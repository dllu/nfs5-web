#!/usr/bin/env python3
"""Compile the translated engine and browser host with a checkout-local SDK."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, default=8)
    parser.add_argument("--optimize", type=int, choices=(1, 2), default=2,
                        help="Compiler optimization level (default: 2)")
    parser.add_argument("--profile", action="store_true", help="Emit a Wasm CPU-profile symbol map")
    parser.add_argument("--linear-fpu", action="store_true", help="Use shifted x87 storage for comparisons")
    args = parser.parse_args()
    sdk = ROOT / ".cache/emsdk"
    compiler = sdk / "upstream/emscripten/emcc"
    env = dict(os.environ, EM_CACHE=str(ROOT / ".cache/emscripten"),
               EM_CONFIG=str(sdk / ".emscripten"), TMPDIR=str(ROOT / ".cache/tmp"))
    Path(env['TMPDIR']).mkdir(parents=True, exist_ok=True)
    lift = ROOT / "build/lift"
    # Retain separate objects for comparisons without discarding either build.
    objects = ROOT / ("build/obj" if args.optimize == 1 else "build/obj-o2")
    if not args.linear_fpu:
        objects = ROOT / f"build/obj-fpu-o{args.optimize}"
    objects.mkdir(parents=True, exist_ok=True)
    runtime = ROOT / "third_party/nfspu-recomp/third_party/pcrecomp/runtime/recomp32"
    # Keep the pinned dependency untouched. The local copy adds an address
    # hook before inline memory helpers, including rep-movs and SSE loads.
    includes = ROOT / 'build/include'
    includes.mkdir(exist_ok=True)
    original = (runtime / 'recomp_types.h').read_text()
    marker = '#ifdef RECOMP_FLAT_MEMORY\n'
    if original.count(marker) != 1:
        parser.error('Pinned memory header changed; review the address hook')
    adapted = original.replace(marker, '#if defined(RECOMP_ADDRESS)\n#define ADDR(va) RECOMP_ADDRESS(va)\n#elif defined(RECOMP_FLAT_MEMORY)\n')
    overlap = 'if (df > 0 ? edi - esi >= b : esi - edi >= b)'
    if original.count(overlap) != 1:
        parser.error('Pinned rep-movs helper changed; review mapped alias overlap')
    adapted = adapted.replace('uint32_t b = n * esz;', 'if (!n) return;\n    uint32_t b = n * esz;')
    adapted = adapted.replace(overlap, 'if (df > 0 ? ADDR(edi) - ADDR(esi) >= b : ADDR(esi) - ADDR(edi) >= b)')
    fpu_start = 'static inline void fp_push_impl('
    fpu_end = '/* fist/fistp round'
    if adapted.count(fpu_start) != 1 or adapted.count(fpu_end) != 1:
        parser.error('Pinned x87 helpers changed; review the stack adapter')
    first_fpu, last_fpu = adapted.index(fpu_start), adapted.index(fpu_end)
    adapted = adapted[:first_fpu] + '#include "web_fpu.h"\n\n' + adapted[last_fpu:]
    # Integer MMX is translated by the pinned 32-bit lifter. NFS uses this
    # capability for visual effects too: its sun/flare initializer refuses
    # framebuffer visibility sampling when CPUID leaf 1 hides bit 23.
    # Keep SSE and 3DNow hidden; their floating SIMD paths are incomplete.
    cpu_features = 'g_edx=0x00000111u & g_cpuid_edx1; /* x87, TSC, CMPXCHG8B; no SIMD */'
    if adapted.count(cpu_features) != 1:
        parser.error('Pinned CPUID helper changed; review supported guest features')
    adapted = adapted.replace(cpu_features,
        'g_edx=0x00800111u & g_cpuid_edx1; /* x87, TSC, CMPXCHG8B, integer MMX */')
    memory_header = includes / 'recomp_types.h'
    if not memory_header.exists() or memory_header.read_text() != adapted:
        memory_header.write_text(adapted)
    optimization = f'-O{args.optimize}'
    flags = [optimization, '-pthread', '-fno-strict-aliasing', '-fwrapv', '-Wno-unused-label',
             '-Wno-unused-variable', '-Wno-tautological-compare', '-Wno-parentheses-equality',
             '-Werror=implicit-function-declaration',
             '-DRECOMP_TRACE', '-DRECOMP_YIELD_EVERY=1024',
             '-I' + str(ROOT / 'src'), '-I' + str(includes), '-I' + str(runtime), '-I' + str(lift)]
    if not args.linear_fpu:
        flags.append('-DWEB_FPU_CIRCULAR')
    sources = sorted(lift.glob('*.c')) + [ROOT / 'src/web_runtime.c']
    if not (lift / 'manifest.json').exists():
        parser.error('Run tools/prepare.py with your game executable first')
    metadata=json.loads((lift/'manifest.json').read_text())
    if not args.linear_fpu and not metadata.get('fpuIndexing'):
        parser.error('Run tools/prepare.py again to generate logical x87 indices')
    if metadata['sha256']=='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906' and 'verok-no-movies' not in metadata.get('patches',[]):
        parser.error('Run tools/prepare.py again to generate the opening-movie configuration hook')
    if metadata['sha256']=='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906' and 'verok-graphics-quality' not in metadata.get('patches',[]):
        parser.error('Run tools/prepare.py again to generate the Verok graphics-quality hooks')
    if metadata['sha256']=='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906' and 'verok-projection' not in metadata.get('patches',[]):
        parser.error('Run tools/prepare.py again to generate the Verok projection hooks')
    if metadata['sha256']=='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906' and 'verok-visibility' not in metadata.get('patches',[]):
        parser.error('Run tools/prepare.py again to generate the Verok visibility/readback hooks')
    if metadata['sha256']=='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906' and 'browser-ui-layout' not in metadata.get('patches',[]):
        parser.error('Run tools/prepare.py again to generate the browser UI layout hooks')
    if metadata['sha256']=='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906' and 'browser-scaled-ui' not in metadata.get('patches',[]):
        parser.error('Run tools/prepare.py again to generate the browser loading-screen and minimap hooks')
    if metadata['sha256']=='c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906' and 'browser-logical-framebuffer' not in metadata.get('patches',[]):
        parser.error('Run tools/prepare.py again to generate the logical loading-framebuffer lock hook')
    configuration = hashlib.sha256(json.dumps([str(compiler), flags]).encode()).hexdigest()
    def compile(source):
        obj = objects / (source.stem + '.o')
        signature = obj.with_suffix('.flags')
        dependencies = [source, ROOT / 'src/web_runtime.h', ROOT / 'src/web_memory.h', memory_header,
                        ROOT / 'src/web_fpu.h', lift / 'functions.h']
        if (lift / 'verok_quality.h').exists():
            dependencies.append(lift / 'verok_quality.h')
        if source.parent == ROOT / 'src':
            dependencies.extend((ROOT / 'src').glob('*.h'))
        if (obj.exists() and signature.exists() and signature.read_text() == configuration
                and obj.stat().st_mtime > max(p.stat().st_mtime for p in dependencies)):
            return obj
        subprocess.run([str(compiler), *flags, '-c', str(source), '-o', str(obj)], env=env, check=True)
        signature.write_text(configuration)
        print('Compiled ' + source.name, flush=True)
        return obj
    # Prime the Emscripten cache before parallel compiler workers use it.
    first = compile(sources[0])
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        compiled = [first, *pool.map(compile, sources[1:])]
    exports = ['_web_init', '_web_run', '_web_start', '_web_stop', '_web_async_status', '_web_async_finish', '_web_call', '_web_registers', '_web_trace',
               '_web_trace_count', '_web_error', '_web_last_pc', '_web_first_pc', '_web_last_import', '_web_heap',
               '_web_set_register', '_web_float_result', '_web_memory_size', '_web_has_entered', '_web_error_thread',
               '_web_shutdown', '_web_timer_stats', '_web_input_key', '_web_input_mouse', '_web_input_focus', '_web_input_cursor', '_web_input_stats',
               '_web_fs_mount', '_web_fs_store', '_web_fs_stats', '_web_fs_snapshot', '_web_fs_acknowledge', '_web_fs_remove', '_web_fs_restore_metadata', '_malloc', '_free']
    exports.extend(['_web_audio_mix', '_web_audio_stats'])
    exports.extend(['_web_audio_start','_web_audio_tick','_web_audio_stop'])
    exports.append('_web_registry_restore')
    exports.append('_web_display_size')
    exports.extend(['_web_projection_update','_web_projection_state'])
    exports.extend(['_web_ui_layout','_web_ui_extent','_web_ui_coordinate','_web_ui_mouse'])
    exports.append('_web_ui_expand')
    exports.extend(['_web_gpu_transport', '_web_gpu_attach', '_web_gpu_fail', '_web_gpu_stats'])
    exports.append('_web_thrash_textures')
    exports.extend(['_web_pointer','_web_mapping_stats'])
    exports.extend(['_web_intro_config','_web_intro_skipped'])
    exports.extend(['_web_process_exited','_web_exit_code'])
    exports.extend(['_web_input_analog','_web_analog_state'])
    exports.extend(['_web_fs_preload','_web_fs_io_stats'])
    exports.append('_web_flare_angle')
    profile_flags = ['--emit-symbol-map'] if args.profile else []
    if not args.profile:
        (ROOT / 'dist/engine.js.symbols').unlink(missing_ok=True)
    subprocess.run([str(compiler), *map(str, compiled), optimization, '-pthread', *profile_flags, '-o', str(ROOT / 'dist/engine.js'),
                    '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node', '-sPTHREAD_POOL_SIZE=8',
                    '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=402653184',
                    '-sSTACK_SIZE=8388608', '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
                    '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8","wasmMemory","PThread"]', '-sASSERTIONS=1',
                    '-lm'], env=env, check=True)
    for source in (ROOT / 'web').iterdir():
        if source.is_file():
            shutil.copyfile(source, ROOT / 'dist' / source.name)
    print('Static browser build: dist/')


if __name__ == '__main__':
    main()
