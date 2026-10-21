/**
 * Pitch (f0) tracking with YIN — de Cheveigné & Kawahara 2002:
 * difference function → cumulative-mean-normalised difference (CMND) → absolute threshold
 * → parabolic interpolation, plus voicing by aperiodicity + energy and a light median.
 *
 * Voicing is tuned on real voices (LibriSpeech, speechocean762 phone-mic learners, GLOBE /
 * Common Voice; tools/e2e/real-voices.mjs, against Praat), not TTS:
 * - the energy gate is relative to a running noise floor (floor + floorMarginDb, never below
 *   minRmsDb), so a quiet input — iOS without AGC is 20–30 dB down — still voices. The floor
 *   is the 10th percentile of the *unvoiced* frames only, so a long sustained vowel (or a
 *   test tone) can never become "noise";
 * - hysteresis: a frame that continues the previous voiced frame (within holdSemitones) only
 *   has to meet the looser holdAperiodicity (breathy / decaying vowels, phone mics).
 * Both are causal state inside the tracker, so live == offline still holds bit for bit.
 * (A continuity rule that pulled octave jumps back to the previous period was tried and
 * dropped: it doubled octave errors by carrying the first wrong frame along.)
 *
 * No browser or Node dependencies, no imports: the page streams microphone audio through
 * `PitchTracker` and the build runs `analyzePitch()` on the native reference audio in Node.
 * `analyzePitch(x)` is literally "push x into a fresh PitchTracker, then flush", so live and
 * offline frames are identical for identical 16 kHz input, however the input is chunked.
 *
 *   import { analyzePitch } from "./src/engine/audio/pitch.ts";   // Node ≥ 22.18 / 23.6
 *
 * Frame grid: frame k is centred on sample k·hop (t = k·hop / sampleRate, 100 frames/s by
 * default), samples before 0 / after the end count as zeros, and a signal of n samples has
 * floor((n − 1) / hop) + 1 frames.
 *
 * Latency (streaming): frame k is final once samples up to k·hop + lookahead have arrived,
 * plus `hop` for each frame of median lookahead → 20.2 ms + 10 ms with the defaults.
 */

export type PitchFrame = { t: number; f0: number | null; rms: number };

export type PitchOptions = {
  /** input sample rate. Default 16000 */
  sampleRate?: number;
  /** frame hop in samples. Default sampleRate / 100 (10 ms) */
  hop?: number;
  /** lowest f0 searched (Hz). Default 65 */
  fMin?: number;
  /** highest f0 searched (Hz). Default 500 */
  fMax?: number;
  /** YIN integration window in samples. Default 25 ms */
  window?: number;
  /** YIN absolute threshold on the CMND for picking the first dip. Default 0.12 */
  threshold?: number;
  /** a voicing onset needs CMND minimum (aperiodicity, 0 = perfectly periodic) ≤ this. Default 0.4 */
  maxAperiodicity?: number;
  /** a frame continuing a voiced one (|Δf0| ≤ holdSemitones) needs only ≤ this. Default 0.5 */
  holdAperiodicity?: number;
  /** max f0 change from the previous voiced frame for the looser limit (semitones). Default 2 */
  holdSemitones?: number;
  /** energy gate: frame RMS ≥ running noise floor + this (dB). Default 6 */
  floorMarginDb?: number;
  /** …and never below this absolute level (dBFS). Default -70 */
  minRmsDb?: number;
  /** noise-floor window (ms; 10th percentile, rises ≤ 10 dB/s). Default 1500 */
  floorWindowMs?: number;
  /** median smoothing length in frames (odd, 1 = off). Default 3 */
  median?: number;
};

type Raw = { f0: number | null; rms: number };

const FLOOR_RISE_DB_PER_S = 10;

export class PitchTracker {
  readonly sampleRate: number;
  readonly hop: number;
  /** samples needed after a frame centre before that frame can be computed */
  readonly lookahead: number;
  /** total algorithmic delay of a smoothed frame, in seconds */
  readonly latency: number;

  private readonly W: number;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private readonly N: number;
  private readonly left: number;
  private readonly threshold: number;
  private readonly maxAp: number;
  private readonly holdAp: number;
  private readonly holdSt: number;
  private readonly marginDb: number;
  private readonly minRmsDb: number;
  private readonly fMin: number;
  private readonly fMax: number;
  private readonly medHalf: number;
  // causal voicing state
  private prevF0: number | null = null;
  /** running noise floor of the frame RMS (dBFS); -Infinity until known */
  floorDb = -Infinity;
  private readonly floorRing: Float64Array;
  private readonly floorScratch: Float64Array;
  private floorHead = 0;
  private floorLen = 0;
  private readonly floorRise: number;

  private buf: Float32Array;
  private bufStart: number; // absolute sample index of buf[0]
  private bufLen: number;
  private totalIn = 0;
  private nextRaw = 0; // next raw frame to compute
  private nextOut = 0; // next smoothed frame to emit
  private raw: Raw[] = []; // raw frames [rawBase, nextRaw)
  private rawBase = 0;
  private done = false;
  private readonly d: Float64Array;
  private readonly cmnd: Float64Array;

