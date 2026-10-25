/**
 * Audio engine (framework-free TypeScript).
 *
 * Runs anywhere (page, Node tests, build scripts — import the files directly in Node ≥ 22.18):
 *   pitch.ts     analyzePitch / PitchTracker (YIN)
 *   resample.ts  resample / StreamResampler (any rate → 16 kHz)
 *   vad.ts       VadDetector / refineSpeechRegion
 *   pipeline.ts  CapturePipeline (level + VAD + 16 kHz + live pitch for one take)
 *   dsp.ts       rms / dBFS / silence trim / Biquad
 *   wav.ts       encodeWav / decodeWav
 *   loudness.ts  integratedLoudness (BS.1770 LUFS) / truePeak / normalizeLoudness
 *
 * Browser only (safe to import during SSR — nothing runs until called):
 *   context.ts   audioCore — the shared AudioContext + iOS audio session handling
 *   mic-recorder.ts  MicRecorder
 *   player.ts    Player
 */

export * from "./types.ts";
export { analyzePitch, PitchTracker, semitoneDiff, type PitchOptions } from "./pitch.ts";
export { resample, StreamResampler, type ResamplerOptions } from "./resample.ts";
export { VadDetector, refineSpeechRegion, type VadOptions, type VadEvent, type VadState } from "./vad.ts";
export { CapturePipeline, MODEL_RATE, type CapturePipelineOptions, type CaptureHandlers } from "./pipeline.ts";
export { rms, rmsDb, peak, toDb, fromDb, findSilenceTrim, trimSilence, Biquad, Float32Growable, concatFloat32, percentile, summarize, DB_FLOOR, type TrimOptions } from "./dsp.ts";
export { encodeWav, decodeWav, type DecodedWav } from "./wav.ts";
export { integratedLoudness, truePeak, normalizeLoudness, type NormalizeOptions, type Normalized } from "./loudness.ts";
export { audioCore, type AudioSessionType, type ContextState } from "./context.ts";
export { CAPTURE_PROCESSOR_NAME, CAPTURE_WORKLET_SOURCE } from "./capture-worklet.ts";
export { MicRecorder, type MicRecorderOptions, type MicRecorderEvents, type MicConstraints, type RecorderState, type RecorderDiagnostics, type CaptureMode } from "./mic-recorder.ts";
export { Player, type Playable, type PlayItem, type PlayheadEvent, type PlayerEvents } from "./player.ts";
