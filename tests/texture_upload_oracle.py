#!/usr/bin/env python3
"""Record native OpenGL texture uploads and normalize their source components.

This executes the supplied DLL's original allocation/update code in Unicorn;
only allocation and OpenGL entry points are replaced by recording callbacks.
The RGBA8 projection describes upload data, not a GPU-rendered/readback image.
Packed component normalization follows OpenGL 4.6 section 2.3.5.1:
https://registry.khronos.org/OpenGL/specs/gl/glspec46.core.pdf
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ESP

ROOT = Path(__file__).resolve().parents[1]
assets = json.loads((ROOT / 'dist/assets.json').read_text())
entry = next(x for x in assets['entries'] if x['path'].lower() == 'drivers/opengl3/opengl3z.dll')
payload = (ROOT / 'dist' / entry['url']).read_bytes()
assert hashlib.sha256(payload).hexdigest() == '5a57e6c244ea40ea90d69cf13bd3b79144ebca0a980f1d7cb87af48197581f6f'
pe = pefile.PE(data=payload)
image = pe.get_memory_mapped_image()


def rgba8(raw, fmt, kind):
    """Decode the GL arguments, independently of the port's Thrash format IDs."""
    if kind == 0x1401:  # GL_UNSIGNED_BYTE
        order = {0x1907: 'RGB', 0x80e0: 'BGR', 0x1908: 'RGBA', 0x80e1: 'BGRA'}[fmt]
        result = bytearray()
        for at in range(0, len(raw), len(order)):
            components = dict(zip(order, raw[at:at + len(order)]))
            result.extend(components.get(channel, 255) for channel in 'RGBA')
        return result
    # The supplied packed uploads use RGB 5_6_5 or BGRA reversed component order.
    if kind == 0x8363:
        assert fmt == 0x1907
        fields = [(11, 5), (5, 6), (0, 5), (0, 0)]
    elif kind == 0x8366:
        assert fmt == 0x80e1
        fields = [(10, 5), (5, 5), (0, 5), (15, 1)]
    else:
        assert kind == 0x8365 and fmt == 0x80e1
        fields = [(8, 4), (4, 4), (0, 4), (12, 4)]
    result = bytearray()
    for (value,) in struct.iter_unpack('<H', raw):
        for shift, bits in fields:
            if not bits:
                result.append(255)
            else:
                maximum = (1 << bits) - 1
                component = value >> shift & maximum
                result.append((component * 255 + maximum // 2) // maximum)
    return result


reports = []
for case in json.load(sys.stdin):
    cpu = Uc(UC_ARCH_X86, UC_MODE_32)
    cpu.mem_map(0x10000000, pe.OPTIONAL_HEADER.SizeOfImage)
    cpu.mem_write(0x10000000, image)
    for address, size in [(0x01000000, 0x10000), (0x02000000, 0x10000), (0x03000000, 0x1000000)]:
        cpu.mem_map(address, size)
    u32 = lambda at: struct.unpack('<I', cpu.mem_read(at, 4))[0]
    put = lambda at, value: cpu.mem_write(at, struct.pack('<I', value))
    put(0x1002bbd0, 0x03000000)
    for fmt in range(3, 8):
        put(0x03000000 + fmt * 4, 1)
    # The staged thrash.ini explicitly selects OGL_TEX_CONVERT_ARGB32=0.
    put(0x1000c188, 0)
    callbacks = {
        0x02000000: ('malloc', 0), 0x02000010: ('gen', 2),
        0x02000020: ('bind', 2), 0x02000030: ('parameter', 3),
        0x02000040: ('image', 9), 0x02000050: ('update', 9),
    }
    for at, (_, count) in callbacks.items():
        cpu.mem_write(at, b'\xc3' if not count else b'\xc2' + struct.pack('<H', count * 4))
    for slot, target in [(0x1000a06c, 0x02000000), (0x1000c098, 0x02000010),
                         (0x1000c084, 0x02000020), (0x1000c064, 0x02000030),
                         (0x1000c0b8, 0x02000040), (0x1000c0c4, 0x02000050)]:
        put(slot, target)
    heap = [0x03100000]
    allocations, uploads = [], []

    def record(cpu, address, size, user):
        if address not in callbacks:
            return
        name, count = callbacks[address]
        stack = cpu.reg_read(UC_X86_REG_ESP)
        args = [u32(stack + 4 + i * 4) for i in range(max(1, count))]
        if name == 'malloc':
            pointer = heap[0]
            heap[0] += (args[0] + 15) & ~15
            assert heap[0] < 0x03800000
            cpu.reg_write(UC_X86_REG_EAX, pointer)
        elif name == 'gen':
            assert args[0] == 1
            put(args[1], 1)
        elif name == 'image':
            target, level, internal, width, height, border, fmt, kind, data = args
            assert target == 0x0de1 and border == 0 and data == 0
            allocations.append({'level': level, 'width': width, 'height': height,
                                'internal': internal, 'format': fmt, 'type': kind})
        elif name == 'update':
            target, level, x, y, width, height, fmt, kind, data = args
            assert target == 0x0de1 and x == y == 0
            stride = (3 if fmt in [0x1907, 0x80e0] else 4) if kind == 0x1401 else 2
            raw = bytes(cpu.mem_read(data, width * height * stride))
            uploads.append({'level': level, 'width': width, 'height': height,
                            'format': fmt, 'type': kind, 'raw': raw.hex(),
                            'rgba8': rgba8(raw, fmt, kind).hex()})

    cpu.hook_add(UC_HOOK_CODE, record)

    def call(address, args):
        stack = 0x0100ff00
        cpu.reg_write(UC_X86_REG_ESP, stack)
        cpu.mem_write(stack, struct.pack('<' + 'I' * (len(args) + 1), 0x0200fff0, *args))
        cpu.emu_start(address, 0x0200fff0, count=2000000)
        assert cpu.reg_read(UC_X86_REG_ESP) == stack + 4 + len(args) * 4
        return cpu.reg_read(UC_X86_REG_EAX)

    texture = call(0x10006d40, [case['width'], case['height'], case['format'], 0, case['extraMips']])
    assert texture
    mutations = []
    for pixels in case['updates']:
        cpu.mem_write(0x03800000, bytes.fromhex(pixels))
        uploads.clear()
        assert call(0x100072a0, [texture, 0x03800000, 0]) == texture
        mutations.append(list(uploads))
    reports.append({'allocations': allocations, 'updates': mutations})
json.dump(reports, sys.stdout)
