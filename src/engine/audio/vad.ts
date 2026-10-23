/**
 * Energy VAD with an adaptive noise floor, for "tap → speak → it stops by itself".
 * No browser or Node dependencies. Works on 10 ms frame levels (dBFS) supplied by the
 * capture pipeline (high-passed at 100 Hz so rumble/DC don't hold the gate open).
 *
 * Noise floor = minimum statistics, robust version: 10th percentile of the 30 ms-smoothed level
 * over the last second (+1 dB bias), allowed to fall instantly but to rise only
 * `floorRiseDbPerSec`, so a long vowel can't drag it up while slow ambient/AGC changes are
 * still followed. (A plain minimum let one half-silent start-up frame pin the floor ~15 dB
 * under the real room tone for a whole second → false onsets on the room tone.)
 * Calibration: the first `calibrationMs` of non-silent audio (onsets need an obviously loud
 * signal, ≥ absOnsetDb, until then). Exact digital silence — the zeros iOS/Chrome deliver while
 * the input warms up, or a hardware noise gate — never enters the floor estimate.
 *
 * Onset: raw level ≥ floor + onsetDb for onsetMs (start time = first frame of that run).
 * Offset: smoothed level < floor + offsetDb (hysteresis) for endSilenceMs → auto-stop.
 * Bursts whose loud part (≥ floor + onsetDb) is shorter than minSpeechMs (taps, bumps) are
 * rejected and listening continues; clicks shorter than onsetMs never start an utterance.
 */

import { DB_FLOOR } from "./dsp.ts";

export type VadOptions = {
  /** analysis frame (ms). Default 10 */
  frameMs?: number;
  /** non-silent audio used to learn the noise floor before normal onsets (ms). Default 250 */
  calibrationMs?: number;
  /** onset threshold above the floor (dB). Default 10 */
  onsetDb?: number;
  /** "still speaking" threshold above the floor (dB), < onsetDb for hysteresis. Default 6 */
  offsetDb?: number;
  /** level must stay above the onset threshold this long (ms). Default 60 */
  onsetMs?: number;
  /** post-speech silence that ends the take (ms). Default 800 */
  endSilenceMs?: number;
  /** hard cap from the start of recording (ms). Default 30000: the scorer's window (1500 frames of 20 ms) */
  maxDurationMs?: number;
  /** utterances shorter than this are discarded (ms). Default 100 */
  minSpeechMs?: number;
  /** audio kept before the onset / after the offset in the take (ms). Defaults 250 / 200 */
  preRollMs?: number;
  postRollMs?: number;
  /** during calibration only a level above this (dBFS) starts speech. Default -40 */
  absOnsetDb?: number;
  /** noise-floor window (ms). Default 1000 */
  floorWindowMs?: number;
  /** percentile of the window taken as the floor (0–1). Default 0.1 */
  floorPercentile?: number;
  /** max floor rise (dB/s). Default 6 */
  floorRiseDbPerSec?: number;
  /** added to the window percentile (dB). Default 1 */
  floorBiasDb?: number;
  /** floor clamp (dBFS). Defaults -85 / -30 */
  minFloorDb?: number;
  maxFloorDb?: number;
  /** smoothing for the floor and offset decisions (ms). Default 30 */
  smoothMs?: number;
};

export type VadEvent =
  | { type: "start"; t: number }
  | { type: "end"; t: number; rejected?: boolean }
  | { type: "stop"; t: number; reason: "vad" | "max" };

export type VadState = "listening" | "speech" | "done";

const NONE: VadEvent[] = [];

export class VadDetector {
  readonly opts: Required<VadOptions>;
  state: VadState = "listening";
  /** current noise floor (dBFS) */
  floorDb: number;
  /** utterance boundaries in seconds from the first frame (null until known) */
  speechStart: number | null = null;
  speechEnd: number | null = null;
  /** loudest raw frame inside the utterance (dBFS) */
  speechPeakDb = DB_FLOOR;
  /** noise floor when the utterance started (dBFS) — AGC can move the floor during speech */
  floorAtStartDb: number;
  /** frames processed */
  frames = 0;

  private readonly fs: number; // frame seconds
  private readonly calibFrames: number;
  private readonly onsetFrames: number;
  private readonly endFrames: number;
  private readonly maxFrames: number;
  private readonly winFrames: number;
  private readonly riseStep: number;
  private readonly smoothN: number;
  private smoothBuf: Float64Array;
  private smoothSum = 0;
  private smoothIdx = 0;
  private smoothFill = 0;
  // ring of (frame, smoothedDb) of the non-silent frames inside the floor window
  private winFrame: Int32Array;
  private winVal: Float64Array;
  private winHead = 0;
  private winLen = 0;
  private scratch: Float64Array;
  private nonSilent = 0;
  private run = 0;
  private runStart = 0;
  private startFrame = 0;
  private lastActive = 0;
  private lastLoud = 0;
  private silenceRun = 0;

