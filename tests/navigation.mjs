import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

// Exercise the running original frontend exclusively through normal DOM input.
// No guest routine is invoked externally while the game is running.
process.env.TMPDIR=resolve('.cache/tmp');
process.env.XDG_CACHE_HOME=resolve('.cache/xdg');
process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR,{recursive:true});
const browser=await chromium.launchPersistentContext(resolve('.cache/chrome-navigation-test'),{
  executablePath:'/usr/bin/google-chrome',headless:false,
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes')],
  viewport:{width:1440,height:1000},
});
let page;
const errors=[],transitions=[];
try {
  page=await browser.newPage();
  const session=await browser.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled',{cacheDisabled:true});
  await session.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(process.env.NFS5_TEST_URL??'http://127.0.0.1:8000');
  await page.evaluate(async()=>{
    document.body.innerHTML='<canvas id="navigation" width="640" height="480" style="position:fixed;inset:0;width:100vw;height:100vh"></canvas>';
    const {loadRuntime}=await import('./runtime.mjs'),{attachInput}=await import('./input.mjs');
    const canvas=document.querySelector('canvas'),runtime=await loadRuntime({canvas,persist:false,intro:false,display:{width:640,height:480}});
    const renderer=runtime.graphics.renderer;
    const detach=attachInput(window,event=>{
      const box=canvas.getBoundingClientRect();
      if('x'in event){event.x=Math.round((event.x-box.left)*renderer.width/box.width);event.y=Math.round((event.y-box.top)*renderer.height/box.height);}
      if('dx'in event){event.dx=Math.round(event.dx*renderer.width/box.width);event.dy=Math.round(event.dy*renderer.height/box.height);}
      runtime.input(event);
    });
    const audit=window.navigationAudit={runtime,detach,frames:0,stencilDraws:0};
    const present=renderer.present,draw=renderer.draw;
    let busy=false,last=0;
    renderer.draw=(...args)=>{audit.stencilDraws+=Number(!!args[2]?.stencil_enable);return draw(...args);};
    renderer.present=()=>{
      present();
      if(busy||renderer.width!==640||renderer.height!==480||performance.now()-last<50)return;
      last=performance.now();busy=true;
      // Schedule the copy at presentation, before the next frame's clear.
      // Arbitrary mid-frame reads can see an empty or partially painted image.
      renderer.readPixels().then(pixels=>{
        const at=(x,y)=>Array.from(pixels.subarray((y*640+x)*4,(y*640+x)*4+4));
        const points={chooser:at(250,353),main:at(290,55),audio:at(130,60),
          graphics:at(420,60),display:at(520,60),settings:at(180,55),center:at(300,150)};
        const warm=([r,g,b])=>r>140&&b<r*.6&&g<r*.95;
        const red=([r,g,b])=>r>170&&g<40&&b<40;
        // An unselected tab also turns yellow on hover. Its old red tab
        // remains selected until the original frontend accepts the click.
        // Check panel contents as well: Audio's music-field border is black,
        // Graphics has the pale Settings highlight, and Display has a red
        // button in the lower panel. Tabs can change before their panel fades in.
        const screen=warm(points.graphics)&&!red(points.audio)&&!red(points.display)&&points.settings[0]>240?'graphics':
          warm(points.audio)&&!red(points.graphics)&&!red(points.display)&&points.center.slice(0,3).every(v=>v<10)&&points.center[3]===255?'audio':
          warm(points.display)&&!red(points.graphics)&&!red(points.audio)&&red(points.chooser)?'display':
          warm(points.main)?'main':points.chooser[0]>120&&points.chooser[1]<10&&points.chooser[2]<10?'chooser':null;
        const stable=screen===audit.frame?.screen?(audit.frame.stable+1):1;
        audit.frame={number:++audit.frames,screen,stable,points};
      }).catch(error=>audit.failure=String(error)).finally(()=>busy=false);
    };
    audit.run=runtime.runAsync(0).then(result=>audit.result=result).catch(error=>audit.failure=String(error));
  });
  async function waitScreen(screen,after=0) {
    const started=Date.now();
    await page.waitForFunction(({screen,after})=>{
      const a=window.navigationAudit;
      if(a.failure||a.result||a.runtime.graphics.renderer.errors.length)throw new Error(JSON.stringify({failure:a.failure,result:a.result,errors:a.runtime.graphics.renderer.errors}));
      return a.frame?.number>after&&a.frame.screen===screen&&a.frame.stable>=3;
    },{screen,after},{timeout:20000,polling:50});
    const frame=await page.evaluate(()=>window.navigationAudit.frame);
    transitions.push({screen,milliseconds:Date.now()-started,frame});
    console.log(`${screen}: ${Date.now()-started} ms`);
    return frame.number;
  }
  async function click(x,y,screen) {
    const after=await page.evaluate(()=>window.navigationAudit.frame?.number??0);
    const box=await page.locator('#navigation').boundingBox();
    await page.mouse.click(box.x+x*box.width/640,box.y+y*box.height/480,{delay:120});
    if(screen)await waitScreen(screen,after);
  }
  await waitScreen('chooser');
  await click(320,400,'main');
  await page.screenshot({path:'build/navigation-main.png'});
  for(const [index,size] of [{width:1440,height:1000},{width:1100,height:700},{width:1920,height:1080}].entries()) {
    await page.setViewportSize(size);
    assert.deepEqual(await page.locator('#navigation').boundingBox(),{x:0,y:0,...size});
    await click(490,467,'audio');
    await click(420,15,'graphics');
    await page.screenshot({path:`build/navigation-graphics-${index}.png`});
    await click(520,15,'display');
    await click(110,15,'audio');
    await click(30,467,'main');
  }
  assert.deepEqual(errors,[]);
  const result=await page.evaluate(async()=>{
    const a=window.navigationAudit,r=a.runtime.graphics.renderer;
    await r.validate();
    return {frames:a.frames,stencilDraws:a.stencilDraws,gpuErrors:r.errors};
  });
  assert.deepEqual(result.gpuErrors,[]);
  await writeFile('build/navigation.json',JSON.stringify({browser:browser.browser().version(),transitions,...result},null,2)+'\n');
  console.log('Original frontend navigation verified with one 120 ms click per action');
} catch(error) {
  if(page){
    await page.screenshot({path:'build/navigation-failure.png'}).catch(()=>{});
    await writeFile('build/navigation-failure.json',JSON.stringify({error:String(error),transitions,errors,
      observation:await page.evaluate(()=>({frame:window.navigationAudit?.frame,failure:window.navigationAudit?.failure,result:window.navigationAudit?.result})).catch(String)},null,2)+'\n');
  }
  throw error;
} finally {
  if(page)await page.evaluate(async()=>{
    const a=window.navigationAudit;if(!a)return;
    a.runtime.stop();await a.run;a.detach();a.runtime.dispose();
  }).catch(()=>{});
  await browser.close();
}
