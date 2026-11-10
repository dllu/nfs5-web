// Hold actual worker XHR responses, then ask the host to acquire the VM while
// ReadFile is pending. Also replace a source during I/O to check cache safety.
import assert from 'node:assert/strict';
import {copyFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');await mkdir(process.env.TMPDIR,{recursive:true});
await copyFile('tests/io-worker.mjs','dist/io-check-worker.mjs');
const browser=await chromium.launchPersistentContext(resolve('.cache/chrome-io-concurrency'),{executablePath:process.env.NFS5_CHROME??'/usr/bin/google-chrome',headless:false,viewport:{width:800,height:600},args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad']});
try{
 const page=await browser.newPage();
 await page.goto(process.env.NFS5_TEST_URL??'http://127.0.0.1:8000');
 await page.route('**/slow-io.bin?phase=*',async route=>{
  const phase=Number(new URL(route.request().url()).searchParams.get('phase'));
  const response=new Promise(resolve=>setTimeout(resolve,600)).then(()=>route.fulfill({status:206,headers:{'Content-Range':'bytes 0-262143/262144','Content-Type':'application/octet-stream'},body:Buffer.alloc(262144,37)}));
  await page.evaluate(phase=>io.worker.postMessage({type:'probe',mutate:phase===2,replacement:new URL('./replaced-io.bin',location.href).href}),phase);await response;
 });
 await page.evaluate(()=>{
  window.io={worker:new Worker('./io-check-worker.mjs',{type:'module'}),events:[]};io.worker.onmessage=({data})=>io.events.push(data);
  io.worker.postMessage({type:'start',url:new URL('./slow-io.bin',location.href).href});
 });
 await page.waitForFunction(()=>{const error=io.events.find(e=>e.type==='error');if(error)throw new Error(error.error);return io.events.some(e=>e.type==='done');},null,{timeout:90000});
 const events=await page.evaluate(()=>io.events);
 for(const phase of [1,2]){
  const probe=events.find(e=>e.type==='probe'&&e.phase===phase);assert(probe.reading);assert(probe.ms<200,`I/O must release the VM; host waited ${probe.ms} ms`);
 }
 const first=events.find(e=>e.type==='read'&&e.phase===1),second=events.find(e=>e.type==='read'&&e.phase===2);
 assert.equal(first.result,1);assert.deepEqual(first.bytes,Array(32).fill(37));
 assert.equal(second.result,0);assert.deepEqual(second.bytes,Array(32).fill(211),'Replacing a source during I/O must not publish stale downloaded bytes');
 assert(first.events.recent.some(e=>e.ms>=500),'Diagnostics retain the actual delayed read');
 await writeFile('build/io-concurrency.json',JSON.stringify(events,null,2)+'\n');
 console.log('Delayed asset reads release the VM; source replacement rejects stale data and preserves the destination');
}finally{await browser.close();}
