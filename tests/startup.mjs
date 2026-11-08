import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const result = { ...await runtime.runAsync(), winMainEntered: runtime.seen(0x004b6710), workerEntered: runtime.seen(0x0055f4f0) };
await writeFile(new URL('../build/startup.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
assert(result.count >= 2099, 'Original startup must reach game initialization after the CRT constructors');
assert.equal(result.first, runtime.manifest.entry);
assert(result.winMainEntered, 'Original WinMain must execute');
assert(result.workerEntered, 'Original worker entry must execute');
assert.equal(result.status, 1, 'Current startup must stop at an explicit missing dependency');
assert(result.error.length > 0, 'Stopped execution must explain the missing dependency');
console.log(`${result.count} original function entries; ${result.error}`);
runtime.dispose();
