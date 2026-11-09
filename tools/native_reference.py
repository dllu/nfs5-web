#!/usr/bin/env python3
"""Run the installed Wine/FEX game from a project-local, writable reference copy."""
import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    wines = Path.home() / 'wines'
    parser.add_argument('--source-prefix', type=Path, default=wines / 'prefixes/nfs5/prefix')
    parser.add_argument('--reference-dir', type=Path, default=ROOT / '.cache/native-reference')
    parser.add_argument('--wine-install', type=Path, default=wines / 'build/wine/wine-install-mainline')
    parser.add_argument('--proton-dist', type=Path, default=wines / 'build/proton/proton-build-arm64/dist')
    parser.add_argument('--fex-install', type=Path, default=wines / 'build/fex/FEX-upstream-main/install-windows')
    parser.add_argument('--dry-run', action='store_true', help='Print the launch command without copying or running')
    parser.add_argument('--fe-config', type=Path,
                        help='Mount a project-local fe.txt read-only (use a fresh --reference-dir)')
    parser.add_argument('wine_args', nargs=argparse.REMAINDER,
                        help='Optional Wine command instead of nfs5.exe (after --)')
    args = parser.parse_args()
    config = args.fe_config.resolve() if args.fe_config else None
    if config and (not config.is_relative_to(ROOT) or not config.is_file()):
        parser.error('Race configuration must be an existing file inside this project')
    reference = args.reference_dir.resolve()
    if not reference.is_relative_to(ROOT) or reference == ROOT:
        parser.error('The writable reference directory must be inside this project')
    source = args.source_prefix.resolve()
    prefix = reference / 'prefix'
    for name in ['prefix', 'tmp', 'cache', 'config', 'data', 'gstreamer-1.0']:
        if not (reference / name).resolve().is_relative_to(ROOT):
            parser.error('Reference paths must resolve inside this project: ' + name)
    if source == prefix.resolve() or source.is_relative_to(reference) or reference.is_relative_to(source):
        parser.error('Source prefix must be separate from the reference copy')
    wine = args.wine_install.resolve() / 'bin/wine'
    fex = args.fex_install.resolve()
    proton = args.proton_dist.resolve()
    for path in [source / 'system.reg', wine, fex / 'lib', proton / 'files']:
        if not path.exists():
            parser.error('Missing native dependency: ' + str(path))
    if not shutil.which('bwrap'):
        parser.error('Native reference runs require bubblewrap (bwrap)')
    game = prefix / 'drive_c/Program Files/Electronic Arts/Need For Speed - Porsche Unleashed'
    if not (source / game.relative_to(prefix) / 'nfs5.exe').is_file():
        parser.error('Source prefix does not contain the installed game')
    env = {
        'WINEPREFIX': str(prefix), 'WINEARCH': 'win64',
        'WINEDLLPATH': f'{fex}/lib:{fex}/lib/wine/aarch64-windows:{proton}/files/lib/vkd3d',
        'LD_LIBRARY_PATH': ':'.join(map(str, [fex / 'lib', *[
            proton / 'files/lib' / arch for arch in ['aarch64-linux-gnu', 'x86_64-linux-gnu', 'i386-linux-gnu']]])),
        'PATH': f'{wine.parent}:{proton}/files/bin-arm64:' + os.environ.get('PATH', ''),
        'WINE_GST_REGISTRY_DIR': str(reference / 'gstreamer-1.0'),
        'XDG_CACHE_HOME': str(reference / 'cache'), 'XDG_CONFIG_HOME': str(reference / 'config'),
        'XDG_DATA_HOME': str(reference / 'data'), 'TMPDIR': '/tmp',
        'FEX_X87REDUCEDPRECISION': '1', 'WINEFSYNC': '1', 'WINEDEBUG': '-all',
    }
    command = ['bwrap', '--die-with-parent', '--ro-bind', '/', '/', '--bind', str(ROOT), str(ROOT),
               '--ro-bind', str(source), str(source),
               '--dev-bind', '/dev', '/dev', '--bind', str(reference / 'tmp'), '/tmp']
    if Path('/tmp/.X11-unix').is_dir():
        command += ['--ro-bind', '/tmp/.X11-unix', '/tmp/.X11-unix']
    if config:
        command += ['--ro-bind', str(config), str(game / 'fe.txt')]
    command += ['--chdir', str(game)]
    for key, value in env.items():
        command += ['--setenv', key, value]
    wine_args = args.wine_args
    if wine_args[:1] == ['--']:
        wine_args = wine_args[1:]
    command += [str(wine), *(wine_args or [str(game / 'nfs5.exe')])]
    if args.dry_run:
        print(shlex.join(command))
        return
    reference.mkdir(parents=True, exist_ok=True)
    if not prefix.exists():
        print('Copying native prefix into ' + str(prefix), flush=True)
        subprocess.run(['cp', '-a', '--reflink=auto', str(source), str(prefix)], check=True)
    if not (prefix / 'system.reg').is_file() or not (game / 'nfs5.exe').is_file():
        parser.error('Reference prefix is incomplete: ' + str(prefix))
    for name in ['tmp', 'cache', 'config', 'data', 'gstreamer-1.0']:
        (reference / name).mkdir(exist_ok=True)
    print('Native reference prefix: ' + str(prefix), flush=True)
    os.execvp(command[0], command)


if __name__ == '__main__':
    main()
