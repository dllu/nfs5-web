import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const { module, base, manifest } = runtime;
const memory = new DataView(module.HEAPU8.buffer, base), data = 0x800000, stack = runtime.memorySize - 0x10000;
const get = p => memory.getUint32(p, true), put = (p, v) => memory.setUint32(p, v >>> 0, true);
let calls = 0;
function call(address, ...args) {
  args.forEach((v, i) => put(stack + i * 4, v)); module._web_set_register(4, stack);
  assert.equal(module._web_run(address, 3000), 0, module.UTF8ToString(module._web_error()));
  const regs = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
  assert.equal(regs[4], stack + args.length * 4, 'COM stdcall cleanup'); calls++;
  return regs[0];
}
const invoke = (name, ...args) => call(manifest.imports.find(item => item.name === name).slot, ...args);
const method = (object, slot, ...args) => call(get(get(object) + slot * 4), object, ...args);
function guid(p, first, second) {
  put(p, first); put(p + 4, 0x11cf0000 | second); put(p + 8, 0x4544c7bf); put(p + 12, 0x5453);
}
function format(p, keyboard) {
  const count = keyboard ? 256 : 7, objects = p + 32;
  [24, 16, 2, keyboard ? 256 : 16, count, objects].forEach((v, i) => put(p + i * 4, v));
  for (let i = 0; i < count; i++) {
    const offset = keyboard ? i : i < 3 ? i * 4 : 12 + i - 3;
    const type = keyboard ? 4 | i << 8 : i < 3 ? 1 | i << 8 : 4 | (i - 3) << 8;
    [0, offset, type, 0].forEach((v, field) => put(objects + i * 16 + field * 4, v));
  }
}
try {
  assert.equal(invoke('DirectInputCreateA', 0x400000, 0x500, data, 0), 0);
  const root = get(data);
  guid(data + 16, 0xdeadbeef, 0xaa8a);
  assert.equal(method(root, 0, data + 16, data + 32), 0x80004002);
  assert.equal(get(data + 32), 0);
  // Real original stdcall callbacks: 00444110 returns true; 00444120 returns
  // false. Their independent execution counts verify enum filtering/stopping.
  let before = module._web_trace_count(); module._web_set_register(0, 0);
  assert.equal(method(root, 4, 0, 0x444110, 0x1234, 0), 0);
  assert.equal(module._web_trace_count() - before, 2);
  before = module._web_trace_count(); module._web_set_register(0, 0);
  assert.equal(method(root, 4, 0, 0x444120, 0x1234, 0), 0);
  assert.equal(module._web_trace_count() - before, 1);
  before = module._web_trace_count();
  assert.equal(method(root, 4, 4, 0x444110, 0, 0), 0);
  assert.equal(module._web_trace_count(), before, 'No joystick is exposed');

  guid(data + 64, 0x6f1d2b61, 0xd5a0);
  assert.equal(method(root, 3, data + 64, data + 32, 0), 0);
  const keyboard = get(data + 32), state = data + 8192;
  assert.equal(method(keyboard, 7), 0x80070057, 'Acquisition needs a data format');
  format(data + 256, true);
  assert.equal(method(keyboard, 11, data + 256), 0);
  assert.equal(method(keyboard, 13, 0, 6), 0); // foreground, nonexclusive
  guid(data + 96, 0x5944e682, 0xc92e);
  assert.equal(method(keyboard, 0, data + 96, data + 32), 0);
  assert.equal(get(data + 32), keyboard);
  assert.equal(method(keyboard, 2), 1);
  before = module._web_trace_count(); module._web_set_register(0, 0);
  assert.equal(method(keyboard, 4, 0x444110, 0x1234, 4), 0);
  assert.equal(module._web_trace_count() - before, 256);
  // Original routine 00424060 copies the callback descriptor size and the
  // first byte of its context into ECX's destination. This checks both args.
  put(data + 128, 0x42); module._web_set_register(1, data + 160);
  assert.equal(method(keyboard, 4, 0x424060, data + 128, 4), 0);
  assert.equal(get(data + 160), 316); assert.equal(memory.getUint8(data + 164), 0x42);
  assert.equal(method(keyboard, 7), 0); assert.equal(method(keyboard, 7), 1);
  assert.equal(method(keyboard, 11, data + 256), 0x800700aa);
  module._web_input_key(0xc8, 1); module._web_input_key(0x11, 1);
  assert.equal(method(keyboard, 9, 256, state), 0);
  const keys = module.HEAPU8.subarray(base + state, base + state + 256);
  assert.equal(keys[0xc8], 0x80); assert.equal(keys[0x11], 0x80);
  assert.equal(Array.from(keys).filter(Boolean).length, 2);
  assert.equal(invoke('GetAsyncKeyState', 0x26), 0x8001);
  assert.equal(invoke('GetAsyncKeyState', 0x26), 0x8000);
  module._web_input_focus(0);
  assert.equal(method(keyboard, 9, 256, state), 0x8007001e);
  assert.equal(method(keyboard, 7), 0x80070005);
  module._web_input_focus(1); assert.equal(method(keyboard, 7), 0);
  assert.equal(method(keyboard, 9, 256, state), 0);
  assert(Array.from(module.HEAPU8.subarray(base + state, base + state + 256)).every(v => v === 0));

  assert.equal(method(keyboard, 8), 0);
  const property = data + 7000; [20, 16, 0, 0, 4].forEach((v, i) => put(property + i * 4, v));
  assert.equal(method(keyboard, 6, 1, property), 0);
  const event = invoke('CreateEventA', 0, 0, 0, 0);
  assert.equal(method(keyboard, 12, event), 0); assert.equal(method(keyboard, 7), 0);
  module._web_input_key(0x11, 1); module._web_input_key(0x11, 1);
  module._web_input_key(0xc8, 1); module._web_input_key(0x11, 0); module._web_input_key(0xc8, 0);
  assert.equal(invoke('WaitForSingleObject', event, 0), 0);
  const count = data + 7100, events = data + 7200;
  put(count, 2); assert.equal(method(keyboard, 10, 16, events, count, 1), 0); assert.equal(get(count), 2);
  put(count, 0xffffffff); assert.equal(method(keyboard, 10, 16, events, count, 0), 0); assert.equal(get(count), 4);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => [get(events + i * 16), get(events + i * 16 + 4)]), [[0x11,128],[0xc8,128],[0x11,0],[0xc8,0]]);
  for (let i = 0; i < 5; i++) { module._web_input_key(0x11, 1); module._web_input_key(0x11, 0); }
  put(count, 100); assert.equal(method(keyboard, 10, 16, events, count, 0), 1); assert.equal(get(count), 4);
  put(count, 100); assert.equal(method(keyboard, 10, 16, events, count, 0), 0); assert.equal(get(count), 0);
  assert.equal(method(keyboard, 8), 0); assert.equal(method(keyboard, 2), 0);
  assert.equal(invoke('CloseHandle', event), 1);

  guid(data + 64, 0x6f1d2b60, 0xd5a0);
  assert.equal(method(root, 3, data + 64, data + 32, 0), 0);
  const mouse = get(data + 32); format(data + 256, false);
  assert.equal(method(mouse, 11, data + 256), 0);
  put(property + 16, 1); assert.equal(method(mouse, 6, 2, property), 0);
  assert.equal(method(mouse, 7), 0);
  module._web_input_mouse(7, -3, 120, 3);
  assert.equal(method(mouse, 7), 1, 'Reacquiring an acquired device must preserve movement');
  assert.equal(method(mouse, 9, 16, state), 0);
  assert.deepEqual([memory.getInt32(state,true),memory.getInt32(state+4,true),memory.getInt32(state+8,true)], [7,-3,120]);
  assert.equal(memory.getUint8(state + 12), 128); assert.equal(memory.getUint8(state + 13), 128);
  assert.equal(method(mouse, 9, 16, state), 0);
  assert.equal(get(state), 0); assert.equal(get(state + 4), 0); assert.equal(get(state + 8), 0);
  assert.equal(method(mouse, 2), 0); assert.equal(method(root, 2), 0);
  console.log(`${calls} DirectInput calls passed (original enumeration callbacks, COM/device ABI, immediate/buffered keys, mouse deltas, focus loss)`);
} finally {
  runtime.dispose();
}
