import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const r=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module:m,base}=r;
const sections=r.manifest.sections.map(s=>({address:r.manifest.imageBase+s.virtual_address,
  bytes:m.HEAPU8.slice(base+r.manifest.imageBase+s.virtual_address,base+r.manifest.imageBase+s.virtual_address+s.raw_size)}));
const sky=0x800000,controller=0x801000,data=0x810000,track=0x820000;
const word=(address,value)=>{const b=Buffer.alloc(4);b.writeUInt32LE(value>>>0);return {address,hex:b.toString('hex')};};
const assets=JSON.parse(await readFile(new URL('../dist/assets.json',import.meta.url),'utf8'));
const curves=[];
for(const name of ['Autobahn','alps','foothills']){
  const asset=assets.entries.find(a=>a.path.toLowerCase()===`gamedata/track/sky/${name.toLowerCase()}.bin`);
  const bytes=await readFile(new URL('../dist/'+asset.url,import.meta.url));
  assert.equal(bytes.readUInt32LE(0),9,'Supported sky-data revision');
  let count=0;while(count<400&&bytes.readInt32LE(0x1a5c+count*48)>=0)count++;
  assert(count>=2&&count<400,'Terminated weather curve');
  const keys=bytes.subarray(0x1a5c,0x1a5c+count*48),positions=new Set([0,keys.readInt32LE((count-1)*48)]);
  for(let i=0;i<count;i+=Math.ceil(count/16)){
    positions.add(keys.readInt32LE(i*48));
    if(i+1<count)positions.add(Math.floor((keys.readInt32LE(i*48)+keys.readInt32LE((i+1)*48))/2));
  }
  const length=keys.readInt32LE((count-1)*48)+100;
  for(const p of [-1,length-1,length,length+1])positions.add(p);
  curves.push({name,keys,length,positions:[...positions]});
}
// Exercise a crossing at the cyclic track boundary, including stale cached
// intervals. Expected interpolation and interval selection run in original x86.
const boundary=Buffer.alloc(96);boundary.writeInt32LE(10,0);boundary.writeInt32LE(90,48);
boundary.writeFloatLE(1,0x18);boundary.writeFloatLE(1,48+0x20);
curves.push({name:'cyclic-boundary',keys:boundary,length:100,positions:[0,5,10,50,89,90,95,99,100]});
const cases=[];
for(const curve of curves)for(const position of curve.positions)for(const [effect,entry]of [['rain',0x45d000],['snow',0x45cfd0]]){
  const state=Buffer.alloc(28);state.writeUInt32LE(data,0);state.writeUInt32LE(curve.keys.length/48,4);
  state.writeUInt32LE(1,12);state.writeUInt32LE(track,20);
  cases.push({name:curve.name,effect,position,entry,float:true,registers:[0,sky,0,0,0,0,0,0],
    memory:[word(sky+0x48,controller),word(sky+0x50,position),word(0x628bc0,track),word(track,curve.length),
      {address:controller,hex:state.toString('hex')},{address:data,hex:curve.keys.toString('hex')}],
    observe:[{address:controller,size:28}]});
}
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
  [new URL('./quality_oracle.py',import.meta.url).pathname],
  {input:JSON.stringify({memorySize:r.memorySize,cases}),encoding:'utf8',maxBuffer:8*1024*1024});
try{
  assert.equal(oracle.status,0,oracle.stderr);const expected=JSON.parse(oracle.stdout);
  for(const [index,c]of cases.entries()){
    m._web_init();for(const s of sections)m.HEAPU8.set(s.bytes,base+s.address);
    for(const memory of c.memory)m.HEAPU8.set(Buffer.from(memory.hex,'hex'),base+memory.address);
    c.registers.forEach((x,i)=>m._web_set_register(i,x));
    const result=r.call(c.entry);assert.equal(result.status,0,result.error);
    assert.deepEqual(result.registers,expected[index].registers,`Weather registers ${index}`);
    assert.equal(m._web_float_result(),expected[index].float,`Native ${c.name} ${c.effect} at ${c.position}`);
    assert.equal(Buffer.from(m.HEAPU8.subarray(base+controller,base+controller+28)).toString('hex'),expected[index].memory[0],`Weather interval ${index}`);
  }
  await writeFile('build/weather-differential.json',JSON.stringify({cases:cases.length,curves:curves.map(c=>c.name),passed:true},null,2)+'\n');
  console.log(`${cases.length} original x86 weather comparisons passed (rain/snow curves, cached intervals and cyclic boundaries)`);
}finally{r.dispose();}
