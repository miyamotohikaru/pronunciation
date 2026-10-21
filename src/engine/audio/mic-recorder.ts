/**
 * Microphone takes: getUserMedia → AudioWorklet (or ScriptProcessor) → CapturePipeline.
 * Browser-only, framework-free.
 *
 *   const rec = new MicRecorder({ workletUrl: "/worklets/mic-capture.js" }, { onLevel, onPitch, … });
 *   button.onclick = () => rec.state === "idle" ? rec.record().then(show) : rec.stop();
 *
 * record() must be called from the tap handler itself: the first thing it does (synchronously)
 * is unlock the shared AudioContext and switch the iOS audio session to play-and-record.
 * It resolves when the take ends — VAD auto-stop, stop(), the 12 s cap, or an interruption
 * (see Take.stopReason) — and rejects if the microphone can't be opened.
 *
 * The mic is opened per take and released right after (tracks stopped): iOS otherwise keeps
 * the PlayAndRecord route (quiet earpiece playback, recording indicator) and Bluetooth headsets
 * stay in low-quality HFP mode. Re-opening is fast: the permission, the AudioContext and the
 * worklet module are kept.
 */

import { audioCore, type ContextState } from "./context.ts";
import { CAPTURE_PROCESSOR_NAME, CAPTURE_WORKLET_SOURCE } from "./capture-worklet.ts";
import { summarize } from "./dsp.ts";
import type { PitchOptions } from "./pitch.ts";
import { CapturePipeline, type CaptureHandlers } from "./pipeline.ts";
import type { StopReason, Take } from "./types.ts";
import type { VadOptions } from "./vad.ts";

export type MicConstraints = {
  /** default false — AEC/NS smear s, th, f, which we score */
  echoCancellation?: boolean;
  /** default false */
  noiseSuppression?: boolean;
  /** default true */
  autoGainControl?: boolean;
  deviceId?: string;
};

export type MicRecorderOptions = {
  constraints?: MicConstraints;
  vad?: VadOptions;
  pitch?: Omit<PitchOptions, "sampleRate">;
  /** same-origin URL serving CAPTURE_WORKLET_SOURCE; falls back to a Blob URL, then ScriptProcessor */
  workletUrl?: string;
  /** skip the AudioWorklet (debug / comparison) */
  forceScriptProcessor?: boolean;
  /** keep untrimmed buffers in Take.raw (debug, tests) */
  keepRaw?: boolean;
  /** frames per worklet message (latency vs message rate). Default 256 (5.3 ms at 48 kHz) */
  chunkFrames?: number;
  levelFps?: number;
};

export type RecorderState = "idle" | "starting" | "recording" | "stopping";

export type MicRecorderEvents = CaptureHandlers & {
  onStateChange?: (s: RecorderState) => void;
};

export type CaptureMode = "audio-worklet" | "script-processor";

export type RecorderDiagnostics = {
  crossOriginIsolated: boolean;
  captureMode: CaptureMode | null;
  /** where the worklet module came from */
  workletSource: "url" | "blob" | null;
  workletError: string | null;
  contextRate: number | null;
  /** differs from contextRate only when a dedicated capture context was needed (Firefox) */
  captureRate: number | null;
  contextState: ContextState | "none";
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  sessionType: string | null;
  contextRecreated: number;
  track: { label: string; settings: MediaTrackSettings } | null;
  /** Chrome's MediaStreamTrack.stats (frames the browser delivered vs. produced), if available */
  trackStats: { deliveredFrames: number; totalFrames: number; latencyMs: number | null } | null;
  /** tap → first audio chunk (ms) */
  startupMs: number | null;
  chunks: number;
  frameGaps: number;
  droppedFrames: number;
  /** first gaps: where (s from the first sample) and how many frames (negative = overlap) */
  gapLog: { t: number; frames: number }[];
  /** frames skipped before the first non-zero input sample (Chrome start-up; filled with zeros) */
  startupGapFrames: number;
  lastError: string | null;
};

type AudioMsg = { type: "audio"; frame: number; data: Float32Array; live: boolean };
type TrackStats = { deliveredFrames?: number; totalFrames?: number; latency?: number };