  constructor(opts: PitchOptions = {}) {
    const sr = (this.sampleRate = opts.sampleRate ?? 16000);
    this.hop = opts.hop ?? Math.round(sr / 100);
    this.fMin = opts.fMin ?? 65;
    this.fMax = opts.fMax ?? 500;
    this.W = opts.window ?? Math.round(sr * 0.025);
    this.tauMin = Math.max(2, Math.floor(sr / this.fMax));
    this.tauMax = Math.ceil(sr / this.fMin);
    this.N = this.W + this.tauMax + 2; // d(τ) up to tauMax + 1 for the interpolation neighbour
    this.left = Math.floor(this.N / 2);
    this.lookahead = this.N - 1 - this.left;
    this.threshold = opts.threshold ?? 0.12;
    this.maxAp = opts.maxAperiodicity ?? 0.4;
    this.holdAp = Math.max(this.maxAp, opts.holdAperiodicity ?? 0.5);
    this.holdSt = opts.holdSemitones ?? 2;
    this.marginDb = opts.floorMarginDb ?? 6;
    this.minRmsDb = opts.minRmsDb ?? -70;
    const winFrames = Math.max(10, Math.round((opts.floorWindowMs ?? 1500) / 1000 / (this.hop / sr)));
    this.floorRing = new Float64Array(winFrames);
    this.floorScratch = new Float64Array(winFrames);
    this.floorRise = FLOOR_RISE_DB_PER_S * (this.hop / sr);
    const m = Math.max(1, Math.floor(opts.median ?? 3));
    this.medHalf = (m % 2 === 1 ? m - 1 : m) / 2;
    this.latency = (this.lookahead + this.medHalf * this.hop) / sr;
    this.d = new Float64Array(this.tauMax + 3);
    this.cmnd = new Float64Array(this.tauMax + 3);
    this.buf = new Float32Array(Math.max(8192, this.N * 4));
    this.bufStart = -this.left;
    this.bufLen = this.left; // zero history before sample 0
  }

  reset(): void {
    this.buf.fill(0);
    this.bufStart = -this.left;
    this.bufLen = this.left;
    this.totalIn = 0;
    this.nextRaw = 0;
    this.nextOut = 0;
    this.raw = [];
    this.rawBase = 0;
    this.done = false;
    this.prevF0 = null;
    this.floorDb = -Infinity;
    this.floorHead = 0;
    this.floorLen = 0;
  }

  /** feed 16 kHz samples; returns the frames that became final */
  push(samples: Float32Array): PitchFrame[] {
    if (this.done) throw new Error("PitchTracker: push() after flush() — call reset()");
    this.append(samples);
    this.totalIn += samples.length;
    return this.run(false);
  }

  /** end of stream: zero-pad and return the remaining frames */
  flush(): PitchFrame[] {
    if (this.done) return [];
    this.done = true;
    this.append(new Float32Array(this.N + this.hop));
    return this.run(true);
  }

  /** number of frames a stream of n samples produces */
  frameCount(n: number): number {
    return n > 0 ? Math.floor((n - 1) / this.hop) + 1 : 0;
  }

  private append(x: Float32Array): void {
    // keep from the start of the next raw frame's window
    const keepFrom = this.nextRaw * this.hop - this.left;
    const drop = Math.max(0, Math.min(this.bufLen, keepFrom - this.bufStart));
    if (drop > 0) {
      this.buf.copyWithin(0, drop, this.bufLen);
      this.bufLen -= drop;
      this.bufStart += drop;
    }
    if (this.bufLen + x.length > this.buf.length) {
      let cap = this.buf.length * 2;
      while (cap < this.bufLen + x.length) cap *= 2;
      const next = new Float32Array(cap);
      next.set(this.buf.subarray(0, this.bufLen));
      this.buf = next;
    }
    this.buf.set(x, this.bufLen);
    this.bufLen += x.length;
  }

  private run(final: boolean): PitchFrame[] {
    const total = this.frameCount(this.totalIn);
    const available = this.bufStart + this.bufLen;
    while (this.nextRaw < total) {
      const c = this.nextRaw * this.hop;
      if (c - this.left + this.N > available) break;
      this.raw.push(this.analyze(c - this.left - this.bufStart));
      this.nextRaw++;
    }
    const out: PitchFrame[] = [];
    while (this.nextOut < this.nextRaw && (final || this.nextOut + this.medHalf < this.nextRaw)) {
      out.push(this.smooth(this.nextOut, final ? total : this.nextRaw));
      this.nextOut++;
    }
    // forget raw frames nobody needs any more
    const keep = this.nextOut - this.medHalf;
    if (keep - this.rawBase > 256) {
      this.raw.splice(0, keep - this.rawBase);
      this.rawBase = keep;
    }
    return out;
  }

