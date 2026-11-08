import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { loadRuntime } from '../dist/runtime.mjs';

globalThis.crypto ??= webcrypto;
const runtime = await loadRuntime({ read: async path => new Response(await readFile(new URL('../dist/' + path, import.meta.url))) });
const { module, base, manifest } = runtime;
const memory = () => new DataView(module.HEAPU8.buffer, base);
const input = 0x800000, output = 0x801000, stack = runtime.memorySize - 0x10000;
let checks = 0;
function invoke(name, ...args) {
  const item = manifest.imports.find(item => ['KERNEL32.dll','WINMM.dll'].includes(item.dll) && item.name === name);
  assert(item, `Missing test import ${name}`);
  args.forEach((value, i) => memory().setUint32(stack + i * 4, value >>> 0, true));
  module._web_set_register(4, stack);
  assert.equal(module._web_run(item.slot, 2000), 0, module.UTF8ToString(module._web_error()));
  const registers = new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8);
  assert.equal(registers[4], stack + args.length * 4, `${name} stdcall stack cleanup`);
  checks++;
  return registers[0];
}
function string(text, address = input) {
  module.HEAPU8.set(Buffer.from(text + '\0', 'latin1'), base + address);
  return address;
}

// Compare every CP1252 code point against the independent ICU-backed decoder.
memory().setUint32(output, 148, true);
assert.equal(invoke('GetVersionExA', output), 1);
assert.deepEqual(Array.from({ length: 5 }, (_, i) => memory().getUint32(output + i * 4, true)), [148,4,1,0,1]);
memory().setUint32(output, 156, true); assert.equal(invoke('GetVersionExA', output), 0);
assert.equal(invoke('GetLastError'), 87);
invoke('GlobalMemoryStatus',output);
assert.equal(memory().getUint32(output,true),32);
assert.equal(memory().getUint32(output+8,true),runtime.memorySize);
const available=memory().getUint32(output+12,true),heap=1;
assert.equal(memory().getUint32(output+4,true),Math.floor((runtime.memorySize-available)*100/runtime.memorySize));
const memoryProbe=invoke('HeapAlloc',heap,0,1024*1024);
invoke('GlobalMemoryStatus',output);assert.equal(available-memory().getUint32(output+12,true),1024*1024);
assert.equal(invoke('HeapFree',heap,0,memoryProbe),1);
invoke('GlobalMemoryStatus',output);assert.equal(memory().getUint32(output+12,true),available);
const tickBefore=invoke('GetTickCount');assert(tickBefore<10000,'Guest uptime starts near zero');
invoke('QueryPerformanceCounter',output);const counterBefore=memory().getBigUint64(output,true);
await new Promise(resolve=>setTimeout(resolve,25));
const nativeTick=await runtime.invokeAsync(manifest.imports.find(i=>i.name==='GetTickCount').slot,[]);
assert.equal(nativeTick.status,0,nativeTick.error);
assert(nativeTick.registers[0]>=tickBefore+20&&nativeTick.registers[0]<tickBefore+2000,'Native pthread shares the guest clock origin');checks++;
const tickAfter=invoke('GetTickCount');assert(tickAfter>=nativeTick.registers[0]&&tickAfter<tickBefore+2000);
invoke('QueryPerformanceCounter',output);const elapsedMicros=Number(memory().getBigUint64(output,true)-counterBefore);
assert(elapsedMicros>=20000&&Math.abs(elapsedMicros/1000-(tickAfter-tickBefore))<100);
const patchVersion=await runtime.invokeAsync(manifest.imports.find(i=>i.dll==='NFS5.dll'&&i.name==='GetVersion').slot,[]);
assert.equal(patchVersion.status,0,patchVersion.error);assert.equal(patchVersion.registers[0],0x60001);checks++;
assert.equal(invoke('LoadLibraryA',string('GIMME.DLL')),0);assert.equal(invoke('GetLastError'),193);
assert.equal(invoke('FreeLibrary',0),0);assert.equal(invoke('GetLastError'),6);
const resident=invoke('LoadLibraryA',string('KERNEL32'));assert(resident);assert.equal(invoke('FreeLibrary',resident),1);

