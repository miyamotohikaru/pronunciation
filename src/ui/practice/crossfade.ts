/**
 * Two word clips looping together, mixed by one number (0 = clip A only … 1 = clip B only),
 * equal-power. Drives the sound card's scrubber: drag from お手本 to what the AI heard and the
 * sound turns from one into the other. Uses the engine's one shared AudioContext.
 * start() must run inside the pointer-down (it unlocks the context synchronously).
 */
import { audioCore } from "@/engine/audio/context.ts";

export type Clip = { buffer: AudioBuffer; t0: number; t1: number };

export class Crossfader {
  private nodes: { src: AudioBufferSourceNode; gain: GainNode }[] = [];

  get running() {
    return this.nodes.length > 0;
  }

  start(a: Clip, b: Clip, mix: number) {
    this.stop();
    if (!audioCore.capturing) audioCore.setSessionType("playback");
    void audioCore.unlock(); // synchronous part happens now, inside the gesture
    const ctx = audioCore.ensure();
    const at = ctx.currentTime + 0.02;
    this.nodes = [a, b].map((c, i) => {
      const src = ctx.createBufferSource();
      src.buffer = c.buffer;
      src.loop = true;
      src.loopStart = Math.max(0, c.t0);
      src.loopEnd = Math.min(c.buffer.duration, Math.max(c.t0 + 0.05, c.t1));
      const gain = ctx.createGain();
      gain.gain.value = this.level(i, mix);
      src.connect(gain).connect(ctx.destination);
      src.start(at, src.loopStart);
      return { src, gain };
    });
  }

  setMix(mix: number) {
    const ctx = audioCore.current;
    if (!ctx) return;
    this.nodes.forEach((n, i) => n.gain.gain.setTargetAtTime(this.level(i, mix), ctx.currentTime, 0.03));
  }

  stop() {
    for (const n of this.nodes) {
      try {
        n.src.stop();
      } catch {
        /* already stopped */
      }
      n.src.disconnect();
      n.gain.disconnect();
    }
    this.nodes = [];
  }

  private level(i: number, mix: number) {
    const m = Math.min(1, Math.max(0, mix));
    return i === 0 ? Math.cos((m * Math.PI) / 2) : Math.sin((m * Math.PI) / 2);
  }
}
