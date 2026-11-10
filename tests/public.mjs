import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {execFileSync} from 'node:child_process';

process.env.TMPDIR=resolve('.cache/tmp');
process.env.XDG_CACHE_HOME=resolve('.cache/xdg');
process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR,{recursive:true});
const url=process.env.NFS5_PUBLIC_URL??'http://127.0.0.1:8001/';
const options={executablePath:'/usr/bin/google-chrome',headless:false,
  viewport:{width:1440,height:1080},args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad',
    '--crash-dumps-dir='+resolve('.cache/crashes')]};
let browser,page;const errors=[];
async function open() {
  browser=await chromium.launchPersistentContext(resolve('.cache/chrome-public-test'),options);
  page=await browser.newPage();
  const session=await browser.newCDPSession(page);
  await session.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  page.on('pageerror',error=>errors.push(String(error)));
}
async function colors(points) {
  return JSON.parse(execFileSync('python3',['-c',
    "import io,json,sys; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB'); print(json.dumps([im.getpixel((round(x*im.width/640),round(y*im.height/480))) for x,y in json.loads(sys.argv[1])]))",JSON.stringify(points)],
    {input:await page.locator('#game').screenshot(),maxBuffer:1024*1024}).toString());
}
async function ready() {
  await page.goto(url);
  await page.waitForFunction(()=>document.querySelector('#loading').hidden,null,{timeout:90000});
  // Observe rendered buttons: first mode change and loading artwork precede
  // the actual chooser, particularly on an uncached remote connection.
  const deadline=Date.now()+90000;let stable=0;
  while(Date.now()<deadline) {
    const samples=await colors([[250,353],[250,377],[250,400]]);
    if(samples.every(([r,g,b])=>r>130&&b<40&&g<r)) {if(++stable===2)return;}
    else stable=0;
    await page.waitForTimeout(500);
  }
  throw new Error('The original profile chooser did not become ready');
}
async function click(x,y) {
  const box=await page.locator('#game').boundingBox();
  await page.mouse.move(box.x+x*box.width/640,box.y+y*box.height/480);
  await page.waitForTimeout(180);
  await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();
  await page.waitForTimeout(1000);
}
async function saved() {
  return page.evaluate(async()=>{
    const {sha256}=await (await fetch('./manifest.json')).json();
    const {openStorage}=await import('./storage.mjs'),storage=await openStorage(sha256);
    try {
      const records=await storage.load(),record=records.find(r=>r.path.toLowerCase().endsWith('\\0webcheck.sav')&&r.live);
      if(!record)return null;
      const bytes=new Uint8Array(record.data),text=new TextDecoder('windows-1252').decode(bytes);
      const at=name=>text.indexOf(name+'\0')+name.length+1;
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      return {path:record.path,size:bytes.length,hash,year:view.getUint32(at('Tournament'),true),
        ownedCars:view.getUint32(at('PlayerInfo'),true),resolution:view.getUint32(at('Graphics.Resolutions'),true),
        carDetail:view.getUint32(at('Graphics.CarDetail'),true),textureDetail:view.getUint32(at('Graphics.TextureDetail'),true),
        completion:Array.from(bytes.subarray(text.indexOf('webcheck\0webcheck\0')+18,text.indexOf('webcheck\0webcheck\0')+21))};
    } finally {storage.close();}
  });
}
try {
  await open();
  // Reset only this dedicated test browser's game database before autostart.
  await page.goto(new URL('THIRD_PARTY_NOTICES.md',url).href);
  await page.evaluate(async()=>{
    localStorage.removeItem('nfs5-scene-detail');
    const {sha256}=await (await fetch('./manifest.json')).json();
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('nfs5-web-files-'+sha256);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Test save database is blocked'));});
  });
  await ready();
  assert.equal(await page.locator('#game-tools').evaluate(c=>getComputedStyle(c).position),'fixed','Controls load the matching release stylesheet');
  assert.equal(await page.locator('#retry').isVisible(),false);
  assert.equal(await page.locator('#game').evaluate(c=>getComputedStyle(c).cursor),'none');
  assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
  for(const size of [{width:1920,height:1080},{width:900,height:1600}]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(350);
    const box=await page.locator('#game').boundingBox();
    const scale=Math.min(size.width/640,size.height/480);
    assert(Math.abs(box.width-640*scale)<.01&&Math.abs(box.height-480*scale)<.01,'Menu keeps its original 4:3 aspect');
    assert(Math.abs(box.x-(size.width-box.width)/2)<.01&&Math.abs(box.y-(size.height-box.height)/2)<.01,'Menu is centered inside its black bars');
    assert.deepEqual(await page.locator('#game').evaluate(c=>[c.width,c.height]),[Math.round(box.width),Math.round(box.height)],'Frontend geometry renders at viewport density inside the 4:3 frame');
    await page.screenshot({path:`build/public-menu-${size.width}x${size.height}.png`});
  }
  // Create a profile with a horizontal letterbox offset, exercising the same
  // bounding-box input mapping used in normal play.
  await page.setViewportSize({width:1920,height:1080});

  const seed=await page.evaluate(async()=>{
    const index=await(await fetch('./assets.json')).json(),e=index.entries.find(e=>e.path==='SaveData/8Showroom.sav');
    const b=new Uint8Array(await(await fetch(e.url)).arrayBuffer()),text=new TextDecoder('windows-1252').decode(b);
    return {year:new DataView(b.buffer).getUint32(text.indexOf('Tournament\0')+11,true),
      completion:Array.from(b.subarray(text.indexOf('Showroom\0Showroom\0')+18,text.indexOf('Showroom\0Showroom\0')+21)),
      personalPlayers:index.entries.filter(e=>e.path.startsWith('SaveData/')&&e.path.endsWith('.sav')).map(e=>e.path)};
  });
  assert.equal(seed.year,2000);assert.deepEqual(seed.completion,[1,1,1]);
  assert.deepEqual(seed.personalPlayers.sort(),['SaveData/8Showroom.sav','SaveData/XXDefXX.sav']);
  console.log('Original profile chooser ready');
  await page.screenshot({path:'build/public-test-chooser.png'});
  let creating=false;
  for(let i=0;i<4&&!creating;i++) {
    await click(320,353);
    const [[r,g,b]]=await colors([[400,169]]);creating=r>130&&b<40;
  }
  assert(creating,'Create player must open the name field');
  await click(350,169);
  await page.getByRole('button',{name:'Keyboard',exact:true}).click();
  await page.setViewportSize({width:1920,height:1000});await page.waitForTimeout(400);
  assert(await page.getByRole('textbox',{name:'Type player name'}).evaluate(field=>document.activeElement===field),'Opening the mobile keyboard retains focus across a renderer resize');
  await page.getByRole('textbox',{name:'Type player name'}).fill('webcheck');
  await page.waitForTimeout(1400);
  await page.getByRole('button',{name:'Keyboard',exact:true}).click();
  await page.screenshot({path:'build/public-test-named.png'});
  await click(225,237);await click(320,400);
  let first;
  for(let i=0;i<20&&!first;i++){first=await saved();if(!first)await page.waitForTimeout(500);}
  assert(first,'Create player must write a browser-local save');
  assert.equal(first.year,1950);assert.equal(first.ownedCars,0);
  assert.deepEqual(first.completion,[0,0,0]);
  assert.equal(first.resolution,26);assert.equal(first.carDetail,4);assert.equal(first.textureDetail,4);
  console.log('Fresh profile saved locally');
  await page.getByRole('button',{name:'Info',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#game-info pre').textContent.includes('wasmBytes'));
  const diagnostics=JSON.parse(await page.locator('#game-info pre').textContent());
  assert.equal(diagnostics.detail.multiplier,await page.evaluate(()=>matchMedia('(pointer: coarse)').matches?1:2),'Automatic adapts to desktop/touch input');
  await page.getByLabel('View distance').selectOption('very-far');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#game-info pre').textContent).detail.multiplier===4);
  assert.equal(await page.evaluate(()=>localStorage.getItem('nfs5-scene-detail')),'very-far');
  assert.equal(diagnostics.wasmBytes,384*1024*1024);assert.equal(diagnostics.info.software,false);
  assert(diagnostics.transport.stateHits>0&&diagnostics.transport.stateMisses>0,'Diagnostics expose state reuse');
  assert(diagnostics.loading.preloadedFiles>900&&diagnostics.loading.preloadBytes<16*1024*1024,'Small assets are batched in a bounded startup pack');
  assert(diagnostics.files.preloadedReads>0,'The original game reads preloaded assets');
  assert(diagnostics.audio.nativeFills>0,'The audio worklet consumes the native refill ring');
  assert.equal(diagnostics.audio.state,'running');assert(diagnostics.audio.rate>0&&diagnostics.audio.peak>=0,'Diagnostics include browser audio state and signal level');
  assert(diagnostics.streaming.enabled&&diagnostics.streaming.failures===0,'The music read-ahead worker is available');
  assert(diagnostics.transport.producerPackets>=diagnostics.transport.producerNotifications&&diagnostics.transport.producerNotifications>0,'Diagnostics expose actual queue notifications');
  assert(diagnostics.submissionIntervalsMs.samples>0&&diagnostics.submissionIntervalsMs.samples<=600);
  assert(diagnostics.submissionIntervalsMs.p50>=1000/70,'Menu redraws are capped near 60 Hz on a high-refresh display');
  assert(diagnostics.submissionIntervalsMs.p99>=diagnostics.submissionIntervalsMs.p50);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Controls',exact:true}).click();
  if(await page.getByRole('button',{name:'Layout: Joystick',exact:true}).isVisible())await page.getByRole('button',{name:'Layout: Joystick',exact:true}).click();
  assert.equal(await page.locator('#touch-pad').getAttribute('data-layout'),'buttons');
  assert(await page.getByRole('button',{name:'Steer left',exact:true}).isVisible());
  const dialogPromise=page.waitForEvent('dialog');
  const reloading=page.reload().then(()=>false,()=>true);
  const dialog=await dialogPromise;assert.equal(dialog.type(),'beforeunload');await dialog.dismiss();
  assert.equal(await reloading,true,'The browser allows cancelling a tab close/reload while playing');
  assert(await page.locator('#loading').isHidden());
  await page.screenshot({path:'build/public-test-created.png'});
  await browser.close();browser=null;
  await open();await ready();
  await page.getByRole('button',{name:'Info',exact:true}).click();
  assert.equal(await page.getByLabel('View distance').inputValue(),'very-far','Scene detail survives a full browser restart');
  await page.waitForFunction(()=>document.querySelector('#game-info pre').textContent.includes('wasmBytes'));
  assert.equal(JSON.parse(await page.locator('#game-info pre').textContent()).detail.multiplier,4);
  await page.getByLabel('View distance').selectOption('auto');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await page.locator('#touch-pad').getAttribute('data-layout'),'buttons','Touch layout survives a full browser restart');
  const restored=await saved();assert.deepEqual(restored,first,'Profile bytes survive a full browser restart');
  await page.screenshot({path:'build/public-test-restored.png'});
  assert.deepEqual(errors,[]);
  await writeFile('build/public-test.json',JSON.stringify({url,seed,first,restored,errors},null,2)+'\n');
  console.log('Public autostart, completed seed, fresh 1950 profile, maximum defaults, hidden cursor and browser-restart persistence passed');
} catch(error) {
  await page?.screenshot({path:'build/public-test-failure.png'}).catch(()=>{});
  throw error;
} finally {await browser?.close();}
