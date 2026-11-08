import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const { module, base, manifest } = runtime;
const stack = runtime.memorySize - 0x10000;
let calls = 0;
function invoke(name, ...args) {
  const item = manifest.imports.find(item => item.name === name);
  assert(item, name);
  const memory = new DataView(module.HEAPU8.buffer, base);
  args.forEach((value, i) => memory.setUint32(stack + i * 4, value >>> 0, true));
  module._web_set_register(4, stack);
  assert.equal(module._web_run(item.slot, 3000), 0, module.UTF8ToString(module._web_error()));
  const regs = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
  assert.equal(regs[4], stack + args.length * 4, `${name} stdcall stack`);
  calls++;
  return regs[0];
}
const stats = () => Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_timer_stats(), 5));
try {
  const event = invoke('CreateEventA', 0, 0, 0, 0);
  assert(event);
  assert.equal(invoke('timeSetEvent', 0, 1, event, 0, 0x10), 0);
  assert.equal(invoke('timeSetEvent', 10, 1, event, 0, 0x30), 0);
  const start = performance.now();
  const once = invoke('timeSetEvent', 25, 1, event, 0, 0x10);
  assert(once);
  assert.equal(invoke('WaitForSingleObject', event, 1000), 0);
  assert(performance.now() - start >= 20, 'The event must wait for its scheduled deadline');
  assert.equal(invoke('WaitForSingleObject', event, 0), 258, 'The one-shot event is not repeated');
  assert.equal(invoke('timeKillEvent', once), 11, 'An expired one-shot ID is no longer active');

  const periodic = invoke('timeSetEvent', 8, 1, event, 0, 0x111);
  assert(periodic);
  assert.equal(invoke('WaitForSingleObject', event, 1000), 0);
  assert.equal(invoke('WaitForSingleObject', event, 1000), 0);
  assert.equal(invoke('timeKillEvent', periodic), 0);
  const stopped = stats()[1];
  invoke('Sleep', 25);
  assert.equal(stats()[1], stopped, 'Synchronous cancellation prevents later timer events');
  invoke('ResetEvent', event);
  const canceled = invoke('timeSetEvent', 100, 1, event, 0, 0x110);
  assert(canceled);
  assert.equal(invoke('timeKillEvent', canceled), 0);
  assert.equal(invoke('WaitForSingleObject', event, 120), 258);
  assert.equal(invoke('timeKillEvent', canceled), 11, 'Canceled IDs cannot cancel a new timer');
  const pulse = invoke('timeSetEvent', 30, 1, event, 0, 0x20);
  assert(pulse);
  assert.equal(invoke('WaitForSingleObject', event, 1000), 0, 'Pulse wakes a waiter without storing a signaled state');
  assert.equal(invoke('WaitForSingleObject', event, 0), 258);
  const manual = invoke('CreateEventA', 0, 1, 0, 0);
  const memory = new DataView(module.HEAPU8.buffer, base);
  memory.setUint32(0x800000, event, true); memory.setUint32(0x800004, manual, true);
  assert(invoke('timeSetEvent', 20, 1, event, 0, 0x20));
  assert(invoke('timeSetEvent', 50, 1, manual, 0, 0x10));
  assert.equal(invoke('WaitForMultipleObjectsEx', 2, 0x800000, 1, 100, 0), 258,
    'Wait-all cannot retain a pulse that occurred while its other event was unsignaled');
  assert.equal(invoke('WaitForSingleObject', event, 0), 258);
  assert.equal(invoke('CloseHandle', manual), 1);
  assert.equal(stats()[4], 0);
  assert.equal(invoke('CloseHandle', event), 1);
  console.log(`${calls} multimedia timer calls passed (one-shot deadlines, periodic dispatch, cancellation, stale IDs)`);
} finally {
  runtime.dispose();
}
