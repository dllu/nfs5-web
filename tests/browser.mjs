import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import {openingMovies} from '../web/config.mjs';

// Keep Chromium's profiles, caches, and Playwright's temporary files local.
process.env.TMPDIR = resolve('.cache/tmp');
process.env.XDG_CACHE_HOME = resolve('.cache/xdg');
process.env.__GL_SHADER_DISK_CACHE_PATH = resolve('.cache/nvidia');
await mkdir(process.env.TMPDIR, { recursive: true });
const fixture = Uint8Array.from({ length: 131195 }, (_, i) => (i * 37 + (i >>> 8)) & 255);
await writeFile('dist/fs-browser-fixture.bin', fixture);
const index=JSON.parse(await readFile('dist/assets.json','utf8')),ini=index.entries.find(item=>item.path.toLowerCase()==='nfs5.ini');
const expectedIntro=openingMovies(ini?.url?new Uint8Array(await readFile(new URL('../dist/'+ini.url,import.meta.url))):null);
const browser = await chromium.launchPersistentContext(resolve('.cache/chrome-test'), {
  executablePath: '/usr/bin/google-chrome', headless: false,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-breakpad',
    '--crash-dumps-dir=' + resolve('.cache/crashes')],
  viewport: { width: 1440, height: 1000 },
});
try {
  const page = await browser.newPage();
  const session = await browser.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.env.NFS5_TEST_URL ?? 'http://127.0.0.1:8000');
  await page.getByRole('button', { name: 'Run original startup' }).click();
  await page.waitForFunction(() => window.nfs5Result, null, { timeout: 60000 });
  const result = await page.evaluate(() => window.nfs5Result);
  assert.equal(result.status, 1);
  assert(result.count >= 2099);
  assert(result.winMainEntered, 'Original WinMain must execute in Chrome');
  assert(result.workerEntered, 'Original worker must execute in Chrome');
  assert(result.error.length > 0);
  assert.equal(result.intro,expectedIntro,'Opening movies follow the supplied nfs5.ini');
  if(!expectedIntro)assert(result.introSkipped>0,'Original helper must take the native patch movie-skip branch');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'build/chrome-startup.png', fullPage: true });
  await writeFile('build/chrome-startup.json', JSON.stringify({ browser: browser.browser().version(), ...result }, null, 2) + '\n');
  console.log(`Chrome ${browser.browser().version()}: ${result.count} original function entries; ${result.error}`);
  const range = await page.request.get(new URL('./fs-browser-fixture.bin', page.url()).href, { headers: { Range: 'bytes=65530-65629' } });
  assert.equal(range.status(), 206);
  assert.equal(range.headers()['content-range'], 'bytes 65530-65629/131195');
  assert.deepEqual(new Uint8Array(await range.body()), fixture.subarray(65530, 65630));
  // Exercise real DOM key events through the same adapter used by the runner,
  // then read them through the Wasm DirectInput vtable, including focus loss.
  await page.evaluate(async () => {
    const { loadRuntime } = await import('./runtime.mjs');
    const { attachInput } = await import('./input.mjs');
    const runtime = await loadRuntime(), { module, base, manifest } = runtime;
    const view = new DataView(module.HEAPU8.buffer, base), data = 0x800000, stack = runtime.memorySize - 0x10000;
    const put = (p, value) => view.setUint32(p, value >>> 0, true), get = p => view.getUint32(p, true);
    function call(address, args) {
      args.forEach((v, i) => put(stack + i * 4, v)); module._web_set_register(4, stack);
      if (module._web_run(address, 2000)) throw new Error(module.UTF8ToString(module._web_error()));
      return new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8)[0];
    }
    const method = (object, slot, ...args) => call(get(get(object) + slot * 4), [object, ...args]);
    for(const name of ['GetLocalTime','GetSystemTime']) {
      const before=Date.now(),result=await runtime.invokeAsync(manifest.imports.find(i=>i.name===name).slot,[data]);
      if(result.status)throw new Error(result.error);
      const after=Date.now(),[year,month,weekday,day,hour,minute,second,millis]=Array.from({length:8},(_,i)=>view.getUint16(data+i*2,true));
      const date=name==='GetSystemTime'?new Date(Date.UTC(year,month-1,day,hour,minute,second,millis)):new Date(year,month-1,day,hour,minute,second,millis);
      if(date.getTime()<before||date.getTime()>after||(name==='GetSystemTime'?date.getUTCDay():date.getDay())!==weekday)throw new Error('Browser calendar fields differ from the host clock');
    }
    const zone=await runtime.invokeAsync(manifest.imports.find(i=>i.name==='GetTimeZoneInformation').slot,[data]);
    if(zone.status||![0,1,2].includes(zone.registers[0])||view.getInt32(data,true)+view.getInt32(data+(zone.registers[0]===2?168:84),true)!==new Date().getTimezoneOffset())throw new Error('Native browser time-zone bias differs from Date');
    const create = manifest.imports.find(item => item.name === 'DirectInputCreateA').slot;
    if (call(create, [0x400000, 0x500, data, 0])) throw new Error('DirectInput creation failed');
    const root = get(data);
    [0x6f1d2b61,0x11cfd5a0,0x4544c7bf,0x5453].forEach((v, i) => put(data + 16 + i * 4, v));
    if (method(root, 3, data + 16, data + 64, 0)) throw new Error('Keyboard creation failed');
    const keyboard = get(data + 64), format = data + 256, objects = format + 32;
    [24,16,2,256,256,objects].forEach((v, i) => put(format + i * 4, v));
    for (let i = 0; i < 256; i++) { put(objects + i * 16 + 4, i); put(objects + i * 16 + 8, 4 | i << 8); }
    if (method(keyboard, 11, format) || method(keyboard, 13, 0, 6) || method(keyboard, 7)) throw new Error('Keyboard acquisition failed');
    const detach = attachInput(window, event => runtime.input(event));
    window.inputHarness = {
      async writeSave() {
        const name = data + 12000, payload = data + 14000;
        const invoke = (name, args) => call(manifest.imports.find(item => item.name === name).slot, args);
        module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\BrowserSaveChecks\0'), base + name);
        invoke('CreateDirectoryA', [name, 0]);
        module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\BrowserSaveChecks\\checkpoint.sav\0'), base + name);
        const file = invoke('CreateFileA', [name, 0xc0000000, 3, 0, 2, 128, 0]);
        if (file === 0xffffffff) throw new Error('Save fixture creation failed');
        module.HEAPU8.set([0,1,2,3,10,13,127,128,255,42], base + payload);
        if (!invoke('WriteFile', [file, payload, 10, payload + 256, 0])) throw new Error('Save fixture write failed');
        invoke('CloseHandle', [file]);
        module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\BrowserSaveChecks\\checkpoint-copy.sav\0'),base+name+512);
        const copied=await runtime.invokeAsync(manifest.imports.find(i=>i.name==='CopyFileA').slot,[name,name+512,0]);
        if(copied.status||!copied.registers[0])throw new Error(copied.error||'Native save copy failed');
        module.HEAPU8.set(new TextEncoder().encode('Software\\NFS5Web\\BrowserChecks\0'), base + name);
        if (invoke('RegCreateKeyA', [0x80000001,name,payload+512])) throw new Error('Registry fixture creation failed');
        const key = get(payload+512); put(payload, 120);
        module.HEAPU8.set(new TextEncoder().encode('FrameLimit\0'), base + name);
        if (invoke('RegSetValueExA', [key,name,0,4,payload,4])) throw new Error('Registry fixture write failed');
        invoke('RegCloseKey', [key]);
        await runtime.checkpoint();
      },
      async readFixture() {
        runtime.mount('C:\\nfs5\\BrowserFixture.bin', { url: new URL('./fs-browser-fixture.bin', location.href).href, size: 131195 });
        const name = data + 9000, output = data + 10000, transferred = output + 1024;
        module.HEAPU8.set(new TextEncoder().encode('browserfixture.bin\0'), base + name);
        const invoke = (name, args) => call(manifest.imports.find(item => item.name === name).slot, args);
        const file = invoke('CreateFileA', [name, 0x80000000, 3, 0, 3, 128, 0]);
        if (file === 0xffffffff) throw new Error('Fixture open failed');
        invoke('SetFilePointer', [file, 65530, 0, 0]);
        [file, output, 100, transferred, 0].forEach((v, i) => put(stack + i * 4, v));
        module._web_set_register(4, stack);
        if (module._web_start(manifest.imports.find(item => item.name === 'ReadFile').slot, 5000)) throw new Error('Native file-read worker failed');
        while (module._web_async_status() === 1) await new Promise(resolve => setTimeout(resolve, 5));
        if (module._web_async_finish()) throw new Error(module.UTF8ToString(module._web_error()));
        const ok = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8)[0];
        const bytes = Array.from(module.HEAPU8.subarray(base + output, base + output + 100));
        invoke('CloseHandle', [file]);
        return { ok, count: get(transferred), bytes, files: Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_fs_stats(), 4)) };
      },
      async mappingFixture() {
        const name=data+15000,path='C:\\nfs5\\BrowserMappingChecks.bin';
        runtime.mount(path,{url:new URL('./fs-browser-fixture.bin',location.href).href,size:131195});
        module.HEAPU8.set(new TextEncoder().encode(path+'\0'),base+name);
        const invoke=(name,args)=>call(manifest.imports.find(i=>i.name===name).slot,args);
        const file=invoke('CreateFileA',[name,0xC0000000,3,0,3,128,0]);
        const mapped=await runtime.invokeAsync(manifest.imports.find(i=>i.name==='CreateFileMappingA').slot,[file,0,0x08000004,0,0,0]);
        if(mapped.status||!mapped.registers[0])throw new Error(mapped.error||'Native mapping creation failed');
        const handle=mapped.registers[0],a=invoke('MapViewOfFile',[handle,6,0,0,0]),b=invoke('MapViewOfFile',[handle,4,0,65536,1000]);
        if(!a||!b||a+65536===b)throw new Error('Mapping views need distinct guest addresses');
        const pa=module._web_pointer(a+65536,1000),pb=module._web_pointer(b,1000);
        if(pa!==pb)throw new Error('Overlapping file views must share backing');
        const original=Array.from(module.HEAPU8.subarray(pa,pa+100));module.HEAPU8.set([0,128,255,17],pa+17);
        invoke('CloseHandle',[file]);invoke('CloseHandle',[handle]);
        await runtime.checkpoint();
        const shared=Array.from(module.HEAPU8.subarray(pb+17,pb+21));
        invoke('UnmapViewOfFile',[a]);invoke('UnmapViewOfFile',[b]);
        return {original,shared,stats:Array.from(new Uint32Array(module.HEAPU8.buffer,module._web_mapping_stats(),6))};
      },
      state() {
        const status = method(keyboard, 9, 256, data + 8192);
        return { status, keys: Array.from(module.HEAPU8.subarray(base + data + 8192, base + data + 8448)) };
      },
      acquire: () => method(keyboard, 7),
      close() { detach(); runtime.dispose(); delete window.inputHarness; },
    };
  });
  try {
    await page.keyboard.down('ArrowUp');
    assert.equal((await page.evaluate(() => window.inputHarness.state())).keys[0xc8], 0x80);
    await page.keyboard.up('ArrowUp');
    assert.equal((await page.evaluate(() => window.inputHarness.state())).keys[0xc8], 0);
    await page.keyboard.down('w');
    assert.equal((await page.evaluate(() => window.inputHarness.state())).keys[0x11], 0x80);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal((await page.evaluate(() => window.inputHarness.state())).status, 0x8007001e);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => window.inputHarness.acquire()), 0);
    assert((await page.evaluate(() => window.inputHarness.state())).keys.every(value => value === 0));
    await page.keyboard.up('w');
    const read = await page.evaluate(() => window.inputHarness.readFixture());
    assert.equal(read.ok, 1); assert.equal(read.count, 100);
    assert.deepEqual(read.bytes, Array.from(fixture.subarray(65530, 65630)));
    assert.equal(read.files[2], 2, 'A cross-chunk native read must fetch two HTTP ranges');
    const mapping=await page.evaluate(()=>window.inputHarness.mappingFixture());
    assert.deepEqual(mapping.original,Array.from(fixture.subarray(65536,65636)));
    assert.deepEqual(mapping.shared,[0,128,255,17]);assert.deepEqual(mapping.stats,[0,0,0,0,0,0]);
    await page.evaluate(() => window.inputHarness.writeSave());
    assert.deepEqual(errors, []);
    console.log('Chrome native calendar/time-zone APIs, physical keyboard input, focus loss and HTTP range reads verified');
  } finally {
    await page.evaluate(() => window.inputHarness.close());
  }
  // A fresh page and fresh Wasm instance must restore the durable binary file.
  await page.reload();
  const restored = await page.evaluate(async () => {
    const { loadRuntime } = await import('./runtime.mjs'), runtime = await loadRuntime();
    const { module, base, manifest } = runtime, data = 0x800000, stack = runtime.memorySize - 0x10000;
    const view = new DataView(module.HEAPU8.buffer, base);
    function invoke(name, args) {
      args.forEach((v, i) => view.setUint32(stack + i * 4, v >>> 0, true)); module._web_set_register(4, stack);
      if (module._web_run(manifest.imports.find(item => item.name === name).slot, 2000)) throw new Error(module.UTF8ToString(module._web_error()));
      return new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8)[0];
    }
    try {
      module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\BrowserSaveChecks\\checkpoint.sav\0'), base + data);
      const file = invoke('CreateFileA', [data, 0x80000000, 3, 0, 3, 128, 0]);
      if (file === 0xffffffff) throw new Error('Saved file was not restored');
      const read = invoke('ReadFile', [file, data + 4096, 20, data + 8192, 0]);
      const result = { read, count: view.getUint32(data + 8192, true), bytes: Array.from(module.HEAPU8.subarray(base + data + 4096, base + data + 4106)) };
      invoke('CloseHandle', [file]);
      if (!invoke('DeleteFileA', [data])) throw new Error('Save fixture deletion failed');
      module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\BrowserSaveChecks\\checkpoint-copy.sav\0'),base+data);
      const copied=invoke('CreateFileA',[data,0x80000000,3,0,3,128,0]);
      if(copied===0xffffffff||!invoke('ReadFile',[copied,data+4096,20,data+8192,0]))throw new Error('Copied save was not restored');
      result.copyBytes=Array.from(module.HEAPU8.subarray(base+data+4096,base+data+4096+view.getUint32(data+8192,true)));
      invoke('CloseHandle',[copied]);if(!invoke('DeleteFileA',[data]))throw new Error('Copied save deletion failed');
      module.HEAPU8.set(new TextEncoder().encode('Software\\NFS5Web\\BrowserChecks\0'), base + data);
      if (invoke('RegOpenKeyA', [0x80000001,data,data+1024])) throw new Error('Registry fixture was not restored');
      const key = view.getUint32(data+1024,true);
      module.HEAPU8.set(new TextEncoder().encode('FrameLimit\0'), base + data);
      view.setUint32(data+1032,4,true);
      if (invoke('RegQueryValueExA', [key,data,0,data+1028,data+1040,data+1032])) throw new Error('Registry fixture query failed');
      result.registry = view.getUint32(data+1040,true); invoke('RegCloseKey', [key]);
      module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\BrowserMappingChecks.bin\0'),base+data);
      const mappedFile=invoke('CreateFileA',[data,0x80000000,3,0,3,128,0]);
      invoke('SetFilePointer',[mappedFile,65536+17,0,0]);
      if(!invoke('ReadFile',[mappedFile,data+4096,4,data+8192,0]))throw new Error('Mapped write did not persist');
      result.mapped=Array.from(module.HEAPU8.subarray(base+data+4096,base+data+4100));invoke('CloseHandle',[mappedFile]);
      await runtime.checkpoint(); return result;
    } finally { runtime.dispose(); }
  });
  assert.equal(restored.read, 1); assert.equal(restored.count, 10);
  assert.deepEqual(restored.bytes, [0,1,2,3,10,13,127,128,255,42]);
  assert.deepEqual(restored.copyBytes,restored.bytes);
  assert.equal(restored.registry, 120);
  assert.deepEqual(restored.mapped,[0,128,255,17]);
  await page.reload();
  const deleted = await page.evaluate(async () => {
    const { loadRuntime } = await import('./runtime.mjs'), runtime = await loadRuntime();
    try {
      const { module, base, manifest } = runtime, data = 0x800000, stack = runtime.memorySize - 0x10000;
      const view = new DataView(module.HEAPU8.buffer, base);
      return ['checkpoint.sav','checkpoint-copy.sav'].map(name=>{
        module.HEAPU8.set(new TextEncoder().encode('C:\\nfs5\\BrowserSaveChecks\\'+name+'\0'),base+data);
        [data,0x80000000,3,0,3,128,0].forEach((v,i)=>view.setUint32(stack+i*4,v>>>0,true));module._web_set_register(4,stack);
        if(module._web_run(manifest.imports.find(item=>item.name==='CreateFileA').slot,2000))throw new Error('Open after deletion failed');
        return new Uint32Array(module.HEAPU8.buffer,module._web_registers(),8)[0];
      });
    } finally { runtime.dispose(); }
  });
  assert.deepEqual(deleted,[0xffffffff,0xffffffff]);
  assert.deepEqual(errors, []);
  console.log('Chrome restored binary save bytes and registry values across a reload; deletion survived a second reload');
  await page.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Check PCM output'; document.body.append(button);
    button.onclick = async () => {
      let audio, runtime;
      try {
        const { openAudio } = await import('./audio.mjs'); audio = await openAudio();
        const { loadRuntime } = await import('./runtime.mjs'); runtime = await loadRuntime({ audio: audio.configuration });
        const { module, base, manifest } = runtime, data = 0x800000, stack = runtime.memorySize - 0x10000;
        const view = new DataView(module.HEAPU8.buffer, base), put = (p, v) => view.setUint32(p, v >>> 0, true), get = p => view.getUint32(p, true);
        function call(address, args) {
          args.forEach((v, i) => put(stack + i * 4, v)); module._web_set_register(4, stack);
          if (module._web_run(address, 3000)) throw new Error(module.UTF8ToString(module._web_error()));
          return new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8)[0];
        }
        const method = (self, slot, ...args) => call(get(get(self) + slot * 4), [self, ...args]);
        const create = manifest.imports.find(item => item.dll === 'DSOUND.dll' && item.name === 'ordinal_1').slot;
        if (call(create, [0,data,0])) throw new Error('Audio device creation failed');
        const device = get(data), desc = data + 256, wave = data + 512, result = data + 1024, rate = audio.configuration.rate;
        view.setUint16(wave,1,true); view.setUint16(wave+2,1,true); put(wave+4,rate); put(wave+8,rate*2);
        view.setUint16(wave+12,2,true); view.setUint16(wave+14,16,true); view.setUint16(wave+16,0,true);
        [20,0xe8,rate/10*2,0,wave].forEach((v, i) => put(desc + i * 4, v));
        if (method(device,3,desc,result,0)) throw new Error('PCM buffer creation failed');
        const buffer = get(result);
        if (method(buffer,11,0,0,result,result+4,result+8,result+12,2)) throw new Error('PCM lock failed');
        const lock = [get(result),get(result+4),get(result+8),get(result+12)];
        for (let i = 0; i < rate/10; i++) view.setInt16(lock[0] + i*2, Math.round(Math.sin(2*Math.PI*440*i/rate)*8192), true);
        if (method(buffer,19,...lock) || method(buffer,12,0,0,1)) throw new Error('PCM playback failed');
        window.audioHarness = { stats: audio.stats, async close() { method(buffer,18); runtime.dispose(); runtime.dispose(); await audio.close(); delete window.audioHarness; } };
      } catch (error) { runtime?.dispose(); await audio?.close(); window.audioFailure = String(error); }
    };
  });
  await page.getByRole('button', { name: 'Check PCM output' }).click();
  await page.waitForFunction(() => window.audioFailure || (window.audioHarness?.stats().rendered > 2048 && window.audioHarness.stats().peak > .2), null, { timeout: 15000 });
  const audio = await page.evaluate(() => ({ error: window.audioFailure, stats: window.audioHarness?.stats() }));
  assert.equal(audio.error, undefined); assert.equal(audio.stats.state, 'running');
  assert(audio.stats.peak >= .249 && audio.stats.peak <= .251);
  await page.evaluate(() => window.audioHarness.close());
  assert.deepEqual(errors, []);
  console.log(`Chrome AudioWorklet rendered ${audio.stats.rendered} PCM frames; expected quarter-scale peak verified`);
  // Run the original intro long enough to cover its initial wait, software
  // video decoder, framebuffer uploads and streaming game audio together.
  await page.evaluate(()=>{
    const button=document.createElement('button');button.textContent='Check original movie';document.body.append(button);
    button.onclick=async()=>{
      let runtime,audio;
      try {
        const {openAudio}=await import('./audio.mjs');audio=await openAudio();
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.id='movie-check';document.body.prepend(canvas);
        const {loadRuntime}=await import('./runtime.mjs');runtime=await loadRuntime({canvas,audio:audio.configuration,persist:false,intro:true});
        const result=await runtime.runAsync(15000),renderer=runtime.graphics.renderer,pixels=await renderer.readPixels();
        let lit=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]||pixels[i+1]||pixels[i+2])lit++;
        const still=document.createElement('canvas');still.width=renderer.width;still.height=renderer.height;still.id='movie-frame';
        still.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),still.width,still.height),0,0);canvas.replaceWith(still);
        window.movieResult={...result,lit,audio:audio.stats(),gpuErrors:renderer.errors};
      }catch(error){window.movieFailure=error.stack||String(error);}
      finally{runtime?.dispose();await audio?.close();}
    };
  });
  await page.getByRole('button',{name:'Check original movie'}).click();
  await page.waitForFunction(()=>window.movieResult||window.movieFailure,null,{timeout:60000});
  const movie=await page.evaluate(()=>({error:window.movieFailure,result:window.movieResult}));
  assert.equal(movie.error,undefined);assert.equal(movie.result.status,1);assert.match(movie.result.error,/budget reached/i);
  assert(movie.result.rendering[3]>100,'Original video must advance beyond initialization');
  assert(movie.result.lit>10000,'Original decoder must produce a visible picture');
  assert(movie.result.audio.peak>.01,'Original streaming PCM must reach the browser audio graph');
  assert(movie.result.timers[2]>100,'Original timer callbacks must keep advancing');
  assert.deepEqual(movie.result.gpuErrors,[]);assert.deepEqual(errors,[]);
  assert.equal(movie.result.intro,true);assert.equal(movie.result.introSkipped,0);
  await page.locator('#movie-frame').screenshot({path:'build/original-startup.png'});
  await writeFile('build/original-startup.json',JSON.stringify(movie.result,null,2)+'\n');
  console.log(`Original intro: ${movie.result.rendering[3]} presented frames, ${movie.result.lit} visible pixels and game PCM peak ${movie.result.audio.peak.toFixed(3)}`);
  // Exercise the original frontend, including its renderer-capability probe.
  // Capture the source texture immediately at presentation, before another
  // frame can overwrite it. The opaque Create Player button has a pale red
  // highlight at the top and a dark red shadow at the bottom.
  const menu=await page.evaluate(async()=>{
    let runtime,watchdog;
    try {
      const {loadRuntime}=await import('./runtime.mjs');
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;document.body.prepend(canvas);
      runtime=await loadRuntime({canvas,persist:false,intro:false});
      const {module}=runtime;
      // Exercise the startup patch's driver [ENV] loader, not a test-side
      // SetEnvironmentVariable call. These files belong to this isolated run.
      const fixture=new TextEncoder().encode('[THRASH]\nFile=opengl3z.dll\nType=opengl\n[ENV]\nOGL_TEXFILTER=1\nBROWSER_ENV_CHECK=loaded-before-renderer\n');
      const id=runtime.mount('C:\\nfs5\\Drivers\\opengl3\\thrash.ini'),pointer=module._malloc(fixture.length);
      try{module.HEAPU8.set(fixture,pointer);if(!module._web_fs_store(id,pointer,fixture.length))throw new Error('Driver environment fixture failed');}
      finally{module._free(pointer);}
      const renderer=runtime.graphics.renderer,present=renderer.present,draw=renderer.draw;
      const filtering={textured:0,nearestSpatial:0,nearestMip:0,framebufferCopies:0};
      renderer.draw=(...args)=>{
        const state=args[2];if(state?.texture){
          // Synthetic framebuffer copies disable diffuse-alpha modulation
          // and keep point sampling, independently of native geometry state.
          if(!state.alpha_modulate)filtering.framebufferCopies++;
          else{filtering.textured++;filtering.nearestSpatial+=Number(!state.filter_linear);filtering.nearestMip+=Number(state.mip_filter===1);}
        }
        return draw(...args);
      };
      let capture,busy=false,last=0,resolveFrame;
      const frame=new Promise(resolve=>resolveFrame=resolve);
      renderer.present=()=>{
        present();
        if(capture||busy||renderer.width!==640||performance.now()-last<100)return;
        last=performance.now();busy=true;
        renderer.readPixels().then(pixels=>{
          const at=(x,y)=>Array.from(pixels.subarray((y*640+x)*4,(y*640+x)*4+4));
          const top=at(250,346),middle=at(250,353),bottom=at(250,360);
          let portraitColors=0;
          for(let y=236;y<300;y++)for(let x=216;x<270;x++){
            const rgb=pixels.subarray((y*640+x)*4,(y*640+x)*4+3);
            if(Math.max(...rgb)-Math.min(...rgb)>50)portraitColors++;
          }
          if(top[0]>100&&top[0]>bottom[0]+60&&top[1]>bottom[1]+20&&bottom[0]>30&&bottom[1]<10&&bottom[2]<10&&portraitColors>200){
            capture={pixels,top,middle,bottom,portraitColors};resolveFrame();
          }
        }).finally(()=>busy=false);
      };
      watchdog=setTimeout(()=>runtime.stop(),30000);
      const run=runtime.runAsync(0);
      await Promise.race([frame,run.then(result=>{throw new Error(`Original menu did not produce its gradient: ${result.error}`);})]);
      runtime.stop();const result=await run;
      renderer.draw=draw;renderer.present=present;
      const {base}=runtime;
      // The game and its workers have stopped before invoking the snapshot API.
      const environmentSlot=runtime.manifest.imports.find(i=>i.name==='GetEnvironmentStringsW').slot;
      const environmentResult=await runtime.invokeAsync(environmentSlot);
      if(environmentResult.status)throw new Error(environmentResult.error);
      const environmentBlock=environmentResult.registers[0],environmentView=new DataView(module.HEAPU8.buffer,base);
      const environment=[];let at=environmentBlock;
      while(environmentView.getUint16(at,true)){
        let entry='';for(let c;(c=environmentView.getUint16(at,true));at+=2)entry+=String.fromCharCode(c);
        environment.push(entry);at+=2;
      }
      const freeSlot=runtime.manifest.imports.find(i=>i.name==='FreeEnvironmentStringsW').slot;
      const freed=await runtime.invokeAsync(freeSlot,[environmentBlock]);if(freed.status||freed.registers[0]!==1)throw new Error('Driver environment snapshot release failed');
      if(module.HEAPU8[base+0x6197aa]!==1||!runtime.seen(0x4d96b0))throw new Error('Original frontend did not enable and execute Gouraud UI geometry');
      // The original caller must convert the selected built-in portrait and
      // produce its browser-local FSH, as well as painting the face on screen.
      const snapshot=module._web_fs_snapshot(),files=new DataView(module.HEAPU8.buffer);
      let cursor=snapshot+12,portraitSize=0;
      for(let i=0;i<files.getUint32(snapshot+8,true);i++){
        const nameLength=files.getUint32(cursor+20,true),length=files.getUint32(cursor+24,true),size=files.getUint32(cursor+8,true);
        cursor+=28;
        const name=new TextDecoder('windows-1252').decode(Uint8Array.from(module.HEAPU8.subarray(cursor,cursor+nameLength-1)));
        cursor+=(nameLength+3)&~3;
        if(name.toLowerCase()==='c:\\nfs5\\savedata\\pic16.fsh'&&length!==0xffffffff)portraitSize=size;
        if(length!==0xffffffff)cursor+=(length+3)&~3;
      }
      if(portraitSize!==6960||!runtime.seen(0x4dbba0))throw new Error('Original built-in portrait conversion did not produce its image');
      const view=new DataView(module.HEAPU8.buffer,base),graphics={};
      for(const [name,offset]of Object.entries({Resolutions:4,CarChrome:12,CarDetail:16,SpecialFX:20,
        ViewDistance:28,Headlights:32,LensFlare:36,TextureDetail:44,SkyRendering:64})) {
        const property=view.getUint32(0x6908f0+offset,true);
        graphics[name]=view.getUint32(property+24,true);
      }
      const resolution=view.getUint32(0x6908f4,true),selected=graphics.Resolutions;
      const raceMode=[0x38,0x3c,0x40].map(offset=>view.getUint32(view.getUint32(resolution+offset,true)+selected*4,true));
      const viewportMode=[Math.max(640,Math.round(innerWidth*devicePixelRatio)),Math.max(480,Math.round(innerHeight*devicePixelRatio)),32];
      const still=document.createElement('canvas');still.width=640;still.height=480;still.id='menu-frame';
      still.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(capture.pixels),640,480),0,0);canvas.replaceWith(still);
      return {top:capture.top,middle:capture.middle,bottom:capture.bottom,graphics,raceMode,viewportMode,filtering,environment,
        portraitColors:capture.portraitColors,portraitSize,mmx:view.getUint32(0x5deb18,true),stopped:result.stopped,gpuErrors:renderer.errors};
    }finally{clearTimeout(watchdog);runtime?.stop();runtime?.dispose();}
  });
  await writeFile('build/original-menu-gradients.json',JSON.stringify(menu,null,2)+'\n');
  assert.equal(menu.stopped,true);assert.deepEqual(menu.gpuErrors,[]);assert.deepEqual(errors,[]);
  assert.deepEqual(menu.graphics,{Resolutions:26,CarChrome:2,CarDetail:4,SpecialFX:3,ViewDistance:3,
    Headlights:1,LensFlare:1,TextureDetail:4,SkyRendering:2},'Original frontend initializes maximum quality and the viewport race mode');
  assert.deepEqual(menu.raceMode,menu.viewportMode,'Selected race mode matches the physical browser viewport at 32-bit color');
  assert.equal(menu.mmx,1,'Original CPU detection enables the MMX capability required by flare initialization');
  assert(menu.portraitColors>200,'Original player chooser paints its built-in portrait');
  assert.equal(menu.portraitSize,6960,'Original portrait converter writes its browser-local FSH');
  assert(menu.environment.includes('BROWSER_ENV_CHECK=loaded-before-renderer'),'Verok startup copies the selected driver ENV section');
  assert(menu.filtering.textured>0&&menu.filtering.nearestSpatial===0&&menu.filtering.nearestMip===0,
    'Original frontend honors the driver bilinear/trilinear override');
  await page.locator('#menu-frame').screenshot({path:'build/original-menu-gradients.png'});
  console.log(`Original menu gradient verified: top ${menu.top}, middle ${menu.middle}, bottom ${menu.bottom}`);
  await page.reload();
  await page.evaluate(()=>{
    window.viewportInputs=[];
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...rest){
      if(message.type==='input')window.viewportInputs.push({...message});
      return post.call(this,message,...rest);
    };
  });
  await page.getByRole('button',{name:'Run game',exact:true}).click();
  await page.waitForFunction(()=>document.body.classList.contains('playing')&&!document.querySelector('#stop').disabled,null,{timeout:30000});
  for(const size of [{width:1440,height:1000},{width:1100,height:700}]) {
    await page.setViewportSize(size);
    const bounds=await page.locator('#game').boundingBox();
    const scale=Math.min(size.width/640,size.height/480);
    assert(Math.abs(bounds.width-640*scale)<.01&&Math.abs(bounds.height-480*scale)<.01,'Live frontend remains 4:3 inside the viewport');
    const x=bounds.x+bounds.width/4,y=bounds.y+bounds.height*3/4;
    await page.mouse.move(x,y);
    let input=await page.evaluate(()=>window.viewportInputs.filter(e=>'x' in e).at(-1));
    assert.deepEqual([input.x,input.y],[160,360],'Mouse movement maps through the fitted 640×480 canvas');
    await page.evaluate(({x,y})=>{
      const canvas=document.querySelector('#game');
      for(const type of ['mousedown','mouseup'])canvas.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,buttons:type==='mousedown'?1:0}));
      canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:x,clientY:y,deltaY:1}));
    },{x:bounds.x+bounds.width*3/4,y:bounds.y+bounds.height/4});
    const pointers=await page.evaluate(()=>window.viewportInputs.filter(e=>'x' in e).slice(-3));
    assert.deepEqual(pointers.map(e=>[e.x,e.y,e.buttons,e.dz]),[[480,120,1,0],[480,120,0,0],[480,120,0,-120]],
      'Buttons and wheel refresh cursor position without requiring a preceding move');
  }
  await page.screenshot({path:'build/viewport-game.png'});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.waitForFunction(()=>window.nfs5Result,null,{timeout:10000});
  const stopped=await page.evaluate(()=>window.nfs5Result);
  assert.equal(stopped.stopped,true);assert.equal(stopped.error,'Stopped by user');
  assert.equal(await page.getByRole('button',{name:'Run game',exact:true}).isEnabled(),true);
  assert.equal(await page.locator('#stop').isHidden(),true);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('playing')),false);
  await page.setViewportSize({width:1440,height:1000});
  // A new instance must start after all native workers and GPU resources close.
  await page.getByRole('button',{name:'Run original startup',exact:true}).click();
  await page.waitForFunction(()=>window.nfs5Result,null,{timeout:30000});
  assert.equal((await page.evaluate(()=>window.nfs5Result)).stopped,false);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('playing')),false);
  assert.deepEqual(errors,[]);
  console.log('Chrome 4:3 frontend/resize, fitted mouse/button/wheel coordinates and Run game/Stop/restart lifecycle verified');
} finally {
  await browser.close();
}
