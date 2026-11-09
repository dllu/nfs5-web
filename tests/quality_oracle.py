#!/usr/bin/env python3
"""Compare against the supplied native DLL, with its actual game-entry hooks."""
import hashlib
import json
from pathlib import Path
import runpy
import struct
import pefile
from unicorn import Uc as OriginalUc
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
    cpu.mem_map(0x10000000, 0x10000)
    for section in pe.sections:
        cpu.mem_write(0x10000000 + section.VirtualAddress, section.get_data())
    original_start = cpu.emu_start

    def start(*args, **kwargs):
        for address, target in [(0x44DFB0, 0x10001030), (0x444E00, 0x100012C0),
                                (0x43A08A, 0x10001060), (0x43A3B6, 0x10001070),
                                (0x44EF8B, 0x100012D0), (0x44F110, 0x100012E0)]:
            cpu.mem_write(address, b'\xe9' + struct.pack('<I', (target - address - 5) & 0xffffffff))
        cpu.mem_write(0x4E5817, struct.pack('<I', 0x5B6D5C))
        cpu.mem_write(0x43A086, struct.pack('<I', 0x1000600C))
        return original_start(*args, **kwargs)

    cpu.emu_start = start
    return cpu


unicorn.Uc = patched_cpu
runpy.run_path(str(ROOT / 'tests/x86_oracle.py'), run_name='__main__')
