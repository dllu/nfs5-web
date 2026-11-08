import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const { module, base, manifest } = runtime;
const memory = () => new DataView(module.HEAPU8.buffer, base);
const input = 0x800000, output = 0x801000, stack = runtime.memorySize - 0x10000;
let checks = 0;
function invoke(name, ...args) {
  const item = manifest.imports.find(item => item.dll === 'KERNEL32.dll' && item.name === name);
  assert(item, `Missing test import ${name}`);
  args.forEach((value, i) => memory().setUint32(stack + i * 4, value >>> 0, true));
  module._web_set_register(4, stack);
  assert.equal(module._web_run(item.slot, 2000), 0, module.UTF8ToString(module._web_error()));
  const registers = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
  assert.equal(registers[4], stack + args.length * 4, `${name} stdcall stack cleanup`);
  checks++;
  return registers[0];
}
function string(text, address = input) {
  module.HEAPU8.set(Buffer.from(text + '\0', 'latin1'), base + address);
  return address;
}

// Compare every CP1252 code point against the independent ICU-backed decoder.
memory().setUint32(output, 148, true);
assert.equal(invoke('GetVersionExA', output), 1);
assert.deepEqual(Array.from({ length: 5 }, (_, i) => memory().getUint32(output + i * 4, true)), [148,4,1,0,1]);
memory().setUint32(output, 156, true); assert.equal(invoke('GetVersionExA', output), 0);
assert.equal(invoke('GetLastError'), 87);

const environment = pointer => {
  const entries = []; let p = pointer;
  while (memory().getUint16(p, true)) {
    let text = '';
    while (memory().getUint16(p, true)) { text += String.fromCharCode(memory().getUint16(p, true)); p += 2; }
    entries.push(text); p += 2;
  }
  return entries;
};
const empty = invoke('GetEnvironmentStringsW');
assert.deepEqual(environment(empty), []); assert.equal(memory().getUint32(empty, true), 0);
assert.equal(invoke('FreeEnvironmentStringsW', empty), 1);
assert.equal(invoke('FreeEnvironmentStringsW', empty), 0);
assert.equal(invoke('SetEnvironmentVariableA', string('Z_TEST'), string('last', input + 256)), 1);
assert.equal(invoke('SetEnvironmentVariableA', string('A_TEST'), string('caf\xe9', input + 256)), 1);
const before = invoke('GetEnvironmentStringsW');
assert.deepEqual(environment(before), ['A_TEST=caf\xe9','Z_TEST=last']);
assert.equal(invoke('SetEnvironmentVariableA', string('a_test'), string('new', input + 256)), 1);
assert.deepEqual(environment(before), ['A_TEST=caf\xe9','Z_TEST=last'], 'Environment blocks are immutable snapshots');
const after = invoke('GetEnvironmentStringsW');
assert.deepEqual(environment(after), ['a_test=new','Z_TEST=last']);
assert.equal(invoke('FreeEnvironmentStringsA', after), 0, 'A/W frees must match the snapshot encoding');
assert.equal(invoke('FreeEnvironmentStringsW', before), 1); assert.equal(invoke('FreeEnvironmentStringsW', after), 1);
assert.equal(invoke('SetEnvironmentVariableA', string('A_TEST'), string('caf\xe9', input + 256)), 1);
const oem = invoke('GetEnvironmentStrings');
assert.deepEqual(Array.from(module.HEAPU8.subarray(base + oem, base + oem + 12)), [65,95,84,69,83,84,61,99,97,102,130,0]);
assert.equal(invoke('FreeEnvironmentStringsA', oem), 1);
assert.equal(invoke('SetEnvironmentVariableA', string('A_TEST'), 0), 1);
assert.equal(invoke('SetEnvironmentVariableA', string('A_TEST'), 0), 0);
assert.equal(invoke('GetLastError'), 203);
assert.equal(invoke('SetEnvironmentVariableA', string('bad=name'), string('x', input + 256)), 0);
assert.equal(invoke('GetLastError'), 87);
const wideName = 'Unicode', wideValue = '\u20ac';
for (const [p,s] of [[input,wideName],[input+256,wideValue]]) {
  Array.from(s + '\0').forEach((c, i) => memory().setUint16(p + i * 2, c.charCodeAt(0), true));
}
assert.equal(invoke('SetEnvironmentVariableW', input, input + 256), 1);
const unicode = invoke('GetEnvironmentStringsW');
assert.deepEqual(environment(unicode), ['Unicode=\u20ac','Z_TEST=last']);
assert.equal(invoke('FreeEnvironmentStringsW', unicode), 1);

function compare(a, b, flags = 0, locale = 0x409) {
  return invoke('CompareStringA', locale, flags, string(a), -1, string(b, input + 256), -1);
}
assert.equal(compare('alpha','bravo'), 1); assert.equal(compare('Bravo','alpha'), 3);
assert.equal(compare('Porsche','porsche',1), 2);
assert.equal(compare('caf\xe9','cafe',2), 2);
assert.notEqual(compare('caf\xe9','cafe'), 2);
assert.equal(compare('Porsche!','Porsche',4), 2);
assert.equal(compare('Porsche\x80','Porsche',4), 2);
assert.equal(compare('coop','co-op'), 3);
assert.equal(compare('a','a',0x80000000), 0); assert.equal(invoke('GetLastError'), 1004);
assert.equal(compare('a','a',0,0x411), 0); assert.equal(invoke('GetLastError'), 87);

