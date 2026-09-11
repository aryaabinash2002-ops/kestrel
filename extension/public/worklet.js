// AudioWorklet: float32 → PCM16 chunks (mono, 80 ms at 16 kHz)
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.chunkSize = opts.chunkSize || 1280;
    this.buf = new Int16Array(this.chunkSize);
    this.idx = 0;
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
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this.buf[this.idx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.idx >= this.chunkSize) {
        const out = this.buf.buffer.slice(0);
        this.port.postMessage({ type: 'chunk', pcm: out }, [out]);
        this.idx = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
