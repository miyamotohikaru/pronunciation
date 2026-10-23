/**
 * AudioWorklet processor that only copies microphone samples out of the audio thread.
 * All DSP happens in CapturePipeline on the main thread (so the same TS runs in Node tests).
 *
 * Kept as a source string so it needs no bundler support for worklets:
 * - served same-origin by src/app/worklets/mic-capture.js/route.ts (works under
 *   COEP: require-corp and a future `script-src 'self'` CSP), or
 * - loaded from a Blob URL (same-origin by construction) when no URL is given.
 *
 * Messages to the main thread: { type: "audio", frame, data, live } — `frame` is the context
 * frame (currentFrame) of data[0], so the receiver can detect gaps; `data` is transferred;
 * `live` = the input had channels (false while the source is still warming up — Chrome skips
 * a few process() calls then, which shows up as a harmless startup gap).
 * Message from the main thread: { type: "stop" } → flush the partial chunk and end processing.
 */

export const CAPTURE_PROCESSOR_NAME = "pt-mic-capture";

export const CAPTURE_WORKLET_SOURCE = `/* pronunciation trainer — microphone capture worklet */
class PtMicCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.size = Math.max(128, o.chunkFrames | 0 || 256);
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.start = -1;
    this.live = false;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "stop") {
        this.flush();
        this.alive = false;
      }
    };
  }
  flush() {
    if (this.n === 0) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ type: "audio", frame: this.start, data: out, live: this.live }, [out.buffer]);
    this.n = 0;
    this.start = -1;
    this.live = false;
  }
  process(inputs) {
    if (!this.alive) return false;
    const input = inputs[0];
    const ch = input && input.length > 0 ? input[0] : null;
    // no channels yet (source not flowing): record silence so the timeline stays continuous
    const len = ch ? ch.length : 128;
    let i = 0;
    while (i < len) {
      if (this.n === 0) this.start = currentFrame + i;
      if (ch) this.live = true;
      const k = Math.min(len - i, this.size - this.n);
      if (ch) this.buf.set(ch.subarray(i, i + k), this.n);
      else this.buf.fill(0, this.n, this.n + k);
      this.n += k;
      i += k;
      if (this.n === this.size) this.flush();
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR_NAME)}, PtMicCapture);
`;
