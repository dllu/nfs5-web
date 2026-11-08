import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';
globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async p => new Response(await readFile(new URL('../dist/' + p, import.meta.url))) });
const { module, base, manifest } = runtime, output = 0x800000, stack = runtime.memorySize - 0x10000;
const view = new DataView(module.HEAPU8.buffer, base), get = p => view.getUint32(p, true), put = (p, v) => view.setUint32(p, v >>> 0, true);
let calls = 0;
function invoke(name, ...args) {
  args.forEach((v, i) => put(stack + i * 4, v)); module._web_set_register(4, stack);
  assert.equal(module._web_run(manifest.imports.find(item => item.name === name).slot, 2000), 0, module.UTF8ToString(module._web_error()));
  const registers = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
  assert.equal(registers[4], stack + args.length * 4, `${name} stdcall cleanup`); calls++;
  return registers[0];
}
try {
  const desktop = invoke('GetDesktopWindow'); assert.equal(desktop, 0x74000001);
  assert.equal(invoke('GetForegroundWindow'), 0);
  assert.equal(invoke('GetWindowLongA', desktop, -16), 0x90000000);
  assert.equal(invoke('GetWindowLongA', 0, -16), 0); assert.equal(invoke('GetLastError'), 1400);
  module._web_display_size(3840, 2160);
  assert.equal(invoke('GetClientRect', desktop, output), 1);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => get(output + i * 4)), [0,0,3840,2160]);
  assert.equal(invoke('GetSystemMetrics', 0), 3840); assert.equal(invoke('GetSystemMetrics', 1), 2160);
  put(output, 23); put(output + 4, 42);
  assert.equal(invoke('ClientToScreen', desktop, output), 1); assert.equal(invoke('ScreenToClient', desktop, output), 1);
  assert.deepEqual([get(output), get(output + 4)], [23,42]);
  const dc = invoke('GetWindowDC', desktop); assert(dc);
  assert.equal(invoke('GetWindowDC', desktop), dc);
  assert.equal(invoke('GetDeviceCaps', dc, 12), 32); assert.equal(invoke('GetDeviceCaps', dc, 14), 1);
  assert.equal(invoke('GetDeviceCaps', dc, 8), 3840); assert.equal(invoke('GetDeviceCaps', dc, 10), 2160);
  assert.equal(invoke('GetDeviceCaps', dc, 116), 1, 'Refresh rate is reported as unknown, not a measured performance claim');
  assert.equal(invoke('ReleaseDC', desktop, dc), 1); assert.equal(invoke('GetDeviceCaps', dc, 12), 32);
  assert.equal(invoke('ReleaseDC', desktop, dc), 1); assert.equal(invoke('ReleaseDC', desktop, dc), 0);
  assert.equal(invoke('GetDeviceCaps', dc, 12), 0); assert.equal(invoke('GetLastError'), 6);
  assert.equal(invoke('ShowCursor', 0), 0xffffffff); assert.equal(invoke('ShowCursor', 0), 0xfffffffe);
  assert.equal(invoke('ShowCursor', 1), 0xffffffff); assert.equal(invoke('ShowCursor', 1), 0);
  const cursor = invoke('LoadCursorA', 0, 0x7f00);
  assert.equal(invoke('SetCursor', 0), cursor); assert.equal(invoke('SetCursor', cursor), 0);
  assert.equal(invoke('GetStockObject', 4), 0x78000004);
  console.log(`${calls} desktop calls passed (4K geometry, coordinate conversion, DC lifetimes, display queries, cursor state)`);
} finally { runtime.dispose(); }
