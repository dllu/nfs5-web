#!/usr/bin/env python3
"""Package a clean direct-launch release from dist/ and a pinned completed save."""
import ctypes
import ctypes.util
import hashlib
import re
import gzip
import json
from pathlib import Path
import shutil
import struct
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SAVE_URL = 'https://www.nfs-cars.com/files/download/send/13891/100_completed_save_game.-20150916112323.rar'
SAVE_SHA256 = '27e75bb42c84d19ca389b2648ec6e3f59b2807a83d548891adb0ca670a61d133'


def completed_files():
    archive = ROOT / '.cache/completed-profile.rar'
    archive.parent.mkdir(exist_ok=True)
    if not archive.exists():
        with urllib.request.urlopen(SAVE_URL, timeout=60) as response:
            archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SAVE_SHA256:
        raise ValueError('Completed-save download does not match the pinned archive')
    # Read data only. Never execute or extract archive paths into the checkout.
    library = ctypes.util.find_library('archive')
    if not library:
        raise RuntimeError('libarchive is required to read the completed-save RAR')
    lib = ctypes.CDLL(library)
    lib.archive_read_new.restype = ctypes.c_void_p
    for name in ('archive_read_support_filter_all', 'archive_read_support_format_all', 'archive_read_free'):
        getattr(lib, name).argtypes = [ctypes.c_void_p]
    lib.archive_read_open_filename.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_size_t]
    lib.archive_read_next_header.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    lib.archive_entry_pathname.argtypes = [ctypes.c_void_p]
    lib.archive_entry_pathname.restype = ctypes.c_char_p
    lib.archive_entry_size.argtypes = [ctypes.c_void_p]
    lib.archive_entry_size.restype = ctypes.c_int64
    lib.archive_read_data.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
    lib.archive_read_data.restype = ctypes.c_ssize_t
    reader = lib.archive_read_new()
    files = {}
    try:
        lib.archive_read_support_filter_all(reader)
        lib.archive_read_support_format_all(reader)
        if lib.archive_read_open_filename(reader, str(archive).encode(), 10240):
            raise ValueError('Cannot read completed-save archive')
        entry = ctypes.c_void_p()
        while True:
            status = lib.archive_read_next_header(reader, ctypes.byref(entry))
            if status == 1:  # ARCHIVE_EOF
                break
            if status != 0:
                raise ValueError('Corrupt completed-save archive')
            name = lib.archive_entry_pathname(entry).decode()
            if name not in ('8BL WCAM2.sav', 'BL WCAM21.hud', 'BL WCAM22.hud'):
                continue
            size = lib.archive_entry_size(entry)
            if not 0 < size < 1024 * 1024:
                raise ValueError('Unexpected completed-save size')
            buffer = ctypes.create_string_buffer(size)
            offset = 0
            while offset < size:
                count = lib.archive_read_data(reader, ctypes.byref(buffer, offset), size - offset)
                if count <= 0:
                    raise ValueError('Truncated completed save')
                offset += count
            files[name] = buffer.raw
    finally:
        lib.archive_read_free(reader)
    if len(files) != 3:
        raise ValueError('Missing completed-save files')
    return files


def property_value(data, name, value):
    marker = name.encode() + b'\0'
    if data.count(marker) != 1:
        raise ValueError(f'Unexpected save property: {name}')
    struct.pack_into('<I', data, data.index(marker) + len(marker), value)


