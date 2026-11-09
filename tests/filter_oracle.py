#!/usr/bin/env python3
"""Record texture parameters from Verok's unmodified x86 batch submission."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_ESP

root = Path(__file__).resolve().parents[1]
index = json.loads((root / 'dist/assets.json').read_text())
entry = next(a for a in index['entries'] if a['path'].lower() == 'drivers/opengl3/opengl3z.dll')
payload = (root / 'dist' / entry['url']).read_bytes()
assert hashlib.sha256(payload).hexdigest() == '5a57e6c244ea40ea90d69cf13bd3b79144ebca0a980f1d7cb87af48197581f6f'
pe = pefile.PE(data=payload)
reports = []
for group in json.load(sys.stdin):
    cpu = Uc(UC_ARCH_X86, UC_MODE_32)
    cpu.mem_map(0x10000000, pe.OPTIONAL_HEADER.SizeOfImage)
    cpu.mem_write(0x10000000, pe.get_memory_mapped_image())
    for address in [0x01000000, 0x02000000, 0x03000000]:
        cpu.mem_map(address, 0x10000)
    u32 = lambda at: struct.unpack('<I', cpu.mem_read(at, 4))[0]
    put = lambda at, value: cpu.mem_write(at, struct.pack('<I', value))
    parameters = {}
    for slot, callback in [(0x1000c064, 0x02000000), (0x1000c088, 0x02000010)]:
        cpu.mem_write(callback, b'\xc2\x0c\x00')
        put(slot, callback)

    def record(cpu, address, size, user):
        if address in [0x02000000, 0x02000010]:
            stack = cpu.reg_read(UC_X86_REG_ESP)
            assert u32(stack + 4) == 0x0de1
            parameters[u32(stack + 8)] = u32(stack + 12)

    cpu.hook_add(UC_HOOK_CODE, record)

    def state(state, value, force=False):
        stack = 0x0100ff00
        cpu.reg_write(UC_X86_REG_ESP, stack)
        if force:
            cpu.reg_write(UC_X86_REG_ECX, state)
            cpu.reg_write(UC_X86_REG_EDX, 0xffff0000)
            cpu.mem_write(stack, struct.pack('<II', 0x0200fff0, value))
            cpu.emu_start(0x10005450, 0x0200fff0, count=200000)
            assert cpu.reg_read(UC_X86_REG_ESP) == stack + 4
        else:
            cpu.mem_write(stack, struct.pack('<III', 0x0200fff0, state, value))
            cpu.emu_start(0x10009a70, 0x0200fff0, count=200000)
            assert cpu.reg_read(UC_X86_REG_ESP) == stack + 12
        return cpu.reg_read(UC_X86_REG_EAX)

    # The native initializer uses this force flag to install defaults despite
    # its initially zero cache. Subsequent updates use the real exported setter.
    for initial in [(7, 1), (11, 1), (13, 0), (8, 0)]:
        assert state(*initial, force=True) == 1
    put(0x1000c17c, group['override'])
    results = []
    for case in group['cases']:
        returns = [state(*change) for change in case['changes']]
        put(0x1000c2b4, 1)  # Texturing enabled and a bound descriptor with mips.
        put(0x1000d2c0, 0x03000000)
        put(0x03000010, int(case['hasMips']))
        put(0x1000d2d0, 4)
        put(0x1000d2d8, 3)
        cpu.reg_write(UC_X86_REG_ESP, 0x0100ff00)
        parameters.clear()
        # Stop after the original sampler setup, before unrelated VBO upload.
        cpu.emu_start(0x10008a60, 0x10008c22, count=200000)
        results.append({'returns': returns, 'mag': parameters[0x2800],
                        'min': parameters[0x2801], 'u': parameters[0x2802],
                        'v': parameters[0x2803], 'bias': parameters[0x8501]})
        put(0x1000d2d0, 0)
        put(0x1000d2d8, 0)
    reports.append(results)
json.dump(reports, sys.stdout)
