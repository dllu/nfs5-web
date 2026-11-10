import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {streamAssets} from '../web/streaming.mjs';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const chunk=262144,delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const deadline=performance.now()+3000;while(!check()){assert(performance.now()<deadline,'Read-ahead must make progress');await delay(2);}}
function transport(){
 const buffer=new SharedArrayBuffer(64+4*(chunk+16)),h=new Int32Array(buffer,0,16);
 h.set([1,0,1,chunk*12-17,-1,0,0,0,0,1,chunk,4]);
 const page=Array.from({length:4},(_,i)=>({s:new Int32Array(buffer,64+i*(chunk+16),4),data:new Uint8Array(buffer,80+i*(chunk+16),chunk)}));
 return {buffer,h,page,hint(start){Atomics.store(h,4,start);Atomics.add(h,1,1);Atomics.notify(h,1);},stop(){Atomics.store(h,0,0);Atomics.add(h,1,1);Atomics.notify(h,1);}};
}
const t=transport(),ranges=[];let active=0,peak=0;
const run=streamAssets({buffer:t.buffer,offset:0,url:'https://test.invalid/music'}, {read:async(url,{headers,signal})=>{
 const [start,end]=headers.Range.slice(6).split('-').map(Number);ranges.push([start,end]);peak=Math.max(peak,++active);
 try{await delay(8);if(signal.aborted)throw new Error('Aborted');return new Response(new Uint8Array(end-start+1).fill(start/chunk),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${t.h[3]}`}});}finally{active--;}
}});
try{
 await delay(15);assert.equal(ranges.length,0,'Do not download music before the original game reads it');
 t.hint(0);await until(()=>Atomics.load(t.h,7)===chunk*3);
 assert.equal(ranges.length,3);assert(peak<=2,'Background concurrency is bounded');
 assert.deepEqual(t.page.filter(p=>Atomics.load(p.s,0)===2).map(p=>p.s[1]).sort((a,b)=>a-b),[chunk,chunk*2,chunk*3]);
 for(const p of t.page.filter(p=>p.s[0]===2))assert.equal(p.data[chunk-1],p.s[1]/chunk);
 const claimed=t.page.find(p=>p.s[1]===chunk);assert.equal(Atomics.compareExchange(claimed.s,0,2,3),2);
 const claimedBytes=claimed.data.slice();t.hint(chunk*7);await until(()=>ranges.length>=6&&active===0);
 assert.deepEqual(claimed.data,claimedBytes,'Eviction must not overwrite a page claimed by native code');
 assert.equal(claimed.s[0],3);Atomics.store(claimed.s,0,2);
 t.hint(chunk*10);await until(()=>t.page.some(p=>p.s[0]===2&&p.s[1]===chunk*11));
 const tail=t.page.find(p=>p.s[0]===2&&p.s[1]===chunk*11);assert.equal(tail.s[2],chunk-17);assert.equal(tail.data[tail.s[2]-1],11);
 assert.equal(t.buffer.byteLength,64+4*(chunk+16));assert.equal(Atomics.load(t.h,8),0);
}finally{t.stop();await run;}
for(const response of [new Response(new Uint8Array(3)),new Response(new Uint8Array(3),{status:206,headers:{'Content-Range':'bytes 262144-524287/3145711'}})]){
 const t=transport();t.hint(0);await streamAssets({buffer:t.buffer,offset:0,url:'https://test.invalid/music'},{read:async()=>response.clone()});
 assert.equal(t.h[0],0);assert(t.h[8]>0,'Invalid range/short responses disable read-ahead for ordinary I/O fallback');
}

const runtime=await loadRuntime({persist:false,read:async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)))}),m=runtime.module;
try{
 const id=runtime.mount('C:\\nfs5\\Stream.bin',{url:'file:///not-present',size:chunk*4});
 const offset=m._web_fs_stream(id),h=new Int32Array(m.HEAPU8.buffer,offset,16),s=new Int32Array(m.HEAPU8.buffer,offset+64,4);
 assert(offset);assert.equal(h[10],chunk);m.HEAPU8.fill(93,offset+80,offset+80+chunk);s[1]=chunk;s[2]=chunk;Atomics.store(s,0,2);
 const address=runtime.base+0x800000;m.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\Stream.bin\0'),address);
 async function call(name,args){const r=await runtime.invokeAsync(runtime.manifest.imports.find(i=>i.name===name).slot,args);assert.equal(r.status,0,r.error);return r.registers[0];}
 const file=await call('CreateFileA',[0x800000,0x80000000,3,0,3,128,0]);assert.notEqual(file,0xffffffff);
 assert.equal(await call('SetFilePointer',[file,chunk,0,0]),chunk);
 assert.equal(await call('ReadFile',[file,0x800100,32,0x800200,0]),1);
 assert.deepEqual(Array.from(m.HEAPU8.subarray(address+256,address+288)),Array(32).fill(93));assert.equal(h[5],1);assert.equal(h[4],chunk);
 assert.equal(new Float64Array(m.HEAPU8.buffer,m._web_fs_io_stats(),6)[0],0,'Ready background pages bypass synchronous file/network reads');
 await call('CloseHandle',[file]);runtime.mount('C:\\nfs5\\Stream.bin',{url:'file:///replacement',size:chunk});
 assert.equal(h[0],0,'Changing an asset invalidates its read-ahead session');
}finally{m._web_fs_stream(0);runtime.dispose();}
console.log('Bounded music read-ahead, concurrency, eviction ownership, tail bytes, range fallback and native reads without network passed');

// Song-aware layout: cache complete songs in coalesced ranges. Advancing within
// a song must not require any more HTTP requests after the initial warmup.
const songBuffer=new SharedArrayBuffer(64+48*(chunk+16)),songHeader=new Int32Array(songBuffer,0,16);
songHeader.set([1,0,1,chunk*100-17,-1,0,0,0,0,2,chunk,48]);
const songs=[{offset:chunk*3+128,size:chunk*23+19},{offset:chunk*30+512,size:chunk*21+333},{offset:chunk*73+256,size:chunk*7+27}];
const songRequests=[];
const songRun=streamAssets({buffer:songBuffer,offset:0,url:'https://test.invalid/music',ranges:songs},{read:async(url,{headers})=>{
 const [start,end]=headers.Range.slice(6).split('-').map(Number);songRequests.push([start,end]);
 const bytes=new Uint8Array(end-start+1);for(let at=start;at<=end;at+=chunk)bytes.fill(at/chunk,at-start,Math.min(at-start+chunk,bytes.length));
 return new Response(bytes,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${songHeader[3]}`}});
}});
const hint=offset=>{Atomics.store(songHeader,4,offset);Atomics.add(songHeader,1,1);Atomics.notify(songHeader,1);};
try{
 hint(songs[0].offset+4096);await until(()=>songHeader[7]>=chunk*46);
 assert(songRequests.some(([start,end])=>end-start+1===4*chunk),'Adjacent pages share a 1 MiB request');
 const requests=songRequests.length;
 for(let i=0;i<5;i++){hint(songs[0].offset+i*chunk+4096);await delay(5);}
 assert.equal(songRequests.length,requests,'A warmed song plays without additional network requests');
 for(const song of songs.slice(0,2))for(let at=Math.floor(song.offset/chunk)*chunk;at<song.offset+song.size;at+=chunk){
  let page;for(let i=0;i<48;i++){const s=new Int32Array(songBuffer,64+i*(chunk+16),4);if(s[0]===2&&s[1]===at)page={s,data:new Uint8Array(songBuffer,80+i*(chunk+16),chunk)};}
  assert(page,`Current and next songs retain page ${at}`);assert.equal(page.data[chunk-1],at/chunk);
 }
}finally{Atomics.store(songHeader,0,0);Atomics.add(songHeader,1,1);Atomics.notify(songHeader,1);await songRun;}
console.log('Complete current/next-song caching, coalesced 1 MiB reads and network-free playback of warmed songs passed');
