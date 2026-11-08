import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module,base,manifest}=runtime,data=0x800000,stack=runtime.memorySize-0x10000;
const view=new DataView(module.HEAPU8.buffer,base),slot=name=>manifest.imports.find(i=>i.name===name).slot;
let checks=0;
function call(name,args=[]) {
  args.forEach((value,i)=>view.setUint32(stack+i*4,value>>>0,true));module._web_set_register(4,stack);
  assert.equal(module._web_run(slot(name),1000),0,module.UTF8ToString(module._web_error()));checks++;
  return new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8)[0];
}
async function interrupt(entry,args) {
  const started=performance.now();let requested=false;
  const timer=setTimeout(()=>{requested=runtime.stop();},30);
  try {
    const result=await runtime.invokeAsync(entry,args,0);
    assert(requested,'A live run accepts stop');assert.equal(result.status,1);assert.equal(result.stopped,true);
    assert.equal(result.error,'Stopped by user');assert(performance.now()-started<1000,'Stop wakes a blocked run promptly');
    assert.equal(module._web_async_status(),0);assert.equal(runtime.stop(),false);checks++;
  }finally{clearTimeout(timer);}
}
const text=s=>{module.HEAPU8.set(new TextEncoder().encode(s+'\0'),base+data);return data;};
try {
  assert.equal(runtime.stop(),false);checks++;
  await interrupt(slot('GetMessageA'),[data,0,0,0]);
  assert.equal((await runtime.invokeAsync(slot('GetTickCount'))).status,0,'A completed stop does not poison subsequent invocations');checks++;
  const event=call('CreateEventA',[0,0,0,0]);assert(event);
  assert(call('timeSetEvent',[1000,0,event,0,0x10]));
  await interrupt(slot('GetMessageA'),[data,0,0,0]);
  assert.equal(new Uint32Array(module.HEAPU8.buffer,module._web_timer_stats(),5)[4],0,'Stopping wakes and clears the sleeping timer dispatcher');checks++;
  call('CloseHandle',[event]);
  await interrupt(slot('Sleep'),[0xffffffff]);
  const library=call('LoadLibraryA',[text('drivers\\opengl3z')]);
  const mode=call('GetProcAddress',[library,text('_THRASH_setvideomode@12')]);assert(mode);
  // Attach an intentionally stalled consumer. A mode change waits for its
  // resize acknowledgement until Stop unwinds the native graphics producer.
  module._web_gpu_attach();await interrupt(mode,[1,0,1]);
  console.log(`${checks} lifecycle checks passed (unbounded runs, message/sleep/GPU cancellation, timer wakeup, stop/restart)`);
}finally{runtime.dispose();}
