/**
 * Listen-only audio for the new corners (a word, a letter's name, the other person's line):
 * one Player of our own (the practice screen's shared player keeps its events), a small decoded
 * buffer cache, and one tiny store that says what is playing now, for the buttons.
 *
 *   play([url], { key })  /  play([a, b, a, b], { key, gap })
 *     call it inside the tap: the AudioContext is unlocked synchronously first; the clips are
 *     fetched and decoded if they are not yet. The same key again while it plays stops it.
 *
 * Clips are written by tools/tts (public/audio/<voice>/<clip>[.slow].mp3). Nothing runs until
 * called, so importing is SSR-safe.
 */
import { useSyncExternalStore } from "react";
import { audioCore } from "@/engine/audio/context.ts";
import { Player, type Playable, type PlayheadEvent } from "@/engine/audio/player.ts";
import { loadSettings } from "../../practice/progress";
import type { VoiceId } from "../../practice/content";

export type ClipSpeed = "" | ".slow";

export const clipUrl = (clip: string, voice: VoiceId, speed: ClipSpeed = "") => `/audio/${voice}/${clip}${speed}.mp3`;

/** the learner's voice (お手本 in the practice settings) */
export function myVoice(): VoiceId {
  return loadSettings().voice;
}
/** the other voice: the conversation partner speaks in it */
export const otherVoice = (v: VoiceId): VoiceId => (v === "af_heart" ? "am_michael" : "af_heart");

// ---------------------------------------------------------------- decoded clips (bounded)

const MAX = 40;
const buffers = new Map<string, Promise<AudioBuffer>>();
let player: Player | null = null;
let playToken = 0;
const getPlayer = () => (player ??= new Player());

export function loadClip(url: string): Promise<AudioBuffer> {
  let p = buffers.get(url);
  if (p) {
    // most recently used goes last
    buffers.delete(url);
    buffers.set(url, p);
    return p;
  }
  p = getPlayer().load(url);
  p.catch(() => buffers.delete(url));
  buffers.set(url, p);
  while (buffers.size > MAX) buffers.delete(buffers.keys().next().value as string);
  return p;
}

type IdleWindow = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };

/** decode these when the page is idle, one after another (a tap then starts at once) */
export function warmClips(urls: string[]): () => void {
  let stop = false;
  const g = globalThis as unknown as IdleWindow;
  const run = async () => {
    for (const u of urls) {
      if (stop) return;
      await loadClip(u).catch(() => undefined);
    }
  };
  const h = g.requestIdleCallback ? g.requestIdleCallback(() => void run(), { timeout: 2500 }) : (setTimeout(() => void run(), 900) as unknown as number);
  return () => {
    stop = true;
    if (g.cancelIdleCallback) g.cancelIdleCallback(h);
    else clearTimeout(h);
  };
}

// ---------------------------------------------------------------- what is playing (for the buttons)

export type NowPlaying = { key: string | null; index: number };
let now: NowPlaying = { key: null, index: -1 };
const subs = new Set<() => void>();
const set = (n: NowPlaying) => {
  if (n.key === now.key && n.index === now.index) return;
  now = n;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const SERVER: NowPlaying = { key: null, index: -1 };

/** which play() is sounding now (its key) and which of its clips */
export function useNowPlaying(): NowPlaying {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => SERVER,
  );
}

export type PlayOptions = {
  /** names this play for useNowPlaying (a button id) */
  key: string;
  /** seconds between clips (A/B) */
  gap?: number;
  onPlayhead?: (e: PlayheadEvent) => void;
  onEnd?: (completed: boolean) => void;
};

/**
 * Play one clip or a row of them (URLs, or audio already in memory such as your own take). Must be
 * called inside the tap. A second call replaces the first; the same key while it plays stops it.
 */
export function play(urls: (string | Playable)[], o: PlayOptions): Promise<boolean> {
  const p = getPlayer();
  if (now.key === o.key) {
    stopListening();
    return Promise.resolve(false);
  }
  p.stop();
  void audioCore.unlock(); // inside the gesture, before anything is awaited (iOS)
  const token = ++playToken;
  set({ key: o.key, index: 0 });
  return Promise.all(urls.map((u) => (typeof u === "string" ? loadClip(u) : u)))
    .then((bufs) => {
      if (token !== playToken) return false;
      p.events = {
        onPlayhead: (e) => {
          if (token !== playToken) return;
          set({ key: o.key, index: e.item });
          o.onPlayhead?.(e);
        },
        onEnd: (completed) => {
          if (token !== playToken) return;
          set({ key: null, index: -1 });
          o.onEnd?.(completed);
        },
      };
      return p.playSequence(
        bufs.map((b, i) => ({ source: b, label: String(i) })),
        { gap: o.gap ?? 0.45 },
      );
    })
    .catch(() => {
      if (token === playToken) set({ key: null, index: -1 });
      o.onEnd?.(false);
      return false;
    });
}

export function stopListening() {
  playToken++;
  player?.stop();
  set({ key: null, index: -1 });
}
