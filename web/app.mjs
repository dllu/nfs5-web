const hex = value => (value >>> 0).toString(16).padStart(8, '0');

const status = document.querySelector('#status');
const output = document.querySelector('#output');
const button = document.querySelector('#boot');
const write = text => { output.textContent += text + '\n'; };

button.addEventListener('click', async () => {
  button.disabled = true;
  output.textContent = '';
  status.textContent = 'Loading translated engine…';
  delete window.nfs5Result;
  let worker;
  try {
    if (!crossOriginIsolated) throw new Error('This build requires cross-origin isolation. Use npm run serve or serve dist with its _headers configuration.');
    worker = new Worker(new URL('./runner.mjs', import.meta.url), { type: 'module' });
    const result = await new Promise((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message));
      worker.onmessage = ({ data }) => {
        if (data.type === 'log') write(data.text);
        if (data.type === 'error') reject(new Error(data.error));
        if (data.type === 'loaded') {
          const m = data.manifest;
          write(`${m.executable} · SHA-256 ${m.sha256}`);
          write(`${m.functions.toLocaleString()} translated functions · ${m.instructions.toLocaleString()} decoded instructions`);
          write(`${m.imports.length} Windows imports · entry 0x${hex(m.entry)}\n`);
          status.textContent = 'Executing original startup code…';
        }
        if (data.type === 'result') resolve(data.result);
      };
      worker.postMessage({ type: 'start' });
    });
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
    worker?.terminate();
    button.disabled = false;
  }
});
