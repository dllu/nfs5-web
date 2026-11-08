import { loadRuntime, hex } from './runtime.mjs';

const status = document.querySelector('#status');
const output = document.querySelector('#output');
const button = document.querySelector('#boot');
const write = text => { output.textContent += text + '\n'; };

button.addEventListener('click', async () => {
  button.disabled = true;
  output.textContent = '';
  status.textContent = 'Loading translated engine…';
  try {
    const runtime = await loadRuntime({ log: write });
    const m = runtime.manifest;
    write(`${m.executable} · SHA-256 ${m.sha256}`);
    write(`${m.functions.toLocaleString()} translated functions · ${m.instructions.toLocaleString()} decoded instructions`);
    write(`${m.imports.length} Windows imports · entry 0x${hex(m.entry)}\n`);
    status.textContent = 'Executing original startup code…';
    // Let the loading state paint before a synchronous Wasm call.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const result = { ...runtime.run(), winMainEntered: runtime.seen(0x004b6710) };
    window.nfs5Result = result;
    status.textContent = result.status ? 'Execution stopped at a porting dependency' : 'Startup function returned';
    write(result.error || 'Returned successfully');
    write(`\n${result.count.toLocaleString()} function entries. Recent calls:`);
    write(result.trace.slice(-32).map(pc => '0x' + hex(pc)).join(' → '));
    write('\n' + ['EAX', 'ECX', 'EDX', 'EBX', 'ESP', 'EBP', 'ESI', 'EDI']
      .map((name, index) => `${name} 0x${hex(result.registers[index])}`).join('  '));
  } catch (error) {
    status.textContent = 'Unable to start the runtime';
    write(error.stack || String(error));
  } finally {
    button.disabled = false;
  }
});
