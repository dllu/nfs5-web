import createEngine from './engine.js';
import { openStorage } from './storage.mjs';
import { attachAudio } from './audio.mjs';
import { attachGraphics } from './graphics.mjs';
import {openingMovies,verokImage,softwareViewport} from './config.mjs';

export const hex = value => (value >>> 0).toString(16).padStart(8, '0');
const soundBufferFields=['address','flags','bytes','rate','channels','bits','playing','looping','playCursor','writeCursor'];

export async function loadRuntime({ log = () => {}, read = fetch, persist = true, audio, display, canvas, onResize, pace, intro, softwarePixelLimit=0 } = {}) {
  const [module, manifest, response] = await Promise.all([
    createEngine({ print: log, printErr: log }),
    read('./manifest.json').then(checked).then(r => r.json()),
    read('./game.exe').then(checked),
  ]);
  const executable = new Uint8Array(await response.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', executable));
  const sha256 = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== manifest.sha256) throw new Error('Executable does not match this translation. Run prepare and build again.');
  const base = module._web_init();
  if (!base) throw new Error('Unable to allocate guest memory');
  const memorySize = module._web_memory_size();
  display ??= typeof innerWidth === 'number' ? {
    width: Math.round(innerWidth * (globalThis.devicePixelRatio || 1)),
    height: Math.round(innerHeight * (globalThis.devicePixelRatio || 1)),
  } : null;
  if (display) module._web_display_size(display.width, display.height);
  const pe = new DataView(executable.buffer).getUint32(0x3c, true);
  const headerSize = new DataView(executable.buffer).getUint32(pe + 24 + 60, true);
  module.HEAPU8.set(executable.subarray(0, headerSize), base + manifest.imageBase);
  // PE sections retain their original virtual addresses inside a separate arena.
  for (const section of manifest.sections) {
    const start = section.raw_offset;
    const end = start + section.raw_size;
    if (end > executable.length) throw new Error(`Truncated PE section ${section.name}`);
    const address = manifest.imageBase + section.virtual_address;
    if (address + Math.max(section.virtual_size, section.raw_size) > memorySize) {
      throw new Error(`PE section ${section.name} exceeds guest memory`);
    }
    module.HEAPU8.set(executable.subarray(start, end), base + address);
  }
  for (const [index, item] of manifest.imports.entries()) {
    new DataView(module.HEAPU8.buffer).setUint32(base + item.slot, 0xf0000000 + index * 16, true);
  }
  const ansiCodes = new Map(Array.from({ length: 256 }, (_, i) => [new TextDecoder('windows-1252').decode(Uint8Array.of(i)), i]));
  function nativeString(text, ansi = false) {
    const bytes = ansi ? Uint8Array.from(Array.from(text + '\0', character => {
      if (!ansiCodes.has(character)) throw new Error(`Filename cannot be represented in Windows-1252: ${text}`);
      return ansiCodes.get(character);
    })) : new TextEncoder().encode(text + '\0'), pointer = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, pointer); return pointer;
  }
  function mount(path, { url = null, size = 0, attributes = 32, modified = 0 } = {}) {
    const name = nativeString(path, true), source = url === null ? 0 : nativeString(url);
    try {
      const id = module._web_fs_mount(name, source, size, attributes, modified);
      if (!id) throw new Error(`Unable to mount virtual file ${path}`);
      return id;
    } finally { module._free(name); module._free(source); }
  }
  let assets,startupConfig;
  try { assets = await read('./assets.json'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (assets?.ok) {
    const index = await assets.json();
    if (index.executable !== sha256) throw new Error('Asset index does not match the translated executable');
    for (const item of index.entries) mount('C:\\nfs5\\' + item.path.replaceAll('/', '\\'), {
      ...item, url: item.url ? new URL(item.url, import.meta.url).href : '',
    });
    log(`Mounted ${index.entries.length.toLocaleString()} game files and directories`);
    const ini=index.entries.find(item=>item.path.toLowerCase()==='nfs5.ini');
    if(ini?.url){const response=await read(ini.url);if(response.ok)startupConfig=new Uint8Array(await response.arrayBuffer());}
  } else if (assets && assets.status !== 404) throw new Error(`Unable to load assets: HTTP ${assets.status}`);
  function changes() {
    const pointer = module._web_fs_snapshot();
    if (!pointer) throw new Error('Unable to snapshot local file changes');
    const view = new DataView(module.HEAPU8.buffer), revision = view.getUint32(pointer + 4, true), count = view.getUint32(pointer + 8, true);
    const records = []; let cursor = pointer + 12;
    for (let i = 0; i < count; i++) {
      const fields = Array.from({ length: 7 }, (_, i) => view.getUint32(cursor + i * 4, true)); cursor += 28;
      const path = new TextDecoder('windows-1252').decode(Uint8Array.from(module.HEAPU8.subarray(cursor, cursor + fields[5] - 1)));
      cursor += (fields[5] + 3) & ~3;
      const data = fields[6] === 0xffffffff ? null : Uint8Array.from(module.HEAPU8.subarray(cursor, cursor + fields[6]));
      if (data) cursor += (data.length + 3) & ~3;
      records.push({ path, live: Boolean(fields[0]), attributes: fields[1], size: fields[2], modifiedLow: fields[3], modifiedHigh: fields[4], data });
    }
    return { revision, records };
  }
  let storage;
  try {
    storage = persist ? await openStorage(sha256) : null;
    if (storage) {
      const records = await storage.load();
      records.sort((a, b) => a.path.split('\\').length - b.path.split('\\').length);
      for (const record of records) {
        if(record.path.toLowerCase()==='c:\\nfs5\\nfs5.ini')startupConfig=record.live?(record.data??startupConfig):null;
        if (!record.live) {
          const path = nativeString(record.path, true);
          try { if (!module._web_fs_remove(path)) throw new Error(`Unable to restore deletion: ${record.path}`); }
          finally { module._free(path); }
          continue;
        }
        const id = mount(record.path, record);
        if (record.data) {
          const pointer = module._malloc(Math.max(1, record.data.length));
          try {
            module.HEAPU8.set(record.data, pointer);
            if (!module._web_fs_store(id, pointer, record.data.length)) throw new Error(`Unable to restore local file: ${record.path}`);
          } finally { module._free(pointer); }
        }
        module._web_fs_restore_metadata(id, record.modifiedLow, record.modifiedHigh);
      }
      module._web_fs_acknowledge(changes().revision);
      if (records.length) log(`Restored ${records.length} browser-local file changes`);
    }
    if (!module._web_registry_restore()) throw new Error('Invalid persisted application registry');
    intro??=openingMovies(startupConfig);
    if(sha256===verokImage)module._web_intro_config(intro?1:0);
  } catch (error) { storage?.close(); module.PThread.terminateAllThreads(); throw error; }
  let saving = Promise.resolve(), disposed = false;
  function checkpoint() {
    if (!storage || disposed) return Promise.resolve();
    const operation = saving.catch(() => {}).then(async () => {
      if (disposed) return;
      const { revision, records } = changes();
      await storage.save(records);
      module._web_fs_acknowledge(revision);
    });
    saving = operation; return operation;
  }
  const storageTimer = storage ? setInterval(() => checkpoint().catch(error => log(`Local save failed: ${error.message}`)), 1000) : null;
  const detachAudio = audio ? attachAudio(module, audio) : null;
  let graphics;
  try { graphics=canvas?await attachGraphics(module,canvas,{onResize,pace,frontendSize:display?{...display}:null}):null; }
  catch(error) {clearInterval(storageTimer);detachAudio?.();storage?.close();module.PThread.terminateAllThreads();throw error;}
  const originalDisplay=display;
  if(graphics?.renderer.info.software&&softwarePixelLimit&&display) {
    display=softwareViewport(display,softwarePixelLimit);
    module._web_display_size(display.width,display.height);
  }
  const reducedResolution=!!(display&&originalDisplay&&(display.width!==originalDisplay.width||display.height!==originalDisplay.height));
  function snapshot(status) {
    const registers = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8));
    const count = module._web_trace_count();
    const ring = new Uint32Array(module.HEAPU8.buffer, module._web_trace(), 1024);
    const trace = Array.from({ length: Math.min(count, 1024) }, (_, i) => ring[(Math.max(0, count - 1024) + i) & 1023]);
    const lastImport = new Uint32Array(module.HEAPU8.buffer, module._web_last_import(), 10);
    const timers = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_timer_stats(), 5));
    const input = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_input_stats(), 4));
    const files = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_fs_stats(), 4));
    const soundPointer=module._web_audio_stats();
    const sound = Array.from(new Uint32Array(module.HEAPU8.buffer, soundPointer, 4));
    const soundBuffers=Array.from({length:sound[1]},(_,i)=>{
      const values=new Uint32Array(module.HEAPU8.buffer,soundPointer+16+i*40,10);
      return Object.fromEntries(soundBufferFields.map((field,j)=>[field,values[j]]));
    });
    const rendering=Array.from(new Uint32Array(module.HEAPU8.buffer,module._web_gpu_stats(),5));
    const mappings=Array.from(new Uint32Array(module.HEAPU8.buffer,module._web_mapping_stats(),6));
    const error=module.UTF8ToString(module._web_error());
    const exited=Boolean(module._web_process_exited());
    return { status, error, stopped:error==='Stopped by user',exited,exitCode:exited?module._web_exit_code()>>>0:null,intro,introSkipped:module._web_intro_skipped(),
      pc: module._web_last_pc(), thread: module._web_error_thread(), first: module._web_first_pc(), count, registers, trace, timers, input, files, mappings, sound, soundBuffers, rendering,
      lastImport: lastImport[0] === 0xffffffff ? null : { ...manifest.imports[lastImport[0]],
        caller: lastImport[1], arguments: Array.from(lastImport.subarray(2)) } };
  }
  async function executeAsync(entry,milliseconds) {
    if(module._web_start(entry,milliseconds))throw new Error('Unable to start the game worker');
    while(module._web_async_status()===1)await new Promise(resolve=>setTimeout(resolve,5));
    const status=module._web_async_finish();await graphics?.settle();const result=snapshot(status);
    await checkpoint();return result;
  }
  return { module, manifest, base, memorySize, graphics, display, reducedResolution,
    mount,
    checkpoint,
    input(event) {
      if ('focus' in event) module._web_input_focus(event.focus ? 1 : 0);
      if ('key' in event) module._web_input_key(event.key, event.down ? 1 : 0);
      if ('x' in event) module._web_input_cursor(event.x | 0, event.y | 0);
      if ('dx' in event) module._web_input_mouse(event.dx | 0, event.dy | 0, event.dz | 0, event.buttons >>> 0);
    },
    seen: address => Boolean(module._web_has_entered(address)),
    async runAsync(milliseconds = 5000) {
      return executeAsync(manifest.entry,milliseconds);
    },
    stop:()=>Boolean(module._web_stop()),
    async invokeAsync(entry,args=[],milliseconds=5000) {
      if(module._web_async_status() || args.length>64)throw new Error('Invalid concurrent guest invocation');
      const stack=memorySize-0x10000,view=new DataView(module.HEAPU8.buffer,base);
      args.forEach((value,i)=>view.setUint32(stack+i*4,value>>>0,true));module._web_set_register(4,stack);
      return executeAsync(entry,milliseconds);
    },
    dispose: () => {
      if(disposed)return;
      disposed=true;
      clearInterval(storageTimer);graphics?.close();detachAudio?.();storage?.close();
      module._web_shutdown();module.PThread.terminateAllThreads();
    },
    run: (milliseconds = 2000) => snapshot(module._web_run(manifest.entry, milliseconds)),
    call: (entry, ...args) => snapshot(module._web_call(entry, ...Array.from({ length: 4 }, (_, i) => args[i] ?? 0))),
  };
}

function checked(response) {
  if (!response.ok) throw new Error(`Unable to load ${response.url}: HTTP ${response.status}`);
  return response;
}
