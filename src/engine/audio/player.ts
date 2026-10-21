/**
 * Playback for takes and reference audio: whole clip, a [t0, t1] segment ("play just this
 * word"), or an A/B sequence (native → mine), with a playhead callback for karaoke sync.
 * Browser-only, framework-free. Uses the shared AudioContext (see context.ts).
 *
 * Call play() / playSegment() / playSequence() from the tap handler itself: they unlock the
 * AudioContext synchronously before anything else.
 * The playhead follows what is audible (AudioContext.getOutputTimestamp), so Bluetooth output
 * latency doesn't desync the lyric wipe.
 */

import { audioCore } from "./context.ts";

/**
 * An AudioBuffer, or mono PCM with its rate. A Take fits as is — its loudness-normalised
 * `playback` buffer is used when present (so `player.play(take)` is already at −18 LUFS).
 */
export type Playable = AudioBuffer | { pcm: Float32Array; sampleRate: number; playback?: Float32Array };

export type PlayItem = {
  source: Playable;
  /** seconds into the source (default 0) */
  t0?: number;
  /** seconds into the source (default: its end) */
  t1?: number;
  label?: string;
};

export type PlayheadEvent = {
  /** index in the sequence */
  item: number;
  label?: string;
  /** position inside that item's source (s) */
  t: number;
};

export type PlayerEvents = {
  /** ~60 fps while playing (requestAnimationFrame) */
  onPlayhead?: (e: PlayheadEvent) => void;
  /** playback finished or was stopped */
  onEnd?: (completed: boolean) => void;
};

type Scheduled = { item: number; label?: string; at: number; t0: number; dur: number; node: AudioBufferSourceNode };

const pcmBuffers = new WeakMap<Float32Array, AudioBuffer>();

export class Player {
  events: PlayerEvents;
  private scheduled: Scheduled[] = [];
  private gain: GainNode | null = null;
  private raf = 0;
  private done: ((completed: boolean) => void) | null = null;
  private token = 0;

  constructor(events: PlayerEvents = {}) {
    this.events = events;
  }

  get playing(): boolean {
    return this.scheduled.length > 0;
  }

  /** fetch + decode (same-origin or CORP/CORS-enabled URLs only: the page is cross-origin isolated) */
  async load(url: string, init?: RequestInit): Promise<AudioBuffer> {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return this.decode(await res.arrayBuffer());
  }

