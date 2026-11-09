import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';

globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({persist:false,read:async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)))});
assert.ok(runtime.manifest.patches.includes('verok-projection'));
const sizes=[[640,480],[800,600],[1024,768],[1280,720],[1920,1080],[3840,2160],[6144,3456],
  [6144,3162],[3440,1440],[5120,1440],[1920,1200],[1024,1024],[1080,1920],[2160,3840],
  [4,3],[3,4],[13333,10000],[13334,10000],[16384,480],[640,16384]];
let seed=0x5645524f;
for(let i=0;i<240;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const w=640+seed%15745;
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;sizes.push([w,480+seed%15905]);
}
const word=(address,value)=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return {address,hex:b.toString('hex')};};
const cases=sizes.map(([width,height])=>({entry:0x10003840,memory:[word(0x1000611c,width),
  word(0x10006120,height),word(0x6b7c01,1)],observe:[{address:0x10006134,size:4},
    {address:0x10006130,size:4},{address:0x10006080,size:4}]}));
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
  [new URL('./quality_oracle.py',import.meta.url).pathname],
  {input:JSON.stringify({cases,memorySize:runtime.memorySize}),encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(oracle.status,0,oracle.stderr);
const expected=JSON.parse(oracle.stdout),m=runtime.module;
const sections=runtime.manifest.sections.map(s=>({address:runtime.manifest.imageBase+s.virtual_address,
  bytes:m.HEAPU8.slice(runtime.base+runtime.manifest.imageBase+s.virtual_address,runtime.base+runtime.manifest.imageBase+s.virtual_address+s.raw_size)}));
let cameraChecks=0;
try{
  for(const [i,[width,height]]of sizes.entries()){
    m._web_projection_update(width,height);
    const data=Buffer.from(m.HEAPU8.slice(m._web_projection_state(),m._web_projection_state()+12));
    assert.deepEqual([0,4,8].map(o=>data.subarray(o,o+4).toString('hex')),expected[i].memory,`Native projection ${width}x${height}`);
  }
  m._web_projection_update(640,480);
  assert.deepEqual(Array.from(new Float32Array(m.HEAPU8.buffer,m._web_projection_state(),3)),[640,480,37.5]);
  for(const [w,h]of [[0,480],[640,0],[16385,480],[640,16385]]){
    m._web_projection_update(w,h);
    assert.deepEqual(Array.from(new Float32Array(m.HEAPU8.buffer,m._web_projection_state(),3)),[640,480,37.5]);
  }
  // Execute the original camera-zoom routine with Verok's actual constant and
  // default-FOV hooks. Observe its camera record and cdecl/callee-preserved
  // registers; EAX contains volatile x87 exception-status bits not modeled by
  // this port, so it is not a calling-convention invariant.
  const cameraCases=[];
  const floatWord=(address,value)=>{const b=Buffer.alloc(4);b.writeFloatLE(value);return {address,hex:b.toString('hex')};};
  for(let i=0;i<14;i++)for(const player of [0,1])for(const active of [0,1])for(const fraction of [.5,1,1.25]){
    const fov=Buffer.from(expected[i].memory[2],'hex').readFloatLE(),record=0x627eb4+player*268;
    cameraCases.push({entry:0x462b80,args:[player,0x3f800000],projection:sizes[i],memory:[
      {address:0x10006080,hex:expected[i].memory[2]},word(0x606a98,0),word(0x606ad4,0),
      word(record,1),word(record+8,active),floatWord(record+4,fov*fraction),
      floatWord(record+12,.5),floatWord(record+16,.25),floatWord(record+20,.5),
      floatWord(record+36,fov*fraction),floatWord(record+68,fov)],
      observe:[{address:record,size:0x50},{address:runtime.memorySize-40,size:4}]});
  }
  const cameraOracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
    [new URL('./quality_oracle.py',import.meta.url).pathname],
    {input:JSON.stringify({cases:cameraCases,memorySize:runtime.memorySize}),encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(cameraOracle.status,0,cameraOracle.stderr);
  const cameraExpected=JSON.parse(cameraOracle.stdout);
  for(const [i,test]of cameraCases.entries()){
    m._web_init();for(const s of sections)m.HEAPU8.set(s.bytes,runtime.base+s.address);
    m._web_projection_update(...test.projection);
    for(const block of test.memory.filter(b=>b.address<runtime.memorySize))m.HEAPU8.set(Buffer.from(block.hex,'hex'),runtime.base+block.address);
    const result=runtime.call(test.entry,...test.args);
    assert.equal(result.status,0,result.error);
    for(const r of [1,2,3,4,5,6,7])assert.equal(result.registers[r],cameraExpected[i].registers[r],`Native camera register ${r}, case ${i}`);
    for(const [j,block]of test.observe.entries())assert.equal(Buffer.from(m.HEAPU8.subarray(runtime.base+block.address,runtime.base+block.address+block.size)).toString('hex'),cameraExpected[i].memory[j],`Native camera memory ${i}`);
    cameraChecks++;
  }
}finally{runtime.dispose();}
await writeFile(new URL('../build/projection-differential.json',import.meta.url),JSON.stringify({cases:sizes.length,cameraChecks,passed:true})+'\n');
console.log(`${sizes.length} native Verok projection and ${cameraChecks} original camera comparisons passed (portrait, square, 4:3, widescreen, ultrawide, zoom)`);
