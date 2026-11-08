#!/usr/bin/env python3
"""Install the pinned toolchain without writing outside this checkout."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SDK_COMMIT = 'c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56'
SDK_VERSION = '4.0.23'


def main():
    temporary = ROOT / '.cache/tmp'
    temporary.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TMPDIR=str(temporary), PIP_CACHE_DIR=str(ROOT / '.cache/pip'),
               npm_config_cache=str(ROOT / '.cache/npm'))
    def run(*command):
        subprocess.run(command, cwd=ROOT, env=env, check=True)
    run('git', 'submodule', 'update', '--init', '--recursive')
    sdk = ROOT / '.cache/emsdk'
    if not sdk.exists():
        run('git', 'clone', '--depth', '1', '--branch', SDK_VERSION,
            'https://github.com/emscripten-core/emsdk.git', str(sdk))
    revision = subprocess.check_output(['git', '-C', str(sdk), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != SDK_COMMIT:
        raise SystemExit(f'Expected emsdk {SDK_COMMIT}; found {revision} at {sdk}')
    run(str(sdk / 'emsdk'), 'install', SDK_VERSION)
    run(str(sdk / 'emsdk'), 'activate', SDK_VERSION)
    python = ROOT / '.venv/bin/python'
    if not python.exists():
        run(sys.executable, '-m', 'venv', str(ROOT / '.venv'))
    run(str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'requirements.txt'))
    run('npm', 'ci', '--ignore-scripts')
    print('Toolchain ready. Use .venv/bin/python tools/prepare.py /path/to/nfs5.exe')


if __name__ == '__main__':
    main()
