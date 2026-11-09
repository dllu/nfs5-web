#!/usr/bin/env python3
"""Record fog uniforms from the supplied, unmodified x86 OpenGL3 driver."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ESP, UC_X86_REG_FPCW

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
cpu.reg_write(UC_X86_REG_FPCW, 0x37f)
u32 = lambda at: struct.unpack('<I', cpu.mem_read(at, 4))[0]
put = lambda at, value: cpu.mem_write(at, struct.pack('<I', value))
# The real state dispatcher/cache and x87 conversions execute unchanged.
# Only the OpenGL entry points are replaced by argument-recording stdcall stubs.
callbacks = {0x02000000: ('integer', 2), 0x02000010: ('float', 2), 0x02000020: ('color', 5)}
for address, (_, count) in callbacks.items():
    cpu.mem_write(address, b'\xc2' + struct.pack('<H', count * 4))
for slot, callback in [(0x1000c0ac, 0x02000000), (0x1000c04c, 0x02000010), (0x1000c074, 0x02000020)]:
    put(slot, callback)
locations = {0x1000c1c8: 1, 0x1000c1d4: 2, 0x1000c1c0: 3, 0x1000c1cc: 4, 0x1000c1f0: 5}
for slot, location in locations.items():
    put(slot, location)
uniforms = {1: [0], 2: [0, 0, 0, 0], 3: [0], 4: [0], 5: [0]}
calls = []


def record(cpu, address, size, user):
    if address not in callbacks:
        return
    kind, count = callbacks[address]
    stack = cpu.reg_read(UC_X86_REG_ESP)
    location = u32(stack + 4)
    values = [u32(stack + 8 + i * 4) for i in range(count - 1)]
    assert location in uniforms, (kind, location)
    uniforms[location] = values
    calls.append({'kind': kind, 'location': location, 'values': values})


cpu.hook_add(UC_HOOK_CODE, record)
results = []
for state, value in json.load(sys.stdin)['states']:
    stack = 0x0100ff00
    cpu.reg_write(UC_X86_REG_ESP, stack)
    cpu.mem_write(stack, struct.pack('<III', 0x0200fff0, state, value))
    calls.clear()
    cpu.emu_start(0x10009a70, 0x0200fff0, count=200000)
    assert cpu.reg_read(UC_X86_REG_ESP) == stack + 12
    results.append({'result': cpu.reg_read(UC_X86_REG_EAX),
                    'mode': uniforms[1][0], 'color': list(uniforms[2]),
                    'near': uniforms[3][0], 'far': uniforms[4][0],
                    'density': uniforms[5][0], 'calls': list(calls)})
json.dump(results, sys.stdout)
