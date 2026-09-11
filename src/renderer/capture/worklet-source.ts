/**
 * AudioWorklet processor source, kept as a string so it can be loaded from a blob URL
 * without a separate build entry. Converts float32 frames to PCM16 chunks of
 * `chunkSize` samples and reports RMS per chunk.
 */
export const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.chunkSize = opts.chunkSize || 1280;
    this.buf = new Int16Array(this.chunkSize);
    this.idx = 0;
    this.sumSq = 0;
    this.count = 0;
    this.peak = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const n = input[0].length;
    const chans = input.length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < chans; c++) s += input[c][i];
      s /= chans;
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this.buf[this.idx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sumSq += s * s;
      this.count++;
      const a = s < 0 ? -s : s;
      if (a > this.peak) this.peak = a;
      if (this.idx >= this.chunkSize) {
        const out = this.buf.buffer.slice(0);
        this.port.postMessage({ type: 'chunk', pcm: out, rms: Math.sqrt(this.sumSq / this.count), peak: this.peak }, [out]);
        this.idx = 0;
        this.sumSq = 0;
        this.count = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;
