#!/usr/bin/env python3
"""Compare against the supplied native DLL, with its actual game-entry hooks."""
import hashlib
import json
from pathlib import Path
import runpy
import struct
import pefile
from unicorn import Uc as OriginalUc
from unicorn.x86_const import UC_X86_REG_FPCW
import unicorn

ROOT = Path(__file__).resolve().parents[1]
index = json.loads((ROOT / 'dist/assets.json').read_text())
library = next(e for e in index['entries'] if e['path'].lower() == 'nfs5.dll')
payload = (ROOT / 'dist' / library['url']).read_bytes()
assert hashlib.sha256(payload).hexdigest() == 'f24b5c82404f403645e5bc3e52d47e4dd6d19bd92613c243ac31bea285fce758'
pe = pefile.PE(data=payload)


# Extend the independent Unicorn oracle; expected results never use generated C.
def patched_cpu(*args, **kwargs):
    cpu = OriginalUc(*args, **kwargs)
    cpu.reg_write(UC_X86_REG_FPCW, 0x37F)
    cpu.mem_map(0x10000000, 0x10000)
    for section in pe.sections:
        cpu.mem_write(0x10000000 + section.VirtualAddress, section.get_data())
    original_start = cpu.emu_start

    def start(*args, **kwargs):
        # The native projection helper calls MSVCRT's x87 register-argument
        # intrinsics. Execute their corresponding x87 instructions independently
        # of the browser/libm formula (_CIatan2 consumes ST1=y and ST0=x).
        cpu.mem_write(0xF200, b'\xd9\xf2\xdd\xd8\xc3')  # fptan; fstp st0; ret
        cpu.mem_write(0xF210, b'\xd9\xf3\xc3')  # fpatan; ret
        cpu.mem_write(0x1000504C, struct.pack('<I', 0xF200))
        cpu.mem_write(0x10005050, struct.pack('<I', 0xF210))
        for address, target in [(0x44DFB0, 0x10001030), (0x444E00, 0x100012C0),
                                (0x43A08A, 0x10001060), (0x43A3B6, 0x10001070),
                                (0x44EF8B, 0x100012D0), (0x44F110, 0x100012E0)]:
            cpu.mem_write(address, b'\xe9' + struct.pack('<I', (target - address - 5) & 0xffffffff))
        cpu.mem_write(0x4E5817, struct.pack('<I', 0x5B6D5C))
        cpu.mem_write(0x43A086, struct.pack('<I', 0x1000600C))
        # Original bytes written by native 10003390. The wrapper's own body
        # runs unmodified in Unicorn, including its signed edge comparisons.
        for address in [0x4603FF, 0x460525, 0x467D91, 0x556F9A]:
            cpu.mem_write(address, b'\x90\xe8' + struct.pack('<I', (0x10003320 - address - 6) & 0xffffffff))
        for address in [0x46049A, 0x4604D9]:
            cpu.mem_write(address, b'\x90' * 6)
        cpu.mem_write(0x46059E, b'\xeb')
        # The actual projection operand redirects and camera trampolines.
        for address in [0x43A2DF, 0x451826, 0x466FE7, 0x46713A]:
            cpu.mem_write(address, struct.pack('<I', 0x10006134))
        for address in [0x451836, 0x466FF4, 0x46714A]:
            cpu.mem_write(address, struct.pack('<I', 0x10006130))
        for address in [0x451824, 0x451834]:
            cpu.mem_write(address, b'\xd8\x35')  # fdiv replaces fmul
        for address in [0x44ECB2, 0x44F1B1, 0x462BFC, 0x462C26, 0x462CAB,
                        0x462CC4, 0x462DD7, 0x462DF0]:
            cpu.mem_write(address, struct.pack('<I', 0x10006080))
        for address in [0x46414B, 0x46584F, 0x465AE8]:
            cpu.mem_write(address, b'\xa1' + struct.pack('<I', 0x10006080))
        for address, target in [(0x462B80, 0x10003BF0), (0x4692E2, 0x10003C10),
                                (0x4E8B7F, 0x10003C30), (0x4E9900, 0x10003C50),
                                (0x4E9BAA, 0x10003C70)]:
            cpu.mem_write(address, b'\xe9' + struct.pack('<I', (target - address - 5) & 0xffffffff))
        return original_start(*args, **kwargs)

    cpu.emu_start = start
    return cpu


unicorn.Uc = patched_cpu
runpy.run_path(str(ROOT / 'tests/x86_oracle.py'), run_name='__main__')
