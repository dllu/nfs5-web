import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';
globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const { module, base, manifest } = runtime, data = 0x800000, stack = runtime.memorySize - 0x10000;
const view = new DataView(module.HEAPU8.buffer, base), put = (p, v) => view.setUint32(p, v >>> 0, true), get = p => view.getUint32(p, true);
let calls = 0;
function call(address, args) {
  args.forEach((v, i) => put(stack + i * 4, v)); module._web_set_register(4, stack);
  assert.equal(module._web_run(address, 2000), 0, module.UTF8ToString(module._web_error()));
  const registers = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
  assert.equal(registers[4], stack + args.length * 4, 'DirectSound stdcall cleanup'); calls++;
  return registers[0];
}
const method = (self, slot, ...args) => call(get(get(self) + slot * 4), [self, ...args]);
function format(p, channels = 1, bits = 16, rate = 44100) {
  view.setUint16(p, 1, true); view.setUint16(p + 2, channels, true); put(p + 4, rate); put(p + 8, rate * channels * bits / 8);
  view.setUint16(p + 12, channels * bits / 8, true); view.setUint16(p + 14, bits, true); view.setUint16(p + 16, 0, true);
}
const mixed = module._malloc(4096 * 2 * 4);
function mix(frames, rate = 44100) {
  assert.equal(module._web_audio_mix(mixed, frames, rate), frames);
  return Array.from(new Float32Array(module.HEAPU8.buffer, mixed, frames * 2));
}
const close = self => assert.equal(method(self, 2), 0);
try {
  const create = manifest.imports.find(item => item.dll === 'DSOUND.dll' && item.name === 'ordinal_1').slot;
  assert.equal(call(create, [0, data, 0]), 0); const device = get(data);
  assert.equal(call(create, [0, data + 4, 1]), 0x80040110); assert.equal(get(data + 4), 0);
  assert.equal(call(manifest.imports.find(item => item.dll === 'DSOUND.dll' && item.name === 'ordinal_6').slot, [0, data + 4, 0]), 0x88780078);
  assert.equal(get(data + 4), 0);
  put(data + 16, 96); assert.equal(method(device, 4, data + 16), 0); assert.equal(get(data + 36), 0, 'No hardware voices advertised');
  const desc = data + 256, wave = desc + 64, output = data + 1024;
  [20,1,0,0,0].forEach((v, i) => put(desc + i * 4, v));
  assert.equal(method(device, 3, desc, output, 0), 0); const primary = get(output);
  format(wave, 2); assert.equal(method(primary, 14, wave), 0x88780046);
  assert.equal(method(device, 6, 0x74000001, 2), 0); assert.equal(method(primary, 14, wave), 0);
  assert.equal(method(primary, 13, 0), 0x80070057);
  assert.equal(method(primary, 11, 0, 4, output, output + 4, output + 8, output + 12, 0), 0x88780032);
  close(primary);

  format(wave); [20,0xe8,8,0,wave].forEach((v, i) => put(desc + i * 4, v));
  assert.equal(method(device, 3, desc, output, 0), 0); const buffer = get(output);
  assert.equal(method(buffer, 11, 6, 6, output, output + 4, output + 8, output + 12, 0), 0);
  const wrapped = [get(output),get(output+4),get(output+8),get(output+12)];
  assert.equal(wrapped[1], 2); assert.equal(wrapped[3], 4); assert.equal(wrapped[0] - wrapped[2], 6);
  assert.equal(method(buffer, 19, wrapped[0], 1, wrapped[2], wrapped[3]), 0x80070057);
  assert.equal(method(buffer, 19, ...wrapped), 0);
  assert.equal(method(buffer, 19, ...wrapped), 0x80070057);
  assert.equal(method(buffer, 11, 0, 0, output, output + 4, output + 8, output + 12, 2), 0);
  const locked = [get(output),get(output+4),get(output+8),get(output+12)];
  [-32768,-16384,0,16384].forEach((v, i) => view.setInt16(locked[0] + i * 2, v, true));
  assert.equal(method(buffer, 19, ...locked), 0);
  assert.equal(method(buffer, 12, 0, 0, 0), 0);
  assert.deepEqual(mix(4), [-1,-1,-.5,-.5,0,0,.5,.5]);
  assert.equal(method(buffer, 9, output), 0); assert.equal(get(output), 0, 'One-shot finishes after its last sample');
  assert.deepEqual(mix(1), [0,0]);
  assert.equal(method(buffer, 12, 0, 0, 1), 0);
  assert.deepEqual(mix(6), [-1,-1,-.5,-.5,0,0,.5,.5,-1,-1,-.5,-.5]);
  assert.equal(method(buffer, 4, output, output + 4), 0); assert.equal(get(output), 4);
  assert.equal(method(buffer, 18), 0); assert.equal(method(buffer, 13, 0), 0);
  assert.equal(method(buffer, 17, 22050), 0); assert.equal(method(buffer, 12, 0, 0, 0), 0);
  assert.deepEqual(mix(8), [-1,-1,-.75,-.75,-.5,-.5,-.25,-.25,0,0,.25,.25,.5,.5,.5,.5]);
  assert.equal(method(buffer, 17, 0), 0); assert.equal(method(buffer, 8, output), 0); assert.equal(get(output), 44100);
  assert.equal(method(buffer, 15, 1), 0x80070057); assert.equal(method(buffer, 15, -2000), 0);
  assert.equal(method(buffer, 16, -10000), 0); assert.equal(method(buffer, 13, 0), 0); assert.equal(method(buffer, 12, 0, 0, 0), 0);
  const quiet = mix(1); assert(Math.abs(quiet[0] + .1) < 1e-6); assert.equal(quiet[1], 0);
  assert.equal(method(buffer, 18), 0); assert.equal(method(buffer, 15, 0), 0); assert.equal(method(buffer, 16, 0), 0);
  assert.equal(method(device, 5, buffer, output), 0); const duplicate = get(output);
  close(buffer); assert.equal(method(duplicate, 12, 0, 0, 0), 0);
  assert.deepEqual(mix(4), [-1,-1,-.5,-.5,0,0,.5,.5], 'Duplicate retains shared PCM after source release'); close(duplicate);

  format(wave, 1, 8); [20,0xe8,4,0,wave].forEach((v, i) => put(desc + i * 4, v));
  assert.equal(method(device, 3, desc, output, 0), 0); const eight = get(output);
  assert.equal(method(eight, 11, 0, 4, output, output + 4, output + 8, output + 12, 0), 0);
  const eightLock = [get(output),get(output+4),get(output+8),get(output+12)];
  module.HEAPU8.set([0,64,128,192], base + eightLock[0]);
  assert.equal(method(eight, 19, ...eightLock), 0); assert.equal(method(eight, 12, 0, 0, 0), 0);
  assert.deepEqual(mix(4), [-1,-1,-.5,-.5,0,0,.5,.5]); close(eight);
  format(wave, 2); [20,0xe8,4,0,wave].forEach((v, i) => put(desc + i * 4, v));
  assert.equal(method(device, 3, desc, output, 0), 0); const stereo = get(output);
  assert.equal(method(stereo, 11, 0, 4, output, output + 4, output + 8, output + 12, 0), 0);
  const stereoLock = [get(output),get(output+4),get(output+8),get(output+12)];
  view.setInt16(stereoLock[0], 24576, true); view.setInt16(stereoLock[0] + 2, -24576, true);
  assert.equal(method(stereo, 19, ...stereoLock), 0); assert.equal(method(device, 5, stereo, output), 0);
  const voice = get(output);
  assert.equal(method(stereo, 12, 0, 0, 0), 0); assert.equal(method(voice, 12, 0, 0, 0), 0);
  assert.deepEqual(mix(1), [1,-1], 'Stereo voices retain channel separation and clip their sum');
  close(stereo); close(voice); close(device);
  assert.deepEqual(Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_audio_stats(), 3)), [0,0,0]);
  console.log(`${calls} DirectSound calls passed (PCM samples, wrap locks, one-shot/loop playback, cursors, resampling, gains, shared duplicates)`);
} finally { module._free(mixed); runtime.dispose(); }
