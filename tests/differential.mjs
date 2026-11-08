import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
assert.equal(runtime.manifest.sha256, 'c318af393d4c2b7071a820ca3d69e956bbd94769b6e5c2e3e49f498ecbc94906',
  'These reverse-engineered routine addresses belong to the Verok 1.06 executable');
const cases = [];
let seed = 0x506f7273;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const source = 0x800000, destination = 0x810000;
for (const length of [0, 1, 2, 3, 4, 7, 15, 16, 31, 63, 64, 255, 256, 1023]) {
  for (const entry of [0x42a130, 0x42a160]) {
    const data = Buffer.from(Array.from({ length: 1024 }, () => random() & 255));
    cases.push({ entry, args: [source, source + length, destination],
      memory: [{ address: source, hex: data.toString('hex') },
        { address: destination, hex: Buffer.alloc(1040, 0xa5).toString('hex') }],
      observe: [{ address: destination, size: 1040 }] });
  }
}
// A game object initializer touches 201 array entries through ECX (thiscall).
for (let i = 0; i < 8; i++) {
  cases.push({ entry: 0x4580e0, registers: [0, source, 0, 0x12345678, 0, 0, 0xabcdef01, 0xfedcba98],
    memory: [{ address: source, hex: Buffer.alloc(0x7000, random() & 255).toString('hex') }],
    observe: [{ address: source, size: 0x7000 }] });
}
// Original three-component dot product, including signs and cancellation.
for (let i = 0; i < 32; i++) {
  const data = Buffer.alloc(0x400);
  for (const offset of [0x33c, 0x340, 0x344, 0x3b8, 0x3bc, 0x3c0]) {
    data.writeFloatLE(((random() % 32768) - 16384) / 16, offset);
  }
  cases.push({ entry: 0x40ef30, args: [source], float: true,
    memory: [{ address: source, hex: data.toString('hex') }] });
}
const oracle = spawnSync(new URL('../.venv/bin/python', import.meta.url).pathname,
  [new URL('./x86_oracle.py', import.meta.url).pathname],
  { input: JSON.stringify({ cases, memorySize: runtime.memorySize }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(oracle.status, 0, oracle.stderr);
const expected = JSON.parse(oracle.stdout);
for (const [index, test] of cases.entries()) {
  // The routines under test have no dependencies on startup's initialized data.
  runtime.module._web_init();
  for (const [i, value] of (test.registers ?? Array(8).fill(0)).entries()) runtime.module._web_set_register(i, value);
  for (const memory of test.memory ?? []) runtime.module.HEAPU8.set(Buffer.from(memory.hex, 'hex'), runtime.base + memory.address);
  const result = runtime.call(test.entry, ...test.args ?? []);
  assert.equal(result.status, 0, result.error);
  assert.deepEqual(result.registers, expected[index].registers, `Registers in case ${index}`);
  for (const [i, memory] of (test.observe ?? []).entries()) {
    const actual = Buffer.from(runtime.module.HEAPU8.subarray(runtime.base + memory.address, runtime.base + memory.address + memory.size));
    assert.equal(actual.toString('hex'), expected[index].memory[i], `Memory in case ${index}`);
  }
  if (test.float) assert.equal(runtime.module._web_float_result(), expected[index].float, `x87 result in case ${index}`);
}
await writeFile(new URL('../build/differential.json', import.meta.url), JSON.stringify({ cases: cases.length, functions: 4, passed: true }) + '\n');
console.log(`${cases.length} original x86/Wasm comparisons passed (range copying, object initialization, x87 dot product)`);
