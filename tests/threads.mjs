import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const { module, base, manifest } = runtime;
const data = 0x800000, output = data + 0x1000, stack = runtime.memorySize - 0x10000;
const memory = () => new DataView(module.HEAPU8.buffer, base);
let calls = 0;
function callAt(address, args) {
  args.forEach((value, i) => memory().setUint32(stack + i * 4, value >>> 0, true));
  module._web_set_register(4, stack);
  assert.equal(module._web_run(address, 3000), 0, module.UTF8ToString(module._web_error()));
  const regs = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
  assert.equal(regs[4], stack + args.length * 4);
  calls++;
  return regs[0];
}
const slot = name => manifest.imports.find(item => item.dll === 'KERNEL32.dll' && item.name === name).slot;
const invoke = (name, ...args) => callAt(slot(name), args);
function string(text) { module.HEAPU8.set(Buffer.from(text + '\0'), base + data); return data; }
try {
  const kernel = invoke('GetModuleHandleA', string('KERNEL32'));
  const getExit = invoke('GetProcAddress', kernel, string('GetExitCodeThread'));
  assert(getExit);
  const index = invoke('TlsAlloc');
  assert.equal(invoke('TlsSetValue', index, 0xc0ffee), 1);
  module._web_set_register(3, 0x12345678); module._web_set_register(6, 0x23456789); module._web_set_register(7, 0x3456789a);
  for (const [offset, value] of [[0x33c, 2], [0x340, 4], [0x344, 6], [0x3b8, 3], [0x3bc, 5], [0x3c0, 7]]) memory().setFloat32(data + offset, value, true);
  assert.equal(runtime.call(0x40ef30, data).status, 0);
  assert.equal(module._web_float_result(), 68);

  // TlsGetValue is itself a one-argument stdcall routine, so it can serve as
  // an independent worker entry and report its return value as the exit code.
  const thread = invoke('CreateThread', 0, 0, slot('TlsGetValue'), index, 4, output);
  assert(thread);
  const tid = memory().getUint32(output, true);
  assert(tid > 1);
  assert.equal(invoke('GetCurrentThreadId'), 1);
  assert.equal(callAt(getExit, [thread, output + 4]), 1);
  assert.equal(memory().getUint32(output + 4, true), 259);
  assert.equal(invoke('WaitForSingleObject', thread, 0), 258);
  assert.equal(invoke('ResumeThread', thread), 1);
  invoke('SetLastError', 0x4321);
  assert.equal(invoke('WaitForSingleObject', thread, 1000), 0);
  assert.equal(invoke('GetLastError'), 0x4321, 'Worker LastError cannot overwrite the parent');
  assert.equal(callAt(getExit, [thread, output + 4]), 1);
  assert.equal(memory().getUint32(output + 4, true), 0, 'New worker TLS starts empty');
  assert.equal(invoke('TlsGetValue', index), 0xc0ffee);
  assert.equal(module._web_float_result(), 68, 'x87 registers survive a worker switch');
  const registers = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8));
  assert.equal(registers[3], 0x12345678); assert.equal(registers[6], 0x23456789); assert.equal(registers[7], 0x3456789a);
  assert.equal(invoke('CloseHandle', thread), 1);

  const event = invoke('CreateEventA', 0, 0, 0, 0);
  const signaler = invoke('CreateThread', 0, 0, slot('SetEvent'), event, 4, output);
  assert(signaler);
  assert.equal(invoke('ResumeThread', signaler), 1);
  assert.equal(invoke('WaitForSingleObject', event, 1000), 0, 'A real worker must signal the waiting parent');
  assert.equal(invoke('WaitForSingleObject', signaler, 1000), 0);
  assert.equal(callAt(getExit, [signaler, output + 4]), 1);
  assert.equal(memory().getUint32(output + 4, true), 1);
  const start = performance.now();
  assert.equal(invoke('WaitForSingleObject', event, 5), 258);
  assert(performance.now() - start >= 4, 'A finite wait must wait for its deadline');
  assert.equal(invoke('CloseHandle', signaler), 1); assert.equal(invoke('CloseHandle', event), 1);
  // All seven guest workers repeatedly release/reacquire the machine while
  // sleeping, then complete one wait-all without changing parent CPU/TLS state.
  const contenders=[];
  for(let i=0;i<7;i++) {
    const handle=invoke('CreateThread',0,0,slot('Sleep'),30,0,output);
    assert(handle);contenders.push(handle);memory().setUint32(output+0x200+i*4,handle,true);
  }
  assert.equal(invoke('WaitForMultipleObjectsEx',7,output+0x200,1,2000,0),0,
    'Every contending native worker completes');
  assert.equal(invoke('TlsGetValue',index),0xc0ffee,'Parent TLS survives seven contenders');
  assert.equal(module._web_float_result(),68,'Parent x87 state survives repeated contended handoffs');
  for(const handle of contenders)assert.equal(invoke('CloseHandle',handle),1);
  // Seven original compute-only searches must share the VM without an API
  // sleep inside their loops. A cyclic non-sentinel node keeps every search
  // active until the host publishes the value being sought.
  const root=data+0x400,node=data+0x440,sentinel=data+0x420;
  for(const [at,value] of [[0x69cae4,root],[root,sentinel],[sentinel,node],[node,node],[node+8,0]])memory().setUint32(at,value,true);
  const spinners=[];
  for(let i=0;i<7;i++) {
    const handle=invoke('CreateThread',0,0,0x5292d0,1,0,output);
    assert(handle);spinners.push(handle);memory().setUint32(output+0x200+i*4,handle,true);
  }
  await new Promise(resolve=>setTimeout(resolve,20));
  for(const handle of spinners) {
    assert.equal(callAt(getExit,[handle,output+4]),1);
    assert.equal(memory().getUint32(output+4,true),259,'Compute worker remains active before its value is published');
  }
  Atomics.store(new Uint32Array(module.HEAPU8.buffer),(base+node+8)/4,1);
  assert.equal(invoke('WaitForMultipleObjectsEx',7,output+0x200,1,2000,0),0,'Every original compute worker makes progress');
  for(const handle of spinners) {
    assert.equal(callAt(getExit,[handle,output+4]),1);
    assert.equal(memory().getUint32(output+4,true),node,'Each worker retains its own search registers');
    assert.equal(invoke('CloseHandle',handle),1);
  }
  assert.equal(invoke('TlsGetValue',index),0xc0ffee);assert.equal(module._web_float_result(),68);
  console.log(`${calls} thread calls passed (suspended startup, TLS/LastError/register isolation, completion, event waits, seven-worker sleep/compute contention)`);
} finally {
  runtime.dispose();
}
