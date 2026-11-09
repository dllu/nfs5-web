// Run by lifecycle.mjs in a bounded subprocess so a stranded native guest
// cannot hang the suite. ExitProcess must end the guest and leave Node alive.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
let checks=0;
async function load() {
  const runtime=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
  const {module,base,manifest}=runtime,data=0x800000,stack=runtime.memorySize-0x10000;
  const view=new DataView(module.HEAPU8.buffer,base),slots=new Map(manifest.imports.map(i=>[i.name,i.slot]));
  const slot=name=>{assert(slots.has(name),name);return slots.get(name);};
  function call(name,args=[]) {
    args.forEach((v,i)=>view.setUint32(stack+i*4,v>>>0,true));module._web_set_register(4,stack);
    assert.equal(module._web_run(slot(name),2000),0,module.UTF8ToString(module._web_error()));
    return new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8)[0];
  }
  function text(value) {module.HEAPU8.set(new TextEncoder().encode(value+'\0'),base+data+128);return data+128;}
  const kernel=call('GetModuleHandleA',[text('KERNEL32')]);
  slots.set('GetExitCodeThread',call('GetProcAddress',[kernel,text('GetExitCodeThread')]));
  assert(slots.get('GetExitCodeThread'));
  return {runtime,module,view,slot,call,data,text};
}
function exited(result,code) {
  assert.equal(result.status,0,result.error);assert.equal(result.error,'');
  assert.equal(result.stopped,false);assert.equal(result.exited,true);assert.equal(result.exitCode,code);checks++;
}
let env=await load();
try {
  const {runtime,call,slot,view,data}=env;
  exited(runtime.call(slot('ExitProcess'),0),0);
  exited(runtime.call(slot('ExitProcess'),0xfedcba98),0xfedcba98);
  const event=call('CreateEventA',[0,1,0,0]);assert(event);
  const workers=Array.from({length:7},()=>call('CreateThread',[0,0,0x55fb90,event,0,0]));assert(workers.every(Boolean));
  await new Promise(resolve=>setTimeout(resolve,20));
  exited(await runtime.invokeAsync(slot('ExitProcess'),[37],0),37);
  for(const h of workers) {
    assert.equal(call('WaitForSingleObject',[h,0]),0,'All seven blocked workers finish');
    assert.equal(call('GetExitCodeThread',[h,data]),1);assert.equal(view.getUint32(data,true),37);
    assert.equal(call('CloseHandle',[h]),1);checks++;
  }
  const restarted=await runtime.invokeAsync(slot('GetTickCount'));
  assert.equal(restarted.status,0,restarted.error);assert.equal(restarted.exited,false);assert.equal(restarted.exitCode,null);checks++;
}finally{env.runtime.dispose();}

// ExitProcess in a multimedia callback must interrupt a primary thread parked
// on an unrelated event, sleeping, dispatching messages/timers, spinning in
// original code, or waiting for a stalled graphics consumer.
for(const kind of ['event','sleep','messages','timer','compute','graphics']) {
  env=await load();
  const {runtime,module,view,slot,call,data,text}=env;
  let timer;
  try {
    let entry,args;
    if(kind==='event') {
      const event=call('CreateEventA',[0,1,0,0]);assert(event);entry=0x55fb90;args=[event];
    }else if(kind==='sleep'){entry=slot('Sleep');args=[0xffffffff];}
    else if(kind==='messages'){entry=slot('GetMessageA');args=[data,0,0,0];}
    else if(kind==='timer'){entry=0xf1000010;args=[];}
    else if(kind==='compute'){view.setUint32(data,data,true);entry=0x580b70;args=[data,0xffffffff];}
    else {
      const library=call('LoadLibraryA',[text('drivers\\opengl3z')]);
      entry=call('GetProcAddress',[library,text('_THRASH_setvideomode@12')]);assert(entry);
      module._web_gpu_attach();args=[1,0,1];
    }
    const id=call('timeSetEvent',[100,0,slot('ExitProcess'),0,0]);assert(id);
    let rescued=false;timer=setTimeout(()=>{rescued=true;runtime.stop();},1000);
    exited(await runtime.invokeAsync(entry,args,0),id);
    assert.equal(rescued,false,`Callback exit must wake ${kind} without host intervention`);
    assert.equal(module._web_async_status(),0);assert.equal(runtime.stop(),false);
    assert.equal(new Uint32Array(module.HEAPU8.buffer,module._web_timer_stats(),5)[4],0,'Exit clears pending timers');checks++;
  }finally{clearTimeout(timer);runtime.dispose();}
}
console.log(`${checks} process-exit checks passed (exit codes, seven blocked workers, callback exit during object/sleep/message/timer/compute/GPU waits, reuse)`);
