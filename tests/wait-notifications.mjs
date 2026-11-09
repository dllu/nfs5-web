// lifecycle.mjs runs this in a bounded subprocess: a lost wake must not hang
// the complete suite when the native guest has an infinite kernel-object wait.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module,base,manifest}=runtime,data=0x800000,stack=runtime.memorySize-0x10000;
const view=new DataView(module.HEAPU8.buffer,base),slots=new Map(manifest.imports.map(i=>[i.name,i.slot]));
const slot=name=>{assert(slots.has(name),name);return slots.get(name);};
let checks=0;
function call(name,args=[]) {
  args.forEach((v,i)=>view.setUint32(stack+i*4,v>>>0,true));module._web_set_register(4,stack);
  assert.equal(module._web_run(slot(name),2000),0,module.UTF8ToString(module._web_error()));
  return new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8)[0];
}
const create=(entry,parameter)=>call('CreateThread',[0,0,entry,parameter,0,0]);
const exits=async(handles,expected)=>{
  handles.forEach((h,i)=>view.setUint32(data+i*4,h,true));
  assert.equal(call('WaitForMultipleObjectsEx',[handles.length,data,1,1000,0]),0);
  for(const h of handles) {
    assert.equal(call('GetExitCodeThread',[h,data+64]),1);
    assert.equal(view.getUint32(data+64,true),expected);
    assert.equal(call('CloseHandle',[h]),1);
  }
};
try {
  module.HEAPU8.set(Buffer.from('KERNEL32\0'),base+data+128);
  const kernel=call('GetModuleHandleA',[data+128]);
  module.HEAPU8.set(Buffer.from('GetExitCodeThread\0'),base+data+128);
  slots.set('GetExitCodeThread',call('GetProcAddress',[kernel,data+128]));
  assert(slots.get('GetExitCodeThread'));
  const event=call('CreateEventA',[0,1,0,0]);assert(event);
  view.setUint32(data,event,true);
  for(const [entry,args,budget=40] of [[slot('WaitForSingleObject'),[event,0xffffffff]],
    [slot('WaitForMultipleObjectsEx'),[1,data,1,0xffffffff,0]],
    [slot('Sleep'),[0xffffffff]],[slot('Sleep'),[1],1],[0xf1000010,[]]]) {
    let rescued=false;const watchdog=setTimeout(()=>{rescued=true;runtime.stop();},500);
    try {
      const result=await runtime.invokeAsync(entry,args,budget);
      assert.equal(rescued,false,'A finite run budget must bound a blocked host API');
      assert.equal(result.status,1);assert.match(result.error,/budget reached/);checks++;
    }finally{clearTimeout(watchdog);}
  }
  const auto=call('CreateEventA',[0,0,0,0]);assert(auto);
  for(let i=0;i<32;i++) {
    // Signals can arrive before registration, between unlock/park, or while
    // parked. The auto-reset token must be delivered exactly once in all cases.
    const worker=create(slot('SetEvent'),auto);assert(worker);
    assert.equal(call('WaitForSingleObject',[auto,1000]),0);
    assert.equal(call('WaitForSingleObject',[auto,0]),258);
    await exits([worker],1);checks++;
  }
  assert.equal(call('CloseHandle',[auto]),1);
  // Original 0055FB90 is a one-argument event-wait wrapper. It blocks through
  // WaitForMultipleObjectsEx(INFINITE) and returns the signaled handle.
  const workers=Array.from({length:7},()=>create(0x55fb90,event));assert(workers.every(Boolean));
  await new Promise(resolve=>setTimeout(resolve,20));
  for(const h of workers) {
    assert.equal(call('GetExitCodeThread',[h,data+64]),1);
    assert.equal(view.getUint32(data+64,true),259);
  }
  assert.equal(call('SetEvent',[event]),1);await exits(workers,event);checks++;
  assert.equal(call('ResetEvent',[event]),1);
  const canceled=Array.from({length:7},()=>create(0x55fb90,event));assert(canceled.every(Boolean));
  await new Promise(resolve=>setTimeout(resolve,20));
  const completed=await runtime.invokeAsync(slot('GetTickCount'),[],0);
  assert.equal(completed.status,0,completed.error);
  for(const h of canceled)assert.equal(call('CloseHandle',[h]),1);checks++;
  for(const [entry,args] of [[0x55fb90,[event]],[0xf1000010,[]]]) {
    const stop=setTimeout(()=>runtime.stop(),20);
    try {
      const stopped=await runtime.invokeAsync(entry,args,0);
      assert.equal(stopped.stopped,true);checks++;
    }finally{clearTimeout(stop);}
  }
  // A compute worker fails after the primary has parked on an unrelated event.
  // Its thread-completion object cannot itself satisfy that primary wait.
  const root=data+0x400,sentinel=root+32,node=root+64;
  for(const [entry,args] of [[0x55fb90,[event]],[0xf1000010,[]]]) {
    for(const [at,value] of [[0x69cae4,root],[root,sentinel],[sentinel,node],[node,node],[node+8,0]])view.setUint32(at,value,true);
    const failed=create(0x5292d0,1);assert(failed);
    const corrupt=setTimeout(()=>Atomics.store(new Uint32Array(module.HEAPU8.buffer),(base+node)/4,0x20000000),30);
    try {
      const result=await runtime.invokeAsync(entry,args,0);
      assert.equal(result.status,1);assert.match(result.error,/Unmapped guest address/);
      assert(result.thread>1,'The original failing worker remains the reported error source');checks++;
    }finally{clearTimeout(corrupt);}
    assert.equal(call('CloseHandle',[failed]),1);
  }
  assert.equal(call('CloseHandle',[event]),1);
  console.log(`${checks} blocked-wait checks passed (finite budgets, signal races, seven parked workers, normal completion, Stop, worker failure)`);
}finally{runtime.stop();runtime.dispose();}
