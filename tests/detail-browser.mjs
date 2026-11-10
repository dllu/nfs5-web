// Compare stationary views in one live race, then drive with extended detail.
import assert from 'node:assert/strict';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR,{recursive:true});await copyFile('tests/race-worker.mjs','dist/race-check-worker.mjs');
const browser=await chromium.launchPersistentContext(resolve('.cache/chrome-detail-test'),{
 executablePath:process.env.NFS5_CHROME??'/usr/bin/google-chrome',headless:false,viewport:{width:1280,height:720},
 args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes')],
});
const reports=[],errors=[];
try {
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 for(const track of (process.env.NFS5_DETAIL_TRACKS??'farmland,coastal,castle').split(',')) {
  await page.goto(process.env.NFS5_TEST_URL??'http://127.0.0.1:8000');
  await page.evaluate(({track,width,height,assetsUrl})=>{
   document.body.style.cssText='margin:0;overflow:hidden';
   document.body.innerHTML='<canvas id="game" width="640" height="480" style="width:100vw;height:100vh;display:block"></canvas>';
   const canvas=document.querySelector('canvas'),worker=new Worker('./race-check-worker.mjs',{type:'module'});
   window.detailCheck={worker,events:[]};worker.onmessage=({data})=>detailCheck.events.push(data);
   const offscreen=canvas.transferControlToOffscreen();worker.postMessage({type:'start',detail:'original',canvas:offscreen,display:{width,height},assetsUrl,track,
    opponents:0,car:{filename:'gt1',spec:'GT1race',ai:'Gt1',sound:'GT1race'}},[offscreen]);
  },{track,width:Number(process.env.NFS5_DETAIL_WIDTH??1920),height:Number(process.env.NFS5_DETAIL_HEIGHT??1080),assetsUrl:process.env.NFS5_TEST_ASSETS_URL});
  await page.waitForFunction(()=>{
   const failure=detailCheck.events.find(e=>e.type==='error'||e.type==='result');if(failure)throw new Error(JSON.stringify(failure));
   return detailCheck.events.some(e=>e.type==='ready');
  },null,{timeout:90000});
  await page.waitForTimeout(10000);
  await page.evaluate(()=>detailCheck.worker.postMessage({type:'input',key:46,down:true}));await page.waitForTimeout(150);
  await page.evaluate(()=>detailCheck.worker.postMessage({type:'input',key:46,down:false}));await page.waitForTimeout(1000);
  let id=0;
  const sample=async()=>{
   const key=++id;await page.evaluate(id=>detailCheck.worker.postMessage({type:'sample',id}),key);
   await page.waitForFunction(id=>detailCheck.events.some(e=>e.id===id),key);
   return page.evaluate(id=>detailCheck.events.find(e=>e.id===id),key);
  };
  const views=[];
  for(const setting of ['original','far','very-far','original']) {
   await page.evaluate(value=>detailCheck.worker.postMessage({type:'detail',value}),setting);
   await page.waitForTimeout(1500);
   await page.evaluate(()=>detailCheck.worker.postMessage({type:'resetTiming'}));
   const before=await sample();await page.waitForTimeout(4500);const after=await sample();
   assert(after.frames>before.frames+30);assert(after.detail.views>before.detail.views);
   assert(after.detail.models>before.detail.models,'The original scenery renderer exercises the LOD override');
   const scale=setting==='far'?2:setting==='very-far'?4:1;
   assert.equal(after.detail.multiplier,scale);assert.equal(after.detail.range,after.detail.originalRange*scale);
   assert(after.stats.peakPendingFrames<=2);
   const frames=after.frames-before.frames;
   const row={setting,detail:after.detail,memory:after.memory,frames,timing:after.timing,
    drawsPerFrame:(after.stats.draws-before.stats.draws)/frames,verticesPerFrame:(after.stats.vertices-before.stats.vertices)/frames};
   views.push(row);console.log(track,JSON.stringify(row));
   await page.locator('canvas').screenshot({path:`build/detail-${track}-${views.length}-${setting}.png`});
  }
  // Returning to Original must recompute the native distance without compounding.
  assert.equal(views[0].detail.originalRange,views[3].detail.range);
  const originalVertices=Math.max(views[0].verticesPerFrame,views[3].verticesPerFrame);
  for(const view of views.slice(1,3))assert(view.verticesPerFrame>originalVertices*1.05,'Extended views must actually render more scenery at the same position');
  await page.evaluate(()=>{detailCheck.worker.postMessage({type:'detail',value:'very-far'});detailCheck.worker.postMessage({type:'input',key:200,down:true});});
  const before=await sample();await page.waitForTimeout(10000);
  await page.evaluate(()=>detailCheck.worker.postMessage({type:'input',key:200,down:false}));
  const driven=await sample();assert(driven.frames>before.frames+60);assert(driven.detail.cars>0,'Native car LOD is exercised during the camera flyby');
  await page.locator('canvas').screenshot({path:`build/detail-${track}-driven.png`});
  await page.evaluate(()=>detailCheck.worker.postMessage({type:'stop'}));
  await page.waitForFunction(()=>detailCheck.events.some(e=>e.type==='stopped'),null,{timeout:20000});
  assert.deepEqual(await page.evaluate(()=>detailCheck.events.filter(e=>e.type==='error')),[]);
  await page.evaluate(()=>detailCheck.worker.terminate());
  reports.push({track,views,driven});await writeFile('build/detail-browser.json',JSON.stringify({reports,errors},null,2)+'\n');
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
