import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const r=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module:m,base,manifest}=r,v=new DataView(m.HEAPU8.buffer,base),data=0x800000,stack=r.memorySize-0x10000;
const text=(s,p=data)=>{m.HEAPU8.set(Buffer.from(s+'\0'),base+p);return p;};
const get=p=>v.getUint32(p,true);
const hash=b=>createHash('sha256').update(b).digest('hex');
const invoke=async(name,...args)=>{
  const x=await r.invokeAsync(manifest.imports.find(i=>i.name===name).slot,args);
  assert.equal(x.status,0,x.error);assert.equal(x.registers[4],stack+args.length*4);return x.registers[0];
};
// RGB565 image hashes from the supplied gimme.dll ConvertFile, invoked in
// Wine/FEX by portrait_native.c for each frame of the original ALLdrivr.fsh.
// These are independent of the port's palette expansion and FSH writer.
const nativePixels=[
  '0831bf26b5a9d757fad4f0b4d369966ba9f043bf34eb6abc0879de94e22a3287',
  '6160257437e0d60b26fe8bb27d672af3d51c28df423e87147e40a040933bddc6',
  '833da1548fc57b2376116e8cdb92c078ed9d813ae52ef4047934d6e9e830563c',
  '0acd67bd01950b39a584eae0c0191a0fc0ab65476a8590f1b470a58563a8c42e',
  '47a642ceca6a2d3458d82c57395534593664c67ba647747566889fdd492b666b',
  'c7a1c8c9806b2e7a881116fe9e07618121aa47cda0bdf79882780938c5820617',
  'b50e4d240788c1cd387238642a558e45e3dcef3d3373256df11de60ff9b841a2',
  '2aed90865c149a6cccbf2c8107d1fba662f03ba0706be53256cdf0464259fb75',
  'f93e830a422a5c5c69915cbe2d5c0ab1af7e5396c05ed21a26dd6a176792ca58',
];
let convert,source,destination;
async function conversion(frame,src=source,dst=destination){
  for(const i of [3,5,6,7])m._web_set_register(i,0x11223300+i);
  const x=await r.invokeAsync(convert,[src,dst,frame]);assert.equal(x.status,0,x.error);
  assert.equal(x.registers[4],stack,'ConvertFile leaves cdecl arguments for the caller');
  for(const i of [3,5,6,7])assert.equal(x.registers[i],0x11223300+i,'Callee-saved register '+i);
  return x.registers[0];
}
async function output(){
  const handle=await invoke('CreateFileA',destination,0x80000000,3,0,3,128,0);assert.notEqual(handle,0xffffffff);
  const size=await invoke('GetFileSize',handle,0);assert.equal(size,6960);
  assert.equal(await invoke('ReadFile',handle,data+8192,size,data+4096,0),1);assert.equal(get(data+4096),size);
  await invoke('CloseHandle',handle);return Buffer.from(m.HEAPU8.slice(base+data+8192,base+data+8192+size));
}
try{
  const library=await invoke('LoadLibraryA',text('GIMME.DLL'));
  assert(library);assert.equal(await invoke('GetModuleHandleA',text('gimme')),library);
  assert.equal(await invoke('LoadLibraryA',text('C:\\nfs5\\gimme.dll')),library);
  assert.equal(await invoke('DisableThreadLibraryCalls',library),1);
  convert=await invoke('GetProcAddress',library,text('ConvertFile'));
  assert(convert);assert.equal(await invoke('GetProcAddress',library,1),convert);
  assert.equal(await invoke('GetProcAddress',library,text('Missing')),0);
  assert.equal(await invoke('GetLastError'),127);
  assert.equal(await invoke('CreateDirectoryA',text('PortraitChecks'),0),1);
  source=text('C:\\nfs5\\FEData\\Art\\ALLdrivr.fsh',data+512);
  destination=text('C:\\nfs5\\PortraitChecks\\portrait.fsh',data+1024);
  const results=[];
  for(let frame=0;frame<9;frame++){
    assert.equal(await conversion(frame),1);
    const bytes=await output();assert.equal(bytes.subarray(0,4).toString(),'SHPI');
    assert.equal(bytes.readUInt32LE(4),bytes.length);assert.equal(bytes.readUInt32LE(8),1);
    const at=bytes.readUInt32LE(20);assert.equal(at,32);assert.equal(bytes[at],0x78);
    assert.equal(bytes.readUInt16LE(at+4),54);assert.equal(bytes.readUInt16LE(at+6),64);
    const pixels=hash(bytes.subarray(at+16));assert.equal(pixels,nativePixels[frame],'Native portrait pixels '+frame);
    results.push({frame,pixels});
  }
  // An already-converted image can be read before replacing the same file.
  assert.equal(await conversion(0,destination,destination),1);
  const preserved=await output();assert.equal(hash(preserved.subarray(48)),nativePixels[8]);
  assert.equal(await conversion(9),0);assert.deepEqual(await output(),preserved);
  assert.equal(await conversion(0,0),0);assert.equal(await invoke('GetLastError'),87);
  assert.equal(await conversion(0,text('missing.fsh',data+2048)),0);assert.equal(await invoke('GetLastError'),2);
  assert.equal(await invoke('SetFileAttributesA',destination,1),1);
  assert.equal(await conversion(0),0);assert.equal(await invoke('GetLastError'),5);
  assert.equal(await invoke('SetFileAttributesA',destination,32),1);assert.deepEqual(await output(),preserved);
  const held=await invoke('CreateFileA',destination,0x80000000,1,0,3,128,0);
  assert.notEqual(held,0xffffffff);assert.equal(await conversion(0),0);assert.equal(await invoke('GetLastError'),32);
  await invoke('CloseHandle',held);
  const assets=JSON.parse(await readFile(new URL('../dist/assets.json',import.meta.url),'utf8'));
  const atlas=await readFile(new URL('../dist/'+assets.entries.find(a=>a.path.toLowerCase().endsWith('/alldrivr.fsh')).url,import.meta.url));
  for(const broken of [atlas.subarray(0,23),Buffer.from(atlas)]){
    if(broken.length>23)broken.writeUInt32LE(0xffffffff,20);
    const path=text('C:\\nfs5\\PortraitChecks\\broken.fsh',data+2048),id=r.mount('C:\\nfs5\\PortraitChecks\\broken.fsh');
    const ptr=m._malloc(broken.length);m.HEAPU8.set(broken,ptr);assert.equal(m._web_fs_store(id,ptr,broken.length),1);m._free(ptr);
    assert.equal(await conversion(0,path),0);assert.deepEqual(await output(),preserved);
  }
  assert.equal(await invoke('FreeLibrary',library),1);
  await writeFile('build/portrait-native-comparison.json',JSON.stringify({results,passed:true},null,2)+'\n');
  console.log('9 native portrait pixel comparisons passed (FSH atlas, cdecl ABI, in-place conversion, sharing, malformed input and failed-write preservation)');
}finally{r.dispose();}
