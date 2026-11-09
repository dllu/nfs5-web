#!/usr/bin/env python3
"""Execute the original OpenGL3 about/descriptor and option-reader code."""
import hashlib
import json
from pathlib import Path
import struct
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ESP, UC_X86_REG_EIP

root = Path(__file__).resolve().parents[1]
index = json.loads((root / 'dist/assets.json').read_text())
entry = next(a for a in index['entries'] if a['path'].lower() == 'drivers/opengl3/opengl3z.dll')
payload = (root / 'dist' / entry['url']).read_bytes()
assert hashlib.sha256(payload).hexdigest() == '5a57e6c244ea40ea90d69cf13bd3b79144ebca0a980f1d7cb87af48197581f6f'
pe = pefile.PE(data=payload)
cpu = Uc(UC_ARCH_X86, UC_MODE_32)
cpu.mem_map(0x10000000, pe.OPTIONAL_HEADER.SizeOfImage)
cpu.mem_write(0x10000000, pe.get_memory_mapped_image())
cpu.mem_map(0x01000000, 0x10000)
cpu.mem_map(0x02000000, 0x10000)
u32 = lambda at: struct.unpack('<I', cpu.mem_read(at, 4))[0]
put = lambda at, value: cpu.mem_write(at, struct.pack('<I', value))


def string(at):
    result = bytearray()
    while cpu.mem_read(at, 1)[0]:
        result += cpu.mem_read(at, 1)
        at += 1
    return result.decode('ascii')


# Platform initialization is complete; the descriptor itself is still unset.
# The real descriptor builder and its per-capability option reader execute.
put(0x1000c2c0, 1)
for slot, target in [(0x1000a080, 0x02000000), (0x1000a040, 0x02000010), (0x1000a048, 0x02000020)]:
    put(slot, target)
    cpu.mem_write(target, b'\xc3')
keys = []


def platform(cpu, address, size, user):
    if address not in [0x02000000, 0x02000010, 0x02000020]:
        return
    stack = cpu.reg_read(UC_X86_REG_ESP)
    args = [u32(stack + 4 + i * 4) for i in range(6)]
    if address == 0x02000000:  # sprintf, cdecl
        fmt = string(args[1])
        values = tuple(string(args[2 + i]) for i in range(fmt.count('%s')))
        value = (fmt % values).encode('ascii')
        cpu.mem_write(args[0], value + b'\0')
        result, cleanup = len(value), 0
    elif address == 0x02000010:  # No DLL-adjacent capability INI overrides.
        keys.append(string(args[1]))
        cpu.mem_write(args[3], b'\0')
        result, cleanup = 0, 24
    else:  # No capability environment overrides.
        cpu.mem_write(args[1], b'\0')
        result, cleanup = 0, 12
    cpu.reg_write(UC_X86_REG_EAX, result)
    cpu.reg_write(UC_X86_REG_EIP, u32(stack))
    cpu.reg_write(UC_X86_REG_ESP, stack + 4 + cleanup)


cpu.hook_add(UC_HOOK_CODE, platform)
stack = 0x0100ff00
cpu.reg_write(UC_X86_REG_ESP, stack)
put(stack, 0x0200fff0)
cpu.emu_start(0x10002750, 0x0200fff0, count=200000)
assert cpu.reg_read(UC_X86_REG_ESP) == stack + 4
descriptor = cpu.reg_read(UC_X86_REG_EAX)
words = [u32(descriptor + i * 4) for i in range(u32(descriptor + 4) // 4)]
assert 'OGL_software' in keys
print(json.dumps({'words': words, 'optionKeys': keys}))
