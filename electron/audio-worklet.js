class PcmWorklet extends AudioWorkletProcessor {
  constructor() { super(); this.queue = []; this.readOffset = 0; this.port.onmessage = ({ data }) => { this.queue.push(new Int16Array(data)); }; }
  process(_inputs, outputs) { const output = outputs[0]; const left = output[0]; const right = output[1] || output[0]; for (let index = 0; index < left.length; index += 1) { if (!this.queue.length) { left[index] = 0; right[index] = 0; continue; } const chunk = this.queue[0]; const sampleIndex = this.readOffset * 2; left[index] = chunk[sampleIndex] / 32768; right[index] = chunk[sampleIndex + 1] / 32768; this.readOffset += 1; if (this.readOffset * 2 >= chunk.length) { this.queue.shift(); this.readOffset = 0; } } return true; }
}
registerProcessor('pcm-worklet', PcmWorklet);