def main():
    source, destination = ROOT / 'dist', ROOT / 'build/public'
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'assets').mkdir(exist_ok=True)
    index = json.loads((source / 'assets.json').read_text())
    # Ship the game's blank template, never local players, replays or records.
    templates = {'savedata', 'savedata/xxdefxx.sav', 'savedata/xxhud1xx.hud', 'savedata/xxhud2xx.hud'}
    index['entries'] = [e for e in index['entries'] if not e['path'].lower().startswith('savedata') or e['path'].lower() in templates]
    files = completed_files()
    data = bytearray(files.pop('8BL WCAM2.sav'))
    if data.count(b'BL WCAM2\0') != 2:
        raise ValueError('Unexpected completed-save identity')
    data = data.replace(b'BL WCAM2\0', b'Showroom\0')
    for name, value in {'CarChrome': 2, 'CarDetail': 4, 'GammaCorrection': 100,
                        'Headlights': 1, 'LensFlare': 1, 'Resolutions': 26,
                        'SkyRendering': 2, 'SpecialFX': 3, 'TextureDetail': 4,
                        'ViewDistance': 3}.items():
        property_value(data, 'Graphics.' + name, value)
    files['8Showroom.sav'] = bytes(data)
    files = {name.replace('BL WCAM2', 'Showroom'): data for name, data in files.items()}
    files['player.lst'] = b'Showroom'
    for name, data in files.items():
        digest = hashlib.sha256(data).hexdigest()
        (destination / 'assets' / digest).write_bytes(data)
        index['entries'].append({'path': 'SaveData/' + name, 'size': len(data), 'attributes': 32,
                                 'modified': 0, 'url': './assets/' + digest})
    # Only referenced payloads are public. Ignore development fixtures and stale
    # staged files, including the source installation's personal saves.
    for entry in index['entries']:
        if not entry.get('url', '').startswith('./assets/'):
            continue
        target = destination / entry['url']
        if not target.exists():
            shutil.copyfile(source / entry['url'], target)
    wasm=(source/'engine.wasm').read_bytes()
    wasm_name=hashlib.sha256(wasm).hexdigest()+'.wasm'
    wasm_path=destination/'assets'/wasm_name
    if not wasm_path.exists():
        wasm_path.write_bytes(wasm)
        wasm_path.with_suffix('.wasm.gz').write_bytes(gzip.compress(wasm,compresslevel=9,mtime=0))
    referenced = {Path(e['url']).name for e in index['entries'] if e.get('url', '').startswith('./assets/')}
    referenced.update([wasm_name,wasm_name+'.gz'])
    for path in (destination / 'assets').iterdir():
        if path.name not in referenced:
            path.unlink()
    # Small files otherwise cost hundreds of serial HTTP round trips. Keep a
    # bounded immutable pack separate from the writable/profile overlay.
    pack=bytearray();packed={}
    for entry in index['entries']:
        if entry.get('url') and entry['size']<=65536:
            if entry['url'] not in packed:
                packed[entry['url']]=len(pack)
                pack.extend((destination/entry['url']).read_bytes())
                pack.extend(b'\0'*(-len(pack)%4))
            entry['preloadOffset']=packed[entry['url']]
    # Music selection probes every song's header. Pin those tiny regions so
    # seeking to a new song never re-fetches metadata or evicts its audio pages.
    music=next(e for e in index['entries'] if e['path'].lower()=='gamedata/music/zzzymus.viv')
    data=(destination/music['url']).read_bytes()
    if data[:4]!=b'BIGF':raise ValueError('Invalid music archive')
    count=struct.unpack_from('>I',data,8)[0];cursor=16;tracks=[];ranges=[]
    def pin(offset,size):
        ranges.append({'path':music['path'],'offset':offset,'size':size,'preloadOffset':len(pack)})
        pack.extend(data[offset:offset+size]);pack.extend(b'\0'*(-len(pack)%4))
    for _ in range(count):
        offset,size=struct.unpack_from('>II',data,cursor);cursor=data.index(0,cursor+8)+1
        if offset>len(data) or size>len(data)-offset or size<1:raise ValueError('Invalid music directory')
        tracks.append({'offset':offset,'size':size})
        pin(offset,min(size,65536))
        if size>65536:pin(offset+size-4096,4096)
    pin(0,cursor)
    index['music']={'path':music['path'],'tracks':tracks}
    digest=hashlib.sha256(pack).hexdigest()
    (destination/'assets'/digest).write_bytes(pack)
    (destination/'assets'/(digest+'.gz')).write_bytes(gzip.compress(pack,compresslevel=9,mtime=0))
    index['preload']={'url':'./assets/'+digest,'size':len(pack),'sha256':digest,'ranges':ranges}
    (destination / 'assets.json').write_text(json.dumps(index, separators=(',', ':')) + '\n')
    static = ['engine.js', 'engine.wasm', 'manifest.json', 'game.exe']
    for name in static:
        shutil.copyfile(source / name, destination / name)
    web = ['play.mjs', 'play.css', 'viewport.css', 'runner.mjs', 'runtime.mjs', 'storage.mjs', 'config.mjs',
           'input.mjs', 'controls.mjs', 'memory.mjs', 'assets.mjs', 'streaming.mjs', 'stream-worker.mjs', 'audio.mjs', 'audio-worklet.mjs', 'graphics.mjs', 'pacing.mjs', 'renderer.mjs', 'thrash.wgsl']
    for name in web:
        shutil.copyfile(ROOT / 'web' / name, destination / name)
    shutil.copyfile(ROOT / 'web/play.html', destination / 'index.html')
    shutil.copyfile(ROOT / 'THIRD_PARTY_NOTICES.md', destination / 'THIRD_PARTY_NOTICES.md')
    # Intermediaries may assign CSS/JS a browser TTL despite origin no-cache.
    # Version every code dependency, including Emscripten's Wasm/worker URLs,
    # so one load cannot mix a new launcher with a cached engine or stylesheet.
    version = hashlib.sha256()
    for name in sorted([*static, *web, 'index.html', 'assets.json']):
        version.update(name.encode() + b'\0' + (destination / name).read_bytes())
    revision = version.hexdigest()[:16]
    names = '|'.join(re.escape(name) for name in [*static, *web, 'assets.json'])
    references = re.compile(r'''(['"])((?:\./)?(?:''' + names + r'''))\1''')
    for name in ['index.html', 'engine.js', *[n for n in web if n.endswith('.mjs')]]:
        path = destination / name
        path.write_text(references.sub(lambda m: m[1] + ('./assets/'+wasm_name if m[2].endswith('engine.wasm') else m[2]+'?v='+revision) + m[1], path.read_text()))
    for name in ('engine.wasm', 'engine.js', 'assets.json'):
        compressed = destination / (name + '.gz')
        compressed.write_bytes(gzip.compress((destination / name).read_bytes(), compresslevel=9, mtime=0))
    print(f'Public release: {destination.relative_to(ROOT)}/ ({len(referenced)} asset payloads, revision {revision})')


if __name__ == '__main__':
    main()
