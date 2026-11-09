#!/usr/bin/env python3
"""Record original x86 gamma uniforms and clear colors without a GPU context."""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_ESP, UC_X86_REG_FPCW

root = Path(__file__).resolve().parents[1]
index = json.loads((root / 'dist/assets.json').read_text())
entry = next(x for x in index['entries'] if x['path'].lower() == 'drivers/opengl3/opengl3z.dll')
payload = (root / 'dist' / entry['url']).read_bytes()
assert hashlib.sha256(payload).hexdigest() == '5a57e6c244ea40ea90d69cf13bd3b79144ebca0a980f1d7cb87af48197581f6f'
pe = pefile.PE(data=payload)
reports = []
for group in json.load(sys.stdin):
    cpu = Uc(UC_ARCH_X86, UC_MODE_32)
    cpu.mem_map(0x10000000, pe.OPTIONAL_HEADER.SizeOfImage)
    cpu.mem_write(0x10000000, pe.get_memory_mapped_image())
    cpu.mem_map(0x01000000, 0x10000)
    cpu.mem_map(0x02000000, 0x10000)
    cpu.reg_write(UC_X86_REG_FPCW, 0x37f)
    u32 = lambda at: struct.unpack('<I', cpu.mem_read(at, 4))[0]
    put = lambda at, value: cpu.mem_write(at, struct.pack('<I', value))
    # Execute the driver's unsigned OGL_GAMMA scale/clamp expression itself.
    cpu.reg_write(UC_X86_REG_ESP, 0x0100ff00)
    cpu.reg_write(UC_X86_REG_EBP, 0x0100fe00)
    cpu.reg_write(UC_X86_REG_EAX, group['option'] & 0xffffffff)
    cpu.emu_start(0x10002612, 0x1000267b, count=2000)
    factor = u32(0x1000c178)
    put(0x1000d2b4, 0xff000000)  # Match the host fixture's initial clear color.
    put(0x1000c1e0, 1)
    put(0x1000c04c, 0x02000000)  # glUniform1f
    put(0x1000c0bc, 0x02000010)  # glClearColor
    cpu.mem_write(0x02000000, b'\xc2\x08\x00')
    cpu.mem_write(0x02000010, b'\xc2\x10\x00')
    # MSVCRT _CIpow has x87 register arguments. Spill its two operands and
    # return the host libm result through x87, preserving the surrounding DLL.
    pow_at, callback = 0x02000100, 0x02000200
    base, exponent, result = 0x02001000, 0x02001008, 0x02001010
    code = b'\xd9\xc9\xdd\x1d' + struct.pack('<I', base) + b'\xdd\x1d' + struct.pack('<I', exponent)
    code += b'\xe8' + struct.pack('<i', callback - (pow_at + len(code) + 5))
    code += b'\xdd\x05' + struct.pack('<I', result) + b'\xc3'
    cpu.mem_write(pow_at, code)
    cpu.mem_write(callback, b'\xc3')
    # The imported intrinsic thunk remains the original call target.
    cpu.mem_write(0x10009bb6, b'\xe9' + struct.pack('<i', pow_at - 0x10009bbb))
    uniforms = {'gamma': 0x3f800000, 'clear': [0, 0, 0, 0]}
    calls = []

    def record(cpu, address, size, user):
        if address == callback:
            a = struct.unpack('<d', cpu.mem_read(base, 8))[0]
            b = struct.unpack('<d', cpu.mem_read(exponent, 8))[0]
            cpu.mem_write(result, struct.pack('<d', math.pow(a, b)))
        elif address in [0x02000000, 0x02000010]:
            stack = cpu.reg_read(UC_X86_REG_ESP)
            if address == 0x02000000:
                assert u32(stack + 4) == 1
                uniforms['gamma'] = u32(stack + 8)
                calls.append('gamma')
            else:
                uniforms['clear'] = [u32(stack + 4 + i * 4) for i in range(4)]
                calls.append('clear')

    cpu.hook_add(UC_HOOK_CODE, record)
    results = []
    for state, value in group['states']:
        stack = 0x0100ff00
        cpu.reg_write(UC_X86_REG_ESP, stack)
        cpu.mem_write(stack, struct.pack('<III', 0x0200fff0, state, value))
        calls.clear()
        cpu.emu_start(0x10009a70, 0x0200fff0, count=100000)
        assert cpu.reg_read(UC_X86_REG_ESP) == stack + 12
        results.append({'result': cpu.reg_read(UC_X86_REG_EAX), 'gamma': uniforms['gamma'],
                        'clear': list(uniforms['clear']), 'calls': list(calls)})
    reports.append({'factor': factor, 'states': results})
json.dump(reports, sys.stdout)
