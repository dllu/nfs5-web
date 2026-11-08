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
    args = parser.parse_args()
    sdk = ROOT / ".cache/emsdk"
    compiler = sdk / "upstream/emscripten/emcc"
    env = dict(os.environ, EM_CACHE=str(ROOT / ".cache/emscripten"),
               EM_CONFIG=str(sdk / ".emscripten"), TMPDIR=str(ROOT / ".cache/tmp"))
    Path(env['TMPDIR']).mkdir(parents=True, exist_ok=True)
    lift = ROOT / "build/lift"
    objects = ROOT / "build/obj"
    objects.mkdir(parents=True, exist_ok=True)
    runtime = ROOT / "third_party/nfspu-recomp/third_party/pcrecomp/runtime/recomp32"
    flags = ['-O1', '-pthread', '-fno-strict-aliasing', '-fwrapv', '-Wno-unused-label',
             '-Wno-unused-variable', '-Wno-tautological-compare', '-Wno-parentheses-equality',
             '-Werror=implicit-function-declaration',
             '-DRECOMP_TRACE', '-DRECOMP_YIELD_EVERY=1024',
             '-I' + str(ROOT / 'src'), '-I' + str(runtime), '-I' + str(lift)]
    sources = sorted(lift.glob('*.c')) + [ROOT / 'src/web_runtime.c']
    if not (lift / 'manifest.json').exists():
        parser.error('Run tools/prepare.py with your game executable first')
    configuration = hashlib.sha256(json.dumps([str(compiler), flags]).encode()).hexdigest()
    def compile(source):
        obj = objects / (source.stem + '.o')
        signature = obj.with_suffix('.flags')
        dependencies = [source, ROOT / 'src/web_runtime.h', runtime / 'recomp_types.h',
                        lift / 'functions.h']
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
    exports = ['_web_init', '_web_run', '_web_start', '_web_async_status', '_web_async_finish', '_web_call', '_web_registers', '_web_trace',
               '_web_trace_count', '_web_error', '_web_last_pc', '_web_first_pc', '_web_last_import', '_web_heap',
               '_web_set_register', '_web_float_result', '_web_memory_size', '_web_has_entered', '_web_error_thread',
               '_web_shutdown', '_web_timer_stats', '_web_input_key', '_web_input_mouse', '_web_input_focus', '_web_input_cursor', '_web_input_stats',
               '_web_fs_mount', '_web_fs_store', '_web_fs_stats', '_web_fs_snapshot', '_web_fs_acknowledge', '_web_fs_remove', '_web_fs_restore_metadata', '_malloc', '_free']
    exports.extend(['_web_audio_mix', '_web_audio_stats'])
    exports.append('_web_registry_restore')
    exports.append('_web_display_size')
    subprocess.run([str(compiler), *map(str, compiled), '-O1', '-pthread', '-o', str(ROOT / 'dist/engine.js'),
                    '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node', '-sPTHREAD_POOL_SIZE=8',
                    '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=536870912',
                    '-sSTACK_SIZE=8388608', '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
                    '-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8","PThread"]', '-sASSERTIONS=1',
                    '-lm'], env=env, check=True)
    for source in (ROOT / 'web').iterdir():
        if source.is_file():
            shutil.copyfile(source, ROOT / 'dist' / source.name)
    print('Static browser build: dist/')


if __name__ == '__main__':
    main()
