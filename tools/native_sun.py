#!/usr/bin/env python3
"""Read reference display/sun state and optional weather keys without changing memory."""
import argparse
from datetime import datetime
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def decode_weather(data):
    """Original 0045A490/0045A8E0/0045A940 use 48-byte weather keys."""
    if not data or len(data) % 48 or len(data) > 400 * 48:
        raise ValueError('Expected 1..400 complete weather records')
    records = []
    for offset in range(0, len(data), 48):
        position = struct.unpack_from('<i', data, offset)[0]
        rain = struct.unpack_from('<f', data, offset + 0x18)[0]
        snow = struct.unpack_from('<f', data, offset + 0x20)[0]
        if position < 0 or not all(math.isfinite(x) for x in [rain, snow]):
            raise ValueError('Invalid weather record')
        records.append({'position': position, 'rain': rain, 'snow': snow})
    return records


def decode_sun(sun):
    if len(sun) != 0x1a0:
        raise ValueError('Expected the complete 416-byte sun snapshot')

    def word(offset):
        return struct.unpack_from('<I', sun, offset)[0]

    def floats(offset, count=1):
        values = struct.unpack_from('<' + 'f' * count, sun, offset)
        return values[0] if count == 1 else values

    return {
        'world': floats(0x11c, 3), 'projected': floats(0x12c, 3),
        'active': sun[0x140], 'initialized': word(0x144),
        'visible': sun[0x18c], 'legacyGate': sun[0x18d],
        'matches': floats(0x190), 'timingSamples': floats(0x198),
        'referenceFormatBytes': word(0x188),
        'reference': list(struct.unpack_from('<16I', sun, 0x148)),
        'textureCount': sum(word(0x70 + i * 4) != 0 for i in range(14)),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='Project-local output prefix')
    parser.add_argument('--reader', type=Path, default=ROOT / 'build/native-memory.exe')
    parser.add_argument('--window', help='Optional X11 window ID to capture with ImageMagick')
    parser.add_argument('--weather', action='store_true', help='Also read sky/weather keyframes')
    args = parser.parse_args()
    prefix = args.output.resolve()
    if not prefix.is_relative_to(ROOT) or prefix == ROOT:
        parser.error('Snapshot outputs must be inside this checkout')
    reader = args.reader.resolve()
    if not reader.is_relative_to(ROOT) or not reader.is_file():
        parser.error('Build the project-local tools/native_memory.c reader first')
    prefix.parent.mkdir(parents=True, exist_ok=True)

    def snapshot(address, size, suffix, nullable=False):
        path = Path(str(prefix) + suffix)
        # A failed/null read must not be mistaken for an older snapshot.
        path.unlink(missing_ok=True)
        windows_path = 'Z:' + str(path).replace('/', '\\')
        result = subprocess.run([sys.executable, str(ROOT / 'tools/native_reference.py'),
                                 '--', str(reader), address, hex(size), windows_path],
                                capture_output=True, text=True, timeout=30)
        if (nullable and address.startswith('@') and result.returncode == 5
                and f'Null pointer at {int(address[1:], 0):08x}' in result.stderr):
            return None, None
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip())
        data = path.read_bytes()
        if len(data) != size:
            raise RuntimeError(f'Incomplete snapshot: {path}')
        target = re.search(r'Read \d+ bytes at ([0-9a-f]+) from native process (\d+)',
                           result.stderr, re.IGNORECASE)
        if not target:
            raise RuntimeError('Native reader did not identify its target')
        return data, {'address': int(target[1], 16), 'process': int(target[2])}

    report = {'observedAt': datetime.now().astimezone().isoformat(), 'atomic': False}
    mode, _ = snapshot('0x619784', 12, '-mode.bin')
    report['mode'] = dict(zip(['width', 'height', 'bits'], struct.unpack('<3I', mode)))
    sun, target = snapshot('@0x627e5c', 0x1a0, '-sun.bin', nullable=True)
    report['sun'] = None
    if sun is not None:
        report['sun'] = {**target, **decode_sun(sun)}
    if args.weather:
        for suffix in ['-weather-controller.bin', '-weather.bin']:
            Path(str(prefix) + suffix).unlink(missing_ok=True)
        sky, sky_target = snapshot('@0x627e48', 0x64, '-sky.bin', nullable=True)
        report['weather'] = None
        if sky is not None:
            controller_address = struct.unpack_from('<I', sky, 0x48)[0]
            if not controller_address:
                raise RuntimeError('Sky has no weather controller')
            controller, _ = snapshot(hex(controller_address), 0x1c, '-weather-controller.bin')
            data_address, count, first, second = struct.unpack_from('<4I', controller)
            if not data_address or not 1 <= count <= 400 or max(first, second) >= count:
                raise RuntimeError('Invalid weather controller')
            data, _ = snapshot(hex(data_address), count * 48, '-weather.bin')
            records = decode_weather(data)
            report['weather'] = {
                'sky': sky_target, 'controllerAddress': controller_address,
                'dataAddress': data_address, 'position': struct.unpack_from('<I', sky, 0x50)[0],
                'indices': [first, second], 'records': records,
                'ranges': {key: [min(r[key] for r in records), max(r[key] for r in records)]
                           for key in ['rain', 'snow']},
            }
    if args.window:
        screenshot = Path(str(prefix) + '.png')
        subprocess.run(['import', '-window', args.window, str(screenshot)],
                       check=True, timeout=20)
        report['screenshot'] = str(screenshot.relative_to(ROOT))
    output = Path(str(prefix) + '.json')
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(output.relative_to(ROOT))


if __name__ == '__main__':
    main()
