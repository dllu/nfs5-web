import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';

globalThis.crypto??=webcrypto;
const cases=[];
for(const format of [3,4,5,6,7])for(const [width,extraMips]of [[256,0],[8,3]]){
  const bpp=format===5?3:format===6?4:2;
  const pixels=extraMips?85:width*width,source=Buffer.alloc(pixels*bpp);
  for(let i=0;i<pixels;i++){
    if(bpp===2)source.writeUInt16LE(extraMips?(i*2371)&65535:i,i*2);
    else for(let c=0;c<bpp;c++)source[i*bpp+c]=(i*(17+c*18)+(i>>8)*(c+1)+(i>>(c+1)))&255;
  }
  cases.push({format,width,height:width,extraMips,updates:[source.toString('hex'),Buffer.from(source.map(x=>x^255)).toString('hex')]});
}
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
  [new URL('./texture_upload_oracle.py',import.meta.url).pathname],
  {input:JSON.stringify(cases),encoding:'utf8',maxBuffer:32*1024*1024});
assert.equal(oracle.status,0,oracle.stderr);
const native=JSON.parse(oracle.stdout);
const runtime=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module:m,base,manifest}=runtime,data=0x800000,image=0x900000;
const header=new Int32Array(m.HEAPU8.buffer,m._web_gpu_transport(),8),ring=new Uint32Array(m.HEAPU8.buffer,header.byteOffset+32,Atomics.load(header,5));
const textures=new Map(),uploads=[],reports=[];
let failure,totalTexels=0;
const timer=setInterval(()=>{try{
  while(Atomics.load(header,1)!==Atomics.load(header,0)){
    const at=Atomics.load(header,1)>>>0,count=ring[at%ring.length];
    const words=Uint32Array.from({length:count},(_,i)=>ring[(at+i)%ring.length]);
    if(words[1]===5)textures.set(words[3],{width:words[4],height:words[5],levels:words[6],next:0});
    if(words[1]===6){
      const [id,offset,length,total]=words.slice(3,7),texture=textures.get(id);
      assert(texture);assert.equal(offset,texture.next);assert.equal(length+28,count*4);
      if(!offset)texture.incoming=new Uint8Array(total);
      texture.incoming.set(new Uint8Array(words.buffer,28,length),offset);texture.next+=length;
      if(texture.next===total){uploads.push({id,...texture,pixels:Buffer.from(texture.incoming)});texture.next=0;texture.incoming=null;}
    }
    Atomics.store(header,1,(at+count)|0);Atomics.store(header,2,words[2]|0);Atomics.notify(header,1);Atomics.notify(header,2);
  }
}catch(error){failure=error;runtime.stop();}},1);
const text=s=>{m.HEAPU8.set(Buffer.from(s+'\0'),base+data);return data;};
async function call(entry,args=[]){const r=await runtime.invokeAsync(entry,args,2000);if(failure)throw failure;assert.equal(r.status,0,r.error);return r.registers[0];}
const invoke=(name,...args)=>call(manifest.imports.find(i=>i.name===name).slot,args);
try{
  const library=await invoke('LoadLibraryA',text('drivers\\opengl3z'));
  const method=async name=>invoke('GetProcAddress',library,text(name));
  const mode=await method('_THRASH_setvideomode@12'),allocate=await method('_THRASH_talloc@20'),update=await method('_THRASH_tupdate@12'),free=await method('_THRASH_tfree@4');
  m._web_gpu_attach();await call(mode,[1,0,2]);
  for(const [index,c]of cases.entries()){
    const texture=await call(allocate,[c.width,c.height,c.format,0,c.extraMips]);assert(texture);
    const mutations=[];let id;
    for(const [version,hex]of c.updates.entries()){
      m.HEAPU8.set(Buffer.from(hex,'hex'),base+image);
      const before=uploads.length;
      assert.equal(await call(update,[texture,image,0]),texture);
      const deadline=performance.now()+2000;
      while(uploads.length===before){if(failure)throw failure;assert(performance.now()<deadline,'Texture upload did not reach the consumer');await new Promise(r=>setTimeout(r,1));}
      assert.equal(uploads.length,before+1);
      const actual=uploads.at(-1),expected=native[index].updates[version];
      if(id)assert.equal(actual.id,id,'Texture mutation retains the GPU allocation');id=actual.id;
      assert.equal(actual.width,c.width);assert.equal(actual.height,c.height);assert.equal(actual.levels,expected.length);
      let offset=0,sourceOffset=0,maxError=0,quantizedComponents=0;
      for(const [level,wanted]of expected.entries()){
        const allocation=native[index].allocations[level];
        assert.deepEqual([wanted.level,wanted.width,wanted.height],[allocation.level,allocation.width,allocation.height]);
        const raw=Buffer.from(wanted.raw,'hex');assert.deepEqual(raw,Buffer.from(hex,'hex').subarray(sourceOffset,sourceOffset+raw.length),'Native GL consumes the original packed mip bytes');sourceOffset+=raw.length;
        const canonical=Buffer.from(wanted.rgba8,'hex'),pixels=actual.pixels.subarray(offset,offset+canonical.length);
        assert.equal(pixels.length,canonical.length);
        for(let i=0;i<pixels.length;i++){
          const error=Math.abs(pixels[i]-canonical[i]),tolerance=(c.format===3||c.format===4)&&i%4!==3?1:0;
          assert(error<=tolerance,`Format ${c.format}, update ${version}, mip ${level}, byte ${i}: ${pixels[i]} != native normalized ${canonical[i]}`);
          maxError=Math.max(maxError,error);quantizedComponents+=Number(error!==0);
        }
        totalTexels+=canonical.length/4;offset+=canonical.length;
      }
      assert.equal(sourceOffset,hex.length/2);assert.equal(offset,actual.pixels.length);
      mutations.push({levels:expected.length,texels:offset/4,maxError,quantizedComponents});
    }
    reports.push({format:c.format,width:c.width,height:c.height,extraMips:c.extraMips,nativeAllocation:native[index].allocations,mutations});
    await call(free,[texture]);
  }
  await writeFile('build/native-texture-uploads.json',JSON.stringify({passed:true,totalTexels,reports,scope:'Original x86 GL upload bytes and normalized source components, not GPU-rendered pixels'},null,2)+'\n');
  console.log(`${totalTexels.toLocaleString()} texture texels compared with native x86 GL uploads (five formats, exhaustive 16-bit inputs, supplied mips and texture mutations)`);
}finally{clearInterval(timer);runtime.dispose();}
