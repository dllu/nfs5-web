#!/usr/bin/env python3
"""Run selected original game routines in Unicorn, independently of the lifter."""
import json
from pathlib import Path
import struct
import sys

from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDX,
                              UC_X86_REG_EBX, UC_X86_REG_ESP, UC_X86_REG_EBP,
                              UC_X86_REG_ESI, UC_X86_REG_EDI)

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'dist/manifest.json').read_text())
image = (ROOT / 'dist/game.exe').read_bytes()
registers = [UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDX, UC_X86_REG_EBX,
             UC_X86_REG_ESP, UC_X86_REG_EBP, UC_X86_REG_ESI, UC_X86_REG_EDI]
results = []
request = json.load(sys.stdin)
memory_size = request['memorySize']
for case in request['cases']:
    cpu = Uc(UC_ARCH_X86, UC_MODE_32)
    cpu.mem_map(0, memory_size)
    for section in manifest['sections']:
        start = section['raw_offset']
        cpu.mem_write(manifest['imageBase'] + section['virtual_address'],
                      image[start:start + section['raw_size']])
    for memory in case.get('memory', []):
        cpu.mem_write(memory['address'], bytes.fromhex(memory['hex']))
    for reg, value in zip(registers, case.get('registers', [0] * 8)):
        cpu.reg_write(reg, value)
    # Match web_call's four-argument cdecl stack, with a real return target.
    stack = case.get('stack', memory_size - 36)
    args = case.get('args', [])
    args = args + [0] * max(0, 4 - len(args))
    sentinel = 0xF000
    cpu.mem_write(stack, struct.pack('<' + 'I' * (1 + len(args)), sentinel, *args))
    cpu.reg_write(UC_X86_REG_ESP, stack)
    cpu.emu_start(case['entry'], sentinel, count=1000000)
    result = {'registers': [cpu.reg_read(r) for r in registers],
              'memory': [bytes(cpu.mem_read(m['address'], m['size'])).hex()
                         for m in case.get('observe', [])]}
    if case.get('float'):
        # Store the original x87 return value as a double for a Wasm comparison.
        cpu.mem_write(sentinel, b'\xdd\x1d' + struct.pack('<I', 0xF100))
        cpu.emu_start(sentinel, sentinel + 6, count=1)
        result['float'] = struct.unpack('<d', cpu.mem_read(0xF100, 8))[0]
    results.append(result)
print(json.dumps(results))
