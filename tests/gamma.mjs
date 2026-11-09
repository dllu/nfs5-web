import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
import {decodeGraphicsState} from '../web/graphics.mjs';
import {effectUniforms} from '../web/renderer.mjs';
globalThis.crypto??=webcrypto;
const bits=x=>new Uint32Array(Float32Array.of(x).buffer)[0];
const value=x=>new Float32Array(Uint32Array.of(x).buffer)[0];
const states=[[46,bits(1)],[3,0x80c08040],[46,bits(2)],[101,bits(.5)],[46,bits(2)],
  [46,bits(1)],[3,0xff000000],[46,bits(.25)],[3,0x12ffffff],[101,bits(4)],
  [3,0x70112233],[46,bits(.75)],[46,bits(.75)],[101,bits(1.5)],[3,0xff80ff00],
  [46,bits(1.25)],[101,bits(1.5)],[3,0xff010203],[46,bits(1)],
  [0x1002e,bits(2)],[46,bits(1)],[0x1002e,bits(.5)],[101,bits(1)]];
const groups=[undefined,0,5,6,10,11,-1].map(option=>({option:option??5,environment:option,states}));
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,[new URL('./gamma_oracle.py',import.meta.url).pathname],
  {input:JSON.stringify(groups),encoding:'utf8',maxBuffer:2*1024*1024});
assert.equal(oracle.status,0,oracle.stderr);const expected=JSON.parse(oracle.stdout),reports=[];
for(const [groupIndex,group]of groups.entries()){
  const r=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
  const {module:m,base,manifest}=r,v=new DataView(m.HEAPU8.buffer,base),data=0x800000;
  const text=(s,p=data)=>{m.HEAPU8.set(Buffer.from(s+'\0'),base+p);return p;};
  const header=new Int32Array(m.HEAPU8.buffer,m._web_gpu_transport(),8),ring=new Uint32Array(m.HEAPU8.buffer,header.byteOffset+32,Atomics.load(header,5));
  let lastState,lastClear,failure;
  const timer=setInterval(()=>{try{
    while(Atomics.load(header,1)!==Atomics.load(header,0)){
      const at=Atomics.load(header,1)>>>0,count=ring[at%ring.length],packet=Uint32Array.from({length:count},(_,i)=>ring[(at+i)%ring.length]);
      if(packet[1]===4)lastState=packet.slice(3,3+(Atomics.load(header,6)>=7?41:40));
      if(packet[1]===2)lastClear=packet[3];
      Atomics.store(header,1,(at+count)|0);Atomics.store(header,2,packet[2]|0);Atomics.notify(header,1);Atomics.notify(header,2);
    }
  }catch(error){failure=error;r.stop();}},1);
  async function call(entry,args=[]){const result=await r.invokeAsync(entry,args,2000);if(failure)throw failure;assert.equal(result.status,0,result.error);return result.registers[0];}
  const invoke=(name,...args)=>call(manifest.imports.find(i=>i.name===name).slot,args);
  try{
    if(group.environment!==undefined)await invoke('SetEnvironmentVariableA',text('OGL_GAMMA'),text(String(group.environment),data+64));
    const library=await invoke('LoadLibraryA',text('drivers\\opengl3z'));
    const method=async name=>invoke('GetProcAddress',library,text(name));
    const mode=await method('_THRASH_setvideomode@12'),state=await method('_THRASH_setstate@8'),draw=await method('_THRASH_drawtri@12'),clear=await method('_THRASH_clearwindow@0');
    const clip=await method('_THRASH_clip@16'),write=await method('_THRASH_writerect@20');
    m._web_gpu_attach();await call(mode,[1,0,2]);
    const vertex=data+256;
    for(let i=0;i<3;i++){
      [i===1?64:0,i===2?64:0,.5,1].forEach((n,j)=>v.setFloat32(vertex+i*32+j*4,n,true));v.setUint32(vertex+i*32+16,0xffffffff,true);
    }
    const results=[];
    for(const [index,args]of states.entries()){
      if(index===7)await call(clip,[10,20,30,40]);
      const native=expected[groupIndex].states[index];
      assert.equal(await call(state,args),native.result,'Native gamma setter result');
      lastState=lastClear=null;await call(clear);await call(draw,[vertex,vertex+32,vertex+64]);
      const deadline=performance.now()+1000;
      while(!lastState||lastClear===null){if(failure)throw failure;assert(performance.now()<deadline,'Gamma commands were not consumed');await new Promise(r=>setTimeout(r,1));}
      assert.equal(lastState.length,41,'Draw commands must carry the native gamma value');
      assert.equal(lastState[40],native.gamma,`Native gamma product, group ${groupIndex}, step ${index}`);
      const uniforms=Float32Array.from(effectUniforms(640,480,decodeGraphicsState(lastState)));
      assert.equal(uniforms.length,20,'WGSL effects layout is five vec4 values');
      assert.equal(bits(uniforms[16]),native.gamma,'The graphics consumer passes gamma into the fragment uniform');
      // Compare the RGBA8 clear target against the native glClearColor floats.
      // The driver rounds only when the value reaches the normalized target.
      const channels=[16,8,0,24].map(shift=>lastClear>>>shift&255);
      for(let c=0;c<4;c++)assert(Math.abs(channels[c]-value(native.clear[c])*255)<=.501,`Native clear component ${c}, group ${groupIndex}, step ${index}`);
      results.push({gamma:lastState[40],clear:lastClear});
    }
    await call(state,[46,bits(2)]);lastState=null;
    await call(write,[0,0,1,1,vertex]);
    const deadline=performance.now()+1000;
    while(!lastState){if(failure)throw failure;assert(performance.now()<deadline,'Framebuffer draw not consumed');await new Promise(r=>setTimeout(r,1));}
    assert.equal(lastState[40],expected[groupIndex].states[2].gamma,'Framebuffer transfers retain the current native gamma');
    reports.push({option:group.option,factor:expected[groupIndex].factor,results,framebufferGamma:lastState[40]});
  }finally{clearInterval(timer);r.dispose();}
}
await writeFile('build/native-gamma-states.json',JSON.stringify({passed:true,reports,states},null,2)+'\n');
console.log(`${groups.length*states.length} native x86 gamma comparisons and ${groups.length} framebuffer forwarding checks passed (driver options, aliases/cache, stages and full/scissored clear colors)`);
