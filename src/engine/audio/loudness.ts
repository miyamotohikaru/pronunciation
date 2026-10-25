/**
 * Loudness (ITU-R BS.1770-4 / EBU R128) and true peak, plus playback normalisation of a take
 * to the same target as the reference audio: −18 LUFS integrated, true peak ≤ −1 dBTP.
 * No browser or Node dependencies.
 *
 * Why: on iOS, echoCancellation:false bypasses the voice-processing unit — and with it the
 * AGC — so a take can arrive 20–30 dB quieter than on desktop and play back "小さい".
 */

import { Biquad } from "./dsp.ts";

export type NormalizeOptions = {
  /** integrated loudness target (LUFS). Default -18 (the reference audio) */
  targetLufs?: number;
  /** true-peak ceiling (dBTP). Default -1 */
  ceilingDbtp?: number;
  /** never boost more than this (dB) — a take of room tone must not become a roar. Default 40 */
  maxGainDb?: number;
};

export type Normalized = {
  pcm: Float32Array;
  inputLufs: number;
  outputLufs: number;
  /** gain applied before the limiter (dB) */
  gainDb: number;
  /** deepest limiter gain reduction (dB, ≤ 0) */
  limiterDb: number;
  /** true peak of the output (dBTP) */
  truePeakDb: number;
};

/** K-weighting (BS.1770 pre-filter + RLB high-pass) for any rate — libebur128's formulas */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = Biquad.fromCoefficients((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp = Biquad.fromCoefficients(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  return [shelf, hp];
}

/** BS.1770-4 integrated loudness (LUFS) of mono PCM; -Infinity for silence */
export function integratedLoudness(pcm: Float32Array, sampleRate: number): number {
  if (pcm.length === 0) return -Infinity;
  const [a, b] = kWeighting(sampleRate);
  const y = new Float64Array(pcm.length);
  a.process(pcm, y);
  b.process(y, y);
  // 100 ms sub-blocks → 400 ms blocks with 75 % overlap
  const step = Math.max(1, Math.round(sampleRate * 0.1));
  const nSub = Math.floor(y.length / step);
  const sub: number[] = [];
  for (let s = 0; s < nSub; s++) {
    let e = 0;
    for (let i = s * step, end = (s + 1) * step; i < end; i++) e += y[i] * y[i];
    sub.push(e / step);
  }
  const z: number[] = [];
  if (nSub < 4) {
    let e = 0;
    for (let i = 0; i < y.length; i++) e += y[i] * y[i];
    z.push(e / y.length);
  } else for (let j = 0; j + 4 <= nSub; j++) z.push((sub[j] + sub[j + 1] + sub[j + 2] + sub[j + 3]) / 4);
  const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms);
  const abs = z.filter((v) => v > 0 && lufs(v) > -70);
  if (abs.length === 0) return -Infinity;
  const rel = lufs(abs.reduce((p, q) => p + q, 0) / abs.length) - 10;
  const gated = abs.filter((v) => lufs(v) > rel);
  return lufs(gated.reduce((p, q) => p + q, 0) / gated.length);
}

// 4× oversampling interpolator for true peak (BS.1770-4 Annex 2 style: 4 phases × 12 taps)
const TP_TAPS = 12;
const tpTable = (() => {
  const t = new Float64Array(4 * TP_TAPS);
  for (let p = 0; p < 4; p++) {
    let sum = 0;
    for (let k = 0; k < TP_TAPS; k++) {
      const x = k - (TP_TAPS / 2 - 1) - p / 4; // offsets −5…+6 around the fractional position
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TP_TAPS / 2 + 1)); // Hann over ±7
      t[p * TP_TAPS + k] = sinc * w;
      sum += t[p * TP_TAPS + k];
    }
    for (let k = 0; k < TP_TAPS; k++) t[p * TP_TAPS + k] /= sum;
  }
  return t;
})();

