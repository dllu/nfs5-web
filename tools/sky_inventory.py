#!/usr/bin/env python3
"""Inventory staged sky definitions to select useful native visual comparisons."""
import argparse
import json
import math
from pathlib import Path
import struct

from native_sun import decode_weather

ROOT = Path(__file__).resolve().parents[1]


def decode_sky(data):
    if len(data) < 0xce8:
        raise ValueError('Incomplete sky definition')
    revision = struct.unpack_from('<I', data)[0]
    if revision not in (7, 9):
        raise ValueError('Expected a complete revision-7 or revision-9 sky definition')
    # Original 00460780 tests these X/Z inputs, not the sky texture's brightness.
    x, z, scale = struct.unpack_from('<3f', data, 0xcdc)
    if not all(math.isfinite(v) for v in (x, z, scale)):
        raise ValueError('Non-finite sun definition')
    limit = struct.unpack('<f', struct.pack('<f', .02))[0]
    result = {'revision': revision, 'sunEnabled': not (-limit < x < limit and -limit < z < limit),
              'sunInputXZ': [x, z], 'sunScale': scale, 'weather': None}
    if revision == 9:
        offset, count = 0x1a5c, 0
        while True:
            at = offset + count * 48
            if at + 4 > len(data):
                raise ValueError('Unterminated weather keys')
            if struct.unpack_from('<i', data, at)[0] < 0:
                break
            count += 1
            if count > 400:
                raise ValueError('Too many weather keys')
        keys = decode_weather(data[offset:offset + count * 48])
        result['weather'] = {'keys': count, **{
            key: [min(k[key] for k in keys), max(k[key] for k in keys)]
            for key in ('rain', 'snow')}}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='Project-local JSON report')
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT) or output == ROOT:
        parser.error('Inventory output must be inside this checkout')
    manifest = json.loads((ROOT / 'dist/assets.json').read_text())
    rows, excluded = [], []
    for entry in manifest['entries']:
        path = entry['path'].lower()
        if not path.startswith('gamedata/track/sky/') or not path.endswith('.bin'):
            continue
        if path.endswith('_lightning.bin'):
            excluded.append(entry['path'])
            continue
        payload = (ROOT / 'dist' / entry['url']).resolve()
        if not payload.is_relative_to(ROOT / 'dist'):
            raise ValueError('Asset payload is outside dist: ' + entry['path'])
        rows.append({'path': entry['path'], **decode_sky(payload.read_bytes())})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'definitions': rows, 'excludedLightning': excluded},
                                 indent=2, allow_nan=False) + '\n')
    print(f'{len(rows)} sky definitions, {sum(r["sunEnabled"] for r in rows)} with a sun; '
          f'{len(excluded)} separate lightning files excluded')


if __name__ == '__main__':
    main()
