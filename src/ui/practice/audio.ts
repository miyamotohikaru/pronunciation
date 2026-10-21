/**
 * The audio/scoring engines as page-lifetime singletons, plus a tiny buffer cache.
 * Nothing here runs until called, so importing is SSR-safe.
 *
 *   - one Player (its events are swapped per use)
 *   - a MicRecorder per take (cheap: permission, AudioContext and worklet module are kept)
 *   - one scoring client, started in the background after the first tap — never awaited by the UI
 *   - decoded model audio: only the current item's buffers and the next item's are kept
 */
import { MicRecorder, Player, normalizeLoudness, type MicRecorderEvents, type Take } from "@/engine/audio";
import { createScoringClient, type ScoringClient, type ScoringProgress } from "@/engine/scoring/client.ts";

const WORKLET_URL = "/worklets/mic-capture.js";

let player: Player | null = null;
export function getPlayer(): Player {
  if (!player) player = new Player();
  return player;
}

/** A recorder for one take. VAD never ends the take: the guide does (or a tap). */
export function newRecorder(maxSeconds: number, events: MicRecorderEvents): MicRecorder {
  return new MicRecorder(
    {
      workletUrl: WORKLET_URL,
      vad: { endSilenceMs: 60_000, maxDurationMs: Math.round(maxSeconds * 1000) },
      // loudness-normalising the take costs ~20 ms on the main thread right when the result should
      // appear: do it lazily, the first time you play your own voice (playableTake)
      playback: false,
    },
    events,
  );
}

/** Warm the worklet module without a gesture (first take starts faster). */
export function warmRecorder() {
  void new MicRecorder({ workletUrl: WORKLET_URL }).prepare();
}

// ---------------------------------------------------------------- decoded model audio (bounded)

const buffers = new Map<string, Promise<AudioBuffer>>();

export function loadBuffer(url: string): Promise<AudioBuffer> {
  let p = buffers.get(url);
  if (!p) {
    p = getPlayer().load(url);
    p.catch(() => buffers.delete(url));
    buffers.set(url, p);
  }
  return p;
}

/** drop every decoded buffer whose URL is not in `keep` (old items, other speeds/voices) */
export function keepBuffers(keep: string[]) {
  for (const k of [...buffers.keys()]) if (!keep.includes(k)) buffers.delete(k);
}

// ---------------------------------------------------------------- scoring (background)

let scoring: ScoringClient | null = null;
let scoringState: { ready: boolean; progress: number; error: string | null } = { ready: false, progress: 0, error: null };
const listeners = new Set<() => void>();

export function scoringStatus() {
  return scoringState;
}
export function onScoringStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function setScoring(s: Partial<typeof scoringState>) {
  const next = { ...scoringState, ...s };
  // download progress arrives every few ms: tell the UI only every 10 % (frequent React updates
  // would keep interrupting the screen's transitions while a take starts)
  const step = (p: number) => Math.floor(p * 10);
  const changed = next.ready !== scoringState.ready || next.error !== scoringState.error || step(next.progress) !== step(scoringState.progress);
  scoringState = next;
  if (changed) listeners.forEach((l) => l());
}

/** Start downloading/warming the scorer (idempotent). Call after the first tap; don't await. */
export function startScoring(): ScoringClient {
  if (!scoring) {
    // ?providers=wasm forces a backend (tests)
    const forced = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("providers") : null;
    scoring = createScoringClient(forced ? { providers: forced.split(",") } : {});
    scoring
      .load((p: ScoringProgress) => {
        if (p.phase === "model" && p.total) setScoring({ progress: (p.loaded ?? 0) / p.total });
      })
      .then(() => setScoring({ ready: true, progress: 1 }))
      .catch((e: unknown) => setScoring({ error: String((e as Error)?.message ?? e) }));
  }
  return scoring;
}

/** Your take at the reference loudness (−18 LUFS), computed once, on the first playback. */
const normalized = new WeakSet<Take>();
export function playableTake(take: Take): Take {
  if (!normalized.has(take)) {
    normalized.add(take);
    if (take.speech) take.playback = normalizeLoudness(take.pcm, take.sampleRate).pcm;
  }
  return take;
}
