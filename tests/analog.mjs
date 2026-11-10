import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');await mkdir(process.env.TMPDIR,{recursive:true});
const browser=await chromium.launchPersistentContext(resolve('.cache/chrome-analog-test'),{executablePath:'/usr/bin/google-chrome',headless:false,hasTouch:true,viewport:{width:1280,height:960},args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes')]});
let page;
try {
 page=await browser.newPage();await page.goto(process.env.NFS5_TEST_URL??'http://127.0.0.1:8000');
 await page.evaluate(async()=>{
  document.body.innerHTML='<canvas id="game" width="640" height="480"></canvas>';document.querySelector('#viewport-style').media='all';
  const css=document.createElement('link');css.rel='stylesheet';css.href='./play.css';document.head.append(css);
  const {loadRuntime}=await import('./runtime.mjs'),{attachInput}=await import('./input.mjs'),{attachControls}=await import('./controls.mjs');
  const canvas=document.querySelector('#game'),runtime=await loadRuntime({canvas,intro:false,persist:false,display:{width:1280,height:960},onResize:(w,h)=>canvas.style.setProperty('--game-aspect',w/h)});
  const args='debugmode=0 fe=0 track_name=farmland linear_track=1 numcars=1 numplayerracecars=1 numopponentracecars=0 car[0].class=human width=1280 height=960 depth=32 texturedetail=4 cardetail=4';
  runtime.module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\nfs5.exe '+args+'\0'),runtime.base+0xb000);
  const input=attachInput(window,event=>runtime.input(event),{viewport:canvas,keepRunningOnBlur:true}),controls=attachControls(input);controls.setScreen({width:1280,height:960});
  const a=window.analogCheck={runtime,input,controls};a.run=runtime.runAsync(0).then(result=>a.result=result);
 });
 await page.waitForFunction(()=>analogCheck.runtime.graphics.renderer.stats.draws>4000||analogCheck.result,null,{timeout:60000});
 await page.waitForTimeout(6500);const rows=[];
 async function sample(steer,pedal,active=true){
  await page.evaluate(({steer,pedal,active})=>analogCheck.input.analog(steer,pedal,active),{steer,pedal,active});await page.waitForTimeout(180);
  return page.evaluate(()=>{const r=analogCheck.runtime,m=r.module,p=m._web_analog_state(),data=Array.from(new Uint32Array(m.HEAPU8.buffer,p,8)),v=new DataView(m.HEAPU8.buffer,r.base+0x5e99dc);return {data,steer:v.getInt8(1),gas:v.getUint8(2),brake:v.getUint8(3)};});
 }
 for(const steer of [-1,-.5,-.25,-.125,0,.125,.25,.5,1]){
  const row=await sample(steer,.5);assert.equal(row.steer,Math.sign(steer)*Math.trunc(Math.round(Math.abs(steer)*255)/4));assert.equal(row.gas,64);rows.push({axis:steer,...row});
 }
 const brake=await sample(0,-.5);assert.equal(brake.gas,0);assert.equal(brake.brake,64);
 // The virtual channel and existing physical controls combine in INPUT_poll.
 await sample(.5,0);await page.keyboard.down('ArrowLeft');await page.waitForTimeout(180);
 const mixed=await page.evaluate(()=>new DataView(analogCheck.runtime.module.HEAPU8.buffer,analogCheck.runtime.base+0x5e99dc).getInt8(1));assert.equal(mixed,-31);await page.keyboard.up('ArrowLeft');
 const released=await sample(0,0,false);assert.equal(released.steer,0);assert.equal(released.gas,0);
 await page.keyboard.down('ArrowRight');await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>new DataView(analogCheck.runtime.module.HEAPU8.buffer,analogCheck.runtime.base+0x5e99dc).getInt8(1)),63);await page.keyboard.up('ArrowRight');
 // Exercise a real browser touch drag through the public joystick -> input ->
 // original callback -> original signed steering byte, not only API calls.
 const session=await browser.newCDPSession(page),box=await page.locator('#joystick').boundingBox(),x=box.x+box.width*.7,y=box.y+box.height*.5;
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:3}]});await page.waitForTimeout(180);
 const touch=await page.evaluate(()=>new DataView(analogCheck.runtime.module.HEAPU8.buffer,analogCheck.runtime.base+0x5e99dc).getInt8(1));assert(touch>15&&touch<30,'Partial touch displacement produces partial native steering');
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(180);
 assert.equal(await page.evaluate(()=>new DataView(analogCheck.runtime.module.HEAPU8.buffer,analogCheck.runtime.base+0x5e99dc).getInt8(1)),0);
 assert(!await page.evaluate(()=>Boolean(analogCheck.result)),'The original race remains running');
 await writeFile('build/native-analog.json',JSON.stringify({rows,brake,mixed,released,touch},null,2)+'\n');
 console.log('Original INPUT_poll: proportional steering/pedals, physical-key mixing, touch drag and neutral release passed');
} finally {
 if(page)await page.evaluate(async()=>{const a=window.analogCheck;if(a){a.runtime.stop();await a.run;a.controls.close();a.input();a.runtime.dispose();}}).catch(()=>{});
 await browser.close();
}
