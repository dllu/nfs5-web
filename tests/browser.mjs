import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

// Keep Chromium's profiles, caches, and Playwright's temporary files local.
process.env.TMPDIR = resolve('.cache/tmp');
await mkdir(process.env.TMPDIR, { recursive: true });
const fixture = Uint8Array.from({ length: 131195 }, (_, i) => (i * 37 + (i >>> 8)) & 255);
await writeFile('dist/fs-browser-fixture.bin', fixture);
const browser = await chromium.launchPersistentContext(resolve('.cache/chrome-test'), {
  executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-breakpad',
    '--crash-dumps-dir=' + resolve('.cache/crashes')],
  viewport: { width: 1440, height: 1000 },
});
try {
  const page = await browser.newPage();
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
    assert.deepEqual(errors, []);
    console.log('Chrome keyboard events reached Wasm DirectInput; focus loss and native HTTP range reads verified');
  } finally {
    await page.evaluate(() => window.inputHarness.close());
  }
} finally {
  await browser.close();
}
