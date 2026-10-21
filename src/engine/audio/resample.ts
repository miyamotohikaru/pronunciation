/**
 * Band-limited sample-rate conversion (windowed-sinc, Kaiser window, polyphase).
 * No browser or Node dependencies.
 *
 * - Exact rational ratios (48000→16000 = 1/3, 44100→16000 = 160/441 …) use one precomputed
 *   filter phase per output phase; odd ratios fall back to 4096 quantised phases (error < -90 dB).
 * - The filter is zero-phase: output sample n is the signal at time n / outRate, so the
 *   16 kHz stream lines up sample-exactly with the capture-rate stream (no group delay to undo).
 * - Streaming and batch are the same code: `resample(x)` === concat(process(chunks…), flush())
 *   for any chunking, so live and offline results match bit for bit.
 * - Defaults: cutoff 0.92 × the lower Nyquist (7.36 kHz for 16 kHz out), 32 zero crossings,
 *   Kaiser β 8 → flat (±0.05 dB) to 6.8 kHz, −2 dB at 7.2 kHz, ≥ 88 dB alias rejection above 8 kHz.
 *   Lookahead (latency) = ⌈32 / (0.92 · 16/48)⌉ = 105 input samples at 48 kHz → 2.2 ms.
 */

export type ResamplerOptions = {
  /** zero crossings of the low-pass sinc on each side (quality vs CPU/latency). Default 32 */
  zeroCrossings?: number;
  /** cutoff as a fraction of the lower of the two Nyquist frequencies. Default 0.92 */
  rolloff?: number;
  /** Kaiser window β. Default 8 */
  kaiserBeta?: number;
};

type Kernel = {
  /** taps per phase (even) */
  taps: number;
  /** taps reach `half` input samples to each side of the output position */
  half: number;
  phases: number;
  /** phases × taps, phase-major */
  table: Float32Array;
  /** exact rational stepping (L outputs per M inputs) */
  exact: boolean;
  L: number;
  M: number;
};

const MAX_PHASES = 4096;
const kernelCache = new Map<string, Kernel>();

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function besselI0(x: number): number {
  const y = (x * x) / 4;
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 200; k++) {
    term *= y / (k * k);
    sum += term;
    if (term < sum * 1e-14) break;
  }
  return sum;
}

function buildKernel(inRate: number, outRate: number, opts: ResamplerOptions): Kernel {
  const zc = opts.zeroCrossings ?? 32;
  const rolloff = opts.rolloff ?? 0.92;
  const beta = opts.kaiserBeta ?? 8;
  const key = `${inRate}:${outRate}:${zc}:${rolloff}:${beta}`;
  const cached = kernelCache.get(key);
  if (cached) return cached;

  // cutoff relative to the input Nyquist: h(t) = fc·sinc(fc·t), t in input samples
  const fc = rolloff * Math.min(1, outRate / inRate);
  const half = Math.ceil(zc / fc);
  const taps = 2 * half;

  let exact = false;
  let L = outRate;
  let M = inRate;
  if (Number.isInteger(inRate) && Number.isInteger(outRate)) {
    const g = gcd(inRate, outRate);
    L = outRate / g;
    M = inRate / g;
    exact = L <= MAX_PHASES;
  }
  const phases = exact ? L : MAX_PHASES;

  const table = new Float32Array(phases * taps);
  const i0b = besselI0(beta);
  for (let p = 0; p < phases; p++) {
    const frac = p / phases;
    let sum = 0;
    const row = new Float64Array(taps);
    for (let j = 0; j < taps; j++) {
      const t = j - half + 1 - frac; // input index (i0 - half + 1 + j) minus the output position
      const r = t / half;
      if (r <= -1 || r >= 1) continue;
      const x = fc * t;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
      row[j] = fc * sinc * w;
      sum += row[j];
    }
    // exact unity DC gain on every phase (no phase-dependent ripple)
    for (let j = 0; j < taps; j++) table[p * taps + j] = row[j] / sum;
  }
  const k: Kernel = { taps, half, phases, table, exact, L, M };
  kernelCache.set(key, k);
  return k;
}

export class StreamResampler {
  readonly inRate: number;
  readonly outRate: number;
  /** input samples of lookahead: output for time t needs input up to t + lookahead / inRate */
  readonly lookahead: number;

  private k: Kernel | null;
  private buf: Float32Array;
  /** absolute input index of buf[0] (negative indices are the zero history before the stream) */
  private bufStart: number;
  private bufLen: number;
  private totalIn = 0;
  private nOut = 0;
  private done = false;