// SYSTEMTIME has eight packed WORDs in local calendar time, including Sunday=0.
// Bound by independent JS Date samples, so midnight/year changes are valid too.
async function checkCalendarTime(name,native) {
  module.HEAPU8.fill(0xa5,base+output-2,base+output+18);
  invoke('SetLastError',1234);
  const before=Date.now();
  if(native) {
    const call=await runtime.invokeAsync(manifest.imports.find(i=>i.name===name).slot,[output]);
    assert.equal(call.status,0,call.error);checks++;
  } else invoke(name,output);
  const after=Date.now(),fields=Array.from({length:8},(_,i)=>memory().getUint16(output+i*2,true));
  const [year,month,weekday,day,hour,minute,second,millis]=fields;
  const utc=name==='GetSystemTime',date=new Date(utc?Date.UTC(year,month-1,day,hour,minute,second,millis):new Date(year,month-1,day,hour,minute,second,millis));
  assert(date.getTime()>=before&&date.getTime()<=after,`${name} SYSTEMTIME ${fields} lies within host wall-clock samples ${before}..${after} (got ${date.getTime()})`);
  assert.equal(utc?date.getUTCDay():date.getDay(),weekday);assert(millis<1000);
  assert.equal(memory().getUint16(output-2,true),0xa5a5);assert.equal(memory().getUint16(output+16,true),0xa5a5);
  if(!native)assert.equal(invoke('GetLastError'),1234);
}
for(const name of ['GetLocalTime','GetSystemTime'])for(const native of [false,true])await checkCalendarTime(name,native);
module.HEAPU8.fill(0xa5,base+output-4,base+output+176);
const zoneState=invoke('GetTimeZoneInformation',output);
assert([0,1,2].includes(zoneState));
const bias=memory().getInt32(output,true),adjustment=memory().getInt32(output+(zoneState===2?168:84),true);
assert.equal(bias+adjustment,new Date().getTimezoneOffset(),'Windows bias is UTC minus local time');
assert.equal(memory().getUint32(output-4,true),0xa5a5a5a5);assert.equal(memory().getUint32(output+172,true),0xa5a5a5a5);
for(const nameOffset of [4,88])assert.equal(memory().getUint16(output+nameOffset+62,true),0,'Time-zone names terminate within 32 WCHARs');
if(zoneState) {
  for(const [position,before,after] of [[68,bias+memory().getInt32(output+168,true),bias],[152,bias,bias+memory().getInt32(output+168,true)]]) {
    const [year,month,weekday,day,hour,minute,second,millis]=Array.from({length:8},(_,i)=>memory().getUint16(output+position+i*2,true));
    assert.equal(year,new Date().getFullYear());
    const instant=Date.UTC(year,month-1,day,hour,minute,second,millis)+before*60000;
    assert.equal(new Date(instant-1).getTimezoneOffset(),before);assert.equal(new Date(instant).getTimezoneOffset(),after);
    assert.equal(new Date(instant-before*60000).getUTCDay(),weekday);
  }
} else {
  assert.equal(memory().getUint16(output+70,true),0);assert.equal(memory().getUint16(output+154,true),0);
}
const nativeZone=await runtime.invokeAsync(manifest.imports.find(i=>i.name==='GetTimeZoneInformation').slot,[input]);
assert.equal(nativeZone.status,0,nativeZone.error);assert.equal(nativeZone.registers[0],zoneState);checks++;
assert.deepEqual(module.HEAPU8.slice(base+input,base+input+172),module.HEAPU8.slice(base+output,base+output+172));
assert.equal(invoke('GetTimeZoneInformation',0),0xffffffff);assert.equal(invoke('GetLastError'),87);
// Exercise the actual CRT routine that blocked race startup, including its
// local/UTC fields, DST query and seconds-since-1970 conversion.
for(const address of [0x6afd18,0x6afd30])invoke('InitializeCriticalSection',address);
const secondsBefore=Math.floor(Date.now()/1000),calendar=runtime.call(0x5a17eb,output),secondsAfter=Math.floor(Date.now()/1000);
assert.equal(calendar.status,0,calendar.error);assert(calendar.registers[0]>=secondsBefore&&calendar.registers[0]<=secondsAfter);
assert.equal(memory().getUint32(output,true),calendar.registers[0]);checks++;
for(const address of [0x6afd18,0x6afd30])invoke('DeleteCriticalSection',address);

