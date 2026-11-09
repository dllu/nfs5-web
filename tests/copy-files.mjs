import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const runtime=await loadRuntime({read:async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)))});
const {module,base,manifest}=runtime,data=0x800000,out=data+4096,count=out+0x40000,stack=runtime.memorySize-0x10000;
const view=new DataView(module.HEAPU8.buffer,base),get=p=>view.getUint32(p,true);
let calls=0;
function invoke(name,...args) {
  args.forEach((value,i)=>view.setUint32(stack+i*4,value>>>0,true));module._web_set_register(4,stack);
  assert.equal(module._web_run(manifest.imports.find(i=>i.name===name).slot,3000),0,module.UTF8ToString(module._web_error()));
  const regs=new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8);
  assert.equal(regs[4],stack+args.length*4,`${name} stdcall cleanup`);calls++;return regs[0];
}
const text=(s,p=data)=>{module.HEAPU8.set(Buffer.from(s+'\0','latin1'),base+p);return p;};
const copy=(a,b,exclusive=0)=>invoke('CopyFileA',text(a),text(b,data+512),exclusive);
const open=(path,access=0x80000000,share=3,disposition=3)=>invoke('CreateFileA',text(path),access,share,0,disposition,128,0);
const close=h=>assert.equal(invoke('CloseHandle',h),1);
const error=n=>assert.equal(invoke('GetLastError'),n);
function bytes(path,length) {
  const file=open(path);assert.notEqual(file,0xffffffff);
  assert.equal(invoke('GetFileSize',file,0),length);
  assert.equal(invoke('ReadFile',file,out,length,count,0),1);assert.equal(get(count),length);close(file);
  return module.HEAPU8.slice(base+out,base+out+length);
}
function metadata(path) {
  const search=invoke('FindFirstFileA',text(path),out);assert.notEqual(search,0xffffffff);
  const fields=[get(out),view.getBigUint64(out+20,true)];assert.equal(invoke('FindClose',search),1);return fields;
}
try {
  assert.equal(invoke('CreateDirectoryA',text('CopyChecks'),0),1);
  assert.equal(invoke('SetCurrentDirectoryA',text('CopyChecks')),1);
  const original=Uint8Array.from({length:196731},(_,i)=>(i*37+(i>>>8))&255);
  await writeFile(new URL('../build/copy-fixture.bin',import.meta.url),original);
  runtime.mount('C:\\nfs5\\CopyChecks\\Source.bin',{url:new URL('../build/copy-fixture.bin',import.meta.url).href,size:original.length,modified:1700000000});
  assert.equal(copy('source.bin','copy.bin',1),1);assert.deepEqual(bytes('COPY.BIN',original.length),original);
  assert.deepEqual(metadata('copy.bin'),metadata('Source.bin'),'Attributes and modification time survive copying');
  assert.equal(copy('source.bin','copy.bin',1),0);error(80);
  assert.equal(copy('source.bin','SOURCE.BIN'),0);error(32);
  assert.equal(copy('source.bin','SOURCE.BIN',1),0);error(80);
  assert.deepEqual(bytes('source.bin',original.length),original,'Self-copy failures preserve source bytes');
  assert.equal(copy('missing.bin','new.bin'),0);error(2);
  assert.equal(copy('source.bin','missing\\new.bin'),0);error(3);
  assert.equal(copy('..','new.bin'),0);error(5);
  assert.equal(copy('source.bin','..'),0);error(5);
  assert.equal(copy('source.bin','D:\\copy.bin'),0);error(19);
  assert.equal(invoke('CopyFileA',0,text('new.bin'),0),0);error(87);
  assert.equal(invoke('CopyFileA',text('source.bin'),0,0),0);error(87);
  for(const attributes of [1,2]) {
    assert.equal(invoke('SetFileAttributesA',text('copy.bin'),attributes),1);
    assert.equal(copy('source.bin','copy.bin'),0);error(5);
  }
  assert.equal(invoke('SetFileAttributesA',text('copy.bin'),32),1);
  const deniedSource=open('source.bin',0x80000000,0);
  assert.equal(copy('source.bin','new.bin'),0);error(32);close(deniedSource);
  const deniedDestination=open('copy.bin',0x80000000,1);
  assert.equal(copy('source.bin','copy.bin'),0);error(32);close(deniedDestination);
  const reader=open('copy.bin',0x80000000,3);
  assert.equal(invoke('SetFilePointer',reader,123,0,0),123);
  assert.equal(copy('source.bin','copy.bin'),1,'A compatible open reader does not prevent overwrite');
  assert.equal(invoke('SetFilePointer',reader,0,0,1),123,'Copying does not move an existing handle');close(reader);
  const writable=open('source.bin',0xc0000000),mapping=invoke('CreateFileMappingA',writable,0,4,0,0,0);
  assert(mapping);const mapped=invoke('MapViewOfFile',mapping,2,0,0,0);assert(mapped);
  module.HEAPU8.set([0,255,128,42],module._web_pointer(mapped+65535,4));
  const expected=original.slice();expected.set([0,255,128,42],65535);
  assert.equal(copy('source.bin','mapped-copy.bin'),1);assert.deepEqual(bytes('mapped-copy.bin',expected.length),expected,'Live mapped source writes are copied');
  assert.equal(copy('copy.bin','source.bin'),0);error(1224);
  assert.equal(invoke('UnmapViewOfFile',mapped),1);close(mapping);close(writable);
  assert.equal(invoke('SetFileAttributesA',text('source.bin'),3),1);
  assert.equal(copy('source.bin','attributes.bin'),1);assert.deepEqual(metadata('attributes.bin'),metadata('source.bin'));
  const empty=open('empty.bin',0x40000000,3,2);close(empty);
  assert.equal(copy('empty.bin','copy.bin'),1);assert.deepEqual(bytes('copy.bin',0),new Uint8Array());
  runtime.mount('C:\\nfs5\\CopyChecks\\TooLarge.bin',{size:64*1024*1024+1});
  assert.equal(copy('TooLarge.bin','mapped-copy.bin'),0);error(112);assert.deepEqual(bytes('mapped-copy.bin',expected.length),expected);
  runtime.mount('C:\\nfs5\\CopyChecks\\Broken.bin',{size:10});
  assert.equal(copy('Broken.bin','mapped-copy.bin'),0);error(30);assert.deepEqual(bytes('mapped-copy.bin',expected.length),expected);
  console.log(`${calls} file-copy calls passed (staged bytes, overwrite, attributes/time, sharing, mapped sources, disk/read failures)`);
} finally {runtime.dispose();}
