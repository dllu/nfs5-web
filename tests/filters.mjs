import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const configurations=[
  {name:'driver defaults',override:0},
  {name:'OGL environment wins',override:1,env:{OGL_TEXFILTER:'1',THRASH_TEXFILTER:'2'},changeAfterQuery:true},
  {name:'options remain mutable until first query',override:2,env:{OGL_TEXFILTER:'1'},changeBeforeQuery:true},
  {name:'THRASH environment fallback',override:2,env:{THRASH_TEXFILTER:'2'}},
  {name:'invalid OGL value uses raw states',override:0,env:{OGL_TEXFILTER:'3',THRASH_TEXFILTER:'1'}},
  {name:'negative OGL value uses raw states',override:0,env:{OGL_TEXFILTER:'-1'}},
  {name:'file OGL wins over environment',override:2,ini:'[thrash]\n OGL_TEXFILTER = "2"\nTHRASH_TEXFILTER=1',env:{OGL_TEXFILTER:'1'}},
  {name:'file THRASH wins over OGL environment',override:1,ini:'[THRASH]\nTHRASH_TEXFILTER=1',env:{OGL_TEXFILTER:'2'}},
  {name:'ENV is populated by the game loader',override:1,ini:'[ENV]\nOGL_TEXFILTER=2',env:{OGL_TEXFILTER:'1'}},
  {name:'empty file key falls back to explicit zero',override:0,ini:'[THRASH]\nOGL_TEXFILTER=""\nTHRASH_TEXFILTER=0',env:{OGL_TEXFILTER:'2'}},
  {name:'UTF16LE driver file',override:1,wide:true,ini:'[THRASH]\r\nOGL_TEXFILTER=1'},
];
const cases=[];
for(const hasMips of [false,true])for(const spatial of [0,1])for(const mips of [0,1,2,5]){
  const bias=[0xbf400000,0x3e800000,0,0x3f800000][mips===5?3:mips];
  cases.push({hasMips,changes:[[7,spatial],[11,mips],[8,bias],[13,1],[65,mips%3],[66,(mips+1)%3]]});
}
// Repeated raw address aliases must retain the native cache behavior.
cases.push({hasMips:true,changes:[[13,2],[65,0],[13,1],[65,0],[66,2],[13,1],[66,2]]});
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
  [new URL('./filter_oracle.py',import.meta.url).pathname],{
    input:JSON.stringify(configurations.map(c=>({override:c.override,cases}))),encoding:'utf8',maxBuffer:4*1024*1024,
  });
