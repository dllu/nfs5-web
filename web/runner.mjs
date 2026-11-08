import { loadRuntime } from './runtime.mjs';

let runtime;
self.onmessage = async ({ data }) => {
  if (data.type === 'input') { runtime?.input(data); return; }
  if (data.type !== 'start' || runtime) return;
  try {
    runtime = await loadRuntime({ log: text => self.postMessage({ type: 'log', text }), audio: data.audio, display: data.display });
    self.postMessage({ type: 'loaded', manifest: runtime.manifest });
    const result = await runtime.runAsync();
    self.postMessage({ type: 'result', result: { ...result, winMainEntered: runtime.seen(0x004b6710), workerEntered: runtime.seen(0x0055f4f0) } });
  } catch (error) {
    self.postMessage({ type: 'error', error: error.stack || String(error) });
  } finally {
    runtime?.dispose();
  }
};
