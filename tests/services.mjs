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
console.log(`${checks} Windows service calls passed (CP1252, dynamic imports, buffer failures, allocation reuse/realloc)`);
