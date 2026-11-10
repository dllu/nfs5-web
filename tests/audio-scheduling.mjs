import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {loadRuntime} from '../dist/runtime.mjs';
globalThis.crypto??=webcrypto;
const r=await loadRuntime({persist:false,read:async path=>new Response(await readFile(new URL('../dist/'+path,import.meta.url)))}),m=r.module;
try{
  assert.equal(m._web_audio_start(0),0);
  const offset=m._web_audio_start(48000),state=new Int32Array(m.HEAPU8.buffer,offset,8);
  assert(offset);assert.equal(Atomics.load(state,1)-Atomics.load(state,0),1024);
  Atomics.store(state,0,Atomics.load(state,1));m._web_input_key(30,1);
  assert.equal(Atomics.load(state,1)-Atomics.load(state,0),1024,'A VM owner refills before releasing the lock');
  const v=new DataView(m.HEAPU8.buffer,r.base),root=0x800400,node=0x800440,sentinel=0x800420;
  for(const [at,value]of [[0x69cae4,root],[root,sentinel],[sentinel,node],[node,node],[node+8,0]])v.setUint32(at,value,true);
  const run=r.invokeAsync(0x5292d0,[1],250);await new Promise(resolve=>setTimeout(resolve,25));
  Atomics.store(state,0,Atomics.load(state,1));
  const began=performance.now();let busy=0;
  for(let i=0;i<100;i++)busy+=m._web_audio_tick()===0;
  const elapsed=performance.now()-began;
  assert(busy>0,'The original compute loop must occupy the VM');assert(elapsed<100,'Audio ticks must not wait for a busy VM');
  assert(Atomics.load(state,6)>0);
  const result=await run;assert.match(result.error,/budget reached/i);
  m._web_audio_stop();assert.equal(Atomics.load(state,5),0);assert.equal(m._web_audio_tick(),1);
  console.log(`Native audio refill and 100 nonblocking ticks passed (${elapsed.toFixed(2)} ms with the original VM compute loop busy)`);
}finally{m._web_audio_stop();r.dispose();}