/** true peak (linear, ≥ sample peak) by 4× oversampling */
export function truePeak(pcm: ArrayLike<number>): number {
  let peak = 0;
  const n = pcm.length;
  const at = (i: number) => (i >= 0 && i < n ? pcm[i] : 0);
  for (let i = 0; i < n; i++) {
    const s = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (s > peak) peak = s;
    for (let p = 1; p < 4; p++) {
      let acc = 0;
      for (let k = 0; k < TP_TAPS; k++) acc += at(i + k - (TP_TAPS / 2 - 1)) * tpTable[p * TP_TAPS + k];
      const v = acc < 0 ? -acc : acc;
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Look-ahead peak limiter, in place: gain never lets a sample exceed `ceiling` (linear).
 * Trailing-min over the look-ahead, exponential release, then a box average of the same
 * length — the average of mins that all include sample n can't exceed n's required gain.
 * Returns the deepest gain (linear).
 */
function limit(y: Float32Array, sampleRate: number, ceiling: number): number {
  const L = Math.max(1, Math.round(sampleRate * 0.002)); // 2 ms look-ahead
  const rel = 1 - Math.exp(-1 / (sampleRate * 0.08)); // 80 ms release
  const n = y.length;
  const need = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const a = y[i] < 0 ? -y[i] : y[i];
    need[i] = a > ceiling ? ceiling / a : 1;
    if (need[i] < 1) any = true;
  }
  if (!any) return 1;
  // trailing min over [i − L, i] (monotonic deque), then release
  const m = new Float32Array(n);
  const dq = new Int32Array(n);
  let h = 0;
  let t = 0;
  let g = 1;
  for (let i = 0; i < n; i++) {
    while (t > h && need[dq[t - 1]] >= need[i]) t--;
    dq[t++] = i;
    if (dq[h] < i - L) h++;
    const mn = need[dq[h]];
    g = mn < g ? mn : g + (1 - g) * rel;
    if (g > mn) g = mn;
    m[i] = g;
  }
  // forward box average over [i, i + L] (shorter at the end — still only mins that include i)
  let acc = 0;
  for (let k = 0; k <= L && k < n; k++) acc += m[k];
  let deepest = 1;
  for (let i = 0; i < n; i++) {
    const gi = acc / (Math.min(n - 1, i + L) - i + 1);
    y[i] *= gi;
    if (gi < deepest) deepest = gi;
    acc -= m[i];
    if (i + L + 1 < n) acc += m[i + L + 1];
  }
  return deepest;
}

/**
 * Gain to `targetLufs`, peak-limit to the true-peak ceiling, verify (and trim) the true peak.
 * Two passes so the limiter's loudness loss is made up. Silence (no gated block) is returned
 * unchanged.
 */
export function normalizeLoudness(pcm: Float32Array, sampleRate: number, opts: NormalizeOptions = {}): Normalized {
  const target = opts.targetLufs ?? -18;
  const ceilDb = opts.ceilingDbtp ?? -1;
  const maxGain = opts.maxGainDb ?? 40;
  const inputLufs = integratedLoudness(pcm, sampleRate);
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  if (!Number.isFinite(inputLufs)) {
    return { pcm: pcm.slice(), inputLufs, outputLufs: inputLufs, gainDb: 0, limiterDb: 0, truePeakDb: db(truePeak(pcm)) };
  }
  // sample-peak ceiling 0.5 dB under the true-peak ceiling leaves room for inter-sample overs
  const sampleCeil = Math.pow(10, (ceilDb - 0.5) / 20);
  let gainDb = Math.min(maxGain, target - inputLufs);
  let y = new Float32Array(0);
  let deepest = 1;
  let out = inputLufs;
  for (let pass = 0; pass < 2; pass++) {
    const g = Math.pow(10, gainDb / 20);
    y = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) y[i] = pcm[i] * g;
    deepest = limit(y, sampleRate, sampleCeil);
    out = integratedLoudness(y, sampleRate);
    const short = target - out;
    if (!(short > 0.2) || gainDb >= maxGain) break;
    gainDb = Math.min(maxGain, gainDb + short);
  }
  let tp = truePeak(y);
  const ceil = Math.pow(10, ceilDb / 20);
  if (tp > ceil) {
    const k = ceil / tp;
    for (let i = 0; i < y.length; i++) y[i] *= k;
    tp = ceil;
    out = integratedLoudness(y, sampleRate);
  }
  return { pcm: y, inputLufs, outputLufs: out, gainDb, limiterDb: db(deepest), truePeakDb: db(tp) };
}