  private smooth(k: number, limit: number): PitchFrame {
    const t = (k * this.hop) / this.sampleRate;
    const me = this.raw[k - this.rawBase];
    if (me.f0 === null || this.medHalf === 0) return { t, f0: me.f0, rms: me.rms };
    const v: number[] = [me.f0]; // the centre counts twice → odd set, ties resolve to the centre
    let neighbours = 0;
    for (let j = k - this.medHalf; j <= k + this.medHalf; j++) {
      if (j < 0 || j >= limit) continue;
      const f = this.raw[j - this.rawBase].f0;
      if (f === null) continue;
      v.push(f);
      if (j !== k) neighbours++;
    }
    if (neighbours === 0) return { t, f0: null, rms: me.rms }; // isolated voiced blip
    if (v.length % 2 === 0) v.shift();
    v.sort((a, b) => a - b);
    return { t, f0: v[v.length >> 1], rms: me.rms };
  }

  /** running 10th percentile of the unvoiced frame levels (digital silence excluded) */
  private updateFloor(db: number): void {
    if (db === -Infinity) return;
    const cap = this.floorRing.length;
    this.floorRing[(this.floorHead + this.floorLen) % cap] = db;
    if (this.floorLen < cap) this.floorLen++;
    else this.floorHead = (this.floorHead + 1) % cap;
    if (this.floorLen < 10) return;
    const n = this.floorLen;
    const a = this.floorScratch.subarray(0, n);
    for (let i = 0; i < n; i++) a[i] = this.floorRing[(this.floorHead + i) % cap];
    a.sort();
    const target = a[Math.floor(0.1 * (n - 1))] + 1;
    this.floorDb = this.floorDb === -Infinity || target < this.floorDb ? target : Math.min(target, this.floorDb + this.floorRise);
  }

  /** YIN on buf[s, s + N) */
  private analyze(s: number): Raw {
    const x = this.buf;
    const { W, tauMin, tauMax, d, cmnd } = this;

    // energy of the W samples centred on the frame, gated against the running noise floor
    const c = s + this.left;
    const r0 = c - (W >> 1);
    let e = 0;
    for (let j = 0; j < W; j++) e += x[r0 + j] * x[r0 + j];
    const rms = Math.sqrt(e / W);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    if (db < Math.max(this.minRmsDb, this.floorDb + this.marginDb)) {
      this.updateFloor(db);
      this.prevF0 = null;
      return { f0: null, rms };
    }

    // 1–2. difference function
    d[0] = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let sum = 0;
      const b = s + tau;
      for (let j = 0; j < W; j++) {
        const v = x[s + j] - x[b + j];
        sum += v * v;
      }
      d[tau] = sum;
    }
    // 3. cumulative mean normalisation
    cmnd[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      run += d[tau];
      cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    // 4. absolute threshold: first dip below it (then walk to its bottom), else the global minimum
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < this.threshold) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      tau = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[tau]) tau = t;
    }
    // 5. parabolic interpolation (period on the raw difference function, aperiodicity on the CMND)
    let delta = 0;
    {
      const a = d[tau - 1];
      const b = d[tau];
      const cc = d[tau + 1];
      const den = a - 2 * b + cc;
      if (den > 0) delta = (0.5 * (a - cc)) / den;
      if (!(delta > -1 && delta < 1)) delta = 0;
    }
    let ap = cmnd[tau];
    {
      const a = cmnd[tau - 1];
      const cc = cmnd[tau + 1];
      const den = a - 2 * ap + cc;
      if (den > 0) {
        const dc = (0.5 * (a - cc)) / den;
        if (dc > -1 && dc < 1) ap = ap - 0.25 * (a - cc) * dc;
      }
    }
    if (ap < 0) ap = 0;
    const f0 = this.sampleRate / (tau + delta);
    const inRange = f0 >= this.fMin * 0.97 && f0 <= this.fMax * 1.03;
    const prev = this.prevF0;
    const holds = prev !== null && ap <= this.holdAp && Math.abs(12 * Math.log2(f0 / prev)) <= this.holdSt;
    const voiced = inRange && (ap <= this.maxAp || holds);
    this.prevF0 = voiced ? f0 : null;
    if (!voiced) this.updateFloor(db);
    return { f0: voiced ? f0 : null, rms };
  }
}

/** Offline pitch track of 16 kHz mono PCM — same algorithm and frames as the live tracker. */
export function analyzePitch(pcm16k: Float32Array, opts: PitchOptions = {}): PitchFrame[] {
  const tr = new PitchTracker(opts);
  const a = tr.push(pcm16k);
  const b = tr.flush();
  return a.length === 0 ? b : b.length === 0 ? a : a.concat(b);
}

/** f0 ratio in semitones (12·log2(a / b)) */
export function semitoneDiff(a: number, b: number): number {
  return 12 * Math.log2(a / b);
}
