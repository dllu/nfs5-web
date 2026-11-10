// Exercise original race loading at native resolutions, including shared-memory
// growth in a game pthread before a full framebuffer readback.
import assert from 'node:assert/strict';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');await mkdir(process.env.TMPDIR,{recursive:true});
await copyFile('tests/race-worker.mjs','dist/race-check-worker.mjs');
const browser=await chromium.launchPersistentContext(resolve('.cache/chrome-race-loading-test'),{
 executablePath:'/usr/bin/google-chrome',headless:false,viewport:{width:1280,height:960},
 args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes')],
});
const reports=[],errors=[];let page;
try {
 page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 for(const [width,height]of [[1280,960],[3840,2160],[6144,3456]]) {
  await page.goto(process.env.NFS5_TEST_URL??'http://127.0.0.1:8000');
  await page.evaluate(({width,height,assetsUrl,detail})=>{
   document.body.innerHTML='<canvas id="game" width="640" height="480"></canvas>';document.querySelector('#viewport-style').media='all';
   const canvas=document.querySelector('#game'),worker=new Worker('./race-check-worker.mjs',{type:'module'});
   window.raceCheck={worker,events:[]};worker.onmessage=({data})=>{raceCheck.events.push(data);if(data.type==='screen')canvas.style.setProperty('--game-aspect',data.width/data.height);};
   const offscreen=canvas.transferControlToOffscreen();worker.postMessage({type:'start',canvas:offscreen,display:{width,height},assetsUrl,detail,track:'castle',opponents:4,
    car:{filename:'gt1',spec:'GT1race',ai:'Gt1',sound:'GT1race'}},[offscreen]);
  },{width,height,assetsUrl:process.env.NFS5_TEST_ASSETS_URL,detail:process.env.NFS5_RACE_DETAIL});
  await page.waitForFunction(()=>{
   const failure=raceCheck.events.find(e=>e.type==='error'||e.type==='result');if(failure)throw new Error(JSON.stringify(failure));
   return raceCheck.events.some(e=>e.type==='ready');
  },null,{timeout:90000});
  // Let the original camera flyby/countdown finish before applying throttle.
  await page.waitForTimeout(6000);
  await page.evaluate(()=>raceCheck.worker.postMessage({type:'sample',id:'loaded'}));
  await page.waitForFunction(()=>raceCheck.events.some(e=>e.id==='loaded'));
  const loaded=await page.evaluate(()=>raceCheck.events.find(e=>e.id==='loaded'));
  await page.evaluate(()=>raceCheck.worker.postMessage({type:'input',key:200,down:true}));
  await page.waitForTimeout(3500);
  await page.evaluate(()=>{raceCheck.worker.postMessage({type:'input',key:200,down:false});raceCheck.worker.postMessage({type:'sample',id:'driven'});});
  await page.waitForFunction(()=>raceCheck.events.some(e=>e.id==='driven'));
  const driven=await page.evaluate(()=>raceCheck.events.find(e=>e.id==='driven'));
  assert(driven.frames>loaded.frames+30,'The original race must continue presenting after loading');
  assert(driven.stats.peakPendingFrames<=2);
  assert(driven.detail.cars>loaded.detail.cars&&driven.detail.models>loaded.detail.models,'Car/scenery LOD decisions continue during the race');
  if(process.env.NFS5_RACE_DETAIL==='very-far')assert.equal(driven.detail.multiplier,4);
  if(width===6144)assert(driven.memory>384*1024*1024,'The 6K race must exercise actual pthread heap growth');
  await page.locator('#game').screenshot({path:`build/gt1-auvergne-${width}x${height}.png`});
  await page.evaluate(()=>raceCheck.worker.postMessage({type:'stop'}));
  await page.waitForFunction(()=>raceCheck.events.some(e=>e.type==='stopped'),null,{timeout:20000});
  const result=await page.evaluate(()=>raceCheck.events.find(e=>e.type==='result').result);assert(result.stopped);
  assert.deepEqual(await page.evaluate(()=>raceCheck.events.filter(e=>e.type==='error')),[]);
  await page.evaluate(()=>raceCheck.worker.terminate());reports.push({width,height,loaded,driven,result});
  await writeFile('build/race-loading.json',JSON.stringify({reports,errors},null,2)+'\n');
  console.log(`911 GT1 / Auvergne / four opponents ${width}×${height}: ${driven.frames-loaded.frames} driving frames, ${(driven.memory/1024/1024).toFixed(1)} MiB Wasm`);
 }
 assert.deepEqual(errors,[]);
} catch(error) {
 if(page){await page.screenshot({path:'build/race-loading-failure.png'}).catch(()=>{});await writeFile('build/race-loading-failure.json',JSON.stringify({error:String(error),events:await page.evaluate(()=>window.raceCheck?.events).catch(String)},null,2)+'\n');}
 throw error;
} finally{await browser.close();}
