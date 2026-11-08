import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module,base,manifest}=runtime,out=0x800000,stack=runtime.memorySize-0x10000,view=new DataView(module.HEAPU8.buffer,base);
let checks=0;
function invoke(name,...args) {
  args.forEach((v,i)=>view.setUint32(stack+i*4,v>>>0,true));module._web_set_register(4,stack);
  assert.equal(module._web_run(manifest.imports.find(i=>i.name===name).slot,1000),0,module.UTF8ToString(module._web_error()));
  const regs=new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8);assert.equal(regs[4],stack+args.length*4);checks++;return regs[0];
}
const old=()=>view.getUint32(out,true);
try {
  const p=invoke('VirtualAlloc',0,16384,0x2000,4);assert(p&&!(p&65535));
  assert.equal(invoke('VirtualProtect',p,4096,2,out),0);assert.equal(invoke('GetLastError'),487);
  assert.equal(invoke('VirtualAlloc',p+4095,2,0x1000,4),p,'Commit rounds both ends of an unaligned range');
  assert.equal(invoke('VirtualProtect',p+4095,2,2,out),1);assert.equal(old(),4);
  assert.equal(invoke('VirtualProtect',p+4096,1,4,out),1);assert.equal(old(),2);
  assert.equal(invoke('VirtualProtect',p,1,4,out),1);assert.equal(old(),2);
  assert.equal(invoke('VirtualProtect',p+4096,8192,2,out),0);assert.equal(invoke('GetLastError'),487);
  assert.equal(invoke('VirtualProtect',p+4096,1,2,out),1);assert.equal(old(),4,'Failed region changes leave committed pages untouched');
  assert.equal(invoke('VirtualProtect',p,8192,4,out),1);
  module.HEAPU8[base+p]=0x7F;module.HEAPU8[base+p+4096]=0xAA;
  assert.equal(invoke('VirtualFree',p,4096,0x4000),1);
  assert.equal(invoke('VirtualProtect',p,1,4,out),0);
  assert.equal(invoke('VirtualAlloc',p,4096,0x1000,4),p);assert.equal(module.HEAPU8[base+p],0);assert.equal(module.HEAPU8[base+p+4096],0xAA);
  assert.equal(invoke('VirtualFree',p,0,0x8000),1);
  assert.equal(invoke('VirtualProtect',p,1,4,out),0);assert.equal(invoke('GetLastError'),487);
  const a=invoke('VirtualAlloc',0,65536,0x3000,4),b=invoke('VirtualAlloc',0,65536,0x3000,4);assert.equal(a+65536,b);
  assert.equal(invoke('VirtualProtect',a,65537,2,out),0,'Protection cannot cross independent adjacent reservations');
  assert.equal(invoke('GetLastError'),487);
  assert.equal(invoke('VirtualProtect',a,1,2,0),0);assert.equal(invoke('GetLastError'),87);
  invoke('VirtualFree',a,0,0x8000);invoke('VirtualFree',b,0,0x8000);
  const mapping=invoke('CreateFileMappingA',0xffffffff,0,4,0,8192,0);
  const rw=invoke('MapViewOfFile',mapping,2,0,0,0),ro=invoke('MapViewOfFile',mapping,4,0,0,0);assert(rw&&ro);
  assert.equal(invoke('VirtualProtect',rw,8192,2,out),1);assert.equal(old(),4);
  assert.equal(invoke('VirtualProtect',rw,1,4,out),1);assert.equal(old(),2);
  assert.equal(invoke('VirtualProtect',ro,1,4,out),0);assert.equal(invoke('GetLastError'),5);
  assert.equal(invoke('VirtualProtect',ro,1,1,out),1);assert.equal(old(),2);
  assert.equal(invoke('VirtualProtect',ro,1,2,out),1);assert.equal(old(),1);
  invoke('CloseHandle',mapping);invoke('UnmapViewOfFile',rw);invoke('UnmapViewOfFile',ro);
  invoke('GetSystemInfo',out);assert.equal(view.getUint32(out+4,true),4096);assert.equal(view.getUint32(out+12,true),0x3FFFFFFF);assert.equal(view.getUint32(out+28,true),65536);
  console.log(`${checks} virtual-memory checks passed (reserve/commit/decommit, page rounding, protection metadata, reservation boundaries, mapped access rights)`);
}finally{runtime.dispose();}
