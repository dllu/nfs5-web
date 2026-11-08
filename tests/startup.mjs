import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const result = runtime.run();
await writeFile(new URL('../build/startup.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
assert(result.count > 0, 'Original entry point must execute');
assert.equal(result.trace[0], runtime.manifest.entry);
assert.equal(result.status, 1, 'Current startup must stop at an explicit missing dependency');
assert(result.error.length > 0, 'Stopped execution must explain the missing dependency');
console.log(`${result.count} original function entries; ${result.error}`);
