import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

process.env.TMPDIR=resolve('.cache/tmp');process.env.XDG_CACHE_HOME=resolve('.cache/xdg');
process.env.__GL_SHADER_DISK_CACHE_PATH=resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR,{recursive:true});
const software=process.env.NFS5_GPU_SOFTWARE==='1';
const reports=[],errors=[];
const observedAt=new Date().toISOString();
let browser,stage='browser launch';
const saveReport=extra=>writeFile('build/loading.json',JSON.stringify({observedAt,software,stage,reports,pageErrors:errors,...extra},null,2)+'\n');
try {
  await saveReport({passed:false});
  browser=await chromium.launchPersistentContext(resolve('.cache/chrome-loading-test'),{
    executablePath:'/usr/bin/google-chrome',headless:software,timeout:30000,viewport:{width:1000,height:800},
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes'),
      ...(software?['--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--use-angle=swiftshader','--use-vulkan=swiftshader','--enable-features=Vulkan','--disable-vulkan-surface']:[])],
  });
  const page=await browser.newPage(),session=await browser.newCDPSession(page);
  await session.send('Network.enable');await session.send('Network.setCacheDisabled',{cacheDisabled:true});
  await session.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  page.on('pageerror',error=>errors.push(String(error)));
  for(const [width,height] of [[1600,900],[900,1600],[3840,2160]]) {
    stage=`${width}x${height} adapter selection`;await saveReport({passed:false});
    await page.goto(process.env.NFS5_TEST_URL??'http://127.0.0.1:8000');
    const adapter=await page.evaluate(async()=>{
      const a=await Promise.race([navigator.gpu.requestAdapter(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('WebGPU adapter request timed out')),10000))]);
      if(!a)throw new Error('No WebGPU adapter is available');
      return {vendor:a.info.vendor,architecture:a.info.architecture};
    });
    if(software)assert.equal(adapter.architecture,'swiftshader');
    stage=`${width}x${height} loading capture`;await saveReport({passed:false});
    let captureTimer;
    const report=await Promise.race([page.evaluate(async({width,height})=>{
      const {loadRuntime}=await import('./runtime.mjs');
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;document.body.prepend(canvas);
      const runtime=await loadRuntime({canvas,persist:false,intro:false,display:{width,height}});
      const args=`debugmode=0 fe=0 track_name=coastal linear_track=1 numcars=1 numplayerracecars=1 numopponentracecars=0 car[0].class=human width=${width} height=${height} depth=32 texturedetail=4 cardetail=4`;
      runtime.module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\nfs5.exe '+args+'\0'),runtime.base+0xb000);
      const renderer=runtime.graphics.renderer,draw=renderer.draw,present=renderer.present,textureCreate=renderer.textureCreate;
      const textures=new Map(),captures=[];
      let uploads=0,lastUpload=0,lastBlit,busy=false,timer,run;
      let finish,fail;const captured=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
      renderer.textureCreate=(id,w,h,...rest)=>{textures.set(id,[w,h]);return textureCreate(id,w,h,...rest);};
      renderer.draw=(bytes,indices,state)=>{
        if(state?.texture&&!state.alpha_modulate&&renderer.width===width&&renderer.height===height){
          const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
          lastBlit={texture:textures.get(state.texture),right:view.getFloat32(64,true),bottom:view.getFloat32(68,true)};
          uploads++;
        }
        return draw(bytes,indices,state);
      };
      renderer.present=()=>{
        present();
        if(busy||!lastBlit||lastUpload===uploads||captures.length>=4)return;
        busy=true;lastUpload=uploads;const blit=lastBlit,frame=renderer.stats.frames;
        renderer.readPixels().then(pixels=>{
          const logical=width*480>=height*640?[Math.round(width*480/height),480]:[640,Math.round(height*640/width)];
          const [lw,lh]=logical,x=Math.trunc((lw-640)/2),y=Math.trunc((lh-480)/2);
          const bounds=[x*width/lw,y*height/lh,(x+640)*width/lw,(y+480)*height/lh];
          let colored=0,outside=0;
          for(let py=0;py<height;py++)for(let px=0;px<width;px++){
            const offset=(py*width+px)*4;
            if(!pixels[offset]&&!pixels[offset+1]&&!pixels[offset+2])continue;
            colored++;
            if(px<bounds[0]-3||py<bounds[1]-3||px>bounds[2]+3||py>bounds[3]+3)outside++;
          }
          if(colored<10000)return;
          const still=document.createElement('canvas');still.width=width;still.height=height;
          still.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),width,height),0,0);
          captures.push({frame,upload:lastUpload,colored,outside,bounds,logical,blit,url:still.toDataURL()});
          if(captures.length===4)finish();
        }).catch(fail).finally(()=>busy=false);
      };
      try {
        timer=setTimeout(()=>fail(new Error('Original loading artwork did not produce four software updates')),45000);
        run=runtime.runAsync(0);
        await Promise.race([captured,run.then(result=>{throw new Error(`Game stopped before loading captures: ${result.error}`);})]);
        runtime.stop();const result=await run;await renderer.validate();
        return {width,height,captures,stopped:result.stopped,errors:renderer.errors};
      } finally {
        clearTimeout(timer);runtime.stop();if(run)await run;
        renderer.draw=draw;renderer.present=present;renderer.textureCreate=textureCreate;runtime.dispose();
      }
    },{width,height}),new Promise((_,reject)=>{captureTimer=setTimeout(()=>reject(new Error('Loading runtime initialization/capture timed out')),55000);})]).finally(()=>clearTimeout(captureTimer));
    for(const [i,capture]of report.captures.entries()){
      if(i===0||i===report.captures.length-1)await writeFile(`build/loading-${width}x${height}-${i}.png`,Buffer.from(capture.url.split(',')[1],'base64'));
      delete capture.url;
    }
    report.adapter=adapter;reports.push(report);
    await saveReport({passed:false});
    assert.equal(report.stopped,true);assert.deepEqual(report.errors,[]);
    for(const frame of report.captures){
      assert.equal(frame.outside,0,`${width}×${height} software update ${frame.upload} repeats artwork into its margins`);
      assert(Math.abs(frame.blit.right-width)<.01&&Math.abs(frame.blit.bottom-height)<.01,'Software upload covers the viewport exactly once');
      assert.deepEqual(frame.blit.texture,frame.logical,'Loading software surface uses logical dimensions');
    }
    console.log(`${width}×${height}: four original loading updates retain black margins and cover the viewport once`);
  }
  assert.deepEqual(errors,[]);
  stage='complete';
  await saveReport({passed:true});
} catch(error) {
  await saveReport({passed:false,error:String(error)});
  throw error;
} finally {await browser?.close();}