  constructor(opts: VadOptions = {}) {
    this.opts = {
      frameMs: 10,
      calibrationMs: 250,
      onsetDb: 10,
      offsetDb: 6,
      onsetMs: 60,
      endSilenceMs: 800,
      maxDurationMs: 30000,
      minSpeechMs: 100,
      preRollMs: 250,
      postRollMs: 200,
      absOnsetDb: -40,
      floorWindowMs: 1000,
      floorPercentile: 0.1,
      floorRiseDbPerSec: 6,
      floorBiasDb: 1,
      minFloorDb: -85,
      maxFloorDb: -30,
      smoothMs: 30,
      ...stripUndefined(opts),
    };
    const o = this.opts;
    this.fs = o.frameMs / 1000;
    this.calibFrames = Math.max(1, Math.round(o.calibrationMs / o.frameMs));
    this.onsetFrames = Math.max(1, Math.round(o.onsetMs / o.frameMs));
    this.endFrames = Math.max(1, Math.round(o.endSilenceMs / o.frameMs));
    this.maxFrames = Math.max(1, Math.round(o.maxDurationMs / o.frameMs));
    this.winFrames = Math.max(1, Math.round(o.floorWindowMs / o.frameMs));
    this.riseStep = o.floorRiseDbPerSec * this.fs;
    this.smoothN = Math.max(1, Math.round(o.smoothMs / o.frameMs));
    this.smoothBuf = new Float64Array(this.smoothN);
    this.winFrame = new Int32Array(this.winFrames);
    this.winVal = new Float64Array(this.winFrames);
    this.scratch = new Float64Array(this.winFrames);
    this.floorDb = o.minFloorDb;
    this.floorAtStartDb = o.minFloorDb;
  }

  /** has the floor been learned from enough non-silent audio? */
  get calibrated(): boolean {
    return this.nonSilent >= this.calibFrames;
  }

  /** feed the next 10 ms frame level (dBFS of the high-passed RMS); returns events of this frame */
  process(levelDb: number): VadEvent[] {
    const o = this.opts;
    const k = this.frames++;
    if (this.state === "done") return NONE;
    const digitalSilence = levelDb <= DB_FLOOR + 0.5;

    // 30 ms power average over non-silent frames (digital silence would drag it down)
    let smoothDb = DB_FLOOR;
    if (!digitalSilence) {
      const p = Math.pow(10, levelDb / 10);
      this.smoothSum += p - this.smoothBuf[this.smoothIdx];
      this.smoothBuf[this.smoothIdx] = p;
      this.smoothIdx = (this.smoothIdx + 1) % this.smoothN;
      if (this.smoothFill < this.smoothN) this.smoothFill++;
      const sm = this.smoothSum / this.smoothFill;
      smoothDb = sm > 1e-10 ? 10 * Math.log10(sm) : DB_FLOOR;
      this.nonSilent++;
      // window: drop the oldest entry when full, append this frame
      const cap = this.winFrames;
      if (this.winLen === cap) {
        this.winHead = (this.winHead + 1) % cap;
        this.winLen--;
      }
      const at = (this.winHead + this.winLen) % cap;
      this.winFrame[at] = k;
      this.winVal[at] = smoothDb;
      this.winLen++;
    }
    // expire entries older than the window
    while (this.winLen > 0 && this.winFrame[this.winHead] <= k - this.winFrames) {
      this.winHead = (this.winHead + 1) % this.winFrames;
      this.winLen--;
    }
    if (this.winLen > 0) {
      const n = this.winLen;
      const a = this.scratch.subarray(0, n);
      for (let i = 0; i < n; i++) a[i] = this.winVal[(this.winHead + i) % this.winFrames];
      a.sort();
      const target = a[Math.floor(o.floorPercentile * (n - 1))] + o.floorBiasDb;
      if (!this.calibrated || target < this.floorDb) this.floorDb = target;
      else this.floorDb = Math.min(target, this.floorDb + this.riseStep);
      this.floorDb = Math.min(o.maxFloorDb, Math.max(o.minFloorDb, this.floorDb));
    }

    let events: VadEvent[] = NONE;
    if (this.state === "listening") {
      const thr = this.calibrated ? this.floorDb + o.onsetDb : Math.max(this.floorDb + o.onsetDb, o.absOnsetDb);
      if (levelDb >= thr) {
        if (this.run === 0) this.runStart = k;
        this.run++;
      } else this.run = 0;
      if (this.run >= this.onsetFrames) {
        this.state = "speech";
        this.startFrame = this.runStart;
        this.lastActive = k;
        this.lastLoud = k;
        this.silenceRun = 0;
        this.speechPeakDb = levelDb;
        this.floorAtStartDb = this.floorDb;
        this.speechStart = this.runStart * this.fs;
        this.speechEnd = null;
        events = [{ type: "start", t: this.speechStart }];
      }
    } else if (this.state === "speech") {
      const active = smoothDb >= this.floorDb + o.offsetDb || levelDb >= this.floorDb + o.onsetDb;
      if (active) {
        this.lastActive = k;
        this.silenceRun = 0;
        if (levelDb > this.speechPeakDb) this.speechPeakDb = levelDb;
      } else this.silenceRun++;
      if (levelDb >= this.floorDb + o.onsetDb) this.lastLoud = k;
      if (this.silenceRun >= this.endFrames) {
        const end = (this.lastActive + 1) * this.fs;
        // judge the length on the loud part only (the smoothed hangover adds ~30 ms to anything)
        if ((this.lastLoud + 1 - this.startFrame) * o.frameMs < o.minSpeechMs) {
          events = [{ type: "end", t: end, rejected: true }];
          this.state = "listening";
          this.run = 0;
          this.speechStart = null;
          this.speechPeakDb = DB_FLOOR;
        } else {
          this.speechEnd = end;
          this.state = "done";
          events = [
            { type: "end", t: end },
            { type: "stop", t: (k + 1) * this.fs, reason: "vad" },
          ];
        }
      }
    }
    if (this.state !== "done" && k + 1 >= this.maxFrames) {
      events = events === NONE ? [] : events.slice();
      if (this.state === "speech") {
        this.speechEnd = (k + 1) * this.fs;
        events.push({ type: "end", t: this.speechEnd });
      }
      this.state = "done";
      events.push({ type: "stop", t: (k + 1) * this.fs, reason: "max" });
    }
    return events;
  }

