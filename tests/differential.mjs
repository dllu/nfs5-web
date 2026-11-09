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
const imageSections=runtime.manifest.sections.map(section=>{
  const address=runtime.manifest.imageBase+section.virtual_address;
  return {address,bytes:runtime.module.HEAPU8.slice(runtime.base+address,runtime.base+address+section.raw_size)};
});
for (const length of [0, 1, 2, 3, 4, 7, 15, 16, 31, 63, 64, 255, 256, 1023]) {
  for (const entry of [0x42a130, 0x42a160]) {
    const data = Buffer.from(Array.from({ length: 1024 }, () => random() & 255));
    cases.push({ entry, args: [source, source + length, destination],
      memory: [{ address: source, hex: data.toString('hex') },
        { address: destination, hex: Buffer.alloc(1040, 0xa5).toString('hex') }],
      observe: [{ address: destination, size: 1040 }] });
  }
}
// Original x87 and MMX integer-copy routines. Exercise alignment branches,
// all block widths and exact 64-bit payloads, including their order on overlap.
for (const length of [0, 1, 7, 8, 31, 32, 127, 128, 255, 1023, 4096]) {
  for (const entry of [0x5b0100,0x5b02c0]) for (let alignment = 0; alignment < 8; alignment++) {
    const bytes = Buffer.from(Array.from({length: 8192}, () => random() & 255));
    cases.push({entry, args: [destination + alignment, source + 3, length],
      memory: [{address: source, hex: bytes.toString('hex')},
        {address: destination, hex: Buffer.alloc(4112, 0xa5).toString('hex')}],
      observe: [{address: destination, size: 4112}]});
  }
}
for (const offset of [-129, -33, -8, -1, 0, 1, 8, 33, 129]) {
  for (const entry of [0x5b0100,0x5b02c0]) cases.push({entry, args: [source + 256 + offset, source + 256, 256],
    memory: [{address: source, hex: Buffer.from(Array.from({length: 1024}, () => random() & 255)).toString('hex')}],
    observe: [{address: source, size: 1024}]});
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
// Original vertex transform and projection callback. Binary fractions and
// signed permutation matrices keep intermediate results exactly representable
// at x87 precision settings while exercising deep stacks and cross-call ST0.
for(const flags of [0x100,0x102,0x200,0x202,0x300,0x302])for(const count of [1,2,7])for(const rotate of [false,true]) {
  const vertices=Buffer.alloc(count*16),matrix=Buffer.alloc(64),settings=Buffer.alloc(32),clip=source+0x6000;
  for(let i=0;i<count;i++)[0.25*(i+1),-0.5*(i+2),i+1,1+i%2].forEach((v,j)=>vertices.writeFloatLE(v,i*16+j*4));
  if(rotate){matrix.writeFloatLE(1,4);matrix.writeFloatLE(-1,16);}
  else {matrix.writeFloatLE(1,0);matrix.writeFloatLE(1,20);}
  matrix.writeFloatLE(1,40);matrix.writeFloatLE(16,56);matrix.writeFloatLE(1,60);
  settings.writeUInt32LE(source+0x4000,0);settings.writeUInt32LE(16,12);
  settings.writeUInt32LE(32,16);settings.writeUInt32LE(4,20);
  settings.writeFloatLE(1,24);settings.writeFloatLE(1000,28);
  const word=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b.toString('hex');};
  cases.push({entry:0x5b0730,args:[flags,count,source,destination],memory:[
    {address:source,hex:vertices.toString('hex')},{address:source+0x4000,hex:matrix.toString('hex')},
    {address:0x5dea58,hex:settings.toString('hex')},{address:0x69e0d0,hex:word(clip)},
    {address:0x5dfc90,hex:word(0x3f800000)},
    {address:destination,hex:Buffer.alloc(count*32+16,0xa5).toString('hex')},
    {address:clip,hex:Buffer.alloc(count*4+16,0xa5).toString('hex')}],
    observe:[{address:destination,size:count*32+16},{address:clip,size:count*4+16}]});
}
const oracle = spawnSync(new URL('../.venv/bin/python', import.meta.url).pathname,
  [new URL('./x86_oracle.py', import.meta.url).pathname],
  { input: JSON.stringify({ cases, memorySize: runtime.memorySize }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(oracle.status, 0, oracle.stderr);
const expected = JSON.parse(oracle.stdout);
for (const [index, test] of cases.entries()) {
  // The routines under test have no dependencies on startup's initialized data.
  runtime.module._web_init();
  for(const section of imageSections)runtime.module.HEAPU8.set(section.bytes,runtime.base+section.address);
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
await writeFile(new URL('../build/differential.json', import.meta.url), JSON.stringify({ cases: cases.length, functions: 7, passed: true }) + '\n');
console.log(`${cases.length} original x86/Wasm comparisons passed (x87/MMX copying/alignment/overlap, object initialization, x87 dot product, vertex transformation)`);
