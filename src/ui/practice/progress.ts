/**
 * What the learner keeps on this device: best score / stars per item, and the practice settings.
 * localStorage only (wrapped: private mode and blocked storage just mean nothing is kept).
 */
import type { Speed, VoiceId } from "./content";

const KEY_BEST = "kara.v1.best";
const KEY_SETTINGS = "kara.v1.settings";

export type Best = { score: number; stars: 0 | 1 | 2 | 3; at: number };
export type Settings = { voice: VoiceId; speed: Speed; together: boolean };

const read = <T,>(k: string, fb: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? ({ ...fb, ...JSON.parse(v) } as T) : fb;
  } catch {
    return fb;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

/** ★ ≥ 60, ★★ ≥ 75, ★★★ ≥ 90 */
export function starsFor(score: number): 0 | 1 | 2 | 3 {
  return score >= 90 ? 3 : score >= 75 ? 2 : score >= 60 ? 1 : 0;
}

export function allBest(): Record<string, Best> {
  return read<Record<string, Best>>(KEY_BEST, {});
}
export function bestOf(id: string): Best | null {
  return allBest()[id] ?? null;
}
/** returns the previous best (null if none) */
export function saveBest(id: string, score: number): Best | null {
  const all = allBest();
  const prev = all[id] ?? null;
  if (!prev || score > prev.score) {
    all[id] = { score, stars: starsFor(score), at: Date.now() };
    write(KEY_BEST, all);
  }
  return prev;
}

export const DEFAULT_SETTINGS: Settings = { voice: "af_heart", speed: "native", together: false };
export function loadSettings(): Settings {
  return read<Settings>(KEY_SETTINGS, DEFAULT_SETTINGS);
}
export function saveSettings(s: Settings) {
  write(KEY_SETTINGS, s);
}

/** the lane's one-time hint (「線を青い帯に重ねよう」): shown on this device's first take only */
const KEY_HINT = "kara.v1.hint";
export function hintSeen(): boolean {
  try {
    return localStorage.getItem(KEY_HINT) === "1";
  } catch {
    return true;
  }
}
export function markHintSeen() {
  write(KEY_HINT, 1);
}
