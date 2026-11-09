import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';

globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({persist:false,read:async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)))});
assert.ok(runtime.manifest.patches.includes('verok-graphics-quality'));
const sections=runtime.manifest.sections.map(s=>({address:runtime.manifest.imageBase+s.virtual_address,
  bytes:runtime.module.HEAPU8.slice(runtime.base+runtime.manifest.imageBase+s.virtual_address,runtime.base+runtime.manifest.imageBase+s.virtual_address+s.raw_size)}));
const word=(address,value)=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return {address,hex:b.toString('hex')};};
const cases=[];
for(let level=0;level<5;level++)for(const depth of [16,24,32])cases.push({entry:0x44dfb0,memory:[
  word(0x657d88,level),word(0x61978c,depth),word(0x619770,0xdeadbeef)],
  observe:[{address:0x619770,size:4},{address:0x657d88,size:4}]});

// Exercise the patch's five quality levels, seven distance tiers, cockpit,
// player, frontend and damage branches. An original three-argument routine
// records the chosen mesh's Render arguments without requiring a GPU.
const car=0x800000,definition=0x810000,meshList=0x820000,meshes=0x830000,vtable=0x840000;
for(let level=0;level<5;level++)for(let lod=0;lod<7;lod++)for(const scene of ['player','ai','frontend','cockpit','cockpit-effects','damage','player-special']) {
  const object=Buffer.alloc(0x500),def=Buffer.alloc(0x600),list=Buffer.alloc(28),objects=Buffer.alloc(7*32,0xa5);
  object.writeUInt32LE(definition,0xf4);object.writeUInt32LE(meshList,0xb0);object.writeUInt32LE(lod,0x2c0);
  object.writeUInt32LE(3,0x2c8);object[0x471]=Number(scene==='damage');
  def.writeUInt32LE(scene==='ai'?1:0,0x520);def.writeUInt32LE(scene==='player-special'?16:0,0x52c);
  for(let i=0;i<7;i++){list.writeUInt32LE(meshes+i*32,i*4);objects.writeUInt32LE(vtable,i*32);}
  cases.push({entry:0x444e00,args:[0x12345678],registers:[0,car,0,0,0,0,0,0],memory:[
    {address:car,hex:object.toString('hex')},{address:definition,hex:def.toString('hex')},
    {address:meshList,hex:list.toString('hex')},{address:meshes,hex:objects.toString('hex')},
    word(vtable+8,0x46be60),word(0x65b928,Number(scene==='frontend')),word(0x628c70,0),word(0x65741c,0),
    word(0x627f43,scene.startsWith('cockpit')?8:0),word(0x6197c4,level),
    word(0x5e99b4,Number(scene==='cockpit-effects')),word(0x5e99ac,0),word(0x5e99b0,0)],
    observe:[{address:meshes,size:objects.length}]});
}
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
  [new URL('./quality_oracle.py',import.meta.url).pathname],
  {input:JSON.stringify({cases,memorySize:runtime.memorySize}),encoding:'utf8',maxBuffer:8*1024*1024});
assert.equal(oracle.status,0,oracle.stderr);
const expected=JSON.parse(oracle.stdout);
for(const [index,test]of cases.entries()){
  runtime.module._web_init();
  for(const s of sections)runtime.module.HEAPU8.set(s.bytes,runtime.base+s.address);
  for(const [i,value]of(test.registers??Array(8).fill(0)).entries())runtime.module._web_set_register(i,value);
  for(const m of test.memory)runtime.module.HEAPU8.set(Buffer.from(m.hex,'hex'),runtime.base+m.address);
  const result=runtime.call(test.entry,...test.args??[]);
  assert.equal(result.status,0,`Quality case ${index}: ${result.error}`);
  assert.deepEqual(result.registers,expected[index].registers,`Quality registers ${index}`);
  for(const [i,m]of test.observe.entries())assert.equal(Buffer.from(runtime.module.HEAPU8.subarray(runtime.base+m.address,runtime.base+m.address+m.size)).toString('hex'),expected[index].memory[i],`Quality memory ${index}`);
}
runtime.dispose();
await writeFile(new URL('../build/quality-differential.json',import.meta.url),JSON.stringify({cases:cases.length,passed:true})+'\n');
console.log(`${cases.length} native Verok DLL/Wasm comparisons passed (texture tiers, five-level car meshes, cockpit, damage, frontend)`);
