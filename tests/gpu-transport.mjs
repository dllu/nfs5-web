import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module,base,manifest}=runtime,view=new DataView(module.HEAPU8.buffer,base);
const data=0x800000,stack=runtime.memorySize-0x10000;
const header=new Int32Array(module.HEAPU8.buffer,module._web_gpu_transport(),8);
const ring=new Uint32Array(module.HEAPU8.buffer,header.byteOffset+32,Atomics.load(header,5));
const text=s=>{module.HEAPU8.set(new TextEncoder().encode(s+'\0'),base+data);return data;};
const slot=name=>manifest.imports.find(i=>i.name===name).slot;
let checks=0;
async function call(entry,args=[]) {
  const result=await runtime.invokeAsync(entry,args,500);
  assert.equal(result.status,0,result.error);checks++;
  return result.registers[0];
}
async function until(predicate,label) {
  const deadline=performance.now()+1000;
  while(!predicate()) {
    assert(performance.now()<deadline,label);
    await new Promise(resolve=>setTimeout(resolve,1));
  }
}
function start(entry,args=[]) {
  args.forEach((v,i)=>view.setUint32(stack+i*4,v>>>0,true));module._web_set_register(4,stack);
  assert.equal(module._web_start(entry,0),0);
}
async function finish() {
  await until(()=>module._web_async_status()!==1,'Guest did not return after acknowledgement');
  assert.equal(module._web_async_finish(),0,module.UTF8ToString(module._web_error()));checks++;
  return new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8)[0];
}
// An intentionally stalled consumer makes producer barriers observable without
// relying on browser task timing. Pixel rendering is checked in renderer.mjs.
async function packet(opcode) {
  await until(()=>Atomics.load(header,0)!==Atomics.load(header,1),'No graphics packet');
  const read=Atomics.load(header,1)>>>0,count=ring[read%ring.length];
  const words=Uint32Array.from({length:count},(_,i)=>ring[(read+i)%ring.length]);
  assert.equal(words[1],opcode);checks++;
  return {words,end:(read+count)|0};
}
function acknowledge({words,end}) {
  Atomics.store(header,1,end);Atomics.store(header,2,words[2]|0);
  Atomics.notify(header,1);Atomics.notify(header,2);
}
async function barrier(entry,args,opcode) {
  start(entry,args);const command=await packet(opcode);
  // The packet was published, but a true barrier must still be pending.
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(module._web_async_status(),1,'Barrier returned before acknowledgement');checks++;
  return command;
}
try {
  const library=await call(slot('LoadLibraryA'),[text('drivers\\opengl3z')]);
  const methods={};
  for(const name of ['flushwindow','pageflip','setvideomode','readrect','restore']) {
    const suffix={flushwindow:0,pageflip:0,setvideomode:12,readrect:20,restore:0}[name];
    methods[name]=await call(slot('GetProcAddress'),[library,text(`_THRASH_${name}@${suffix}`)]);
    assert(methods[name]);
  }
  module._web_gpu_attach();
  assert.equal(await call(methods.flushwindow),1,'Flush returns while the consumer is idle');
  const flush=await packet(9);
  assert.equal(Atomics.load(header,1),0);assert.equal(Atomics.load(header,2),0);checks++;
  // Leave flush queued: the next barrier must follow it in the same stream.
  start(methods.setvideomode,[1,0,2]);
  await until(()=>Atomics.load(header,0)>flush.end,'No mode-change packet after flush');
  assert.equal(module._web_async_status(),1);checks++;
  acknowledge(flush);
  const resize=await packet(1);assert.deepEqual(Array.from(resize.words.slice(3)),[640,480]);checks++;
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(module._web_async_status(),1,'Flush acknowledgement must not release resize');checks++;
  acknowledge(resize);assert.equal(await finish(),1);
  const present=await barrier(methods.pageflip,[],3);acknowledge(present);assert.equal(await finish(),1);
  const readback=await barrier(methods.readrect,[0,0,1,1,data+128],8);
  const [destination,width,height]=readback.words.slice(3);
  assert.deepEqual([width,height],[640,480]);checks++;
  module.HEAPU8.set([0x12,0xab,0x34,0xff],destination);
  acknowledge(readback);assert.equal(await finish(),1);
  assert.equal(view.getUint16(data+128,true),0x1546,'RGB565 readback is copied only after completion');checks++;
  const reset=await barrier(methods.restore,[],10);acknowledge(reset);assert.equal(await finish(),1);
  assert.equal(Atomics.load(header,0),Atomics.load(header,1));checks++;
  const timed=await runtime.invokeAsync(methods.setvideomode,[1,0,2],30);
  assert.equal(timed.status,1);assert.match(timed.error,/Graphics wait budget reached/);checks++;
  console.log(`${checks} graphics-transport checks passed (asynchronous flush, ordered resize, present/readback/reset barriers, finite deadline)`);
} finally {runtime.stop();runtime.dispose();}
