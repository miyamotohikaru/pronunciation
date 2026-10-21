/**
 * Shared types for the audio engine. No browser or Node dependencies.
 * Times are seconds, levels are linear amplitude (full scale = 1) unless a name says "Db".
 */

/** One pitch frame. `f0` is Hz or null when unvoiced; `rms` is linear amplitude of the analysis window. */
export type PitchFrame = { t: number; f0: number | null; rms: number };

/** ~60 fps level for a VU meter (computed on the raw input, before any filtering). */
export type LevelEvent = {
  /** seconds since the recording started */
  t: number;
  rms: number;
  peak: number;
  /** rms in dBFS (floored at -100) */
  db: number;
  /** current VAD noise floor in dBFS */
  floorDb: number;
  /** VAD is inside an utterance */
  speaking: boolean;
  /** peak reached full scale in this window */
  clipped: boolean;
};

export type SpeechStartEvent = { t: number };
/** `rejected` = the "utterance" was shorter than VadOptions.minSpeechMs (click, bump) and was discarded. */
export type SpeechEndEvent = { t: number; rejected?: boolean };

export type StopReason =
  | "vad" // post-speech silence reached VadOptions.endSilenceMs
  | "manual" // stop() was called
  | "max" // VadOptions.maxDurationMs reached
  | "interrupted" // page hidden, context interrupted, track muted (phone call, Siri…)
  | "ended"; // track ended (device unplugged, permission revoked)

export type SpeechRegion = { start: number; end: number };

export type VadEventLog = { type: "start" | "end" | "rejected" | "stop"; t: number; reason?: StopReason };

/** Everything the engine knows about one take, for the debug panel and the e2e test. */
export type TakeStats = {
  /** input (AudioContext) sample rate */
  sampleRate: number;
  /** seconds of audio received in total (untrimmed) */
  rawDuration: number;
  /** noise floor at the end of the take (dBFS) */
  floorDb: number;
  /** loudest 10 ms frame inside speech (dBFS), -100 if no speech */
  speechPeakDb: number;
  vadEvents: VadEventLog[];
  /** worklet chunks whose start frame did not follow the previous chunk */
  frameGaps: number;
  /** samples missing according to those gaps */
  droppedFrames: number;
  /** main-thread DSP time / audio time (0.02 = 2 % of one core) */
  dspLoad: number;
  /** ms from "audio of time t reached the capture node" to "onPitch for t fired" */
  pitchLatencyMs: { median: number; p95: number; max: number; n: number } | null;
  /** ms between the end of a worklet chunk and its processing on the main thread */
  transportLatencyMs: { median: number; p95: number; max: number; n: number } | null;
  /** Take.playback normalisation (null when no utterance was found → played as recorded) */
  loudness: { inputLufs: number; outputLufs: number; gainDb: number; limiterDb: number; truePeakDb: number } | null;
};

export type Take = {
  /** sample rate of `pcm` (the capture rate: 48000, 44100, …) */
  sampleRate: number;
  /** mono Float32 at the capture rate, trimmed to speech ± pre/post-roll, as recorded */
  pcm: Float32Array;
  /**
   * `pcm` loudness-normalised for listening: −18 LUFS, true peak ≤ −1 dBTP (the reference
   * audio's target; iOS takes arrive 20–30 dB quiet without AGC). Player uses it automatically
   * when you pass the Take itself: `player.play(take)`.
   */
  playback: Float32Array;
  /** the same span resampled to 16 kHz mono — feed this to the speech model and analyzePitch */
  pcm16k: Float32Array;
  /** seconds (= pcm16k.length / 16000) */
  duration: number;
  /** where the trimmed span starts inside the raw recording (s, multiple of 10 ms) */
  offset: number;
  /** detected utterance, relative to the trimmed take; null if VAD never fired */
  speech: SpeechRegion | null;
  /** live pitch frames, re-timed to the trimmed take (identical to analyzePitch(raw) frames) */
  pitch: PitchFrame[];
  stopReason: StopReason;
  stats: TakeStats;
  /** untrimmed buffers (only with keepRaw) — times relative to the recording start */
  raw?: {
    pcm: Float32Array;
    pcm16k: Float32Array;
    speech: SpeechRegion | null;
    pitch: PitchFrame[];
    /** the 10 ms VAD frame levels (dBFS, 100 Hz high-passed) */
    levels: Float32Array;
  };
};
