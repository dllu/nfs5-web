// Independent x86 comparisons protect the original per-section range, menu
// tiers and FOV exception on which the browser's live multiplier is based.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const r=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const m=r.module,sections=r.manifest.sections.map(s=>({address:r.manifest.imageBase+s.virtual_address,
 bytes:m.HEAPU8.slice(r.base+r.manifest.imageBase+s.virtual_address,r.base+r.manifest.imageBase+s.virtual_address+s.raw_size)}));
const word=(address,value)=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return {address,hex:b.toString('hex')};};
const float=(address,value)=>{const b=Buffer.alloc(4);b.writeFloatLE(value);return {address,hex:b.toString('hex')};};
const cases=[];
for(const tier of [0,1,2,3])for(const camera of [0,2])for(const fov of [20,37.5,60])for(const range of [0,1,49,50,51,100,300,700,2000]) {
 cases.push({entry:0x44f1a0,args:[Buffer.from(float(0,range).hex,'hex').readUInt32LE()],
  memory:[word(0x657d70,tier),word(0x657424,camera),float(0x627ed8,fov),float(0x10006080,37.5)],
  observe:[{address:0x6197cc,size:12}]});
}
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,[new URL('./quality_oracle.py',import.meta.url).pathname],
 {input:JSON.stringify({memorySize:r.memorySize,cases}),encoding:'utf8',maxBuffer:2*1024*1024});
assert.equal(oracle.status,0,oracle.stderr);const expected=JSON.parse(oracle.stdout);
try {
 assert(r.manifest.patches.includes('browser-extended-detail'));
 for(const [i,test]of cases.entries()) {
  m._web_init();for(const s of sections)m.HEAPU8.set(s.bytes,r.base+s.address);
  for(const b of test.memory.filter(b=>b.address<r.memorySize))m.HEAPU8.set(Buffer.from(b.hex,'hex'),r.base+b.address);
  const result=r.call(test.entry,...test.args);assert.equal(result.status,0,result.error);
  assert.deepEqual(result.registers,expected[i].registers,`Native range registers ${i}`);
  assert.equal(Buffer.from(m.HEAPU8.slice(r.base+0x6197cc,r.base+0x6197d8)).toString('hex'),expected[i].memory[0],`Native range ${i}`);
 }
 for(const [setting,scale]of [['far',2],['very-far',4],['original',1],['invalid',1]]) {
  // Without a graphics adapter, Automatic retains the original native settings.
  r.setDetail(setting);assert.equal(r.detailStats().multiplier,scale);
 }
}finally{r.dispose();}
await writeFile('build/detail-native.json',JSON.stringify({cases:cases.length,passed:true})+'\n');
console.log(`${cases.length} original x86/Wasm view-range comparisons passed (four tiers, section distances, minimum, FOV exception)`);
