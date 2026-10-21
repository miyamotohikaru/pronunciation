/**
 * Capture-side DSP for one take, independent of where the samples come from.
 * No browser or Node dependencies: MicRecorder feeds it AudioWorklet chunks, and the Node
 * tests feed it WAV files in random chunk sizes to check live == offline.
 *
 *   capture-rate mono ─┬─ keep (playback)
 *                      ├─ ~60 fps RMS/peak ──────────────────────────────▶ onLevel
 *                      ├─ 100 Hz high-pass → 10 ms levels → VadDetector ─▶ onSpeechStart / onSpeechEnd / auto-stop
 *                      └─ StreamResampler → 16 kHz ─┬─ keep (speech model)
 *                                                    └─ PitchTracker ────▶ onPitch
 */

import { Biquad, DB_FLOOR, Float32Growable, toDb } from "./dsp.ts";
import { normalizeLoudness, type NormalizeOptions } from "./loudness.ts";
import { PitchTracker, type PitchOptions } from "./pitch.ts";
import { StreamResampler } from "./resample.ts";
import type { LevelEvent, PitchFrame, SpeechEndEvent, SpeechRegion, SpeechStartEvent, StopReason, Take, TakeStats, VadEventLog } from "./types.ts";
import { refineSpeechRegion, VadDetector, type VadOptions } from "./vad.ts";

export const MODEL_RATE = 16000;

export type CapturePipelineOptions = {
  /** capture sample rate (AudioContext.sampleRate) */
  sampleRate: number;
  vad?: VadOptions;
  /** pitch options (sampleRate is always 16000) */
  pitch?: Omit<PitchOptions, "sampleRate">;
  /** level events per second. Default 60 */
  levelFps?: number;
  /** VAD high-pass corner (Hz). Default 100 */
  highpassHz?: number;
  /** keep untrimmed buffers in Take.raw. Default false */
  keepRaw?: boolean;
  /** Take.playback loudness target (default −18 LUFS / −1 dBTP); false = play as recorded */
  playback?: NormalizeOptions | false;
};

