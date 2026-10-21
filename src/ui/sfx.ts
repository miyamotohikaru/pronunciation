/**
 * Short, soft game sounds made on the fly (no files). Optional: the top bar mutes them.
 * Created lazily inside a user gesture so iOS lets it play; haptics where supported.
 */
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(v: boolean) {
  muted = v;
}

/** Only after the person has touched the page (no autoplay warnings, no surprise sounds). */
const activated = () =>
  typeof navigator !== "undefined" && (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === true;

function ac(): AudioContext | null {
  if (typeof window === "undefined" || !activated()) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + at);
  g.gain.setValueAtTime(0.0001, a.currentTime + at);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + at);
  o.stop(a.currentTime + at + dur + 0.02);
}

export type Sfx = "tap" | "hit" | "great" | "score" | "best";

export function sfx(kind: Sfx) {
  if (muted) return;
  switch (kind) {
    case "tap":
      tone(660, 0, 0.07, 0.05, "triangle");
      break;
    case "hit":
      tone(1320, 0, 0.06, 0.035);
      break;
    case "great":
      tone(988, 0, 0.08, 0.05, "triangle");
      tone(1319, 0.06, 0.1, 0.05, "triangle");
      break;
    case "score":
      tone(784, 0, 0.12, 0.06, "triangle");
      tone(1175, 0.09, 0.18, 0.06, "triangle");
      break;
    case "best":
      tone(784, 0, 0.1, 0.06, "triangle");
      tone(988, 0.08, 0.1, 0.06, "triangle");
      tone(1319, 0.16, 0.22, 0.06, "triangle");
      break;
  }
}

export function buzz(ms = 10) {
  if (muted || !activated()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
