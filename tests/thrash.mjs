import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module,base,manifest}=runtime,view=new DataView(module.HEAPU8.buffer,base),data=0x800000;
const get=p=>view.getUint32(p,true),put=(p,v)=>view.setUint32(p,v>>>0,true);
const text=(s,p=data)=>{module.HEAPU8.set(Buffer.from(s+'\0'),base+p);return p;};
let calls=0;
async function call(entry,args=[]) {
  const result=await runtime.invokeAsync(entry,args);
  assert.equal(result.status,0,result.error);
  assert.equal(result.registers[4],runtime.memorySize-0x10000+args.length*4,'stdcall stack cleanup');calls++;
  return result.registers[0];
}
const invoke=(name,...args)=>call(manifest.imports.find(item=>item.name===name).slot,args);
let library;
const method=async(name,...args)=>call(await invoke('GetProcAddress',library,text(name)),args);
try {
  library=await invoke('LoadLibraryA',text('.\\DRIVERS\\OPENGL3Z.DLL'));assert.equal(library,0x7a000001);
  assert.equal(await invoke('GetModuleHandleA',data),library);
  assert.equal(await invoke('DisableThreadLibraryCalls',library),1);
  assert.equal(await invoke('LoadLibraryA',text('C:\\nfs5\\Drivers\\dx7z')),library);
  for(let ordinal=1;ordinal<=41;ordinal++)assert.equal(await invoke('GetProcAddress',library,ordinal),0xf5000000+(ordinal-1)*16);
  assert.equal(await invoke('GetProcAddress',library,text('Missing')),0);
  assert.equal(await invoke('GetLastError'),127,'Async calls retain guest LastError');
  const descriptor=await method('_THRASH_about@0');assert(descriptor);
  assert.equal(get(descriptor+4),208);assert.equal(get(descriptor+8),107);
  const count=get(descriptor+60),modes=get(descriptor+64),formats=get(descriptor+48);
  const sizes=[];for(let i=1;i<=count;i++)sizes.push([get(modes+i*40),get(modes+i*40+4),get(modes+i*40+8)]);
  assert(sizes.some(v=>v[0]===3840&&v[1]===2160&&v[2]===32));
  assert(sizes.some(v=>v[0]===6144&&v[1]===3456&&v[2]===32));
  assert.deepEqual([get(formats+4),get(formats+8)],[0,0],'Indexed formats use the original game conversion fallback');
  assert.equal(await method('_THRASH_init@0'),1);
  assert.equal(await method('_THRASH_getstate@4',6),1,'Native default is Gouraud shading');
  for(const mode of [0,2,1]) {
    assert.equal(await method('_THRASH_setstate@8',6,mode),1);
    assert.equal(await method('_THRASH_getstate@4',6),mode);
  }
  assert.equal(await method('_THRASH_setstate@8',6,3),0,'Unknown shading modes are rejected');
  assert.equal(await method('_THRASH_getstate@4',6),1,'Rejected shading mode preserves state');
  assert.equal(await method('_THRASH_getstate@4',7),1,'Native default spatial filter is linear');
  assert.equal(await method('_THRASH_getstate@4',11),1,'Native default mip filter is nearest');
  for(const state of [13,65,66]) {
    assert.equal(await method('_THRASH_setstate@8',state,2),1,'Native mirrored addressing is accepted');
    assert.equal(await method('_THRASH_setstate@8',state,3),0,'Invalid texture addressing is rejected');
    assert.equal(await method('_THRASH_getstate@4',state),2,'Invalid addressing preserves retained state');
  }
  for(const [preset,src,dst] of [[0,2,3],[1,2,0],[2,1,3],[3,7,1]]) {
    assert.equal(await method('_THRASH_setstate@8',56,preset),1);
    assert.equal(await method('_THRASH_getstate@4',404),src,'Preset retains native source factor');
    assert.equal(await method('_THRASH_getstate@4',405),dst,'Preset retains native destination factor');
  }
  assert.equal(await method('_THRASH_setstate@8',404,9),1);
  assert.equal(await method('_THRASH_setstate@8',405,8),1);
  assert.equal(await method('_THRASH_getstate@4',56),4,'Custom factors mark the blend preset custom');
  assert.equal(await method('_THRASH_getstate@4',104),4,'Custom factors mark the legacy preset alias custom');
  assert.equal(await method('_THRASH_setstate@8',404,10),0);
  assert.equal(await method('_THRASH_getstate@4',404),9,'Rejected source factor preserves state');
  assert.equal(await method('_THRASH_setstate@8',405,10),0);
  assert.equal(await method('_THRASH_getstate@4',405),8,'Rejected destination factor preserves state');
  assert.equal(await method('_THRASH_setstate@8',56,4),0,'Custom sentinel is not a selectable preset');
  assert.equal(await method('_THRASH_setstate@8',56,0),1);
  for(const mode of [0,1,2,3])assert.equal(await method('_THRASH_setstate@8',10,mode),1,'ABI 107 accepts all four blend modes');
  assert.equal(await method('_THRASH_setstate@8',10,4),0);
  assert.equal(await method('_THRASH_setstate@8',31,106),1);
  assert.equal(await method('_THRASH_setstate@8',10,3),0,'Older ABI rejects blend mode three');
  assert.equal(await method('_THRASH_setstate@8',10,1),1,'Older ABI accepts blend mode one');
  await method('_THRASH_setstate@8',31,107);await method('_THRASH_setstate@8',10,0);
  assert.equal(await method('_THRASH_selectdisplay@4',0),1);assert.equal(await method('_THRASH_selectdisplay@4',1),0);
  for(const window of [0,1,2,3])assert.equal(await method('_THRASH_window@4',window),1);
  assert.equal(await method('_THRASH_window@4',4),0);await method('_THRASH_window@4',1);
  assert.equal(await method('_THRASH_setstate@8',4,2),0,'Native OpenGL driver does not advertise W-buffer mode');
  assert.equal(await method('_THRASH_getstate@4',4),0,'Rejected depth mode preserves state');
  for(const state of [48,52,53,54]) {
    assert.equal(await method('_THRASH_setstate@8',state,7),1);
    assert.equal(await method('_THRASH_setstate@8',state,8),0,'Invalid stencil enum is rejected');
    assert.equal(await method('_THRASH_getstate@4',state),7,'Invalid stencil enum preserves state');
  }
  assert.equal(await method('_THRASH_setstate@8',37,1),0,'Optional timer callbacks are not falsely advertised');
  assert.equal(await method('_THRASH_setstate@8',451,0),1,'Native frontend extension probe enables detailed menu draws');
  assert.equal(await method('_THRASH_getstate@4',451),0xffffffff,'The native probe does not create retained state');
  // Execute the original capability setup, which decides whether menu
  // highlights and shadows use Gouraud geometry or the flat fallback.
  for(const [at,name] of [[0x6bd934,'_THRASH_about@0'],[0x6bd984,'_THRASH_getstate@4'],[0x6bd97c,'_THRASH_setstate@8']])
    put(at,await invoke('GetProcAddress',library,text(name)));
  put(0x619784,640);put(0x619788,480);put(0x61978c,32);
  await call(0x44e890);
  assert.equal(view.getUint8(0x6197aa),1,'Original capability setup enables detailed frontend rendering');
  assert.equal(await method('_THRASH_setstate@8',42,1),1);assert.equal(await method('_THRASH_getstate@4',42),1);
  const before=module._web_trace_count();
  assert.equal(await method('_THRASH_setstate@8',39,0x444110),1);
  assert.equal(await method('_THRASH_setstate@8',3,0xff112233),1);
  assert.equal(module._web_trace_count()-before,2,'Original stdcall state callbacks execute');
  assert.equal(await method('_THRASH_setstate@8',39,0),1);
  assert.equal(await method('_THRASH_talloc@20',0,16,6,0,0),0);
  assert.equal(await method('_THRASH_talloc@20',8,8,6,0,4),0,'Mip count cannot exceed the full texture chain');
  const texture=await method('_THRASH_talloc@20',8,4,6,0,0);assert(texture);
  assert.deepEqual([get(texture),get(texture+4),get(texture+8)],[8,4,6]);
  assert.equal(await method('_THRASH_tfree@4',texture),1);
  const mode=await invoke('GetProcAddress',library,text('_THRASH_setvideomode@12'));
  const stopped=await runtime.invokeAsync(mode,[1,0,1]);
  assert.equal(stopped.status,1);assert.match(stopped.error,/WebGPU renderer is not attached/);
  console.log(`${calls} Thrash loader/ABI calls passed (41 exports, descriptors, 4K/6K modes, callbacks, explicit missing-renderer failure)`);
} finally {runtime.dispose();}
