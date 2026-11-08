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
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; document.body.prepend(canvas);
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
    renderer.textureCreate(3,1,1,Uint8Array.of(255,0,0,128)); renderer.clear(0xff000000);
    renderer.draw(quad(0,0,64,64,0x40ffffff),mesh,{texture:3}); expect(pixel(await renderer.readPixels(),16,16),[255,0,0,128],'texture alpha selection');
    renderer.draw(quad(0,0,64,64,0x40ffffff),mesh,{texture:3,alpha_modulate:1}); expect(pixel(await renderer.readPixels(),16,16),[255,0,0,32],'modulated texture alpha',1);
    renderer.textureUpdate(3,Uint8Array.of(255,0,0,255)); renderer.clear(0xff000000);
    renderer.draw(quad(0,0,32,64),mesh,{texture:3}); renderer.textureUpdate(3,Uint8Array.of(0,255,0,255));
    renderer.draw(quad(32,0,32,64),mesh,{texture:3}); pixels = await renderer.readPixels();
    expect(pixel(pixels,16,32),[255,0,0,255],'draw before texture mutation'); expect(pixel(pixels,48,32),[0,255,0,255],'draw after texture mutation');
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
  await page.locator('canvas').screenshot({ path:'build/webgpu-renderer.png' });
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
  assert.deepEqual(errors,[]);
  await writeFile('build/webgpu-renderer.json', JSON.stringify({ browser:browser.browser().version(),...result },null,2)+'\n');
  console.log(`WebGPU (${result.info.vendor}): ${result.checks} pixel/batching checks passed, including 3840x2160 output; OffscreenCanvas Worker rendering passed`);
} finally { await browser.close(); }
