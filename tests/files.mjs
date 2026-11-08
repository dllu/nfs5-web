import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const { module, base, manifest } = runtime;
const view = new DataView(module.HEAPU8.buffer, base), data = 0x800000, output = data + 4096, stack = runtime.memorySize - 0x10000;
const get = p => view.getUint32(p, true), put = (p, v) => view.setUint32(p, v >>> 0, true);
const text = (s, p = data) => { module.HEAPU8.set(Buffer.from(s + '\0', 'latin1'), base + p); return p; };
const string = p => { let end = p; while (module.HEAPU8[base + end]) end++; return Buffer.from(module.HEAPU8.subarray(base + p, base + end)).toString('latin1'); };
let calls = 0;
function invoke(name, ...args) {
  args.forEach((v, i) => put(stack + i * 4, v)); module._web_set_register(4, stack);
  const address = manifest.imports.find(item => item.name === name).slot;
  assert.equal(module._web_run(address, 3000), 0, module.UTF8ToString(module._web_error()));
  const registers = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
  assert.equal(registers[4], stack + args.length * 4, `${name} stdcall cleanup`); calls++;
  return registers[0];
}
const open = (name, access = 0x80000000, share = 3, disposition = 3, flags = 128) => invoke('CreateFileA', text(name), access, share, 0, disposition, flags, 0);
const close = handle => assert.equal(invoke('CloseHandle', handle), 1);
const error = value => assert.equal(invoke('GetLastError'), value);
try {
  // Literal expected paths exercise independent DOS drive/parent semantics.
  for (const [source, expected] of [
    ['file.bin', 'C:\\nfs5\\file.bin'], ['.\\FEData/../GameData\\car.viv', 'C:\\nfs5\\GameData\\car.viv'],
    ['c:relative.txt', 'C:\\nfs5\\relative.txt'], ['D:relative.txt', 'D:\\relative.txt'],
    ['\\root\\..\\game.txt', 'C:\\game.txt'], ['C:\\..\\..\\foo', 'C:\\foo'],
    ['C:/one//two/../three/', 'C:\\one\\three\\'], ['C:\\name.  ', 'C:\\name'],
  ]) {
    const length = invoke('GetFullPathNameA', text(source), 1024, output, output + 2048);
    assert.equal(length, expected.length); assert.equal(string(output), expected);
    const part = get(output + 2048);
    assert.equal(part ? string(part) : '', expected.endsWith('\\') ? '' : expected.slice(expected.lastIndexOf('\\') + 1));
  }
  module.HEAPU8.fill(0xa5, base + output, base + output + 8); put(output + 2048, 0x1234);
  assert.equal(invoke('GetFullPathNameA', text('file.bin'), 2, output, output + 2048), 17);
  assert.equal(get(output), 0xa5a5a5a5); assert.equal(get(output + 2048), 0x1234);
  assert.equal(invoke('GetFullPathNameA', text('bad:name'), 1024, output, 0), 0); error(123);
  assert.equal(invoke('GetCurrentDirectoryA', 0, 0), 8);
  assert.equal(invoke('GetCurrentDirectoryA', 1024, output), 7); assert.equal(string(output), 'C:\\nfs5');
  assert.equal(invoke('GetLogicalDrives'), 12);
  assert.equal(invoke('GetLogicalDriveStringsA', 0, 0), 9);
  assert.equal(invoke('GetLogicalDriveStringsA', 9, output), 8);
  assert.deepEqual(Array.from(module.HEAPU8.subarray(base + output, base + output + 9)), [67,58,92,0,68,58,92,0,0]);
  assert.equal(invoke('CreateDirectoryA', text('FsChecks'), 0), 1);
  assert.equal(invoke('CreateDirectoryA', text('fschecks'), 0), 0); error(183);
  assert.equal(invoke('SetCurrentDirectoryA', text('FSCHECKS')), 1);
  assert.equal(invoke('SetCurrentDirectoryA', text('missing')), 0); error(3);
  assert.equal(invoke('SetCurrentDirectoryA', text('D:\\')), 1);
  assert.equal(invoke('GetFullPathNameA', text('C:sample'), 1024, output, 0), 23);
  assert.equal(string(output), 'C:\\nfs5\\FsChecks\\sample');
  assert.equal(invoke('SetCurrentDirectoryA', text('C:')), 1);

  const source = Uint8Array.from({ length: 196731 }, (_, i) => (i * 37 + (i >>> 8)) & 255);
  await writeFile(new URL('../build/fs-fixture.bin', import.meta.url), source);
  runtime.mount('C:\\nfs5\\FsChecks\\Original.bin', { url: new URL('../build/fs-fixture.bin', import.meta.url).href, size: source.length });
  const original = open('ORIGINAL.BIN'); assert.notEqual(original, 0xffffffff);
  assert.equal(invoke('GetFileType', original), 1);
  assert.equal(invoke('GetFileSize', original, output), source.length); assert.equal(get(output), 0);
  assert.equal(invoke('SetFilePointer', original, 65530, 0, 0), 65530);
  assert.equal(invoke('ReadFile', original, output, 100, output + 512, 0), 1); assert.equal(get(output + 512), 100);
  assert.deepEqual(module.HEAPU8.subarray(base + output, base + output + 100), source.subarray(65530, 65630));
  assert.equal(invoke('SetFilePointer', original, -10, 0, 2), source.length - 10);
  assert.equal(invoke('ReadFile', original, output, 50, output + 512, 0), 1); assert.equal(get(output + 512), 10);
  assert.deepEqual(module.HEAPU8.subarray(base + output, base + output + 10), source.subarray(-10));
  assert.equal(invoke('ReadFile', original, output, 50, output + 512, 0), 1); assert.equal(get(output + 512), 0);
  assert.equal(invoke('SetFilePointer', original, -1, 0, 0), 0xffffffff); error(131);
  assert.equal(invoke('WriteFile', original, data, 1, output + 512, 0), 0); error(5);
  close(original); assert.equal(invoke('ReadFile', original, output, 1, output + 512, 0), 0); error(6);

  const writable = open('save.bin', 0xc0000000, 1, 2); assert.notEqual(writable, 0xffffffff);
  assert.equal(open('SAVE.BIN', 0x40000000, 3), 0xffffffff); error(32);
  assert.equal(open('save.bin', 0x80000000, 0), 0xffffffff); error(32);
  text('Porsche'); assert.equal(invoke('WriteFile', writable, data, 7, output + 512, 0), 1);
  assert.equal(get(output + 512), 7);
  assert.equal(invoke('DuplicateHandle', 0xffffffff, writable, 0xffffffff, output + 1024, 0, 0, 2), 1);
  const duplicate = get(output + 1024);
  assert.equal(invoke('SetFilePointer', duplicate, 2, 0, 0), 2);
  assert.equal(invoke('SetFilePointer', writable, 0, 0, 1), 2, 'Duplicate handles share their file position');
  assert.equal(invoke('ReadFile', writable, output, 7, output + 512, 0), 1);
  assert.equal(get(output + 512), 5); assert.equal(string(output).slice(0, 5), 'rsche');
  assert.equal(invoke('SetFilePointer', writable, 12, 0, 0), 12);
  text('!'); assert.equal(invoke('WriteFile', writable, data, 1, output + 512, 0), 1);
  assert.equal(invoke('SetFilePointer', writable, 0, 0, 0), 0);
  assert.equal(invoke('ReadFile', writable, output, 13, output + 512, 0), 1);
  assert.deepEqual(Array.from(module.HEAPU8.subarray(base + output, base + output + 13)), [80,111,114,115,99,104,101,0,0,0,0,0,33]);
  assert.equal(invoke('SetFilePointer', writable, 3, 0, 0), 3);
  assert.equal(invoke('SetEndOfFile', writable), 1); assert.equal(invoke('GetFileSize', duplicate, 0), 3);
  assert.equal(invoke('FlushFileBuffers', writable), 1);
  close(writable); close(duplicate);
  const reopened = open('save.bin'); assert.notEqual(reopened, writable);
  assert.equal(invoke('ReadFile', reopened, output, 8, output + 512, 0), 1); assert.equal(get(output + 512), 3);
  assert.deepEqual(Array.from(module.HEAPU8.subarray(base + output, base + output + 3)), [80,111,114]); close(reopened);
  assert.equal(open('save.bin', 0xc0000000, 3, 1), 0xffffffff); error(80);
  assert.equal(invoke('SetFileAttributesA', text('save.bin'), 1), 1);
  assert.equal(invoke('DeleteFileA', text('save.bin')), 0); error(5);
  assert.equal(invoke('SetFileAttributesA', text('save.bin'), 32), 1);
  const search = invoke('FindFirstFileA', text('*.BIN'), output); assert.notEqual(search, 0xffffffff);
  const found = [[string(output + 44), get(output + 32)]];
  while (invoke('FindNextFileA', search, output)) found.push([string(output + 44), get(output + 32)]);
  error(18); assert.deepEqual(found.sort(), [['Original.bin', source.length], ['save.bin', 3]].sort());
  assert.equal(invoke('FindClose', search), 1); assert.equal(invoke('FindClose', search), 0); error(6);
  assert.equal(invoke('DeleteFileA', text('save.bin')), 1);
  assert.equal(open('save.bin'), 0xffffffff); error(2);
  assert.equal(invoke('GetDiskFreeSpaceA', text('C:\\'), output, output + 4, output + 8, output + 12), 1);
  assert(get(output + 8) > 0); assert.equal(get(output) * get(output + 4), 4096);
  assert.equal(invoke('GetDiskFreeSpaceA', text('D:\\'), output, output + 4, output + 8, output + 12), 1);
  assert.equal(get(output + 8), 0);
  console.log(`${calls} filesystem/path calls passed (staged bytes, cross-chunk reads, EOF, seeks, sharing, duplicate offsets, write gaps, enumeration)`);
} finally { runtime.dispose(); }
