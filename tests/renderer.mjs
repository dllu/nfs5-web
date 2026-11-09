import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
process.env.TMPDIR = resolve('.cache/tmp');
process.env.XDG_CACHE_HOME = resolve('.cache/xdg');
process.env.__GL_SHADER_DISK_CACHE_PATH = resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR, { recursive: true });
const headless = process.env.NFS5_GPU_HEADLESS === '1';
const browser = await chromium.launchPersistentContext(resolve('.cache/chrome-renderer-test'), {
  executablePath: '/usr/bin/google-chrome', headless,
  args: ['--no-sandbox','--disable-dev-shm-usage','--disable-breakpad','--crash-dumps-dir='+resolve('.cache/crashes'),
    ...(headless ? ['--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--enable-unsafe-webgpu','--ignore-gpu-blocklist'] : [])],
  viewport: { width: 1000, height: 850 },
});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.env.NFS5_TEST_URL ?? 'http://127.0.0.1:8000');
  const result = await page.evaluate(async () => {
    const { createRenderer } = await import('./renderer.mjs');
    const canvas = document.createElement('canvas');canvas.id='renderer-check'; canvas.width = 64; canvas.height = 64; document.body.prepend(canvas);
    const renderer = await createRenderer(canvas); window.testRenderer = renderer;
    let checks = 0;
    function pack(vertices) {
      const bytes = new Uint8Array(vertices.length * 32), view = new DataView(bytes.buffer);
      vertices.forEach((v, i) => {
        [v.x,v.y,v.z ?? .5,v.rhw ?? 1].forEach((value, j) => view.setFloat32(i*32+j*4,value,true));
        view.setUint32(i*32+16,v.color ?? 0xffffffff,true); view.setUint32(i*32+20,v.specular ?? 0xff000000,true);
        view.setFloat32(i*32+24,v.u ?? 0,true); view.setFloat32(i*32+28,v.v ?? 0,true);
      });
      return bytes;
    }
    const mesh = Uint32Array.of(0,1,2,0,2,3);
    function quad(x, y, w, h, color = 0xffffffff, extra = {}) {
      return pack([{ x,y,color,u:0,v:0,...extra },{x:x+w,y,color,u:1,v:0,...extra},
        {x:x+w,y:y+h,color,u:1,v:1,...extra},{x,y:y+h,color,u:0,v:1,...extra}]);
    }
    function pixel(bytes, x, y) { return Array.from(bytes.subarray((y*renderer.width+x)*4,(y*renderer.width+x)*4+4)); }
    function expect(value, wanted, label, tolerance = 0) {
      if (value.length !== wanted.length || value.some((v, i) => Math.abs(v-wanted[i]) > tolerance)) throw new Error(`${label}: ${value} != ${wanted}`);
      checks++;
    }
    renderer.clear(0xff102030); expect(pixel(await renderer.readPixels(),5,5),[16,32,48,255],'clear');
    renderer.clear(0xff000000); renderer.draw(quad(0,0,32,32,0xffff0000),mesh);
    let pixels = await renderer.readPixels(); expect(pixel(pixels,8,8),[255,0,0,255],'screen-space XY/ARGB'); expect(pixel(pixels,48,48),[0,0,0,255],'outside geometry');
    renderer.clear(0xff000000); const depth = {depth_test:1,depth_write:1};
    renderer.draw(quad(0,0,64,64,0xff00ff00,{z:.8}),mesh,depth);
    renderer.draw(quad(0,0,64,64,0xffff0000,{z:.2}),mesh,depth);
    renderer.draw(quad(0,0,64,64,0xff0000ff,{z:.9}),mesh,depth);
    expect(pixel(await renderer.readPixels(),16,16),[255,0,0,255],'depth comparison/writes');
    renderer.clear(0xff0000ff); renderer.draw(quad(0,0,64,64,0x80ff0000),mesh,{blend_enable:1});
    expect(pixel(await renderer.readPixels(),16,16),[128,0,127,191],'alpha blend',1);
    const texels = Uint8Array.of(255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255);
    renderer.textureCreate(1,2,2,texels); renderer.clear(0xff000000); const textured = {texture:1,filter_linear:0,address_wrap:0};
    renderer.draw(quad(0,0,64,64),mesh,textured); pixels = await renderer.readPixels();
    expect(pixel(pixels,16,16),[255,0,0,255],'texture upper left'); expect(pixel(pixels,48,16),[0,255,0,255],'texture upper right');
    expect(pixel(pixels,16,48),[0,0,255,255],'texture lower left'); expect(pixel(pixels,48,48),[255,255,255,255],'texture lower right');
    const transparent = texels.slice(); transparent[3] = 0; renderer.textureUpdate(1,transparent); renderer.clear(0xff0000ff);
    renderer.draw(quad(0,0,64,64),mesh,{...textured,alpha_test:1,alpha_ref:128}); pixels = await renderer.readPixels();
    expect(pixel(pixels,16,16),[0,0,255,255],'alpha test discard'); expect(pixel(pixels,48,16),[0,255,0,255],'alpha test pass');
    for(const alpha of [64,128]) {
      const passes=alpha===64?[false,true,false,true,false,true,false,true]:[false,false,true,true,false,false,true,true];
      for(let func=0;func<8;func++) {
        renderer.clear(0xff0000ff);renderer.draw(quad(0,0,64,64,(alpha*0x1000000+0xff0000)>>>0),mesh,{alpha_test:1,alpha_ref:128,alpha_func:func});
        expect(pixel(await renderer.readPixels(),16,16),passes[func]?[255,0,0,alpha]:[0,0,255,255],`alpha comparison ${func}, input ${alpha}`);
      }
    }
    renderer.clear(0xff000000); renderer.draw(quad(0,0,64,64,0xffff0000),mesh,{scissor_enable:1,scissor_x:16,scissor_y:16,scissor_w:16,scissor_h:16});
    pixels = await renderer.readPixels(); expect(pixel(pixels,20,20),[255,0,0,255],'inside clip'); expect(pixel(pixels,8,8),[0,0,0,255],'outside clip');
    renderer.clear(0xff000000); renderer.draw(quad(0,0,64,64,0xffff0000,{specular:0}),mesh,{fog_enable:1,fog_color:0x00808080});
    expect(pixel(await renderer.readPixels(),16,16),[128,128,128,255],'vertex fog');
    renderer.clear(0xff000000); renderer.draw(quad(0,0,64,64,0xffff0000,{rhw:.5}),mesh,{fog_enable:1,fog_color:0x00808080,fog_mode:1,fog_near:1,fog_far:3});
    expect(pixel(await renderer.readPixels(),16,16),[192,64,64,255],'eye-depth linear fog',1);
    renderer.textureCreate(2,2,1,Uint8Array.of(255,0,0,255,0,255,0,255));
    const perspective = pack([{x:0,y:0,u:0,v:0,rhw:1},{x:64,y:0,u:1,v:0,rhw:.25},{x:64,y:64,u:1,v:1,rhw:.25},{x:0,y:64,u:0,v:1,rhw:1}]);
    renderer.clear(0xff000000); renderer.draw(perspective,mesh,{texture:2,filter_linear:0,address_wrap:0}); pixels = await renderer.readPixels();
    expect(pixel(pixels,48,32),[255,0,0,255],'perspective UV red'); expect(pixel(pixels,56,32),[0,255,0,255],'perspective UV green');
    const gouraud = pack([{x:0,y:0,color:0xffff0000,rhw:1},{x:64,y:0,color:0xff00ff00,rhw:.25},
      {x:64,y:64,color:0xff00ff00,rhw:.25},{x:0,y:64,color:0xffff0000,rhw:1}]);
    renderer.clear(0xff000000); renderer.draw(gouraud,mesh);
    expect(pixel(await renderer.readPixels(),48,32),[62,193,0,255],'screen-linear vertex color with unequal RHW',1);
    const flat = pack([{x:0,y:0,color:0xffff0000},{x:64,y:0,color:0xff00ff00},{x:0,y:64,color:0xff0000ff}]);
    renderer.clear(0xff000000); renderer.draw(flat,null,{shade_mode:0});
    expect(pixel(await renderer.readPixels(),8,8),[0,0,255,255],'flat triangle uses last vertex');
    renderer.clear(0xff000000); renderer.draw(flat,Uint32Array.of(0,2,1),{shade_mode:0});
    expect(pixel(await renderer.readPixels(),8,8),[0,255,0,255],'indexed flat triangle uses last mesh vertex');
    for(const cull of [2,3]) {
      renderer.clear(0xff000000);renderer.draw(flat,null,{cull,shade_mode:1});
      const visible=pixel(await renderer.readPixels(),8,8).slice(0,3).some(v=>v);
      renderer.clear(0xff000000);renderer.draw(flat,null,{cull,shade_mode:0});
      expect([Number(pixel(await renderer.readPixels(),8,8)[2]>0)],[Number(visible)],'flat rotation preserves culling');
    }
    renderer.clear(0xff000000);
    renderer.draw(pack([{x:0,y:16.5,color:0xffff0000},{x:64,y:16.5,color:0xff00ff00}]),null,{primitive:1,shade_mode:0});
    renderer.draw(pack([{x:8.5,y:8.5,color:0xffff0000}]),null,{primitive:2,shade_mode:0});
    pixels=await renderer.readPixels();
    expect(pixel(pixels,16,16),[0,255,0,255],'flat line uses final endpoint');
    expect(pixel(pixels,8,8),[255,0,0,255],'flat point color');
    const highlights=pack([{x:0,y:0,rhw:1,color:0x40000000,specular:0},
      {x:64,y:0,rhw:.25,color:0x40000000,specular:0x80804020},
      {x:64,y:64,rhw:.25,color:0x40000000,specular:0x80804020},
      {x:0,y:64,rhw:1,color:0x40000000,specular:0}]);
    renderer.clear(0xff000000);renderer.draw(highlights,mesh,{shade_mode:1});
    expect(pixel(await renderer.readPixels(),48,32),[0,0,0,64],'Gouraud mode ignores specular');
    renderer.draw(highlights,mesh,{shade_mode:2});
    expect(pixel(await renderer.readPixels(),48,32),[97,49,24,161],'screen-linear specular RGBA with unequal RHW',1);
    renderer.textureCreate(4,1,1,Uint8Array.of(128,128,128,128));
    const lit=quad(0,0,64,64,0x80402010,{specular:0x40203040}),litState={texture:4,alpha_modulate:1,shade_mode:2};
    renderer.clear(0xff000000);renderer.draw(lit,mesh,{...litState,alpha_test:1,alpha_ref:120});
    expect(pixel(await renderer.readPixels(),16,16),[64,64,72,128],'specular addition follows texture modulation and precedes alpha test',1);
    renderer.clear(0xff000000);renderer.draw(lit,mesh,{...litState,alpha_test:1,alpha_ref:140});
    expect(pixel(await renderer.readPixels(),16,16),[0,0,0,255],'alpha test after specular can discard');
    renderer.draw(lit,mesh,{...litState,fog_enable:1,fog_color:0});
    expect(pixel(await renderer.readPixels(),16,16),[16,16,18,128],'fog follows specular addition',1);
    renderer.draw(quad(0,0,64,64,0xfff0f0f0,{specular:0x80a0a0a0}),mesh,{shade_mode:2});
    expect(pixel(await renderer.readPixels(),16,16),[255,255,255,255],'specular output saturates at target');
    renderer.clear(0xff000000);
    renderer.draw(quad(0,0,32,64,0xff000000,{specular:0x00203040}),mesh,{shade_mode:1});
    renderer.draw(quad(32,0,32,64,0xff000000,{specular:0x00203040}),mesh,{shade_mode:2});pixels=await renderer.readPixels();
    expect(pixel(pixels,16,16),[0,0,0,255],'queued Gouraud state');
    expect(pixel(pixels,48,16),[32,48,64,255],'queued shading mode change');
    renderer.textureCreate(3,1,1,Uint8Array.of(255,0,0,128)); renderer.clear(0xff000000);
    renderer.draw(quad(0,0,64,64,0x40ffffff),mesh,{texture:3}); expect(pixel(await renderer.readPixels(),16,16),[255,0,0,128],'texture alpha selection');
    renderer.draw(quad(0,0,64,64,0x40ffffff),mesh,{texture:3,alpha_modulate:1}); expect(pixel(await renderer.readPixels(),16,16),[255,0,0,32],'modulated texture alpha',1);
    renderer.textureUpdate(3,Uint8Array.of(255,0,0,255)); renderer.clear(0xff000000);
    renderer.draw(quad(0,0,32,64),mesh,{texture:3}); renderer.textureUpdate(3,Uint8Array.of(0,255,0,255));
    renderer.draw(quad(32,0,32,64),mesh,{texture:3}); pixels = await renderer.readPixels();
    expect(pixel(pixels,16,32),[255,0,0,255],'draw before texture mutation'); expect(pixel(pixels,48,32),[0,255,0,255],'draw after texture mutation');
    // Deliberately distinct source levels expose missing uploads or an
    // incorrect LOD/filter choice even when base-level rendering looks fine.
    const mipBytes=new Uint8Array((64+16+4+1)*4);
    [[0,64,[255,0,0,255]],[64,16,[0,255,0,255]],[80,4,[0,0,255,255]],[84,1,[255,255,255,255]]]
      .forEach(([start,count,color])=>{for(let i=start;i<start+count;i++)mipBytes.set(color,i*4);});
    renderer.textureCreate(5,8,8,mipBytes,4);
    function scaledUVQuad(x,y,w,h,scale) {
      return pack([{x,y,u:0,v:0},{x:x+w,y,u:scale,v:0},
        {x:x+w,y:y+h,u:scale,v:scale},{x,y:y+h,u:0,v:scale}]);
    }
    const minified=scaledUVQuad(0,0,64,64,32),mipState={texture:5,filter_linear:0,mip_filter:1};
    renderer.clear(0xff000000);renderer.draw(minified,mesh,{...mipState,mip_filter:0});
    expect(pixel(await renderer.readPixels(),16,16),[255,0,0,255],'disabled mip filter selects base level');
    renderer.draw(minified,mesh,mipState);
    expect(pixel(await renderer.readPixels(),16,16),[0,0,255,255],'implicit minification selects supplied level two');
    renderer.draw(minified,mesh,{...mipState,mip_lod_bias:-1});
    expect(pixel(await renderer.readPixels(),16,16),[0,255,0,255],'negative LOD bias preserves finer detail');
    renderer.draw(minified,mesh,{...mipState,mip_lod_bias:1});
    expect(pixel(await renderer.readPixels(),16,16),[255,255,255,255],'positive LOD bias selects coarser detail');
    renderer.draw(scaledUVQuad(0,0,64,64,16*Math.SQRT2),mesh,{...mipState,mip_filter:2});
    expect(pixel(await renderer.readPixels(),16,16),[0,128,128,255],'linear mip filtering blends adjacent supplied levels',2);
    renderer.draw(scaledUVQuad(0,0,64,64,1),mesh,mipState);
    expect(pixel(await renderer.readPixels(),16,16),[255,0,0,255],'magnification uses base level');
    renderer.clear(0xff000000);renderer.draw(scaledUVQuad(0,0,32,64,8),mesh,mipState);
    const updatedMips=mipBytes.slice();for(let i=64;i<80;i++)updatedMips.set([255,255,0,255],i*4);
    renderer.textureUpdate(5,updatedMips);renderer.draw(scaledUVQuad(32,0,32,64,8),mesh,mipState);pixels=await renderer.readPixels();
    expect(pixel(pixels,8,16),[0,255,0,255],'queued draw retains old mip data');
    expect(pixel(pixels,40,16),[255,255,0,255],'texture mutation replaces every supplied level');
    const narrow=new Uint8Array((8+4+2+1)*4);for(let i=0;i<15;i++)narrow.set(i<12?[255,0,0,255]:[0,255,0,255],i*4);
    renderer.textureCreate(6,1,8,narrow,4);renderer.draw(scaledUVQuad(0,0,64,64,32),mesh,{texture:6,mip_filter:1,filter_linear:0});
    expect(pixel(await renderer.readPixels(),16,16),[0,255,0,255],'rectangular mip chain retains a one-texel axis');
    renderer.textureUpdate(1,texels);
    for(const [u,v,wanted] of [[0,1,[255,255,255,255]],[1,0,[255,0,0,255]],[2,2,[0,255,0,255]]]) {
      renderer.draw(quad(0,0,64,64,0xffffffff,{u:1.25,v:-.25}),mesh,{texture:1,filter_linear:0,address_u:u,address_v:v});
      expect(pixel(await renderer.readPixels(),16,16),wanted,'independent clamp/repeat/mirror texture axes');
    }
    renderer.clear(0xff000000); const before = renderer.stats.batches;
    for (let i = 0; i < 100; i++) renderer.draw(quad(0,0,64,64,0xff00ffff),mesh);
    pixels = await renderer.readPixels(); expect([renderer.stats.batches-before],[1],'consecutive draw batching'); expect(pixel(pixels,16,16),[0,255,255,255],'batched vertices/indices');
    renderer.resize(3840,2160); renderer.clear(0xff203040); renderer.draw(quad(3832,2152,8,8,0xffff0000),mesh);
    pixels = await renderer.readPixels(); expect(pixel(pixels,0,0),[32,48,64,255],'4K target'); expect(pixel(pixels,3838,2158),[255,0,0,255],'4K lower-right raster');
    renderer.resize(640,360); renderer.clear(0xff102030);
    renderer.draw(pack([{x:40,y:40,color:0xffff0000},{x:350,y:55,color:0xff00ff00},{x:80,y:320,color:0xff0000ff}]),null);
    renderer.textureUpdate(1,texels); renderer.draw(quad(395,85,180,180),mesh,{texture:1,filter_linear:0,address_wrap:0});
    renderer.present();
    const target = document.createElement('canvas'); target.width = 640; target.height = 360; const context = target.getContext('2d'); context.drawImage(canvas,0,0);
    expect(Array.from(context.getImageData(10,10,1,1).data),[16,32,48,255],'canvas presentation');
    await renderer.validate();
    return { checks, info: renderer.info, stats: {...renderer.stats}, validationErrors: renderer.errors.slice(), resolution: [3840,2160] };
  });
  assert.deepEqual(errors, []); assert.deepEqual(result.validationErrors, []); assert(result.checks >= 25);
  await page.locator('#renderer-check').screenshot({ path:'build/webgpu-renderer.png' });
  await page.evaluate(() => { window.testRenderer.close(); delete window.testRenderer; });
  result.worker = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16; document.body.append(canvas);
    const module = new URL('./renderer.mjs', location.href).href;
    const source = `import {createRenderer} from ${JSON.stringify(module)};
      self.onmessage = async ({data:canvas}) => {
        let renderer;
        try {
          renderer = await createRenderer(canvas); renderer.clear(0xff112233);
          const bytes = new Uint8Array(96), view = new DataView(bytes.buffer);
          [[0,0],[16,0],[0,16]].forEach(([x,y],i) => {
            view.setFloat32(i*32,x,true);view.setFloat32(i*32+4,y,true);
            view.setFloat32(i*32+8,.5,true);view.setFloat32(i*32+12,1,true);view.setUint32(i*32+16,0xffff0000,true);
          });
          renderer.draw(bytes,null);renderer.present();const pixels = await renderer.readPixels();await renderer.validate();
          self.postMessage({inside:Array.from(pixels.slice((2*16+2)*4,(2*16+2)*4+4)),outside:Array.from(pixels.slice((14*16+14)*4,(14*16+14)*4+4)),vendor:renderer.info.vendor,errors:renderer.errors});
        } catch(error) {self.postMessage({error:String(error)});} finally {renderer?.close();}
      };`;
    const url = URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    const worker = new Worker(url,{type:'module'});
    try {
      return await new Promise((resolve,reject) => {
        worker.onmessage = ({data}) => resolve(data);worker.onerror = event => reject(new Error(event.message));
        const offscreen = canvas.transferControlToOffscreen(); worker.postMessage(offscreen,[offscreen]);
      });
    } finally {worker.terminate();URL.revokeObjectURL(url);canvas.remove();}
  });
  assert.equal(result.worker.error,undefined);assert.deepEqual(result.worker.errors,[]);
  assert.deepEqual(result.worker.inside,[255,0,0,255]);assert.deepEqual(result.worker.outside,[17,34,51,255]);
  result.thrash=await page.evaluate(async()=>{
    const {loadRuntime}=await import('./runtime.mjs');
    const canvas=document.createElement('canvas');canvas.id='thrash-check';canvas.width=640;canvas.height=480;canvas.style.width='640px';document.body.prepend(canvas);
    const runtime=await loadRuntime({canvas,pace:false,persist:false});window.thrashRuntime=runtime;
    const {module,base,manifest}=runtime,view=new DataView(module.HEAPU8.buffer,base),data=0x800000,out=0x120000,image=0x900000;
    const put=(p,v)=>view.setUint32(p,v>>>0,true),get=p=>view.getUint32(p,true);
    const text=s=>{module.HEAPU8.set(new TextEncoder().encode(s+'\0'),base+data);return data;};
    let calls=0,checks=0;
    async function call(entry,args=[]) {
      const result=await runtime.invokeAsync(entry,args);if(result.status)throw new Error(result.error);calls++;
      if(result.registers[4]!==runtime.memorySize-0x10000+args.length*4)throw new Error('Native driver stack imbalance');
      return result.registers[0];
    }
    const invoke=(name,...args)=>call(manifest.imports.find(item=>item.name===name).slot,args);
    const wc=data+64;
    [0,manifest.imports.find(item=>item.name==='DefWindowProcA').slot,0,0,0x400000,0,0,0,0,text('ThrashWindowChecks')].forEach((v,i)=>put(wc+i*4,v));
    const atom=await invoke('RegisterClassA',wc),hwnd=await invoke('CreateWindowExA',0,atom,0,0x90000000,0,0,1000,850,0,0,0x400000,0);
    if(!hwnd)throw new Error('Native driver test window creation failed');
    const library=await invoke('LoadLibraryA',text('.\\drivers\\opengl3z'));
    const functions=new Map();
    async function method(name,...args){if(!functions.has(name))functions.set(name,await invoke('GetProcAddress',library,text(name)));return call(functions.get(name),args);}
    function expect(got,wanted,label,tolerance=0){
      const differs=tolerance?[0,8,16,24].some(shift=>Math.abs((got>>>shift&255)-(wanted>>>shift&255))>tolerance):got!==wanted;
      if(differs)throw new Error(`${label}: ${got.toString(16)} != ${wanted.toString(16)}`);checks++;
    }
    const descriptor=await method('_THRASH_about@0'),count=get(descriptor+60),modes=get(descriptor+64);
    function mode(w,h){for(let i=1;i<=count;i++)if(get(modes+i*40)===w&&get(modes+i*40+4)===h&&get(modes+i*40+8)===32)return i;throw new Error('Missing mode');}
    expect(await method('_THRASH_setvideomode@12',mode(640,480),0,2),1,'video mode');
    await invoke('GetClientRect',hwnd,out);expect(get(out+8),640,'window tracks render width');expect(get(out+12),480,'window tracks render height');
    await invoke('GetMessageA',out,hwnd,5,5);expect(get(out+12),(480<<16)|640,'mode change queues WM_SIZE');
    expect(await method('_THRASH_setstate@8',3,0xff112233),1,'clear state');await method('_THRASH_clearwindow@0');
    async function pixel(x,y){expect(await method('_THRASH_readrect@20',x,y,1,1,out),1,'readrect');return get(out);}
    expect(await pixel(100,100),0xff112233,'native clear/readback');
    function vertex(p,x,y,color=0xffffffff,u=0,v=0,z=.2){[x,y,z,1].forEach((v,i)=>view.setFloat32(p+i*4,v,true));put(p+16,color);put(p+20,0xff000000);view.setFloat32(p+24,u,true);view.setFloat32(p+28,v,true);}
    const vertices=data+4096;
    vertex(vertices,0,0,0xffff0000);vertex(vertices+32,64,0,0xffff0000);vertex(vertices+64,0,64,0xffff0000);
    await method('_THRASH_setstate@8',4,1);await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
    expect(await pixel(8,8),0xffff0000,'native triangle');
    const flushAddress=await invoke('GetProcAddress',library,text('_THRASH_flushwindow@0'));
    // Keep the JS consumer idle until both guest calls return. Flush must not
    // wait for this thread; queued draws own their vertex bytes at publication.
    for(let i=0;i<3;i++)put(vertices+i*32+16,0xff00ff00);
    for(const [address,args] of [[functions.get('_THRASH_drawtri@12'),[vertices,vertices+32,vertices+64]],[flushAddress,[]]]) {
      const result=runtime.call(address,...args);calls++;
      expect(result.status,0,'synchronous graphics producer');expect(result.registers[0],1,'queued draw/flush return');
    }
    for(let i=0;i<3;i++)put(vertices+i*32+16,0xff0000ff);
    expect(await pixel(8,8),0xff00ff00,'draw snapshot and readback after asynchronous flush');
    // Native 404/405 factors apply independently to source and destination,
    // including the color factors used by the original doubled-modulate helper.
    const source=[64,128,192,128],destination=[192,128,64,128];
    const factors=[()=>1,()=>0,()=>source[3]/255,()=>1-source[3]/255,
      ()=>destination[3]/255,()=>1-destination[3]/255,c=>source[c]/255,c=>destination[c]/255,
      c=>1-source[c]/255,c=>1-destination[c]/255];
    const argb=rgb=>(0xff000000|rgb[0]<<16|rgb[1]<<8|rgb[2])>>>0;
    for(let i=0;i<3;i++)put(vertices+i*32+16,0x804080c0);
    await method('_THRASH_setstate@8',36,0);await method('_THRASH_setstate@8',10,2);
    await method('_THRASH_setstate@8',3,0x80c08040);
    for(let factor=0;factor<10;factor++) {
      for(const src of [true,false]) {
        await method('_THRASH_setstate@8',404,src?factor:1);await method('_THRASH_setstate@8',405,src?1:factor);
        await method('_THRASH_clearwindow@0');await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
        const input=src?source:destination,wanted=argb(input.slice(0,3).map((v,c)=>Math.round(v*factors[factor](c))));
        expect(await pixel(8,8),wanted,`native ${src?'source':'destination'} blend factor ${factor}`,1);
      }
    }
    put(0x6bd97c,functions.get('_THRASH_setstate@8'));
    const originalBlend=await runtime.invokeAsync(0x540550,[404,0xffffffff]);calls++;
    if(originalBlend.status)throw new Error(originalBlend.error);
    await method('_THRASH_clearwindow@0');await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
    expect(await pixel(8,8),0xff608160,'original doubled-modulate blend helper reaches native custom factors',1);
    await method('_THRASH_setstate@8',56,0);await method('_THRASH_setstate@8',3,0xff0000ff);
    for(let i=0;i<3;i++)put(vertices+i*32+16,0x80ff0000);
    for(const [mode,reference,color] of [[0,255,0xffff0000],[1,255,0xffff0000],
      [2,128,0xff0000ff],[3,128,0xff0000ff],[2,127,0xff80007f],[3,127,0xff80007f],[2,256,0xff0000ff]]) {
      await method('_THRASH_setstate@8',10,mode);await method('_THRASH_setstate@8',36,reference);
      await method('_THRASH_clearwindow@0');await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
      expect(await pixel(8,8),color,'native blend mode and independent full alpha reference',1);
    }
    await method('_THRASH_setstate@8',31,106);await method('_THRASH_setstate@8',10,1);await method('_THRASH_setstate@8',36,127);
    await method('_THRASH_clearwindow@0');await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
    expect(await pixel(8,8),0xff80007f,'older Thrash ABI enables blending in mode one',1);
    await method('_THRASH_setstate@8',31,107);
    await method('_THRASH_setstate@8',10,2);await method('_THRASH_setstate@8',36,0);
    await method('_THRASH_clearwindow@0');
    for(let i=0;i<3;i++)put(vertices+i*32+16,0x00ff0000);
    await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
    await method('_THRASH_setstate@8',10,0);
    for(let i=0;i<3;i++){put(vertices+i*32+16,0xff00ff00);view.setFloat32(vertices+i*32+8,.5,true);}
    await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
    expect(await pixel(8,8),0xff00ff00,'zero-alpha fragments do not occlude geometry behind them');
    await method('_THRASH_setstate@8',6,0);
    vertex(vertices,0,0,0xffff0000);vertex(vertices+32,64,0,0xff00ff00);
    vertex(vertices+64,64,64,0xff0000ff);vertex(vertices+96,0,64,0xffffffff);
    await method('_THRASH_drawquad@16',vertices,vertices+32,vertices+64,vertices+96);
    expect(await pixel(48,8),0xff0000ff,'native flat quad first triangle uses C');
    expect(await pixel(8,48),0xffff0000,'native flat quad second triangle uses A');
    const quadIndices=vertices+128;
    [0,1,2,3].forEach((v,i)=>put(quadIndices+i*4,v));
    await method('_THRASH_setstate@8',3,0xff000000);await method('_THRASH_clearwindow@0');
    await method('_THRASH_drawquadmesh@12',1,vertices,quadIndices);
    expect(await pixel(48,8),0xff0000ff,'native flat quad mesh first triangle');
    expect(await pixel(8,48),0xffff0000,'native flat quad mesh second triangle');
    vertex(vertices,0,0,0xffff0000);vertex(vertices+32,64,64,0xff00ff00);
    await method('_THRASH_drawsprite@8',vertices,vertices+32);
    expect(await pixel(48,8),0xff00ff00,'native flat sprite first triangle uses B');
    expect(await pixel(8,48),0xff00ff00,'native flat sprite second triangle uses B');
    const translucent=await method('_THRASH_talloc@20',1,1,6,0,0);
    put(image,0x80808080);await method('_THRASH_tupdate@12',translucent,image,0);
    await method('_THRASH_settexture@4',translucent);await method('_THRASH_setstate@8',6,2);
    vertex(vertices,0,0,0x80402010);vertex(vertices+32,64,0,0x80402010);vertex(vertices+64,0,64,0x80402010);
    for(let i=0;i<3;i++)put(vertices+i*32+20,0x40203040);
    for(const stage41 of [3,2]) {
      await method('_THRASH_setstate@8',41,stage41);
      await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
      expect(await pixel(8,8),0xff404048,`native RGB modulation and specular with state 41=${stage41}`);
      // The native readrect API returns opaque display pixels; inspect the
      // render target to verify fragment alpha independently of that API.
      const rgba=await runtime.graphics.renderer.readPixels();
      expect(rgba[(8*640+8)*4+3],128,`native fragment alpha with state 41=${stage41}`);
    }
    await method('_THRASH_setstate@8',6,1);await method('_THRASH_tfree@4',translucent);
    const texture=await method('_THRASH_talloc@20',2,2,4,0,0),pixels=data+8192;
    [0xf800,0x07e0,0x001f,0xffff].forEach((v,i)=>view.setUint16(pixels+i*2,v,true));
    expect(await method('_THRASH_tupdate@12',texture,pixels,0),texture,'RGB565 upload');
    await method('_THRASH_settexture@4',texture);await method('_THRASH_setstate@8',11,0);await method('_THRASH_setstate@8',7,0);
    vertex(vertices,0,0);vertex(vertices+32,64,64,0xffffffff,1,1);
    await method('_THRASH_drawsprite@8',vertices,vertices+32);
    for(const [x,y,color] of [[8,8,0xffff0000],[48,8,0xff00ff00],[8,48,0xff0000ff],[48,48,0xffffffff]])expect(await pixel(x,y),color,'RGB565 texture orientation');
    vertex(vertices,0,0,0xffffffff,.5,.5);vertex(vertices+32,64,0,0xffffffff,.5,.5);vertex(vertices+64,0,64,0xffffffff,.5,.5);
    await method('_THRASH_setstate@8',7,1);
    for(const [state,value] of [[11,0],[13,1],[65,2],[66,0]]) {
      await method('_THRASH_setstate@8',state,value);await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
      expect(await pixel(8,8),0xff808080,'native addressing/mip state preserves spatial bilinear filter',1);
    }
    await method('_THRASH_setstate@8',7,0);
    for(let i=0;i<3;i++){view.setFloat32(vertices+i*32+24,1.25,true);view.setFloat32(vertices+i*32+28,-.25,true);}
    for(const [u,v,color] of [[0,1,0xffffffff],[1,0,0xffff0000],[2,2,0xff00ff00]]) {
      await method('_THRASH_setstate@8',65,u);await method('_THRASH_setstate@8',66,v);
      await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
      expect(await pixel(8,8),color,'native independent U/V texture addressing');
    }
    await method('_THRASH_setstate@8',13,1);await method('_THRASH_setstate@8',47,0);await method('_THRASH_setstate@8',48,0);
    await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
    expect(await pixel(8,8),0xff0000ff,'stencil states do not overwrite repeat texture addressing');
    await method('_THRASH_tfree@4',texture);
    const mipTexture=await method('_THRASH_talloc@20',4,4,4,0,2);
    for(let i=0;i<21;i++)view.setUint16(image+i*2,i<16?0xf800:i<20?0x07e0:0x001f,true);
    expect(await method('_THRASH_tupdate@12',mipTexture,image,0),mipTexture,'native RGB565 mip chain upload');
    await method('_THRASH_settexture@4',mipTexture);await method('_THRASH_setstate@8',13,0);
    vertex(vertices,0,0);vertex(vertices+32,64,0,0xffffffff,64,0);vertex(vertices+64,0,64,0xffffffff,0,64);
    for(const [filter,bias,color] of [[0,0,0xffff0000],[1,0,0xff0000ff],[1,0xbf800000,0xff00ff00]]) {
      await method('_THRASH_setstate@8',11,filter);await method('_THRASH_setstate@8',8,bias);
      await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
      expect(await pixel(8,8),color,'native source mips and LOD bias reach shader');
    }
    await method('_THRASH_tfree@4',mipTexture);await method('_THRASH_setstate@8',8,0);await method('_THRASH_setstate@8',11,0);
    const large=await method('_THRASH_talloc@20',1024,1024,6,0,10),largePixels=(4**11-1)/3;
    for(let i=0;i<5;i++){
      const chain=new Uint32Array(module.HEAPU8.buffer,base+image,largePixels);
      chain.fill((0xff000000|(i*32)<<16|0x2233)>>>0);chain[largePixels-1]=0xff12ab34;
      expect(await method('_THRASH_tupdate@12',large,image,0),large,'large texture update');
    }
    const transport=module._web_gpu_transport(),header=new Uint32Array(module.HEAPU8.buffer,transport,8);
    if(header[0]<=header[5])throw new Error('The native command ring did not wrap');checks++;
    await method('_THRASH_settexture@4',large);vertex(vertices,0,0);vertex(vertices+32,640,480,0xffffffff,1,1);
    await method('_THRASH_drawsprite@8',vertices,vertices+32);
    expect(await pixel(200,200),0xff802233,'wrapped texture command bytes');
    await method('_THRASH_setstate@8',11,1);await method('_THRASH_setstate@8',8,0x41800000);
    await method('_THRASH_drawsprite@8',vertices,vertices+32);
    expect(await pixel(200,200),0xff12ab34,'wrapped upload includes smallest mip at the end of the chain');
    await method('_THRASH_setstate@8',11,0);await method('_THRASH_setstate@8',8,0);await method('_THRASH_tfree@4',large);
    await method('_THRASH_setvideomode@12',mode(3840,2160),0,2);await method('_THRASH_clip@16',0,0,3840,2160);
    await invoke('GetClientRect',hwnd,out);expect(get(out+8),3840,'4K client width');expect(get(out+12),2160,'4K client height');
    await invoke('GetMessageA',out,hwnd,5,5);expect(get(out+12),(2160<<16)|3840,'4K WM_SIZE');
    await method('_THRASH_setstate@8',3,0xff203040);await method('_THRASH_clearwindow@0');
    vertex(vertices,3832,2152,0xffff0000);vertex(vertices+32,3840,2152,0xffff0000);vertex(vertices+64,3832,2160,0xffff0000);
    await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);
    expect(await pixel(3834,2154),0xffff0000,'native 4K triangle');expect(await pixel(0,0),0xff203040,'native 4K clear');
    const locked=await method('_THRASH_lockwindow@0');expect(get(locked+4),3840*4,'locked pitch');expect(get(locked+8),6,'locked pixel format');
    put(get(locked),0xff12ab34);let heartbeat=0;const timer=setInterval(()=>heartbeat++,1);
    try{expect(await method('_THRASH_unlockwindow@4',locked),1,'software framebuffer upload');}finally{clearInterval(timer);}
    if(!heartbeat)throw new Error('The application thread did not run during framebuffer upload');checks++;
    expect(await pixel(0,0),0xff12ab34,'4K locked framebuffer round trip');
    await runtime.graphics.renderer.validate();
    const stats=Array.from(new Uint32Array(module.HEAPU8.buffer,module._web_gpu_stats(),5));
    const nativeMode=[runtime.graphics.renderer.width,runtime.graphics.renderer.height];
    await method('_THRASH_restore@0');await method('_THRASH_setvideomode@12',mode(640,480),0,2);
    await invoke('GetClientRect',hwnd,out);expect(get(out+8),640,'restored client width');expect(get(out+12),480,'restored client height');
    await method('_THRASH_clip@16',0,0,640,480);await method('_THRASH_setstate@8',3,0xff102030);await method('_THRASH_clearwindow@0');
    vertex(vertices,40,40,0xffff0000);vertex(vertices+32,600,60,0xff00ff00);vertex(vertices+64,80,440,0xff0000ff);
    await method('_THRASH_drawtri@12',vertices,vertices+32,vertices+64);await method('_THRASH_pageflip@0');
    await invoke('DestroyWindow',hwnd);await invoke('UnregisterClassA',atom,0x400000);
    return {calls,checks,stats,nativeMode,heartbeat,errors:runtime.graphics.renderer.errors.slice()};
  });
  assert.deepEqual(result.thrash.errors,[]);assert.deepEqual(result.thrash.nativeMode,[3840,2160]);assert(result.thrash.checks>=25);
  await page.locator('#thrash-check').screenshot({path:'build/thrash-driver.png'});
  await page.evaluate(()=>{window.thrashRuntime.dispose();delete window.thrashRuntime;});
  result.fallback=await page.evaluate(async()=>{
    const {loadRuntime}=await import('./runtime.mjs'),{attachGraphics}=await import('./graphics.mjs');
    const runtime=await loadRuntime({persist:false}),{module,base,manifest}=runtime;
    const transport=new Int32Array(module.HEAPU8.buffer,module._web_gpu_transport(),8);
    Atomics.store(transport,6,1); // Legacy producers cannot notify their consumer.
    const canvas=document.createElement('canvas');document.body.append(canvas);
    const graphics=await attachGraphics(module,canvas,{pace:false}),data=0x800000;
    const text=s=>{module.HEAPU8.set(new TextEncoder().encode(s+'\0'),base+data);return data;};
    async function call(address,args=[]) {const r=await runtime.invokeAsync(address,args);if(r.status)throw new Error(r.error);await graphics.settle();return r.registers[0];}
    const invoke=(name,...args)=>call(manifest.imports.find(i=>i.name===name).slot,args);
    try {
      const library=await invoke('LoadLibraryA',text('drivers\\opengl3z'));
      const method=async(name,...args)=>call(await invoke('GetProcAddress',library,text(name)),args);
      await method('_THRASH_setvideomode@12',1,0,1);
      await new Promise(resolve=>setTimeout(resolve,25));
      await method('_THRASH_setstate@8',3,0xff112233);await method('_THRASH_clearwindow@0');
      await method('_THRASH_flushwindow@0');await method('_THRASH_pageflip@0');
      const pixel=Array.from((await graphics.renderer.readPixels()).slice(0,4));
      if(pixel.join()!=='17,34,51,255'||graphics.renderer.stats.frames!==1)throw new Error('Legacy polling transport lost a command after idle');
      return {pixel,frames:graphics.renderer.stats.frames,errors:graphics.renderer.errors.slice()};
    } finally {graphics.close();runtime.dispose();}
  });
  assert.deepEqual(result.fallback.errors,[]);
  result.legacyDraws=await page.evaluate(async()=>{
    const {attachGraphics}=await import('./graphics.mjs'),results=[];
    for(const version of [1,2,3,4]) {
      // Older state layouts still decode geometry/textures and retain their
      // alpha >= reference comparison without the v5 alpha-function field.
      const memory=new SharedArrayBuffer(32768),heap=new Uint8Array(memory),header=new Int32Array(memory,0,8),ring=new Uint32Array(memory,32,4096);
      header[5]=ring.length;header[6]=version;let sequence=0;
      const module={HEAPU8:heap,_web_gpu_transport:()=>0,_web_gpu_attach:()=>{header[3]=1;},
        _malloc:()=>30000,_free:()=>{},_web_gpu_fail:()=>{}};
      const canvas=document.createElement('canvas');document.body.append(canvas);
      const graphics=await attachGraphics(module,canvas,{pace:false});
      function send(opcode,data) {
        const packet=Uint32Array.of(data.length+3,opcode,++sequence,...data),start=Atomics.load(header,0);
        packet.forEach((word,i)=>ring[(start+i)%ring.length]=word);Atomics.store(header,0,start+packet.length);
        if(version>=2)Atomics.notify(header,0);
      }
      try {
        send(1,Uint32Array.of(64,64));
        const stateSize=version>=4?30:version>=3?26:25,start=stateSize+2,end=start+24;
        const draw=new Uint32Array(end+3),floats=new Float32Array(draw.buffer);
        draw[6]=draw[7]=draw[8]=draw[22]=1;draw[16]=4;floats[14]=floats[24]=1;
        if(version>=3)draw[25]=1;
        draw[stateSize]=draw[stateSize+1]=3;
        [[0,0,1,0xffff0000],[64,0,.25,0xff00ff00],[0,64,.5,0xff0000ff]].forEach(([x,y,rhw,color],i)=>{
          const at=start+i*8;floats[at]=x;floats[at+1]=y;floats[at+2]=.5;floats[at+3]=rhw;draw[at+4]=color;draw[at+5]=0xffffffff;
        });
        draw.set([0,1,2],end);send(4,draw);send(3,new Uint32Array());await graphics.settle();
        const sample=bytes=>Array.from(bytes.slice((8*64+8)*4,(8*64+8)*4+4));
        const indexed=sample(await graphics.renderer.readPixels());
        if(indexed.some((v,i)=>Math.abs(v-[187,34,34,255][i])>1))throw new Error(`Legacy v${version} indexed Gouraud: ${indexed}`);
        await new Promise(resolve=>setTimeout(resolve,25));
        draw[stateSize+1]=0;for(let i=0;i<3;i++)draw[start+i*8+4]=0xff00ff00;
        send(4,draw.subarray(0,end));send(3,new Uint32Array());
        const deadline=performance.now()+2000;
        while(Atomics.load(header,2)!==sequence) {
          if(performance.now()>deadline)throw new Error(`Legacy v${version} consumer did not wake after idle`);
          await new Promise(resolve=>setTimeout(resolve,1));
        }
        await graphics.settle();
        const unindexed=sample(await graphics.renderer.readPixels());
        if(unindexed.join()!=='0,255,0,255')throw new Error(`Legacy v${version} unindexed draw: ${unindexed}`);
        send(5,version>=4?Uint32Array.of(7,1,1,1):Uint32Array.of(7,1,1));send(6,Uint32Array.of(7,0,4,4,0xff0000ff));
        draw[9]=1;draw[10]=255; // Legacy comparison remains alpha >= reference.
        draw[0]=7;for(let i=0;i<3;i++)draw[start+i*8+4]=0xffffffff;
        send(4,draw.subarray(0,end));await graphics.settle();
        const textured=sample(await graphics.renderer.readPixels());
        if(textured.join()!=='255,0,0,255')throw new Error(`Legacy v${version} texture packet: ${textured}`);
        results.push({version,indexed,unindexed,textured,errors:graphics.renderer.errors.slice()});
      } finally {graphics.close();canvas.remove();}
    }
    return results;
  });
  for(const legacy of result.legacyDraws)assert.deepEqual(legacy.errors,[]);
  assert.deepEqual(errors,[]);
  await writeFile('build/webgpu-renderer.json', JSON.stringify({ browser:browser.browser().version(),...result },null,2)+'\n');
  console.log(`WebGPU (${result.info.vendor}): ${result.checks} backend checks; ${result.thrash.checks} native-driver checks and ${result.thrash.calls} ABI calls passed, including 4K, ring wrapping and legacy polling after idle`);
} finally { await browser.close(); }
