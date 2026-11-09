import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR,{recursive:true});
const context=await chromium.launchPersistentContext(resolve('.cache/chrome-usability-test'),{
 executablePath:'/usr/bin/google-chrome',headless:false,viewport:{width:1280,height:900},hasTouch:true,
 args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes')],
});
try {
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const session=await context.newCDPSession(page);await session.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await page.goto(process.env.NFS5_TEST_URL??'http://127.0.0.1:8000');
 await page.evaluate(async()=>{
  document.body.innerHTML='<canvas id="game" width="640" height="480" style="width:640px;height:480px;touch-action:none"></canvas>';
  const style=document.createElement('link');style.rel='stylesheet';style.href='./play.css';document.head.append(style);
  const {attachInput}=await import('./input.mjs'),{attachControls}=await import('./controls.mjs');
  const canvas=document.querySelector('canvas');window.inputs=[];
  window.input=attachInput(window,e=>window.inputs.push({...e,time:performance.now()}),{viewport:canvas,keepRunningOnBlur:true});
  window.controls=attachControls(window.input);window.controls.setScreen({width:1280,height:720});
 });
 await page.keyboard.press('Escape');
 let events=await page.evaluate(()=>window.inputs.filter(e=>e.key===1));
 assert.equal(events[0].down,true);assert.equal(events.length,1,'A quick Escape remains pressed until the guest can poll it');
 await page.waitForTimeout(180);
 events=await page.evaluate(()=>window.inputs.filter(e=>e.key===1));
 assert.equal(events.at(-1).down,false);assert(events.at(-1).time-events[0].time>=140);
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Unidentified',cancelable:true})));
 await page.waitForTimeout(170);
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Unidentified',cancelable:true})));
 assert.equal((await page.evaluate(()=>window.inputs.filter(e=>e.key===1).slice(-2))).map(e=>e.down).join(),'true,false');
 await page.touchscreen.tap(200,200);await page.waitForTimeout(150);
 const touch=await page.evaluate(()=>window.inputs.filter(e=>'buttons'in e&&e.x===200&&e.y===200));
 assert(touch.some(e=>e.buttons===1)&&touch.at(-1).buttons===0,'A tap becomes a complete mouse click');
 if(await page.locator('#touch-pad').isHidden())await page.getByRole('button',{name:'Controls',exact:true}).click();
 const stick=await page.locator('#joystick').boundingBox();
 await page.locator('#joystick').screenshot({path:'build/touch-stick.png'});
 await page.evaluate(()=>{window.pointerLog=[];for(const type of ['pointerdown','pointerup','pointercancel'])window.addEventListener(type,e=>window.pointerLog.push({type,target:e.target.id,x:e.clientX,y:e.clientY}),true);});
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:stick.x+stick.width*.2,y:stick.y+stick.height*.2,id:2}]});
 await page.waitForTimeout(100);
 const stickDown=await page.evaluate(()=>window.inputs.filter(e=>e.down).slice(-2).map(e=>e.key));
 assert.deepEqual(stickDown,[203,200],JSON.stringify({stick,pointers:await page.evaluate(()=>window.pointerLog)}));
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.keyboard.down('ArrowUp');
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 events=await page.evaluate(()=>window.inputs);
 assert.equal(events.filter(e=>e.key===200).at(-1).down,false);
 assert(!events.some(e=>e.focus===false),'Losing browser focus releases controls without pausing the guest');
 await page.keyboard.up('ArrowUp');
 await page.getByRole('button',{name:'Keyboard',exact:true}).click();
 await page.getByRole('textbox',{name:'Type player name'}).fill('Ab9');await page.waitForTimeout(500);
 const text=await page.evaluate(()=>window.inputs.filter(e=>e.down&&[30,48,10].includes(e.key)).map(e=>e.key));assert.deepEqual(text,[30,48,10]);
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForTimeout(180);
 assert.deepEqual(await page.evaluate(()=>window.inputs.filter(e=>e.key===1).slice(-2).map(e=>e.down)),[true,false]);
 await page.evaluate(()=>{window.controls.close();window.input();});
 assert.deepEqual(errors,[]);
 await writeFile('build/usability-input.json',JSON.stringify({events:events.length,touch,errors},null,2)+'\n');
 console.log('Touch click, joystick, mobile name entry, quick/fallback Escape, Pause and focus release passed');
} finally {await context.close();}