  /** decodeAudioData (mp3/aac/wav/…); the result is resampled to the context rate */
  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = audioCore.ensure(); // decoding works on a suspended context — no gesture needed
    return new Promise<AudioBuffer>((resolve, reject) => {
      // callback form too: older WebKit returns undefined instead of a promise
      const p = ctx.decodeAudioData(data, resolve, (e) => reject(e ?? new Error("decodeAudioData failed")));
      if (p && typeof p.then === "function") p.then(resolve, reject);
    });
  }

  /** a Playable as an AudioBuffer (PCM is copied once and cached per array) */
  toBuffer(source: Playable): AudioBuffer {
    if (typeof AudioBuffer !== "undefined" && source instanceof AudioBuffer) return source;
    const src = source as { pcm: Float32Array; sampleRate: number; playback?: Float32Array };
    const pcm = src.playback ?? src.pcm;
    const sampleRate = src.sampleRate;
    let b = pcmBuffers.get(pcm);
    if (!b || b.sampleRate !== sampleRate) {
      b = audioCore.ensure().createBuffer(1, Math.max(1, pcm.length), sampleRate);
      b.getChannelData(0).set(pcm);
      pcmBuffers.set(pcm, b);
    }
    return b;
  }

  /** play a whole source, or [t0, t1] of it */
  play(source: Playable, opts: { t0?: number; t1?: number; label?: string } = {}): Promise<boolean> {
    return this.playSequence([{ source, ...opts }]);
  }

  /** play [t0, t1] seconds of a source ("play just this word") */
  playSegment(source: Playable, t0: number, t1: number): Promise<boolean> {
    return this.playSequence([{ source, t0, t1 }]);
  }

  /**
   * Play items back to back (A/B: [{ source: native, label: "native" }, { source: take, label: "mine" }]),
   * `gap` seconds apart. Resolves true when everything played, false if stopped/replaced.
   */
  playSequence(items: PlayItem[], opts: { gap?: number } = {}): Promise<boolean> {
    // synchronous: inside the gesture
    this.stop();
    if (!audioCore.capturing) audioCore.setSessionType("playback");
    const unlocked = audioCore.unlock();
    const token = ++this.token;
    return unlocked.then((ctx) => {
      if (token !== this.token) return false; // superseded by a newer play/stop
      const gap = Math.max(0, opts.gap ?? 0.35);
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      this.gain = gain;
      let at = ctx.currentTime + 0.03; // a little headroom so the first samples aren't clipped
      const list: Scheduled[] = [];
      items.forEach((it, i) => {
        const buffer = this.toBuffer(it.source);
        const t0 = Math.min(Math.max(0, it.t0 ?? 0), buffer.duration);
        const t1 = Math.min(Math.max(t0, it.t1 ?? buffer.duration), buffer.duration);
        const dur = t1 - t0;
        if (dur <= 0) return;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(gain);
        node.start(at, t0, dur);
        list.push({ item: i, label: it.label, at, t0, dur, node });
        at += dur + gap;
      });
      if (list.length === 0) return true;
      this.scheduled = list;
      return new Promise<boolean>((resolve) => {
        this.done = (completed) => {
          this.done = null;
          resolve(completed);
        };
        const last = list[list.length - 1];
        // Backup for background tabs, where requestAnimationFrame stops. `ended` fires when the
        // last sample is *rendered*, i.e. output-latency earlier than it is heard (~200 ms on
        // Bluetooth), so give the rAF loop that long to finish at the audible end first.
        last.node.onended = () => {
          const lat = (typeof ctx.outputLatency === "number" ? ctx.outputLatency : ctx.baseLatency || 0) + 0.25;
          setTimeout(() => {
            if (token === this.token && this.scheduled === list) this.finish(true);
          }, lat * 1000);
        };
        const tick = () => {
          if (token !== this.token || this.scheduled !== list) return;
          const now = this.audibleTime(ctx);
          const cur = list.find((s) => now < s.at + s.dur) ?? last;
          if (now >= last.at + last.dur) {
            this.events.onPlayhead?.({ item: last.item, label: last.label, t: last.t0 + last.dur });
            this.finish(true);
            return;
          }
          this.events.onPlayhead?.({ item: cur.item, label: cur.label, t: cur.t0 + Math.min(cur.dur, Math.max(0, now - cur.at)) });
          this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      });
    });
  }

  /** stop whatever is playing (pending play promises resolve false) */
  stop(): void {
    this.token++;
    if (this.scheduled.length || this.done) this.finish(false);
  }

  private finish(completed: boolean): void {
    cancelAnimationFrame(this.raf);
    for (const s of this.scheduled) {
      s.node.onended = null;
      try {
        s.node.stop();
      } catch {
        /* not started yet / already stopped */
      }
      s.node.disconnect();
    }
    this.scheduled = [];
    this.gain?.disconnect();
    this.gain = null;
    const done = this.done;
    this.done = null;
    done?.(completed);
    this.events.onEnd?.(completed);
  }

  /** context time of the sample leaving the speaker now */
  private audibleTime(ctx: AudioContext): number {
    const ts = typeof ctx.getOutputTimestamp === "function" ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime && ts.performanceTime) {
      return ts.contextTime + Math.max(0, performance.now() - ts.performanceTime) / 1000;
    }
    const lat = typeof ctx.outputLatency === "number" ? ctx.outputLatency : ctx.baseLatency || 0;
    return ctx.currentTime - lat;
  }
}
