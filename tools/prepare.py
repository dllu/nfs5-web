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
from verok_quality import IMAGE_SHA, LIBRARY_SHA, QualityHooks
from ui_layout import UiHooks
from detail_hooks import DetailHooks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable", type=Path)
    parser.add_argument("--patch-library", type=Path, help="Verok nfs5.dll (default: beside executable)")
    args = parser.parse_args()
    image = args.executable.resolve()
    info, data, iat = load_pe(str(image))
    image_sha=hashlib.sha256(data).hexdigest()
    patches=[]
    if info.image_base != 0x400000:
        parser.error("Expected the NFS5 image at 0x400000")
    output = ROOT / "build/lift"
    output.mkdir(parents=True, exist_ok=True)
    for path in output.glob("*.c"):
        path.unlink()
    quality = None
    ui = None
    detail = None
    if image_sha == IMAGE_SHA:
        library = args.patch_library or image.with_name('nfs5.dll')
        try:
            quality = QualityHooks(library, output)
        except (OSError, ValueError) as error:
            parser.error(str(error))
        patches.append('verok-graphics-quality')
        patches.append('verok-projection')
        patches.append('verok-visibility')
        ui = UiHooks()
        patches.append('browser-ui-layout')
        patches.append('browser-scaled-ui')
        patches.append('browser-logical-framebuffer')
        detail = DetailHooks()
        patches.append('browser-extended-detail')
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
        if quality:
            lines.append('#include "verok_quality.h"')
        for address in addresses[start:start + 200]:
            function = functions[address]
            function.name = f"sub_{address:08X}"
            source = lifter.lift_function(function)
            if quality:
                source = quality.apply(address, source)
            if ui:
                source = ui.apply(source)
            # Keep logical x87 indices independent of the physical stack file.
            source = re.sub(r'\b_st\[([0-7])\]',r'FP_ST(\1)',source)
            source = re.sub(r'\bg_st_i64\[([0-7])\]',r'FP_I64(\1)',source)
            if detail:
                source = detail.apply(source)
            if re.search(r'\b(?:_st|g_st_i64)\[',re.sub(r'/\*.*?\*/','',source,flags=re.S)):
                parser.error('Unexpected x87 register subscript; review logical indexing')
            if address==0x004DD600 and image_sha=='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906':
                # The supplied nfs5.dll patches 004DD611 to jump to 004DD70B
                # for NoMovies=1. Keep the same stack/register effects in the
                # static translation instead of modifying executable bytes.
                for pc in ('004DD611','004DD70B'):
                    if source.count('/* 0x'+pc+':')!=1:parser.error('Opening-movie hook instructions changed')
                source=re.sub(r'(?m)^(.*?/\* 0x004DD611:.*)$',r'    if (web_skip_intro()) goto WEB_INTRO_RESUME;\n\1',source,count=1)
                source=re.sub(r'(?m)^(.*?/\* 0x004DD70B:.*)$',r'WEB_INTRO_RESUME:\n\1',source,count=1)
                source='int web_skip_intro(void);\n'+source
                patches.append('verok-no-movies')
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
    if quality:
        quality.validate()
    if ui:
        ui.validate()
    if detail:
        detail.validate()
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
    manifest = {"executable": image.name, "sha256": image_sha,"patches":patches,
                "fpuIndexing": True,
                "imageBase": info.image_base, "entry": info.image_base + info.entry_point_rva,
                "sections": [asdict(s) for s in info.sections], "imports": imports,
                "functions": len(functions), "instructions": sum(r['instructions'] for r in records),
                "unsupported": dict(unsupported)}
    if quality:
        manifest['qualityLibrary'] = {'sha256': LIBRARY_SHA, 'hooks': quality.counts}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "functions.json").write_text(json.dumps(records, indent=2) + "\n")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    shutil.copyfile(image, dist / "game.exe")
    shutil.copyfile(output / "manifest.json", dist / "manifest.json")
    print(json.dumps({k: manifest[k] for k in ('sha256', 'functions', 'instructions', 'unsupported')}, indent=2))


if __name__ == "__main__":
    main()
