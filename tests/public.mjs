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
    {input:await page.screenshot(),maxBuffer:1024*1024}).toString());
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
    const {sha256}=await (await fetch('./manifest.json')).json();
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('nfs5-web-files-'+sha256);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Test save database is blocked'));});
  });
  await ready();
  assert.equal(await page.locator('#retry').isVisible(),false);
  assert.equal(await page.locator('#game').evaluate(c=>getComputedStyle(c).cursor),'none');
  assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
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
  await page.keyboard.type('webcheck',{delay:80});
  await page.screenshot({path:'build/public-test-named.png'});
  await click(225,237);await click(320,400);
  let first;
  for(let i=0;i<20&&!first;i++){first=await saved();if(!first)await page.waitForTimeout(500);}
  assert(first,'Create player must write a browser-local save');
  assert.equal(first.year,1950);assert.equal(first.ownedCars,0);
  assert.deepEqual(first.completion,[0,0,0]);
  assert.equal(first.resolution,26);assert.equal(first.carDetail,4);assert.equal(first.textureDetail,4);
  console.log('Fresh profile saved locally');
  await page.screenshot({path:'build/public-test-created.png'});
  await browser.close();browser=null;
  await open();await ready();
  const restored=await saved();assert.deepEqual(restored,first,'Profile bytes survive a full browser restart');
  await page.screenshot({path:'build/public-test-restored.png'});
  assert.deepEqual(errors,[]);
  await writeFile('build/public-test.json',JSON.stringify({url,seed,first,restored,errors},null,2)+'\n');
  console.log('Public autostart, completed seed, fresh 1950 profile, maximum defaults, hidden cursor and browser-restart persistence passed');
} catch(error) {
  await page?.screenshot({path:'build/public-test-failure.png'}).catch(()=>{});
  throw error;
} finally {await browser?.close();}