module.HEAPU8.set(Uint8Array.from({ length: 256 }, (_, i) => i), base + input);
assert.equal(invoke('MultiByteToWideChar', 1252, 0, input, 256, 0, 0), 256);
assert.equal(invoke('MultiByteToWideChar', 1252, 0, input, 256, output, 256), 256);
const decoded = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i));
for (let i = 0; i < 256; i++) assert.equal(memory().getUint16(output + i * 2, true), decoded.charCodeAt(i));
assert.equal(invoke('WideCharToMultiByte', 1252, 0, output, 256, input + 512, 0, 0, 0), 256);
assert.equal(invoke('WideCharToMultiByte', 1252, 0, output, 256, input + 512, 256, 0, output + 1024), 256);
assert.deepEqual(module.HEAPU8.subarray(base + input + 512, base + input + 768), Uint8Array.from({ length: 256 }, (_, i) => i));
assert.equal(memory().getUint32(output + 1024, true), 0);
// Insufficient buffers must fail without writing their output.
module.HEAPU8.fill(0xa5, base + output, base + output + 8);
assert.equal(invoke('MultiByteToWideChar', 1252, 0, input, 4, output, 1), 0);
assert.equal(invoke('GetLastError'), 122);
assert.deepEqual(Array.from(module.HEAPU8.subarray(base + output, base + output + 8)), Array(8).fill(0xa5));

const text = 'Porsche \xe9lan \x8akoda';
string(text);
assert.equal(invoke('LCMapStringA', 0x409, 0x200, input, -1, output, 256), text.length + 1);
const mapped = new TextDecoder('windows-1252').decode(module.HEAPU8.subarray(base + output, base + output + text.length));
assert.equal(mapped, new TextDecoder('windows-1252').decode(Buffer.from(text, 'latin1')).toUpperCase());
string('A9\t \xe9\0');
assert.equal(invoke('GetStringTypeA', 0x409, 1, input, 6, output), 1);
assert.deepEqual(Array.from({ length: 6 }, (_, i) => memory().getUint16(output + i * 2, true)), [0x181, 0x84, 0x68, 0x48, 0x102, 0x20]);
assert.equal(invoke('GetStringTypeW', 1, input, 1, output), 0);
assert.equal(invoke('GetLastError'), 120);

const kernel = invoke('GetModuleHandleA', string('KERNEL32'));
assert(kernel);
assert.equal(invoke('GetModuleHandleA', string('kernel32.DLL')), kernel);
const pointer = invoke('GetProcAddress', kernel, string('QueryPerformanceFrequency'));
assert(pointer);
memory().setUint32(stack, output, true);
module._web_set_register(4, stack);
assert.equal(module._web_run(pointer, 2000), 0);
assert.equal(memory().getBigUint64(output, true), 1000000n);
assert.equal(invoke('GetProcAddress', kernel, string('IsProcessorFeaturePresent')), 0);
assert.equal(invoke('GetLastError'), 127);
assert.equal(invoke('GetModuleHandleA', string('missing.dll')), 0);
assert.equal(invoke('GetLastError'), 126);
assert.equal(invoke('GetOEMCP'), 437);

// The actual game probes a 128 MiB reservation and immediately releases it.
assert.equal(invoke('VirtualAlloc', 0, 0, 0x3000, 4), 0);
assert.equal(invoke('GetLastError'), 87);
for (let i = 0; i < 2; i++) {
  const address = invoke('VirtualAlloc', 0, 128 * 1024 * 1024, 0x3000, 4);
  assert(address && address % 65536 === 0);
  memory().setUint32(address, 0x506f7273, true);
  assert.equal(invoke('VirtualFree', address, 0, 0x8000), 1);
}
const allocation = invoke('HeapAlloc', 1, 8, 64);
const guard = invoke('HeapAlloc', 1, 0, 64);
module.HEAPU8.fill(0x5a, base + allocation, base + allocation + 64);
const resized = invoke('HeapReAlloc', 1, 8, allocation, 256);
assert(resized);
assert.deepEqual(Array.from(module.HEAPU8.subarray(base + resized, base + resized + 64)), Array(64).fill(0x5a));
assert.deepEqual(Array.from(module.HEAPU8.subarray(base + resized + 64, base + resized + 256)), Array(192).fill(0));
assert.equal(invoke('HeapSize', 1, 0, resized), 256);
assert.equal(invoke('HeapFree', 1, 0, allocation), 0);
assert.equal(invoke('HeapFree', 1, 0, guard), 1);
assert.equal(invoke('HeapFree', 1, 0, resized), 1);
console.log(`${checks} Windows service calls passed (version, environment snapshots, CP1252/OEM, collation, dynamic imports, allocation reuse/realloc)`);
