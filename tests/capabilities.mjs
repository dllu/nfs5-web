import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const oracle=spawnSync(new URL('../.venv/bin/python',import.meta.url).pathname,
  [new URL('./capabilities_oracle.py',import.meta.url).pathname],{encoding:'utf8'});
assert.equal(oracle.status,0,oracle.stderr);const native=JSON.parse(oracle.stdout);
const r=await loadRuntime({persist:false,read:async p=>new Response(await readFile(new URL('../dist/'+p,import.meta.url)))});
const {module:m,base,manifest}=r,view=new DataView(m.HEAPU8.buffer,base),data=0x800000;
const text=s=>{m.HEAPU8.set(Buffer.from(s+'\0'),base+data);return data;};
async function call(entry,args=[]){const result=await r.invokeAsync(entry,args);assert.equal(result.status,0,result.error);return result.registers[0];}
const invoke=(name,...args)=>call(manifest.imports.find(i=>i.name===name).slot,args);
try{
  const library=await invoke('LoadLibraryA',text('drivers\\opengl3z'));
  const about=await invoke('GetProcAddress',library,text('_THRASH_about@0'));
  const descriptor=await call(about),flags=view.getUint32(descriptor+12,true);
  assert.equal(flags,native.words[3],'Native hardware texture/line/window capability flags');
  const report={native,actualFlags:flags,passed:true};
  await writeFile('build/native-capabilities.json',JSON.stringify(report,null,2)+'\n');
  console.log('Native descriptor flags match (hardware, texture constraints, line width and window-mode reporting)');
}finally{r.dispose();}
