class GameAudio extends AudioWorkletProcessor {
  constructor({ processorOptions: { buffer } }) {
    super();
    this.state = new Int32Array(buffer, 0, 8);
    this.samples = new Float32Array(buffer, 32);
    this.capacity = this.samples.length / 2;
  }
  process(inputs, outputs) {
    const output = outputs[0], frames = output[0].length;
    const read = Atomics.load(this.state, 0) >>> 0, write = Atomics.load(this.state, 1) >>> 0;
    const count = Math.min(frames, (write - read) >>> 0);
    let peak = 0;
    for (let frame = 0; frame < frames; frame++) {
      const slot = (read + frame) % this.capacity;
      const left = frame < count ? this.samples[slot * 2] : 0;
      const right = frame < count ? this.samples[slot * 2 + 1] : 0;
      output[0][frame] = left; output[1][frame] = right;
      peak = Math.max(peak, Math.abs(left), Math.abs(right));
    }
    Atomics.store(this.state, 0, (read + count) | 0);
    Atomics.add(this.state, 2, frames - count);
    Atomics.add(this.state, 3, count);
    if (Math.round(peak * 32767) > Atomics.load(this.state, 4)) Atomics.store(this.state, 4, Math.round(peak * 32767));
    return Boolean(Atomics.load(this.state, 5));
  }
}
registerProcessor('nfs5-audio', GameAudio);
