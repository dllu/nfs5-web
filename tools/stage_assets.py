#!/usr/bin/env python3
"""Copy user-owned game assets into the ignored static build, without changing the installation."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('installation', type=Path)
    args = parser.parse_args()
    installation = args.installation.resolve()
    manifest = json.loads((ROOT / 'build/lift/manifest.json').read_text())
    executable = installation / manifest['executable']
    if hashlib.sha256(executable.read_bytes()).hexdigest() != manifest['sha256']:
        parser.error('Installation executable does not match the prepared translation')
    destination = ROOT / 'dist/assets'
    destination.mkdir(parents=True, exist_ok=True)
    entries = []
    total = 0
    # Parents precede children. Content-addressed payloads avoid URL/case issues.
    for source in sorted(installation.rglob('*'), key=lambda p: (len(p.parts), p.as_posix())):
        if source.is_symlink():
            parser.error(f'Symlinks are not supported: {source.relative_to(installation)}')
        info = source.stat()
        record = {'path': source.relative_to(installation).as_posix(),
                  'size': 0, 'attributes': 16 if source.is_dir() else 32,
                  'modified': int(info.st_mtime)}
        if source.is_file():
            if source == executable:
                record['url'] = './game.exe'
            else:
                digest = hashlib.sha256(source.read_bytes()).hexdigest()
                target = destination / digest
                if not target.exists():
                    shutil.copyfile(source, target)
                record['url'] = './assets/' + digest
            record['size'] = info.st_size
            total += info.st_size
        entries.append(record)
    (ROOT / 'dist/assets.json').write_text(json.dumps({'executable': manifest['sha256'], 'entries': entries}, indent=2) + '\n')
    print(f'Staged {len(entries)} files/directories, {total / 1024**2:.1f} MiB; payloads load on demand')


if __name__ == '__main__':
    main()
