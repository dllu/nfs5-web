import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR,{recursive:true});
const context=await chromium.launchPersistentContext(resolve('.cache/chrome-usability-test'),{
 executablePath:'/usr/bin/google-chrome',headless:false,viewport:{width:1280,height:900},hasTouch:true,isMobile:true,
 args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes')],
});
try {
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const session=await context.newCDPSession(page);await session.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await page.goto(process.env.NFS5_TEST_URL??'http://127.0.0.1:8000');
 await page.evaluate(async()=>{
  localStorage.removeItem('nfs5-touch-layout');
  document.body.innerHTML='<canvas id="game" width="640" height="480" tabindex="0"></canvas>';
  document.querySelector('#viewport-style').media='all';
  const style=document.createElement('link');style.rel='stylesheet';style.href='./play.css';document.head.append(style);
  const {attachInput}=await import('./input.mjs'),{attachControls}=await import('./controls.mjs');
  const canvas=document.querySelector('canvas');window.inputs=[];
  window.input=attachInput(window,e=>window.inputs.push({...e,time:performance.now()}),{viewport:canvas,keepRunningOnBlur:true});
  window.controls=attachControls(window.input);window.controls.setScreen({width:1280,height:720});
 });
 const action=async name=>{
  await page.getByRole('button',{name:'Game menu'}).click();
  await page.getByRole('button',{name,exact:true}).click();
 };
 assert(await page.locator('#game-actions').isHidden(),'Only the menu button is visible initially');
 await page.getByRole('button',{name:'Game menu'}).click();
 await page.keyboard.press('Escape');
 assert(await page.locator('#game-actions').isHidden());
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>e.key===1).length),0,'Escape closes the web menu before reaching the game');
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
 if(await page.locator('#touch-pad').isHidden())await action('Controls');
 assert.equal(await page.getByRole('button',{name:'Gas',exact:true}).evaluate(e=>getComputedStyle(e).userSelect),'none');
 const gas=await page.getByRole('button',{name:'Gas',exact:true}).boundingBox();
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:gas.x+gas.width/2,y:gas.y+gas.height/2,id:4}]});
 await page.waitForTimeout(1000);
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>e.key===200).at(-1).down),true,'Holding Gas stays pressed');
 assert.equal(await page.evaluate(()=>String(getSelection())), '','Holding Gas must not select its label');
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>e.key===200).at(-1).down),false);
 const stick=await page.locator('#joystick').boundingBox();
 await page.locator('#joystick').screenshot({path:'build/touch-stick.png'});
 await page.evaluate(()=>{window.pointerLog=[];for(const type of ['pointerdown','pointerup','pointercancel'])window.addEventListener(type,e=>window.pointerLog.push({type,target:e.target.id,x:e.clientX,y:e.clientY}),true);});
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:stick.x+stick.width*.2,y:stick.y+stick.height*.2,id:2}]});
 await page.waitForTimeout(100);
 const stickDown=await page.evaluate(()=>window.inputs.filter(e=>e.analog).at(-1));
 assert(stickDown.steer<-.5&&stickDown.steer>-.8&&stickDown.pedal>.5&&stickDown.pedal<.8,'Joystick sends proportional native axes');
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>e.key===203||e.key===205).length),0,'Steering does not generate arrow keys');
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await action('Layout: Joystick');
 assert.equal(await page.locator('#joystick').isVisible(),false);
 assert.equal(await page.locator('#steering-buttons').isVisible(),true);
 const boxes=async()=>{
  const out={};for(const name of ['Steer left','Steer right','Gas','Brake','Handbrake','Camera'])out[name]=await page.getByRole('button',{name,exact:true}).boundingBox();return out;
 };
 for(const size of [{width:430,height:932},{width:320,height:568},{width:932,height:430}]){
  await page.setViewportSize(size);const b=await boxes(),left=b['Steer left'],right=b['Steer right'];
  const game=await page.locator('#game').boundingBox();
  assert(Math.abs(game.width/game.height-4/3)<.001,'Mobile game has a 4:3 picture');
  assert(left.x+left.width<=right.x&&left.y===right.y,'Left and right sit side by side');
  assert(b.Gas.x===b.Brake.x&&b.Gas.y+b.Gas.height<=b.Brake.y,'Gas sits above brake');
  assert(left.x+left.width/2<b.Handbrake.x+b.Handbrake.width/2&&b.Handbrake.x+b.Handbrake.width/2<b.Gas.x+b.Gas.width/2,'Handbrake sits between the hands');
  for(const [name,box]of Object.entries(b)){
   assert(box.x>=0&&box.y>=0&&box.x+box.width<=size.width&&box.y+box.height<=size.height,name+' remains within the viewport');
   assert(box.x+box.width<=game.x+.02||game.x+game.width<=box.x+.02||box.y>=game.y+game.height-.02,name+' sits outside the game picture');
   for(const [other,c]of Object.entries(b))if(name!==other)assert(box.x+box.width<=c.x||c.x+c.width<=box.x||box.y+box.height<=c.y||c.y+c.height<=box.y,name+' does not overlap '+other);
  }
  const tools=await page.locator('#game-tools').boundingBox();assert(tools.x>=0&&tools.x+tools.width<=size.width,'The toolbar fits narrow screens');
  await page.screenshot({path:`build/touch-buttons-${size.width}x${size.height}.png`});
 }
 await page.setViewportSize({width:430,height:932});
 const b=await boxes(),point=(box,id)=>({x:box.x+box.width/2,y:box.y+box.height/2,id});
 const leftPoint=point(b['Steer left'],11),gasPoint=point(b.Gas,12);
 const gap=await page.evaluate(()=>({x:innerWidth/2,y:innerHeight-4}));
 assert.deepEqual(await page.evaluate(({x,y})=>{
  const target=document.elementFromPoint(x,y);
  return [target.tagName,getComputedStyle(target).touchAction];
 },gap),['BODY','none'],'A missed tap lands on a background that suppresses zoom');
 const scale=await page.evaluate(()=>visualViewport.scale);
 for(const {x,y} of [gap,gasPoint]){
  await page.touchscreen.tap(x,y);
  await page.touchscreen.tap(x,y);
 }
 assert.equal(await page.evaluate(()=>visualViewport.scale),scale,'Rapid taps on and around the controls keep the viewport scale');
 assert.deepEqual(await page.evaluate(()=>window.inputs.filter(e=>e.key===200).slice(-4).map(e=>e.down)),[true,false,true,false]);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[leftPoint,gasPoint]});
 await page.waitForTimeout(1000);
 assert.deepEqual(await page.evaluate(()=>[203,200].map(key=>window.inputs.filter(e=>e.key===key).at(-1)?.down)),[true,true],'Steering and gas can be held with separate fingers');
 assert.equal(await page.evaluate(()=>String(getSelection())),'');
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[leftPoint]});
 assert.deepEqual(await page.evaluate(()=>[203,200].map(key=>window.inputs.filter(e=>e.key===key).at(-1)?.down)),[false,true],'Releasing steering keeps gas held');
 const handbrakePoint=point(b.Handbrake,14);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[gasPoint,handbrakePoint]});
 assert.deepEqual(await page.evaluate(()=>[57,200].map(key=>window.inputs.filter(e=>e.key===key).at(-1)?.down)),[true,true],'The centered handbrake works while gas remains held');
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[handbrakePoint]});
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>e.key===57).at(-1).down),false);
 await page.keyboard.down('ArrowUp');
 await action('Layout: Buttons');
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>e.key===200).at(-1).down),true,'Changing layouts preserves a physical key held on the keyboard');
 await page.keyboard.up('ArrowUp');
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>e.key===200).at(-1).down),false,'Changing layouts releases the virtual pedal');
 await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await action('Layout: Joystick');
 const rightPoint=point((await boxes())['Steer right'],13);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rightPoint]});
 await action('Controls');
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>e.key===205).at(-1).down),false,'Hiding the pad releases steering');
 await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await page.evaluate(async()=>{window.controls.close();const {attachControls}=await import('./controls.mjs');window.controls=attachControls(window.input);window.controls.setScreen({width:1280,height:720});});
 assert.equal(await page.locator('#touch-pad').getAttribute('data-layout'),'buttons','Layout preference survives rebuilding the controls');
 assert.equal(await page.evaluate(()=>localStorage.getItem('nfs5-touch-layout')),'buttons');
 if(await page.locator('#touch-pad').isHidden())await action('Controls');
 await action('Layout: Buttons');
 await page.keyboard.down('ArrowUp');
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 events=await page.evaluate(()=>window.inputs);
 assert.equal(events.filter(e=>e.key===200).at(-1).down,false);
 assert(!events.some(e=>e.focus===false),'Losing browser focus releases controls without pausing the guest');
 await page.keyboard.up('ArrowUp');
 await action('Info');
 await page.getByLabel('View distance').focus();
 const steering=await page.evaluate(()=>window.inputs.filter(e=>[200,203,205,208].includes(e.key)&&e.down).length);
 await page.keyboard.press('ArrowDown');
 assert.equal(await page.evaluate(()=>window.inputs.filter(e=>[200,203,205,208].includes(e.key)&&e.down).length),steering,'Using the detail selector must not drive the car');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await action('Keyboard');
 const field=page.getByRole('textbox',{name:'Game text'});
 assert.equal(await field.getAttribute('placeholder'),null);
 await field.fill('Ab9');await page.waitForTimeout(500);
 const text=await page.evaluate(()=>window.inputs.filter(e=>e.down&&[30,48,10].includes(e.key)).map(e=>e.key));assert.deepEqual(text,[30,48,10]);
 await field.fill('25000');await field.press('Enter');await page.waitForTimeout(900);
 const price=await page.evaluate(()=>window.inputs.filter(e=>e.down&&[3,6,11,28].includes(e.key)).map(e=>e.key));
 assert.deepEqual(price,[3,6,11,11,11,28],'The keyboard also enters and submits a price');
 await action('Pause');await page.waitForTimeout(180);
 assert.deepEqual(await page.evaluate(()=>window.inputs.filter(e=>e.key===1).slice(-2).map(e=>e.down)),[true,false]);
 if(await page.evaluate(()=>document.fullscreenEnabled)){
  await page.getByRole('button',{name:'Game menu'}).tap();
  await page.getByRole('button',{name:'Fullscreen',exact:true}).tap();
  await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);
  await page.getByRole('button',{name:'Game menu'}).tap();
  await page.getByRole('button',{name:'Exit fullscreen',exact:true}).tap();
  await page.waitForFunction(()=>!document.fullscreenElement);
 }
 await page.evaluate(async()=>{
  Object.defineProperty(document,'fullscreenEnabled',{value:false});
  Object.defineProperty(navigator,'standalone',{value:false});
  window.controls.close();
  const {attachControls}=await import('./controls.mjs');
  window.controls=attachControls(window.input);
 });
 await action('Fullscreen');
 assert(await page.getByText(/Add to Home Screen/).isVisible(),'iPhone browser mode gets Home Screen instructions');
 await page.evaluate(()=>{window.controls.close();window.input();});
 assert.deepEqual(errors,[]);
 await writeFile('build/usability-input.json',JSON.stringify({events:events.length,touch,errors},null,2)+'\n');
 console.log('Touch input, zoom suppression, mobile fullscreen, layout persistence, text and price entry, Escape, Pause and focus release passed');
} finally {await context.close();}
