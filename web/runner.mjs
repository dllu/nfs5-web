import { loadRuntime } from './runtime.mjs';

self.onmessage = async () => {
  let runtime;
  try {
    runtime = await loadRuntime({ log: text => self.postMessage({ type: 'log', text }) });
    self.postMessage({ type: 'loaded', manifest: runtime.manifest });
    const result = await runtime.runAsync();
    self.postMessage({ type: 'result', result: { ...result, winMainEntered: runtime.seen(0x004b6710), workerEntered: runtime.seen(0x0055f4f0) } });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.stack || String(error) });
  } finally {
    runtime?.dispose();
  }
};