assert.equal(oracle.status,0,oracle.stderr);const expected=JSON.parse(oracle.stdout),reports=[];
for(const [configurationIndex,configuration]of configurations.entries()){
  const r=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
  const {module:m,base,manifest}=r,v=new DataView(m.HEAPU8.buffer,base),data=0x800000;
  const text=(s,at=data)=>{m.HEAPU8.set(Buffer.from(s+'\0'),base+at);return at;};
  const header=new Int32Array(m.HEAPU8.buffer,m._web_gpu_transport(),8),ring=new Uint32Array(m.HEAPU8.buffer,header.byteOffset+32,Atomics.load(header,5));
  let lastState,failure;
  const timer=setInterval(()=>{try{
    while(Atomics.load(header,1)!==Atomics.load(header,0)){
      const at=Atomics.load(header,1)>>>0,count=ring[at%ring.length];
      if(ring[(at+1)%ring.length]===4)lastState=Uint32Array.from({length:40},(_,i)=>ring[(at+3+i)%ring.length]);
      Atomics.store(header,1,(at+count)|0);Atomics.store(header,2,ring[(at+2)%ring.length]|0);Atomics.notify(header,1);Atomics.notify(header,2);
    }
  }catch(e){failure=e;r.stop();}},1);
  async function call(entry,args=[]){const result=await r.invokeAsync(entry,args,2000);if(failure)throw failure;assert.equal(result.status,0,result.error);return result.registers[0];}
  const invoke=(name,...args)=>call(manifest.imports.find(i=>i.name===name).slot,args);
  try{
    for(const [key,value]of Object.entries(configuration.env??{}))assert.equal(await invoke('SetEnvironmentVariableA',text(key),text(value,data+128)),1);
    if(configuration.ini!==undefined){
      const bytes=configuration.wide?Buffer.concat([Buffer.from([255,254]),Buffer.from(configuration.ini,'utf16le')]):Buffer.from(configuration.ini);
      const id=r.mount('C:\\nfs5\\Drivers\\opengl3\\opengl3z.ini'),pointer=m._malloc(bytes.length);
      try{m.HEAPU8.set(bytes,pointer);assert.equal(m._web_fs_store(id,pointer,bytes.length),1);}finally{m._free(pointer);}
    }
    const library=await invoke('LoadLibraryA',text('drivers\\opengl3z'));
    const method=async name=>invoke('GetProcAddress',library,text(name));
    const mode=await method('_THRASH_setvideomode@12'),state=await method('_THRASH_setstate@8'),get=await method('_THRASH_getstate@4');
    const draw=await method('_THRASH_drawtri@12'),allocate=await method('_THRASH_talloc@20'),update=await method('_THRASH_tupdate@12'),bind=await method('_THRASH_settexture@4');
    if(configuration.changeBeforeQuery)assert.equal(await invoke('SetEnvironmentVariableA',text('OGL_TEXFILTER'),text('2',data+128)),1);
    await call(await method('_THRASH_about@0'));
    if(configuration.changeAfterQuery){
      assert.equal(await invoke('SetEnvironmentVariableA',text('OGL_TEXFILTER'),text('2',data+128)),1);
      assert.equal(await invoke('LoadLibraryA',text('drivers\\opengl3z')),library,'Static binding retains initialized configuration');
    }
    m._web_gpu_attach();await call(mode,[1,0,2]);
    const vertex=data+256,pixels=data+1024;
    for(let i=0;i<3;i++){
      [i===1?64:0,i===2?64:0,.5,1].forEach((x,j)=>v.setFloat32(vertex+i*32+j*4,x,true));
      v.setUint32(vertex+i*32+16,0xffffffff,true);
    }
    m.HEAPU8.fill(255,base+pixels,base+pixels+84);
    const textures=[];
    for(const extraMips of [0,2]){const texture=await call(allocate,[4,4,6,0,extraMips]);assert(texture);assert.equal(await call(update,[texture,pixels,0]),texture);textures.push(texture);}
    const results=[];
    for(const [index,c]of cases.entries()){
      const label=configuration.name+' case '+index;
      const stateReturns=[];for(const args of c.changes)stateReturns.push(await call(state,args));
      assert.deepEqual(stateReturns,expected[configurationIndex][index].returns,label+' state results');
      await call(bind,[textures[Number(c.hasMips)]]);lastState=null;await call(draw,[vertex,vertex+32,vertex+64]);
      const until=performance.now()+1000;
      while(!lastState){assert(performance.now()<until,'Filter draw not consumed');await new Promise(r=>setTimeout(r,1));}
      const linear=lastState[6],mip=lastState[26];
      const result={mag:0x2600+linear,min:!c.hasMips||!mip?0x2600+linear:(mip===1?0x2700:0x2702)+linear,
        u:[0x812f,0x2901,0x8370][lastState[27]],v:[0x812f,0x2901,0x8370][lastState[28]],bias:lastState[29]};
      const {returns,...native}=expected[configurationIndex][index];assert.deepEqual(result,native,label+' native GL parameters');
      for(const id of [7,11]){const update=c.changes.findLast(args=>args[0]===id);if(update)assert.equal(await call(get,[id]),update[1],label+' raw state '+id);}
      results.push(result);
    }
    reports.push({name:configuration.name,override:configuration.override,results});
  }finally{clearInterval(timer);r.dispose();}
}
await writeFile('build/native-filter-states.json',JSON.stringify({reports,passed:true},null,2)+'\n');
console.log(`${configurations.length*cases.length} native sampler comparisons passed (filter override, mips, LOD, address aliases, option precedence and raw state queries)`);
