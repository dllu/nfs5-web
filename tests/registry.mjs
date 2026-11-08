import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';
globalThis.crypto ??= webcrypto;
const load = () => loadRuntime({ read: async p => new Response(await readFile(new URL('../dist/' + p, import.meta.url))) });
let calls = 0;
function api(runtime) {
  const { module, base, manifest } = runtime, data = 0x800000, output = data + 4096, stack = runtime.memorySize - 0x10000;
  const view = new DataView(module.HEAPU8.buffer, base), get = p => view.getUint32(p, true), put = (p, v) => view.setUint32(p, v >>> 0, true);
  const text = (value, p = data) => { module.HEAPU8.set(Buffer.from(value + '\0', 'latin1'), base + p); return p; };
  function invoke(name, ...args) {
    args.forEach((v, i) => put(stack + i * 4, v)); module._web_set_register(4, stack);
    assert.equal(module._web_run(manifest.imports.find(item => item.name === name).slot, 2000), 0, module.UTF8ToString(module._web_error()));
    const registers = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
    assert.equal(registers[4], stack + args.length * 4, `${name} stdcall cleanup`); calls++;
    return registers[0];
  }
  return { module, base, data, output, view, get, put, text, invoke };
}
const path = 'Software\\NFS5Web\\caf\xe9';
let saved;
let runtime = await load();
try {
  const { module, base, data, output, get, put, text, invoke } = api(runtime);
  invoke('SetLastError', 1234);
  assert.equal(invoke('RegOpenKeyExA', 0x80000002, text('SOFTWARE\\Electronic Arts\\Need for Speed - Porsche 2000'), 0, 0x20019, output), 2);
  assert.equal(invoke('GetLastError'), 1234, 'Registry APIs return LSTATUS, without changing LastError');
  assert.equal(invoke('RegOpenKeyExA', 0x80000002, text('software\\electronic arts\\need for speed - porsche unleashed'), 0, 0x20019, output), 0);
  const install = get(output), type = output + 4, size = output + 8, bytes = output + 16;
  put(size, 0);
  assert.equal(invoke('RegQueryValueExA', install, text('Install Dir'), 0, type, 0, size), 0);
  assert.equal(get(type), 1); assert.equal(get(size), 9);
  module.HEAPU8.fill(0xa5, base + bytes, base + bytes + 16); put(size, 2);
  assert.equal(invoke('RegQueryValueExA', install, data, 0, type, bytes, size), 234);
  assert.equal(get(size), 9); assert.equal(get(bytes), 0xa5a5a5a5);
  put(size, 16); assert.equal(invoke('RegQueryValueExA', install, data, 0, type, bytes, size), 0);
  assert.deepEqual(Array.from(module.HEAPU8.subarray(base + bytes, base + bytes + 9)), [67,58,92,110,102,115,53,92,0]);
  assert.equal(invoke('RegSetValueExA', install, text('Denied'), 0, 4, data, 4), 5);
  assert.equal(invoke('RegCloseKey', install), 0); assert.equal(invoke('RegCloseKey', install), 6);
  assert.equal(invoke('RegCloseKey', 0x80000002), 0);

  assert.equal(invoke('RegCreateKeyA', 0x80000001, text(path), output), 0); const key = get(output);
  put(data + 256, 120);
  assert.equal(invoke('RegSetValueExA', key, text('FrameLimit'), 0, 4, data + 256, 4), 0);
  module.HEAPU8.set([0,255,128,42,0], base + data + 256);
  assert.equal(invoke('RegSetValueExA', key, 0, 0, 3, data + 256, 5), 0);
  assert.equal(invoke('RegFlushKey', key), 0);
  assert.equal(invoke('RegOpenKeyExA', 0x80000001, text('SOFTWARE\\NFS5WEB\\CAF\xc9'), 0, 1, output), 0);
  const readOnly = get(output); put(size, 16);
  assert.equal(invoke('RegQueryValueExA', readOnly, text('framelimit'), 0, type, bytes, size), 0);
  assert.equal(get(type), 4); assert.equal(get(size), 4); assert.equal(get(bytes), 120);
  put(size, 16); assert.equal(invoke('RegQueryValueExA', readOnly, text(''), 0, type, bytes, size), 0);
  assert.deepEqual(Array.from(module.HEAPU8.subarray(base + bytes, base + bytes + 5)), [0,255,128,42,0]);
  assert.equal(invoke('RegCreateKeyA', readOnly, text('Child'), output), 5);
  assert.equal(invoke('RegQueryValueExA', readOnly, text('Missing'), 0, 0, bytes, 0), 87);
  assert.equal(invoke('RegCloseKey', readOnly), 0); assert.equal(invoke('RegCloseKey', key), 0);
  const file = invoke('CreateFileA', text('C:\\nfs5\\.web-registry.bin'), 0x80000000, 3, 0, 3, 128, 0);
  assert.notEqual(file, 0xffffffff);
  const length = invoke('GetFileSize', file, 0);
  assert(length > 16 && length < 16384);
  assert.equal(invoke('ReadFile', file, output + 8192, length, size, 0), 1);
  assert.equal(get(size), length); saved = Uint8Array.from(module.HEAPU8.subarray(base + output + 8192, base + output + 8192 + length));
  assert.equal(invoke('CloseHandle', file), 1);
} finally { runtime.dispose(); }

runtime = await load();
try {
  const { module, base, data, output, get, put, text, invoke } = api(runtime);
  assert.equal(invoke('RegOpenKeyA', 0x80000001, text(path), output), 2, 'A new runtime starts without the previous runtime\'s in-memory user keys');
  const id = runtime.mount('C:\\nfs5\\.web-registry.bin', { size: saved.length, attributes: 2 }), pointer = module._malloc(saved.length);
  function restore(bytes) {
    module.HEAPU8.set(bytes, pointer); assert.equal(module._web_fs_store(id, pointer, bytes.length), 1);
    return module._web_registry_restore();
  }
  assert.equal(restore(saved), 1);
  assert.equal(invoke('RegOpenKeyA', 0x80000001, text(path), output), 0); const key = get(output);
  put(output + 8, 4);
  assert.equal(invoke('RegQueryValueExA', key, text('FrameLimit'), 0, output + 4, output + 16, output + 8), 0);
  assert.equal(get(output + 16), 120);
  const corrupt = saved.slice(); corrupt[0] ^= 255;
  assert.equal(restore(corrupt), 0, 'Malformed persisted state must be rejected');
  put(output + 8, 4);
  assert.equal(invoke('RegQueryValueExA', key, data, 0, 0, output + 16, output + 8), 0);
  assert.equal(get(output + 16), 120, 'A failed restore leaves the live registry intact');
  module._free(pointer); assert.equal(invoke('RegCloseKey', key), 0);
  console.log(`${calls} application-registry calls passed (install fallback, CP1252 case, buffer sizing, permissions, binary values, persisted restore)`);
} finally { runtime.dispose(); }