const environment = pointer => {
  const entries = []; let p = pointer;
  while (memory().getUint16(p, true)) {
    let text = '';
    while (memory().getUint16(p, true)) { text += String.fromCharCode(memory().getUint16(p, true)); p += 2; }
    entries.push(text); p += 2;
  }
  return entries;
};
const empty = invoke('GetEnvironmentStringsW');
assert.deepEqual(environment(empty), []); assert.equal(memory().getUint32(empty, true), 0);
assert.equal(invoke('FreeEnvironmentStringsW', empty), 1);
assert.equal(invoke('FreeEnvironmentStringsW', empty), 0);
assert.equal(invoke('SetEnvironmentVariableA', string('Z_TEST'), string('last', input + 256)), 1);
assert.equal(invoke('SetEnvironmentVariableA', string('A_TEST'), string('caf\xe9', input + 256)), 1);
const before = invoke('GetEnvironmentStringsW');
assert.deepEqual(environment(before), ['A_TEST=caf\xe9','Z_TEST=last']);
assert.equal(invoke('SetEnvironmentVariableA', string('a_test'), string('new', input + 256)), 1);
assert.deepEqual(environment(before), ['A_TEST=caf\xe9','Z_TEST=last'], 'Environment blocks are immutable snapshots');
const after = invoke('GetEnvironmentStringsW');
assert.deepEqual(environment(after), ['a_test=new','Z_TEST=last']);
assert.equal(invoke('FreeEnvironmentStringsA', after), 0, 'A/W frees must match the snapshot encoding');
assert.equal(invoke('FreeEnvironmentStringsW', before), 1); assert.equal(invoke('FreeEnvironmentStringsW', after), 1);
assert.equal(invoke('SetEnvironmentVariableA', string('A_TEST'), string('caf\xe9', input + 256)), 1);
const oem = invoke('GetEnvironmentStrings');
assert.deepEqual(Array.from(module.HEAPU8.subarray(base + oem, base + oem + 12)), [65,95,84,69,83,84,61,99,97,102,130,0]);
assert.equal(invoke('FreeEnvironmentStringsA', oem), 1);
assert.equal(invoke('SetEnvironmentVariableA', string('A_TEST'), 0), 1);
assert.equal(invoke('SetEnvironmentVariableA', string('A_TEST'), 0), 0);
assert.equal(invoke('GetLastError'), 203);
assert.equal(invoke('SetEnvironmentVariableA', string('bad=name'), string('x', input + 256)), 0);
assert.equal(invoke('GetLastError'), 87);
const wideName = 'Unicode', wideValue = '\u20ac';
for (const [p,s] of [[input,wideName],[input+256,wideValue]]) {
  Array.from(s + '\0').forEach((c, i) => memory().setUint16(p + i * 2, c.charCodeAt(0), true));
}
assert.equal(invoke('SetEnvironmentVariableW', input, input + 256), 1);
const unicode = invoke('GetEnvironmentStringsW');
assert.deepEqual(environment(unicode), ['Unicode=\u20ac','Z_TEST=last']);
assert.equal(invoke('FreeEnvironmentStringsW', unicode), 1);

function compare(a, b, flags = 0, locale = 0x409) {
  return invoke('CompareStringA', locale, flags, string(a), -1, string(b, input + 256), -1);
}
assert.equal(compare('alpha','bravo'), 1); assert.equal(compare('Bravo','alpha'), 3);
assert.equal(compare('Porsche','porsche',1), 2);
assert.equal(compare('caf\xe9','cafe',2), 2);
assert.notEqual(compare('caf\xe9','cafe'), 2);
assert.equal(compare('Porsche!','Porsche',4), 2);
assert.equal(compare('Porsche\x80','Porsche',4), 2);
assert.equal(compare('coop','co-op'), 3);
assert.equal(compare('a','a',0x80000000), 0); assert.equal(invoke('GetLastError'), 1004);
assert.equal(compare('a','a',0,0x411), 0); assert.equal(invoke('GetLastError'), 87);

