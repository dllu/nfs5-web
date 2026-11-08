import createEngine from './engine.js';

export const hex = value => (value >>> 0).toString(16).padStart(8, '0');

export async function loadRuntime({ log = () => {}, read = fetch } = {}) {
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
  function mount(path, { url = '', size = 0, attributes = 32, modified = 0 } = {}) {
    const name = nativeString(path, true), source = nativeString(url);
    try {
      const id = module._web_fs_mount(name, source, size, attributes, modified);
      if (!id) throw new Error(`Unable to mount virtual file ${path}`);
      return id;
    } finally { module._free(name); module._free(source); }
  }
  let assets;
  try { assets = await read('./assets.json'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (assets?.ok) {
    const index = await assets.json();
    if (index.executable !== sha256) throw new Error('Asset index does not match the translated executable');
    for (const item of index.entries) mount('C:\\nfs5\\' + item.path.replaceAll('/', '\\'), {
      ...item, url: item.url ? new URL(item.url, import.meta.url).href : '',
    });
    log(`Mounted ${index.entries.length.toLocaleString()} game files and directories`);
  } else if (assets && assets.status !== 404) throw new Error(`Unable to load assets: HTTP ${assets.status}`);
  function snapshot(status) {
    const registers = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_registers(), 8));
    const count = module._web_trace_count();
    const ring = new Uint32Array(module.HEAPU8.buffer, module._web_trace(), 1024);
    const trace = Array.from({ length: Math.min(count, 1024) }, (_, i) => ring[(Math.max(0, count - 1024) + i) & 1023]);
    const lastImport = new Uint32Array(module.HEAPU8.buffer, module._web_last_import(), 10);
    const timers = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_timer_stats(), 5));
    const input = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_input_stats(), 4));
    const files = Array.from(new Uint32Array(module.HEAPU8.buffer, module._web_fs_stats(), 4));
    return { status, error: module.UTF8ToString(module._web_error()),
      pc: module._web_last_pc(), thread: module._web_error_thread(), first: module._web_first_pc(), count, registers, trace, timers, input, files,
      lastImport: lastImport[0] === 0xffffffff ? null : { ...manifest.imports[lastImport[0]],
        caller: lastImport[1], arguments: Array.from(lastImport.subarray(2)) } };
  }
  return { module, manifest, base, memorySize,
    mount,
    input(event) {
      if ('focus' in event) module._web_input_focus(event.focus ? 1 : 0);
      if ('key' in event) module._web_input_key(event.key, event.down ? 1 : 0);
      if ('dx' in event) module._web_input_mouse(event.dx | 0, event.dy | 0, event.dz | 0, event.buttons >>> 0);
      if ('x' in event) module._web_input_cursor(event.x | 0, event.y | 0);
    },
    seen: address => Boolean(module._web_has_entered(address)),
    async runAsync(milliseconds = 5000) {
      if (module._web_start(manifest.entry, milliseconds)) throw new Error('Unable to start the game worker');
      while (module._web_async_status() === 1) await new Promise(resolve => setTimeout(resolve, 5));
      return snapshot(module._web_async_finish());
    },
    dispose: () => { module._web_shutdown(); module.PThread.terminateAllThreads(); },
    run: (milliseconds = 2000) => snapshot(module._web_run(manifest.entry, milliseconds)),
    call: (entry, ...args) => snapshot(module._web_call(entry, ...Array.from({ length: 4 }, (_, i) => args[i] ?? 0))),
  };
}

function checked(response) {
  if (!response.ok) throw new Error(`Unable to load ${response.url}: HTTP ${response.status}`);
  return response;
}