export type CaptureHandlers = {
  onLevel?: (e: LevelEvent) => void;
  onSpeechStart?: (e: SpeechStartEvent) => void;
  onSpeechEnd?: (e: SpeechEndEvent) => void;
  onPitch?: (f: PitchFrame) => void;
  /** VAD decided the take is over ("vad") or the hard cap was hit ("max") */
  onAutoStop?: (reason: "vad" | "max", t: number) => void;
};

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class CapturePipeline {
  readonly sampleRate: number;
  readonly vad: VadDetector;
  readonly pitchTracker: PitchTracker;
  /** live pitch frames so far (t from the recording start) */
  readonly pitch: PitchFrame[] = [];
  /** 10 ms VAD frame levels (dBFS, high-passed) */
  readonly levels: number[] = [];
  readonly vadLog: VadEventLog[] = [];

  private readonly opts: CapturePipelineOptions;
  private readonly h: CaptureHandlers;
  private readonly raw = new Float32Growable(48000 * 4);
  private readonly pcm16 = new Float32Growable(16000 * 4);
  private readonly resampler: StreamResampler;
  private readonly hp: Biquad;
  private hpScratch = new Float32Array(1024);
  // level meter window
  private readonly levelLen: number;
  private levelN = 0;
  private levelSum = 0;
  private levelPeak = 0;
  // VAD framing (frame k covers [floor(k·sr/100), floor((k+1)·sr/100)))
  private vadFrame = 0;
  private vadNext: number;
  private vadSum = 0;
  private vadZeros = 0;
  private vadCount = 0;
  private total = 0;
  private dspMs = 0;
  private finished = false;
  private autoStopped: "vad" | "max" | null = null;

  constructor(opts: CapturePipelineOptions, handlers: CaptureHandlers = {}) {
    this.opts = opts;
    this.h = handlers;
    this.sampleRate = opts.sampleRate;
    this.vad = new VadDetector(opts.vad);
    this.pitchTracker = new PitchTracker({ ...opts.pitch, sampleRate: MODEL_RATE });
    this.resampler = new StreamResampler(opts.sampleRate, MODEL_RATE);
    this.hp = Biquad.highpass(opts.sampleRate, opts.highpassHz ?? 100);
    this.levelLen = Math.max(1, Math.round(opts.sampleRate / (opts.levelFps ?? 60)));
    this.vadNext = this.frameEdge(1);
  }

  /** seconds of audio consumed */
  get time(): number {
    return this.total / this.sampleRate;
  }

  /** samples consumed */
  get length(): number {
    return this.total;
  }

  /** set once the VAD (or the hard cap) ended the take; further pushes are ignored */
  get stopped(): "vad" | "max" | null {
    return this.autoStopped;
  }

  private frameEdge(k: number): number {
    return Math.floor((k * this.sampleRate * this.vad.opts.frameMs) / 1000);
  }

  /** feed capture-rate mono samples (the array may be modified in place: non-finite → 0) */
  push(chunk: Float32Array): void {
    if (this.finished || this.autoStopped) return;
    const t0 = now();
    const n = chunk.length;
    for (let i = 0; i < n; i++) if (!Number.isFinite(chunk[i])) chunk[i] = 0;
    this.raw.push(chunk);

    // level meter on the raw signal
    for (let i = 0; i < n; i++) {
      const x = chunk[i];
      this.levelSum += x * x;
      const a = x < 0 ? -x : x;
      if (a > this.levelPeak) this.levelPeak = a;
      if (++this.levelN === this.levelLen) {
        const r = Math.sqrt(this.levelSum / this.levelN);
        this.h.onLevel?.({
          t: (this.total + i + 1) / this.sampleRate,
          rms: r,
          peak: this.levelPeak,
          db: toDb(r),
          floorDb: this.vad.floorDb,
          speaking: this.vad.state === "speech",
          clipped: this.levelPeak >= 0.999,
        });
        this.levelN = 0;
        this.levelSum = 0;
        this.levelPeak = 0;
      }
    }

    // VAD on 10 ms high-passed frames
    if (this.hpScratch.length < n) this.hpScratch = new Float32Array(n);
    const hp = this.hpScratch;
    this.hp.process(chunk, hp, 0, n);
    for (let i = 0; i < n && !this.autoStopped; i++) {
      this.vadSum += hp[i] * hp[i];
      if (chunk[i] === 0) this.vadZeros++;
      this.vadCount++;
      if (this.total + i + 1 === this.vadNext) {
        // a frame that is mostly exact zeros is start-up / dropout silence, not room tone
        const db = this.vadCount > 0 && this.vadZeros * 2 < this.vadCount ? toDb(Math.sqrt(this.vadSum / this.vadCount)) : DB_FLOOR;
        this.levels.push(db);
        this.vadSum = 0;
        this.vadZeros = 0;
        this.vadCount = 0;
        this.vadFrame++;
        this.vadNext = this.frameEdge(this.vadFrame + 1);
        for (const e of this.vad.process(db)) this.dispatchVad(e);
      }
    }

    // 16 kHz stream + pitch
    const y = this.resampler.process(chunk);
    if (y.length) {
      this.pcm16.push(y);
      this.emitPitch(this.pitchTracker.push(y));
    }
    this.total += n;
    this.dspMs += now() - t0;
  }

  private emitPitch(frames: PitchFrame[]): void {
    for (const f of frames) {
      this.pitch.push(f);
      this.h.onPitch?.(f);
    }
  }

  private dispatchVad(e: ReturnType<VadDetector["process"]>[number]): void {
    if (e.type === "start") {
      this.vadLog.push({ type: "start", t: e.t });
      this.h.onSpeechStart?.({ t: e.t });
    } else if (e.type === "end") {
      this.vadLog.push({ type: e.rejected ? "rejected" : "end", t: e.t });
      this.h.onSpeechEnd?.(e.rejected ? { t: e.t, rejected: true } : { t: e.t });
    } else {
      this.vadLog.push({ type: "stop", t: e.t, reason: e.reason });
      this.autoStopped = e.reason;
      this.h.onAutoStop?.(e.reason, e.t);
    }
  }

  /**
   * End the take: flush resampler + pitch tracker, refine the speech region with the final
   * noise floor, trim to speech ± pre/post-roll on the 10 ms grid, and build the Take.
   */
  finish(reason: StopReason, extraStats: Partial<TakeStats> = {}): Take {
    if (this.finished) throw new Error("CapturePipeline: finish() called twice");
    this.finished = true;
    const t0 = now();
    const closing = this.vad.close();
    if (closing) this.dispatchVad(closing);
    if (reason !== "vad" && reason !== "max") this.vadLog.push({ type: "stop", t: this.time, reason });
    else if (!this.vadLog.some((e) => e.type === "stop")) this.vadLog.push({ type: "stop", t: this.time, reason });

    const tail = this.resampler.flush();
    if (tail.length) {
      this.pcm16.push(tail);
      this.emitPitch(this.pitchTracker.push(tail));
    }
    this.emitPitch(this.pitchTracker.flush());

    const sr = this.sampleRate;
    const n16 = this.pcm16.length;
    const duration = n16 / MODEL_RATE;
    const o = this.vad.opts;
    const fs = o.frameMs / 1000;
    let rawSpeech: SpeechRegion | null = null;
    if (this.vad.speechStart !== null) {
      const live = { start: this.vad.speechStart, end: this.vad.speechEnd ?? this.time };
      rawSpeech = refineSpeechRegion(this.levels, live, { start: this.vad.floorAtStartDb, end: this.vad.floorDb }, { frameMs: o.frameMs, offsetDb: o.offsetDb });
      rawSpeech.end = Math.min(rawSpeech.end, duration);
    }
    // trim span on the 10 ms grid (so take.pitch stays on analyzePitch's frame grid)
    let a = 0;
    let b = duration;
    if (rawSpeech) {
      a = Math.max(0, Math.floor((rawSpeech.start - o.preRollMs / 1000) / fs + 1e-9) * fs);
      b = Math.min(duration, Math.ceil((rawSpeech.end + o.postRollMs / 1000) / fs - 1e-9) * fs);
    }
    const a16 = Math.round(a * MODEL_RATE);
    const b16 = Math.max(a16, Math.min(n16, Math.round(b * MODEL_RATE)));
    const aRaw = Math.round(a * sr);
    const bRaw = Math.max(aRaw, Math.min(this.raw.length, Math.round(b * sr)));
    const hop = this.pitchTracker.hop;
    const k0 = Math.round(a16 / hop);
    const pitch: PitchFrame[] = [];
    for (const f of this.pitch) {
      const k = Math.round((f.t * MODEL_RATE) / hop);
      if (k * hop >= a16 && k * hop < b16) pitch.push({ t: ((k - k0) * hop) / MODEL_RATE, f0: f.f0, rms: f.rms });
    }
    const pcm = this.raw.slice(aRaw, bRaw);
    const norm = rawSpeech && this.opts.playback !== false && pcm.length > 0 ? normalizeLoudness(pcm, sr, this.opts.playback || {}) : null;
    this.dspMs += now() - t0;

    const stats: TakeStats = {
      sampleRate: sr,
      rawDuration: this.time,
      floorDb: this.vad.floorDb,
      speechPeakDb: this.vad.speechPeakDb,
      vadEvents: this.vadLog.slice(),
      frameGaps: 0,
      droppedFrames: 0,
      dspLoad: this.time > 0 ? this.dspMs / 1000 / this.time : 0,
      pitchLatencyMs: null,
      transportLatencyMs: null,
      loudness: norm && { inputLufs: norm.inputLufs, outputLufs: norm.outputLufs, gainDb: norm.gainDb, limiterDb: norm.limiterDb, truePeakDb: norm.truePeakDb },
      ...extraStats,
    };
    const take: Take = {
      sampleRate: sr,
      pcm,
      playback: norm ? norm.pcm : pcm,
      pcm16k: this.pcm16.slice(a16, b16),
      duration: (b16 - a16) / MODEL_RATE,
      offset: a16 / MODEL_RATE,
      speech: rawSpeech ? { start: Math.max(0, rawSpeech.start - a), end: Math.min(b, rawSpeech.end) - a } : null,
      pitch,
      stopReason: reason,
      stats,
    };
    if (this.opts.keepRaw) {
      take.raw = { pcm: this.raw.slice(), pcm16k: this.pcm16.slice(), speech: rawSpeech, pitch: this.pitch.slice(), levels: Float32Array.from(this.levels) };
    }
    return take;
  }
}