module.HEAPU8.set(Uint8Array.from({ length: 256 }, (_, i) => i), base + input);
assert.equal(invoke('MultiByteToWideChar', 1252, 0, input, 256, 0, 0), 256);
assert.equal(invoke('MultiByteToWideChar', 1252, 0, input, 256, output, 256), 256);
const decoded = new TextDecoder('windows-1252').decode(Uint8Array.from({ length: 256 }, (_, i) => i));
for (let i = 0; i < 256; i++) assert.equal(memory().getUint16(output + i * 2, true), decoded.charCodeAt(i));
assert.equal(invoke('WideCharToMultiByte', 1252, 0, output, 256, input + 512, 0, 0, 0), 256);
assert.equal(invoke('WideCharToMultiByte', 1252, 0, output, 256, input + 512, 256, 0, output + 1024), 256);
assert.deepEqual(module.HEAPU8.subarray(base + input + 512, base + input + 768), Uint8Array.from({ length: 256 }, (_, i) => i));
assert.equal(memory().getUint32(output + 1024, true), 0);
// Insufficient buffers must fail without writing their output.
module.HEAPU8.fill(0xa5, base + output, base + output + 8);
assert.equal(invoke('MultiByteToWideChar', 1252, 0, input, 4, output, 1), 0);
assert.equal(invoke('GetLastError'), 122);
assert.deepEqual(Array.from(module.HEAPU8.subarray(base + output, base + output + 8)), Array(8).fill(0xa5));

const text = 'Porsche \xe9lan \x8akoda';
string(text);
assert.equal(invoke('LCMapStringA', 0x409, 0x200, input, -1, output, 256), text.length + 1);
const mapped = new TextDecoder('windows-1252').decode(module.HEAPU8.subarray(base + output, base + output + text.length));
assert.equal(mapped, new TextDecoder('windows-1252').decode(Buffer.from(text, 'latin1')).toUpperCase());
string('A9\t \xe9\0');
assert.equal(invoke('GetStringTypeA', 0x409, 1, input, 6, output), 1);
assert.deepEqual(Array.from({ length: 6 }, (_, i) => memory().getUint16(output + i * 2, true)), [0x181, 0x84, 0x68, 0x48, 0x102, 0x20]);
assert.equal(invoke('GetStringTypeW', 1, input, 1, output), 0);
assert.equal(invoke('GetLastError'), 120);

const kernel = invoke('GetModuleHandleA', string('KERNEL32'));
assert(kernel);
assert.equal(invoke('GetModuleHandleA', string('kernel32.DLL')), kernel);
const pointer = invoke('GetProcAddress', kernel, string('QueryPerformanceFrequency'));
assert(pointer);
memory().setUint32(stack, output, true);
module._web_set_register(4, stack);
assert.equal(module._web_run(pointer, 2000), 0);
assert.equal(memory().getBigUint64(output, true), 1000000n);
assert.equal(invoke('GetProcAddress', kernel, string('IsProcessorFeaturePresent')), 0);
assert.equal(invoke('GetLastError'), 127);
assert.equal(invoke('GetModuleHandleA', string('missing.dll')), 0);
assert.equal(invoke('GetLastError'), 126);
assert.equal(invoke('GetOEMCP'), 437);

// The actual game probes a 128 MiB reservation and immediately releases it.
assert.equal(invoke('VirtualAlloc', 0, 0, 0x3000, 4), 0);
assert.equal(invoke('GetLastError'), 87);
for (let i = 0; i < 2; i++) {
  const address = invoke('VirtualAlloc', 0, 128 * 1024 * 1024, 0x3000, 4);
  assert(address && address % 65536 === 0);
  memory().setUint32(address, 0x506f7273, true);
  assert.equal(invoke('VirtualFree', address, 0, 0x8000), 1);
}
const allocation = invoke('HeapAlloc', 1, 8, 64);
const guard = invoke('HeapAlloc', 1, 0, 64);
module.HEAPU8.fill(0x5a, base + allocation, base + allocation + 64);
const resized = invoke('HeapReAlloc', 1, 8, allocation, 256);
assert(resized);
assert.deepEqual(Array.from(module.HEAPU8.subarray(base + resized, base + resized + 64)), Array(64).fill(0x5a));
assert.deepEqual(Array.from(module.HEAPU8.subarray(base + resized + 64, base + resized + 256)), Array(192).fill(0));
assert.equal(invoke('HeapSize', 1, 0, resized), 256);
assert.equal(invoke('HeapFree', 1, 0, allocation), 0);
assert.equal(invoke('HeapFree', 1, 0, guard), 1);
assert.equal(invoke('HeapFree', 1, 0, resized), 1);
console.log(`${checks} Windows service calls passed (version, memory status, shared clocks, local calendar time, environment, CP1252/OEM, collation, imports, allocation reuse/realloc)`);
