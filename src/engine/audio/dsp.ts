/**
 * Small DSP helpers. No browser or Node dependencies (runs in the page, in Node tests and at build time).
 */

export const DB_FLOOR = -100;

/** linear amplitude → dBFS, floored at DB_FLOOR (never -Infinity) */
export function toDb(linear: number): number {
  return linear > 1e-5 ? 20 * Math.log10(linear) : DB_FLOOR;
}

export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

/** RMS of x[start, end) */
export function rms(x: ArrayLike<number>, start = 0, end = x.length): number {
  const a = Math.max(0, start);
  const b = Math.min(x.length, end);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
}

/** dBFS of the RMS of x[start, end) */
export function rmsDb(x: ArrayLike<number>, start = 0, end = x.length): number {
  return toDb(rms(x, start, end));
}

export function peak(x: ArrayLike<number>, start = 0, end = x.length): number {
  let p = 0;
  for (let i = Math.max(0, start), b = Math.min(x.length, end); i < b; i++) {
    const v = x[i] < 0 ? -x[i] : x[i];
    if (v > p) p = v;
  }
  return p;
}

/**
 * Second-order IIR section (RBJ cookbook), transposed direct form II, Float64 state.
 * Used as an 80–100 Hz high-pass in front of the VAD so rumble and DC don't hold the gate open.
 */
export class Biquad {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private z1 = 0;
  private z2 = 0;

  private constructor(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /** normalised coefficients (a0 = 1) */
  static fromCoefficients(b0: number, b1: number, b2: number, a1: number, a2: number): Biquad {
    return new Biquad(b0, b1, b2, 1, a1, a2);
  }

  static highpass(sampleRate: number, freq: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * freq) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    return new Biquad((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  static lowpass(sampleRate: number, freq: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * freq) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    return new Biquad((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  /** filter `input` into `output` (may be the same array) */
  process(input: ArrayLike<number>, output: Float32Array | Float64Array, start = 0, end = input.length): void {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = start; i < end; i++) {
      const x = input[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      output[i] = y;
    }
    // flush denormals
    this.z1 = Math.abs(z1) < 1e-25 ? 0 : z1;
    this.z2 = Math.abs(z2) < 1e-25 ? 0 : z2;
  }
}

/** Append-only Float32 buffer (amortised O(1) appends, no per-chunk arrays kept). */
export class Float32Growable {
  private data: Float32Array;
  length = 0;

  constructor(initialCapacity = 16384) {
    this.data = new Float32Array(Math.max(16, initialCapacity));
  }

  push(chunk: ArrayLike<number>): void {
    const need = this.length + chunk.length;
    if (need > this.data.length) {
      let cap = this.data.length * 2;
      while (cap < need) cap *= 2;
      const next = new Float32Array(cap);
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    this.data.set(chunk as ArrayLike<number>, this.length);
    this.length = need;
  }

  /** zero-copy view of [start, end) — valid until the next push */
  view(start = 0, end = this.length): Float32Array {
    return this.data.subarray(Math.max(0, start), Math.min(this.length, end));
  }

  /** copy of [start, end) */
  slice(start = 0, end = this.length): Float32Array {
    return this.data.slice(Math.max(0, start), Math.min(this.length, end));
  }

  clear(): void {
    this.length = 0;
  }
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export type TrimOptions = {
  /** frames quieter than this (dBFS, 10 ms RMS) count as silence. Default: max(-50, peakFrame - 40) */
  thresholdDb?: number;
  /** keep this much before the first loud frame (s). Default 0.05 */
  padStart?: number;
  /** keep this much after the last loud frame (s). Default 0.05 */
  padEnd?: number;
  /** analysis frame (s). Default 0.01 */
  frame?: number;
};

/**
 * Silence trim for offline use (reference audio, debug). Returns sample indices [start, end);
 * start === end when everything is below the threshold. The live recorder uses the VAD instead.
 */
export function findSilenceTrim(pcm: Float32Array, sampleRate: number, opts: TrimOptions = {}): { start: number; end: number } {
  const hop = Math.max(1, Math.round((opts.frame ?? 0.01) * sampleRate));
  const n = Math.ceil(pcm.length / hop);
  const levels = new Float64Array(n);
  let loudest = DB_FLOOR;
  for (let k = 0; k < n; k++) {
    levels[k] = rmsDb(pcm, k * hop, (k + 1) * hop);
    if (levels[k] > loudest) loudest = levels[k];
  }
  const thr = opts.thresholdDb ?? Math.max(-50, loudest - 40);
  let first = -1;
  let last = -1;
  for (let k = 0; k < n; k++) {
    if (levels[k] > thr) {
      if (first < 0) first = k;
      last = k;
    }
  }
  if (first < 0) return { start: 0, end: 0 };
  const start = Math.max(0, first * hop - Math.round((opts.padStart ?? 0.05) * sampleRate));
  const end = Math.min(pcm.length, (last + 1) * hop + Math.round((opts.padEnd ?? 0.05) * sampleRate));
  return { start, end };
}

export function trimSilence(pcm: Float32Array, sampleRate: number, opts: TrimOptions = {}): Float32Array {
  const { start, end } = findSilenceTrim(pcm, sampleRate, opts);
  return pcm.slice(start, end);
}

/** Percentile of a numeric array (linear interpolation), q in [0, 1]. */
export function percentile(values: ArrayLike<number>, q: number): number {
  const n = values.length;
  if (n === 0) return NaN;
  const a = Float64Array.from(values as ArrayLike<number>).sort();
  const pos = Math.min(n - 1, Math.max(0, q * (n - 1)));
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < n ? a[i] * (1 - f) + a[i + 1] * f : a[i];
}

/** median / p95 / max summary for latency style measurements (null when empty) */
export function summarize(values: number[]): { median: number; p95: number; max: number; n: number } | null {
  if (values.length === 0) return null;
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  return { median: percentile(values, 0.5), p95: percentile(values, 0.95), max, n: values.length };
}