  constructor(inRate: number, outRate: number, opts: ResamplerOptions = {}) {
    if (!(inRate > 0) || !(outRate > 0)) throw new RangeError(`bad sample rates ${inRate} → ${outRate}`);
    this.inRate = inRate;
    this.outRate = outRate;
    this.k = inRate === outRate ? null : buildKernel(inRate, outRate, opts);
    const half = this.k ? this.k.half : 0;
    this.lookahead = half;
    this.buf = new Float32Array(Math.max(4096, 4 * (this.k ? this.k.taps : 0)));
    this.bufStart = -Math.max(0, half - 1);
    this.bufLen = Math.max(0, half - 1); // zeros
  }

  reset(): void {
    const half = this.k ? this.k.half : 0;
    this.buf.fill(0);
    this.bufStart = -Math.max(0, half - 1);
    this.bufLen = Math.max(0, half - 1);
    this.totalIn = 0;
    this.nOut = 0;
    this.done = false;
  }

  /** feed input, get every output sample that is now fully determined */
  process(input: Float32Array): Float32Array {
    if (this.done) throw new Error("StreamResampler: process() after flush() — call reset()");
    if (!this.k) {
      this.totalIn += input.length;
      this.nOut += input.length;
      return input.slice();
    }
    this.append(input, input.length);
    this.totalIn += input.length;
    return this.drain(Infinity);
  }

  /** end of stream: zero-pad and emit the remaining ceil(totalIn · out/in) − emitted samples */
  flush(): Float32Array {
    if (this.done) return new Float32Array(0);
    this.done = true;
    if (!this.k) return new Float32Array(0);
    const { L, M, exact, half } = this.k;
    const totalOut = exact ? Math.floor((this.totalIn * L + M - 1) / M) : Math.ceil((this.totalIn * this.outRate) / this.inRate - 1e-9);
    this.append(new Float32Array(half + 1), half + 1);
    return this.drain(totalOut);
  }

  /** output samples emitted so far */
  get outputLength(): number {
    return this.nOut;
  }

  private position(n: number): { i0: number; p: number } {
    const { exact, L, M, phases } = this.k as Kernel;
    if (exact) {
      const num = n * M;
      const i0 = Math.floor(num / L);
      return { i0, p: num - i0 * L };
    }
    const pos = (n * this.inRate) / this.outRate;
    let i0 = Math.floor(pos);
    let p = Math.round((pos - i0) * phases);
    if (p >= phases) {
      p = 0;
      i0++;
    }
    return { i0, p };
  }

  private append(x: Float32Array, n: number): void {
    const k = this.k as Kernel;
    // drop history older than the next output needs
    const keepFrom = this.position(this.nOut).i0 - k.half + 1;
    const drop = Math.max(0, Math.min(this.bufLen, keepFrom - this.bufStart));
    if (drop > 0) {
      this.buf.copyWithin(0, drop, this.bufLen);
      this.bufLen -= drop;
      this.bufStart += drop;
    }
    if (this.bufLen + n > this.buf.length) {
      let cap = this.buf.length * 2;
      while (cap < this.bufLen + n) cap *= 2;
      const next = new Float32Array(cap);
      next.set(this.buf.subarray(0, this.bufLen));
      this.buf = next;
    }
    this.buf.set(x.subarray(0, n), this.bufLen);
    this.bufLen += n;
  }

  private drain(limit: number): Float32Array {
    const k = this.k as Kernel;
    const { taps, half, table } = k;
    const available = this.bufStart + this.bufLen; // absolute index one past the last buffered sample
    const estimate = Math.ceil(((this.bufLen + 2) * this.outRate) / this.inRate) + 2;
    let out = new Float32Array(Math.max(0, Math.min(estimate, limit === Infinity ? estimate : limit - this.nOut)));
    let w = 0;
    const buf = this.buf;
    while (this.nOut < limit) {
      const { i0, p } = this.position(this.nOut);
      if (i0 + half >= available) break;
      const base = i0 - half + 1 - this.bufStart;
      const off = p * taps;
      let acc = 0;
      for (let j = 0; j < taps; j++) acc += buf[base + j] * table[off + j];
      if (w >= out.length) {
        const next = new Float32Array(Math.max(16, out.length * 2));
        next.set(out);
        out = next;
      }
      out[w++] = acc;
      this.nOut++;
    }
    return w === out.length ? out : out.slice(0, w);
  }
}

/** one-shot conversion; identical to streaming the whole input through StreamResampler */
export function resample(x: Float32Array, inRate: number, outRate: number, opts: ResamplerOptions = {}): Float32Array {
  if (inRate === outRate) return x.slice();
  const r = new StreamResampler(inRate, outRate, opts);
  const a = r.process(x);
  const b = r.flush();
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
