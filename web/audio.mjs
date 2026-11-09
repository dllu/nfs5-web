// One producer (the application Worker), one real-time AudioWorklet consumer.
// Only the producer enters Wasm; the audio callback never waits on a VM lock.
export async function openAudio({waitForResume=true}={}) {
  const context = new AudioContext({ latencyHint: 'interactive' });
  try {
    const resume = context.resume();
    const buffer = new SharedArrayBuffer(32 + 4096 * 2 * 4);
    const state = new Int32Array(buffer, 0, 8); Atomics.store(state, 5, 1);
    await context.audioWorklet.addModule(new URL('./audio-worklet.mjs', import.meta.url));
    const node = new AudioWorkletNode(context, 'nfs5-audio', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { buffer } });
    node.connect(context.destination); if(waitForResume)await resume;else resume.catch(()=>{});
    return {
      configuration: { buffer, rate: context.sampleRate },
      resume: () => context.resume(),
      stats: () => ({ rendered: Atomics.load(state, 3) >>> 0, missing: Atomics.load(state, 2) >>> 0, peak: Atomics.load(state, 4) / 32767, state: context.state }),
      async close() { Atomics.store(state, 5, 0); node.disconnect(); await context.close(); },
    };
  } catch (error) { await context.close(); throw error; }
}

export function attachAudio(module, { buffer, rate }) {
  const state = new Int32Array(buffer, 0, 8), samples = new Float32Array(buffer, 32), capacity = samples.length / 2;
  const pointer = module._malloc(512 * 2 * 4);
  function pump() {
    const read = Atomics.load(state, 0) >>> 0; let write = Atomics.load(state, 1) >>> 0;
    const wanted = Math.max(0, 1024 - ((write - read) >>> 0));
    for (let remaining = wanted; remaining > 0;) {
      const count = Math.min(512, remaining);
      if (module._web_audio_mix(pointer, count, rate) !== count) throw new Error('Audio mixer rejected the output format');
      const mixed = new Float32Array(module.HEAPU8.buffer, pointer, count * 2);
      for (let i = 0; i < count; i++) {
        const slot = (write + i) % capacity;
        samples[slot * 2] = mixed[i * 2]; samples[slot * 2 + 1] = mixed[i * 2 + 1];
      }
      write = (write + count) >>> 0; Atomics.store(state, 1, write | 0); remaining -= count;
    }
  }
  pump(); const timer = setInterval(pump, 4);
  return () => { clearInterval(timer); module._free(pointer); };
}
