import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module,base,manifest}=runtime,data=0x800000,vector=data+4096,stack=runtime.memorySize-0x10000;
const view=new DataView(module.HEAPU8.buffer,base),slot=name=>manifest.imports.find(i=>i.name===name).slot;
function invoke(name,...args) {
  args.forEach((v,i)=>view.setUint32(stack+i*4,v>>>0,true));module._web_set_register(4,stack);
  assert.equal(module._web_run(slot(name),3000),0,module.UTF8ToString(module._web_error()));
  return new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8)[0];
}
const integers=[0x123456789abcdefn,-0x123456789abcdefn,(1n<<53n)+1n,(1n<<63n)-1n,-(1n<<63n)+1n];
let checks=0;
try {
  for(const switchWorker of [false,true])for(let start=0;start<integers.length;start++)for(let depth=1;depth<=3;depth++) {
    module._web_init();
    const mapping=invoke('CreateFileMappingA',0xffffffff,0,4,0,4096,0);assert(mapping);
    const mapped=invoke('MapViewOfFile',mapping,2,0,0,4096);assert(mapped);
    const source=mapped+4096-8-32*(depth-1),values=Array.from({length:depth},(_,i)=>integers[(start+i)%integers.length]);
    for(const [i,value] of values.entries())new DataView(module.HEAPU8.buffer).setBigInt64(module._web_pointer(source+i*32,8),value,true);
    // Original memcpy loads qwords at offsets 0, 32, 64, 96. The first
    // unmapped read stops it with exact integers still live on the x87 stack.
    const stopped=runtime.call(0x5b0100,data,source,128);
    assert.equal(stopped.status,1);assert.match(stopped.error,/Unmapped guest address/);
    if(switchWorker) {
      for(const [offset,value] of [[0x33c,2],[0x340,4],[0x344,6],[0x3b8,3],[0x3bc,5],[0x3c0,7]])view.setFloat32(vector+offset,value,true);
      const worker=invoke('CreateThread',0,0,0x40ef30,vector,0,0);assert(worker);
      assert.equal(invoke('WaitForSingleObject',worker,1000),0);
      assert.equal(invoke('CloseHandle',worker),1);
    }
    for(const value of values.reverse()) {
      // Original CRT _ftol consumes ST0 and returns the exact EDX:EAX pair.
      const converted=runtime.call(0x5a0f98);
      assert.equal(converted.status,0,converted.error);
      const actual=BigInt.asIntN(64,BigInt(converted.registers[2])<<32n|BigInt(converted.registers[0]));
      assert.equal(actual,value,`Exact x87 integer at depth ${depth}, worker switch ${switchWorker}`);checks++;
    }
    assert.equal(invoke('UnmapViewOfFile',mapped),1);assert.equal(invoke('CloseHandle',mapping),1);
  }
  console.log(`${checks} exact x87 integer returns passed (original memcpy/_ftol, live stack depths, worker isolation)`);
}finally{runtime.dispose();}
