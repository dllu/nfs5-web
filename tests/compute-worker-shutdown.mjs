// Invoked by lifecycle.mjs in a subprocess: broken VM shutdown must not hang
// the test runner itself while the guest owns the machine indefinitely.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module,base,manifest}=runtime,view=new DataView(module.HEAPU8.buffer,base);
const data=0x800000,stack=runtime.memorySize-0x10000;
try {
  // Original 005292D0 searches a list until it finds the requested value or
  // sentinel. A self-linked non-sentinel node keeps it entirely in guest code.
  for(const [at,value] of [[0x69cae4,data],[data,data+16],[data+16,data+32],[data+32,data+32],[data+40,0]])
    view.setUint32(at,value,true);
  [0,0,0x5292d0,1,0,0].forEach((v,i)=>view.setUint32(stack+i*4,v,true));
  module._web_set_register(4,stack);
  const create=manifest.imports.find(i=>i.name==='CreateThread').slot;
  assert.equal(module._web_run(create,0),0,module.UTF8ToString(module._web_error()));
  assert(new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8)[0]);
  await new Promise(resolve=>setTimeout(resolve,25));
  assert(runtime.seen(0x5292d0),'Original worker entered its compute loop');
  console.log('Original compute worker entered; disposing runtime');
}finally{runtime.dispose();}
console.log('Original compute worker stopped during runtime disposal');