const blobUrls = new WeakMap<BaseAudioContext, string>();
const loaded = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

function addModuleOnce(ctx: BaseAudioContext, url: string): Promise<void> {
  let m = loaded.get(ctx);
  if (!m) loaded.set(ctx, (m = new Map()));
  let p = m.get(url);
  if (!p) {
    p = ctx.audioWorklet.addModule(url);
    m.set(url, p);
    p.catch(() => m?.delete(url)); // allow a retry
  }
  return p;
}

/** load the capture processor into `ctx`: given URL first, inline Blob URL second */
async function loadCaptureWorklet(ctx: BaseAudioContext, url: string | undefined): Promise<"url" | "blob"> {
  let firstError: unknown = null;
  if (url) {
    try {
      await addModuleOnce(ctx, url);
      return "url";
    } catch (e) {
      firstError = e;
    }
  }
  let blob = blobUrls.get(ctx);
  if (!blob) {
    blob = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }));
    blobUrls.set(ctx, blob);
  }
  try {
    await addModuleOnce(ctx, blob);
    return "blob";
  } catch (e) {
    throw firstError ?? e;
  }
}

export class MicRecorder {
  readonly diagnostics: RecorderDiagnostics = {
    crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false,
    captureMode: null,
    workletSource: null,
    workletError: null,
    contextRate: null,
    captureRate: null,
    contextState: "none",
    baseLatencyMs: null,
    outputLatencyMs: null,
    sessionType: null,
    contextRecreated: 0,
    track: null,
    trackStats: null,
    startupMs: null,
    chunks: 0,
    frameGaps: 0,
    droppedFrames: 0,
    gapLog: [],
    startupGapFrames: 0,
    lastError: null,
  };

  private readonly opts: MicRecorderOptions;
  private readonly ev: MicRecorderEvents;
  private _state: RecorderState = "idle";
  // per-take
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private ownsCtx = false;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private mute: GainNode | null = null;
  private pipeline: CapturePipeline | null = null;
  private resolveTake: ((t: Take) => void) | null = null;
  private rejectTake: ((e: unknown) => void) | null = null;
  private pendingStop: StopReason | null = null;
  private cancelled = false;
  private tapAt = 0;
  private sample0 = -1; // context frame of the first captured sample
  private nextFrame = -1;
  private inputLive = false; // the input has delivered real samples
  private pitchLat: number[] = [];
  private transportLat: number[] = [];
  private cleanups: (() => void)[] = [];

  constructor(opts: MicRecorderOptions = {}, events: MicRecorderEvents = {}) {
    this.opts = opts;
    this.ev = events;
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && !!(window.AudioContext ?? (window as Window & { webkitAudioContext?: unknown }).webkitAudioContext);
  }

  get state(): RecorderState {
    return this._state;
  }

  private setState(s: RecorderState): void {
    if (this._state === s) return;
    this._state = s;
    this.ev.onStateChange?.(s);
  }

  /**
   * Optional warm-up (no gesture needed): create the shared context (suspended) and load the
   * worklet module, so the first record() starts faster.
   */
  async prepare(): Promise<void> {
    if (this.opts.forceScriptProcessor) return;
    try {
      const ctx = audioCore.ensure();
      if (ctx.audioWorklet) await loadCaptureWorklet(ctx, this.opts.workletUrl);
    } catch {
      /* record() will retry and fall back */
    }
  }

  /** start a take — call synchronously from a user gesture. Resolves when the take ends. */
  record(): Promise<Take> {
    if (this._state !== "idle") return Promise.reject(new Error(`MicRecorder is ${this._state}`));
    if (!MicRecorder.isSupported()) {
      return Promise.reject(
        new Error(typeof isSecureContext !== "undefined" && !isSecureContext ? "The microphone needs HTTPS (or localhost)" : "This browser cannot record audio"),
      );
    }
    // --- synchronous part: still inside the user gesture ---
    let unlocked: Promise<AudioContext>;
    try {
      audioCore.setSessionType("play-and-record"); // before getUserMedia, so iOS switches route once
      unlocked = audioCore.unlock();
    } catch (e) {
      return Promise.reject(e);
    }
    audioCore.capturing = true;
    this.setState("starting");
    this.tapAt = performance.now();
    this.pendingStop = null;
    this.cancelled = false;
    const take = new Promise<Take>((resolve, reject) => {
      this.resolveTake = resolve;
      this.rejectTake = reject;
    });
    this.begin(unlocked).catch((e) => this.fail(e));
    return take;
  }

