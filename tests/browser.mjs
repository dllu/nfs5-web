import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

// Keep Chromium's profiles, caches, and Playwright's temporary files local.
process.env.TMPDIR = resolve('.cache/tmp');
await mkdir(process.env.TMPDIR, { recursive: true });
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
  await page.waitForFunction(() => window.nfs5Result, { timeout: 60000 });
  const result = await page.evaluate(() => window.nfs5Result);
  assert.equal(result.status, 1);
  assert(result.count > 1);
  assert(result.error.length > 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'build/chrome-startup.png', fullPage: true });
  await writeFile('build/chrome-startup.json', JSON.stringify({ browser: browser.browser().version(), ...result }, null, 2) + '\n');
  console.log(`Chrome ${browser.browser().version()}: ${result.count} original function entries; ${result.error}`);
} finally {
  await browser.close();
}