  /**
   * Close an utterance still open when recording stops for another reason (manual stop,
   * interruption). Returns the "end" event if one was emitted.
   */
  close(): VadEvent | null {
    if (this.state === "speech") {
      this.speechEnd = this.frames * this.fs;
      this.state = "done";
      return { type: "end", t: this.speechEnd };
    }
    this.state = "done";
    return null;
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(o) as (keyof T)[]) if (o[key] !== undefined) out[key] = o[key];
  return out;
}

/**
 * After the take: widen the live VAD region at both ends while frames stay above
 * floor + offsetDb (short gaps allowed) — catches soft onsets ("h", "f", "th") and fading final
 * fricatives ("…rice" → /s/) that the onset threshold / live hangover called silence.
 * The start uses the floor from before the utterance — or the median level of the 50–300 ms
 * before the onset if that is higher (AGC ramps the noise up during silence faster than the
 * rise-limited floor follows) — and the end uses the final floor (learned from the post-speech
 * silence). `levels` are the same 10 ms frame levels the detector saw. Never shrinks the region.
 */
export function refineSpeechRegion(
  levels: ArrayLike<number>,
  region: { start: number; end: number },
  floors: { start: number; end: number },
  opts: { frameMs?: number; offsetDb?: number; maxExtendMs?: number; gapMs?: number } = {},
): { start: number; end: number } {
  const fs = (opts.frameMs ?? 10) / 1000;
  const off = opts.offsetDb ?? 6;
  const maxExt = Math.round((opts.maxExtendMs ?? 300) / 1000 / fs);
  const gap = Math.round((opts.gapMs ?? 30) / 1000 / fs);
  let a = Math.round(region.start / fs);
  let b = Math.round(region.end / fs); // exclusive
  const before: number[] = [];
  for (let k = Math.max(0, a - Math.round(0.3 / fs)); k < a - Math.round(0.05 / fs); k++) if (levels[k] > DB_FLOOR + 0.5) before.push(levels[k]);
  before.sort((p, q) => p - q);
  const background = before.length >= 5 ? before[before.length >> 1] : -Infinity;
  const thrA = Math.max(floors.start, background) + off;
  const thrB = floors.end + off;
  // walk back from the onset while frames (allowing short gaps) are above the threshold
  for (let k = a - 1, quiet = 0, steps = 0; k >= 0 && steps < maxExt; k--, steps++) {
    if (levels[k] >= thrA) {
      a = k;
      quiet = 0;
    } else if (++quiet > gap) break;
  }
  for (let k = b, quiet = 0, steps = 0; k < levels.length && steps < maxExt; k++, steps++) {
    if (levels[k] >= thrB) {
      b = k + 1;
      quiet = 0;
    } else if (++quiet > gap) break;
  }
  return { start: a * fs, end: b * fs };
}
