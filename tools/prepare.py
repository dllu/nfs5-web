#!/usr/bin/env python3
"""Lift the user's PE32 image; all binary-derived output stays in build/."""
import argparse
from collections import Counter
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
PCRECOMP = ROOT / "third_party/nfspu-recomp/third_party/pcrecomp"
sys.path.insert(0, str(PCRECOMP))
from tools.lift.translator import load_pe, discover_functions
from tools.lift.lift32 import Lifter


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    args = parser.parse_args()
    image = args.executable.resolve()
    info, data, iat = load_pe(str(image))
    if info.image_base != 0x400000:
        parser.error("Expected the NFS5 image at 0x400000")
    output = ROOT / "build/lift"
    output.mkdir(parents=True, exist_ok=True)
    for path in output.glob("*.c"):
        path.unlink()
    functions = discover_functions(data, info, iat)
    lifter = Lifter(iat_map=iat, lifted=set(functions))
    unsupported = Counter()
    records = []
    addresses = sorted(functions)
    declarations = "\n".join(f"void sub_{a:08X}(void);" for a in addresses)
    (output / "functions.h").write_text(declarations + "\n")
    for start in range(0, len(addresses), 200):
        lines = ['#define RECOMP_GENERATED_CODE', '#include "web_runtime.h"',
                 '#include "functions.h"']
        for address in addresses[start:start + 200]:
            function = functions[address]
            function.name = f"sub_{address:08X}"
            source = lifter.lift_function(function)
            # A missing instruction must stop the guest at its exact address.
            def trap(match):
                instruction, pc = match.groups()
                unsupported[instruction.split()[0]] += 1
                return f"web_unsupported(0x{pc}u, {json.dumps(instruction)});"
            source = re.sub(r"; /\* UNIMPLEMENTED: (.*?) \*/ /\* 0x([0-9A-Fa-f]+): .*? \*/", trap, source)
            # Keep runaway guest loops interruptible and bounded during bring-up.
            source = re.sub(r"(?m)^(.*goto L_([0-9A-Fa-f]{8});.*?/\* 0x([0-9A-Fa-f]{8}): .*)$",
                            lambda m: ("    RECOMP_BACKEDGE();\n" if int(m[2], 16) <= int(m[3], 16) else "") + m[0], source)
            lines.append(source)
            records.append({"address": address, "size": function.size,
                            "instructions": function.num_instructions})
        (output / f"code_{start // 200:04d}.c").write_text("\n".join(lines))
        print(f"Lifted {min(start + 200, len(addresses))}/{len(addresses)}", flush=True)
    dispatch = ['#include "web_runtime.h"', '#include "functions.h"',
                'const recomp_dispatch_entry_t recomp_dispatch_table[] = {']
    dispatch += [f"{{0x{a:08X}u, sub_{a:08X}}}," for a in addresses]
    dispatch += ['};', f'const uint32_t recomp_dispatch_count = {len(addresses)};']
    (output / "dispatch.c").write_text("\n".join(dispatch))
    imports = [{"slot": a, "dll": dll, "name": name} for a, (dll, name) in sorted(iat.items())]
    wrappers = ['#include "web_runtime.h"']
    for i, imp in enumerate(imports):
        wrappers.append(f'static void import_{i}(void) {{ web_import({i}); }}')
    wrappers += ['recomp_func_t web_import_lookup(uint32_t va) { switch (va) {']
    for i, imp in enumerate(imports):
        wrappers.append(f'case 0x{imp["slot"]:08X}u: case 0x{0xF0000000 + i * 16:08X}u: return import_{i};')
    wrappers += ['default: return NULL; }}', 'const char *web_import_names[] = {']
    wrappers += [json.dumps(imp['dll'] + '!' + imp['name']) + ',' for imp in imports]
    wrappers += ['};']
    (output / "imports.c").write_text("\n".join(wrappers))
    manifest = {"executable": image.name, "sha256": hashlib.sha256(data).hexdigest(),
                "imageBase": info.image_base, "entry": info.image_base + info.entry_point_rva,
                "sections": [asdict(s) for s in info.sections], "imports": imports,
                "functions": len(functions), "instructions": sum(r['instructions'] for r in records),
                "unsupported": dict(unsupported)}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "functions.json").write_text(json.dumps(records, indent=2) + "\n")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    shutil.copyfile(image, dist / "game.exe")
    shutil.copyfile(output / "manifest.json", dist / "manifest.json")
    print(json.dumps({k: manifest[k] for k in ('sha256', 'functions', 'instructions', 'unsupported')}, indent=2))


if __name__ == "__main__":
    main()