  /** end the take now (record() resolves with what was captured) */
  stop(): void {
    if (this._state === "starting") this.pendingStop = "manual";
    else if (this._state === "recording") this.finish("manual");
  }

  /** abandon the take (record() rejects with an AbortError) */
  cancel(): void {
    if (this._state === "idle") return;
    this.cancelled = true;
    if (this._state === "recording") this.finish("manual");
  }

  private async begin(unlocked: Promise<AudioContext>): Promise<void> {
    const c = this.opts.constraints ?? {};
    const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {};
    const audio: MediaTrackConstraints & { voiceIsolation?: boolean } = {
      echoCancellation: c.echoCancellation ?? false,
      noiseSuppression: c.noiseSuppression ?? false,
      autoGainControl: c.autoGainControl ?? true,
      channelCount: { ideal: 1 },
    };
    if (c.deviceId) audio.deviceId = { exact: c.deviceId };
    // Chrome 135+/macOS platform voice isolation also smears fricatives — off unless NS is wanted
    if ((supported as Record<string, boolean>).voiceIsolation) audio.voiceIsolation = c.noiseSuppression ?? false;

    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.stream = stream;
    if (this.cancelled) throw new DOMException("cancelled", "AbortError");
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("no audio track");

    // iOS may bounce the context to "interrupted" while it reconfigures the session for capture;
    // capture is active now, so resuming (or recreating) without a gesture is allowed.
    await unlocked.catch(() => undefined);
    let ctx = await audioCore.resumeOrRecreate();
    this.ctx = ctx;
    this.ownsCtx = false;

    let source: MediaStreamAudioSourceNode;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch (e) {
      // Firefox throws NotSupportedError when the mic rate ≠ context rate: capture in a
      // dedicated context at the track's rate (playback stays on the shared one).
      const rate = track.getSettings().sampleRate;
      if (!rate || rate === ctx.sampleRate) throw e;
      ctx = new AudioContext({ sampleRate: rate, latencyHint: "interactive" });
      this.ctx = ctx;
      this.ownsCtx = true;
      await ctx.resume().catch(() => undefined);
      source = ctx.createMediaStreamSource(stream);
    }
    this.source = source;

    const rate = ctx.sampleRate;
    const self = this;
    this.pipeline = new CapturePipeline(
      { sampleRate: rate, vad: this.opts.vad, pitch: this.opts.pitch, keepRaw: this.opts.keepRaw, levelFps: this.opts.levelFps },
      {
        onLevel: this.ev.onLevel,
        onSpeechStart: this.ev.onSpeechStart,
        onSpeechEnd: this.ev.onSpeechEnd,
        onPitch(f) {
          if (self.ctx && self.sample0 >= 0) self.pitchLat.push((self.ctx.currentTime - self.sample0 / rate - f.t) * 1000);
          self.ev.onPitch?.(f);
        },
        onAutoStop: (reason) => queueMicrotask(() => this.finish(reason)),
      },
    );
    this.sample0 = -1;
    this.nextFrame = -1;
    this.pitchLat = [];
    this.transportLat = [];
    Object.assign(this.diagnostics, { chunks: 0, frameGaps: 0, droppedFrames: 0, gapLog: [], startupGapFrames: 0, startupMs: null, lastError: null, trackStats: null });
    this.inputLive = false;

    // capture node
    let node: AudioWorkletNode | ScriptProcessorNode | null = null;
    this.diagnostics.workletError = null;
    if (!this.opts.forceScriptProcessor && ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        this.diagnostics.workletSource = await loadCaptureWorklet(ctx, this.opts.workletUrl);
        const wn = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: "explicit", // the browser downmixes stereo mics to mono for us
          channelInterpretation: "speakers",
          processorOptions: { chunkFrames: this.opts.chunkFrames ?? 256 },
        });
        wn.port.onmessage = (e: MessageEvent<AudioMsg>) => this.onWorkletChunk(e.data);
        node = wn;
        this.diagnostics.captureMode = "audio-worklet";
      } catch (e) {
        this.diagnostics.workletError = String((e as Error)?.message ?? e);
        this.diagnostics.workletSource = null;
      }
    }
    if (!node) {
      // deprecated but universal; must be connected to the destination to fire (Chrome)
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = (e) => this.onScriptChunk(e);
      node = sp;
      this.diagnostics.captureMode = "script-processor";
    }
    this.node = node;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.mute = mute;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination); // keeps the node pulled by the render graph in every engine

    // interruptions
    // - page hidden / pagehide: iOS stops capture in the background → end the take now
    // - track "ended": device unplugged, permission revoked → end now
    // - track "mute" and context "interrupted"/"suspended": a phone call, Siri or another app
    //   took the session — or just a route change (Bluetooth HFP ↔ A2DP, headphones plugged),
    //   which bounces the context for a moment when the mic opens. Try to resume (allowed while
    //   capturing) and end the take only if it hasn't recovered after GRACE_MS.
    const GRACE_MS = 1500;
    let muteTimer: ReturnType<typeof setTimeout> | undefined;
    let ctxTimer: ReturnType<typeof setTimeout> | undefined;
    const onHidden = () => {
      if (document.visibilityState === "hidden") this.finish("interrupted");
    };
    const onPageHide = () => this.finish("interrupted");
    const onEnded = () => this.finish("ended");
    const onMute = () => {
      clearTimeout(muteTimer);
      muteTimer = setTimeout(() => track.muted && this.finish("interrupted"), GRACE_MS);
    };
    const onUnmute = () => clearTimeout(muteTimer);
    const onCtxState = () => {
      const st = ctx.state as ContextState;
      clearTimeout(ctxTimer);
      if (st === "running") return;
      if (st === "closed") {
        this.finish("interrupted");
        return;
      }
      ctx.resume().catch(() => undefined);
      ctxTimer = setTimeout(() => (ctx.state as ContextState) !== "running" && this.finish("interrupted"), GRACE_MS);
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    track.addEventListener("ended", onEnded);
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    ctx.addEventListener("statechange", onCtxState);
    this.cleanups.push(() => {
      clearTimeout(muteTimer);
      clearTimeout(ctxTimer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      track.removeEventListener("ended", onEnded);
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
      ctx.removeEventListener("statechange", onCtxState);
    });

    this.updateDiagnostics(track);
    this.setState("recording");
    if (this.cancelled) this.finish("manual");
    else if (this.pendingStop) this.finish(this.pendingStop);
  }

  private onWorkletChunk(m: AudioMsg): void {
    if (this._state !== "recording" || !this.pipeline || m.type !== "audio") return;
    this.accept(m.frame, m.data, m.live);
  }

  private onScriptChunk(e: AudioProcessingEvent): void {
    if (this._state !== "recording" || !this.pipeline || !this.ctx) return;
    const data = e.inputBuffer.getChannelData(0).slice();
    // ScriptProcessor hands over every input block in order, so blocks are contiguous by
    // construction (playbackTime jitters by a block now and then — useless for gap detection);
    // it only anchors the first block on the context clock for the latency figures.
    const frame = this.nextFrame >= 0 ? this.nextFrame : Math.max(0, Math.round(e.playbackTime * this.ctx.sampleRate) - data.length);
    this.accept(frame, data, true);
  }

  private accept(frame: number, data: Float32Array, live: boolean): void {
    const p = this.pipeline as CapturePipeline;
    const ctx = this.ctx as AudioContext;
    const d = this.diagnostics;
    if (this.sample0 < 0) {
      this.sample0 = frame;
      this.nextFrame = frame;
      d.startupMs = performance.now() - this.tapAt;
    }
    const gap = frame - this.nextFrame;
    if (gap !== 0) {
      if (!this.inputLive) {
        if (gap > 0) d.startupGapFrames += gap; // no mic samples existed yet: nothing was lost
      } else {
        d.frameGaps++;
        if (d.gapLog.length < 20) d.gapLog.push({ t: (this.nextFrame - this.sample0) / ctx.sampleRate, frames: gap });
        if (gap > 0) d.droppedFrames += gap;
      }
      if (gap > 0) {
        // keep the timeline continuous (karaoke sync, VAD timing): fill up to 1 s with silence
        const fill = Math.min(gap, ctx.sampleRate);
        p.push(new Float32Array(fill));
      }
    }
    this.nextFrame = frame + data.length;
    // "live" = real samples, not the zeros a source delivers while it warms up
    if (live && !this.inputLive) {
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) {
          this.inputLive = true;
          break;
        }
      }
    }
    d.chunks++;
    this.transportLat.push((ctx.currentTime - (frame + data.length) / ctx.sampleRate) * 1000);
    p.push(data);
  }

  private updateDiagnostics(track?: MediaStreamTrack): void {
    const d = this.diagnostics;
    const shared = audioCore.current;
    d.contextRate = shared ? shared.sampleRate : null;
    d.captureRate = this.ctx ? this.ctx.sampleRate : null;
    d.contextState = audioCore.state();
    d.baseLatencyMs = shared && typeof shared.baseLatency === "number" ? shared.baseLatency * 1000 : null;
    d.outputLatencyMs = shared && typeof shared.outputLatency === "number" ? shared.outputLatency * 1000 : null;
    d.sessionType = audioCore.sessionType();
    d.contextRecreated = audioCore.recreated;
    if (track) {
      d.track = { label: track.label, settings: track.getSettings() };
      const s = (track as MediaStreamTrack & { stats?: TrackStats }).stats;
      if (s && typeof s.totalFrames === "number") {
        d.trackStats = { deliveredFrames: s.deliveredFrames ?? 0, totalFrames: s.totalFrames, latencyMs: typeof s.latency === "number" ? s.latency : null };
      }
    }
  }

  private finish(reason: StopReason): void {
    if (this._state !== "recording") return;
    this.setState("stopping");
    const track = this.stream?.getAudioTracks()[0];
    this.updateDiagnostics(track);
    this.teardown();
    const pipeline = this.pipeline as CapturePipeline;
    this.pipeline = null;
    let take: Take | null = null;
    try {
      take = pipeline.finish(reason, {
        frameGaps: this.diagnostics.frameGaps,
        droppedFrames: this.diagnostics.droppedFrames,
        pitchLatencyMs: summarize(this.pitchLat),
        transportLatencyMs: summarize(this.transportLat),
      });
    } catch (e) {
      this.settle(null, e);
      return;
    }
    if (this.cancelled) this.settle(null, new DOMException("cancelled", "AbortError"));
    else this.settle(take, null);
  }

  /** stop audio flow, release the mic, restore the playback session */
  private teardown(): void {
    for (const f of this.cleanups.splice(0)) f();
    const node = this.node;
    if (node) {
      if (node instanceof ScriptProcessorNode) node.onaudioprocess = null;
      else {
        node.port.onmessage = null;
        try {
          node.port.postMessage({ type: "stop" });
        } catch {
          /* ignore */
        }
      }
    }
    for (const n of [this.source, node, this.mute]) {
      try {
        n?.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.source = null;
    this.node = null;
    this.mute = null;
    // release the microphone so iOS leaves the PlayAndRecord route (earpiece trap, HFP)
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    audioCore.capturing = false;
    audioCore.setSessionType("playback");
    if (this.ownsCtx && this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.ownsCtx = false;
  }

  private fail(e: unknown): void {
    this.diagnostics.lastError = String((e as Error)?.message ?? e);
    this.teardown();
    this.pipeline = null;
    this.settle(null, e);
  }

  private settle(take: Take | null, err: unknown): void {
    const resolve = this.resolveTake;
    const reject = this.rejectTake;
    this.resolveTake = null;
    this.rejectTake = null;
    this.setState("idle");
    if (take && resolve) resolve(take);
    else reject?.(err);
  }
}
