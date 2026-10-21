/**
 * One AudioContext shared by MicRecorder and Player, plus the iOS audio-session dance.
 * Browser-only (no React). Nothing touches `window` until first use, so importing is SSR-safe.
 *
 * iOS Safari rules this file encodes:
 * - An AudioContext only starts inside a user gesture: `unlock()` must be called synchronously
 *   from the tap handler (before any `await`). It calls resume() and starts a 1-sample silent
 *   buffer in that same call stack (the classic unlock, harmless elsewhere).
 * - While a page captures audio, WebKit lets it start/resume audio without a gesture, so the
 *   recorder may recover a bounced context after getUserMedia() has resolved.
 * - Never pass `sampleRate` to the AudioContext: use the hardware rate (48 kHz on most iPhones,
 *   44.1 kHz on some routes/older devices, 16/24 kHz with Bluetooth HFP) and resample ourselves.
 *   Forcing a rate makes WebKit resample the mic and has produced crackle / pitch-shifted audio.
 * - `navigator.audioSession.type` (Safari 16.4+): "play-and-record" while the mic is open,
 *   "playback" otherwise. Without it, audio played after a recording can stay on the quiet
 *   earpiece receiver (the PlayAndRecord route), and Web Audio is muted by the silent switch;
 *   "playback" routes to the loudspeaker and plays through the switch like a media app.
 * - The context can become "interrupted" (WebKit-only state: phone call, Siri, alarm, another
 *   app taking the session, page backgrounded). resume() may then never settle, so every resume
 *   is raced against a timeout and a dead context is replaced by a fresh one.
 * - `visibilitychange` → visible: try resume() quietly; if that is refused, the next tap's
 *   unlock() does it.
 */

export type AudioSessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";

type AudioSessionLike = { type: AudioSessionType; state?: string };
type WithAudioSession = Navigator & { audioSession?: AudioSessionLike };
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** AudioContext state including WebKit's "interrupted" */
export type ContextState = AudioContextState | "interrupted";

const RESUME_TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

class AudioCore {
  private ctx: AudioContext | null = null;
  private listeners = new Set<(ctx: AudioContext, state: ContextState) => void>();
  private visibilityHooked = false;
  /** how many times a dead/interrupted context was replaced */
  recreated = 0;
  /** set by MicRecorder while the microphone is open */
  capturing = false;

  /** the shared context, if one exists */
  get current(): AudioContext | null {
    return this.ctx;
  }

  state(): ContextState | "none" {
    return this.ctx ? (this.ctx.state as ContextState) : "none";
  }

  /** create the context if missing or closed (it starts suspended outside a gesture) */
  ensure(): AudioContext {
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) throw new Error("Web Audio is not supported in this browser");
    const ctx = new Ctor({ latencyHint: "interactive" });
    ctx.addEventListener("statechange", () => this.emit(ctx));
    this.ctx = ctx;
    this.hookVisibility();
    this.emit(ctx);
    return ctx;
  }

  /**
   * Call synchronously inside a user-gesture handler (click/pointerup/keydown), before any await.
   * Resolves with a running context; if the old one is stuck (interrupted), it is replaced —
   * the replacement may still be suspended when no gesture/capture is active (check `.state`).
   */
  unlock(): Promise<AudioContext> {
    const ctx = this.ensure();
    // transient activation = we really are inside a gesture (Chrome 72+, Safari 16.4+, Firefox 120+)
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    const inGesture = activation ? activation.isActive : true;
    const resumed = ctx.state === "running" ? Promise.resolve() : ctx.resume();
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
    const stuck = () => {
      const st = ctx.state as ContextState;
      // "interrupted" never comes back by itself on some iOS versions; a suspended context that
      // ignored resume() inside a real gesture is dead too. Outside a gesture (Chrome autoplay
      // policy) suspended is expected — keep it, the next tap will start it.
      return st === "interrupted" || (st === "suspended" && inGesture);
    };
    return withTimeout(resumed, RESUME_TIMEOUT_MS).then(
      () => (stuck() ? this.recover(ctx) : ctx),
      () => (stuck() ? this.recover(ctx) : ctx),
    );
  }

  /** resume without a gesture (allowed while capturing); replace the context if it won't run */
  async resumeOrRecreate(): Promise<AudioContext> {
    const ctx = this.ensure();
    if (ctx.state === "running") return ctx;
    try {
      await withTimeout(ctx.resume(), RESUME_TIMEOUT_MS);
      if ((ctx.state as ContextState) === "running") return ctx;
    } catch {
      /* fall through */
    }
    return this.recover(ctx);
  }

  private async recover(dead: AudioContext): Promise<AudioContext> {
    if (this.ctx !== dead) return this.ensure();
    if ((dead.state as ContextState) === "running") return dead;
    try {
      void dead.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.recreated++;
    const fresh = this.ensure();
    try {
      await withTimeout(fresh.resume(), RESUME_TIMEOUT_MS);
    } catch {
      /* still suspended: the next gesture's unlock() will start it */
    }
    return fresh;
  }

  /** navigator.audioSession.type (Safari 16.4+); a no-op elsewhere */
  setSessionType(type: AudioSessionType): void {
    const s = typeof navigator !== "undefined" ? (navigator as WithAudioSession).audioSession : undefined;
    if (!s) return;
    try {
      if (s.type !== type) s.type = type;
    } catch {
      /* ignore */
    }
  }

  sessionType(): AudioSessionType | null {
    const s = typeof navigator !== "undefined" ? (navigator as WithAudioSession).audioSession : undefined;
    return s ? s.type : null;
  }

  /** subscribe to context state changes and replacements */
  onChange(cb: (ctx: AudioContext, state: ContextState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(ctx: AudioContext): void {
    for (const cb of this.listeners) {
      try {
        cb(ctx, ctx.state as ContextState);
      } catch {
        /* listener errors must not break audio */
      }
    }
  }

  private hookVisibility(): void {
    if (this.visibilityHooked || typeof document === "undefined") return;
    this.visibilityHooked = true;
    const wake = () => {
      const ctx = this.ctx;
      if (document.visibilityState !== "visible" || !ctx) return;
      if (ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake); // back/forward-cache restore
  }
}

/** the page-wide audio core */
export const audioCore = new AudioCore();
