import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const states=[
  [21,1],[15,0x80123456],[22,3],[23,100],[14,64],[21,2],[21,0],[21,1],
  [20,8],[105,0],[21,1],[105,1], // Repeated values and aliases use the native cache.
  [21,4],[15,0x00112233],[15,0xffaabbcc],[22,0xffffffff],[23,0xfffffffe],
  [14,4095],[14,4096],[14,0x3e800000],[14,0xbe800000],[14,0],[14,1],
  [20,16],[21,0],[21,1],[105,0x810000],[105,2],[20,1],[21,8],
  [22,0],[23,1],[15,0],[105,4],[105,0],[105,1],
];
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
  [new URL('./fog_oracle.py',import.meta.url).pathname],{input:JSON.stringify({states}),encoding:'utf8'});
assert.equal(oracle.status,0,oracle.stderr);const expected=JSON.parse(oracle.stdout);
const r=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module:m,base,manifest}=r,v=new DataView(m.HEAPU8.buffer,base),data=0x800000;
const text=s=>{m.HEAPU8.set(Buffer.from(s+'\0'),base+data);return data;};
const fbits=f=>{const a=new Float32Array([f]);return new Uint32Array(a.buffer)[0];};
const header=new Int32Array(m.HEAPU8.buffer,m._web_gpu_transport(),8),ring=new Uint32Array(m.HEAPU8.buffer,header.byteOffset+32,Atomics.load(header,5));
let lastState,lastSpecular,failure;
const timer=setInterval(()=>{try{
  while(Atomics.load(header,1)!==Atomics.load(header,0)){
    const at=Atomics.load(header,1)>>>0,count=ring[at%ring.length],packet=Uint32Array.from({length:count},(_,i)=>ring[(at+i)%ring.length]);
    if(packet[1]===4){lastState=packet.slice(3,44);lastSpecular=packet[3+43+5];}
    else assert.equal(packet[1],1,'Unexpected fog-test command');
    Atomics.store(header,1,(at+count)|0);Atomics.store(header,2,packet[2]|0);Atomics.notify(header,1);Atomics.notify(header,2);
  }
}catch(e){failure=e;r.stop();}},1);
async function call(entry,args=[]){
  const result=await r.invokeAsync(entry,args,2000);if(failure)throw failure;
  assert.equal(result.status,0,result.error);return result.registers[0];
}
const invoke=(name,...args)=>call(manifest.imports.find(i=>i.name===name).slot,args);
try{
  const library=await invoke('LoadLibraryA',text('drivers\\opengl3z'));
  const method=async name=>invoke('GetProcAddress',library,text(name));
  const mode=await method('_THRASH_setvideomode@12'),state=await method('_THRASH_setstate@8'),draw=await method('_THRASH_drawtri@12');
  m._web_gpu_attach();await call(mode,[1,0,2]);
  const vertex=data+256;
  for(let i=0;i<3;i++){
    [i===1?64:0,i===2?64:0,.5,1].forEach((x,j)=>v.setFloat32(vertex+i*32+j*4,x,true));
    v.setUint32(vertex+i*32+16,0xffffffff,true);v.setUint32(vertex+i*32+20,0x7f112233,true);
  }
  for(const [index,args]of states.entries()){
    assert.equal(await call(state,args),expected[index].result,'Native fog state return '+index);
    lastState=null;await call(draw,[vertex,vertex+32,vertex+64]);
    const until=performance.now()+1000;
    while(!lastState){assert(performance.now()<until,'Fog draw not consumed');await new Promise(r=>setTimeout(r,1));}
    const e=expected[index],kind={2:1,4:2,8:3}[e.mode]??0;
    assert.equal(lastState[11],Number(kind!==0),'Native shader fog enable '+index);
    assert.equal(lastState[23],kind,'Native shader fog mode '+index);
    assert.equal(lastState[13],e.near,'Native unsigned fog start '+index);
    assert.equal(lastState[14],e.far,'Native unsigned fog end '+index);
    assert.equal(lastState[24],e.density,'Native density bits '+index);
    const color=lastState[12];
    assert.deepEqual([16,8,0,24].map(shift=>fbits((color>>>shift&255)/255)),e.color,'Native ARGB fog uniform '+index);
    assert.equal(lastSpecular,0x7f112233,'Fog mode does not overwrite vertex specular '+index);
  }
  await writeFile('build/native-fog-states.json',JSON.stringify({states,expected,passed:true},null,2)+'\n');
  console.log(`${states.length} native x86 fog state comparisons passed (ARGB, unsigned ranges, density, aliases/cache and invalid shader modes)`);
}finally{clearInterval(timer);r.dispose();}
