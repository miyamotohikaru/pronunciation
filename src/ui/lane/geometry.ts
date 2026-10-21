/**
 * Pure geometry for the pitch lane. Used by the canvas and by the HTML overlays (judgement pops)
 * so both agree on where a syllable is.
 *   x = time (model timeline), y = semitones from the speaker's median.
 */
import type { ContourPoint, LaneSyllable } from "../types";

export type LaneFrame = { t0: number; t1: number; st0: number; st1: number };
export type LaneBox = { w: number; h: number; padL: number; padR: number; padT: number; padB: number };

export function laneFrame(syl: LaneSyllable[], contours: (ContourPoint[] | undefined | null)[]): LaneFrame {
  const t0 = syl[0].start - 0.07;
  const t1 = syl[syl.length - 1].end + 0.2;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of syl) {
    if (s.pitchSt === null) continue;
    lo = Math.min(lo, s.pitchSt);
    hi = Math.max(hi, s.pitchSt);
  }
  for (const c of contours) {
    if (!c) continue;
    for (const p of c) {
      if (p.st === null) continue;
      lo = Math.min(lo, p.st);
      hi = Math.max(hi, p.st);
    }
  }
  if (!Number.isFinite(lo)) {
    lo = -4;
    hi = 4;
  }
  lo -= 1.6;
  hi += 1.6;
  const span = hi - lo;
  if (span < 11) {
    const add = (11 - span) / 2;
    lo -= add;
    hi += add;
  }
  return { t0, t1, st0: lo, st1: hi };
}

export const xOf = (b: LaneBox, f: LaneFrame, t: number) =>
  b.padL + ((t - f.t0) / (f.t1 - f.t0)) * (b.w - b.padL - b.padR);
export const yOf = (b: LaneBox, f: LaneFrame, st: number) =>
  b.padT + ((f.st1 - st) / (f.st1 - f.st0)) * (b.h - b.padT - b.padB);

/** Prominence is an unbounded z-sum; map it to 0..1 inside this utterance. */
export function normProminence(syl: LaneSyllable[]): number[] {
  const v = syl.map((s) => s.prominence);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  if (hi - lo < 1e-6) return v.map(() => 0.5);
  return v.map((x) => (x - lo) / (hi - lo));
}

/**
 * A bar is flat at the syllable's pitch, unless the model clearly glides inside the vowel
 * (the fall on "rice."): then it bends with a straight fit over the nucleus.
 * Returns [t, st] points from start to end.
 */
export function barLine(s: LaneSyllable, contour: ContourPoint[] | undefined, fallbackSt: number): [number, number][] {
  const flat = s.pitchSt ?? fallbackSt;
  if (!contour || s.pitchSt === null) return [
    [s.start, flat],
    [s.end, flat],
  ];
  const pts = contour.filter((p) => p.st !== null && p.t >= s.nucleusStart && p.t <= s.nucleusEnd) as {
    t: number;
    st: number;
  }[];
  if (pts.length < 4) return [
    [s.start, flat],
    [s.end, flat],
  ];
  const n = pts.length;
  const mt = pts.reduce((a, p) => a + p.t, 0) / n;
  const ms = pts.reduce((a, p) => a + p.st, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.t - mt) * (p.st - ms);
    den += (p.t - mt) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const a = ms + slope * (s.nucleusStart - mt);
  const b = ms + slope * (s.nucleusEnd - mt);
  if (Math.abs(b - a) < 1.4) return [
    [s.start, flat],
    [s.end, flat],
  ];
  return [
    [s.start, a],
    [s.nucleusStart, a],
    [s.nucleusEnd, b],
    [s.end, b],
  ];
}

/** st of a bar line at time t (clamped to the ends). */
export function lineAt(line: [number, number][], t: number): number {
  if (t <= line[0][0]) return line[0][1];
  for (let i = 0; i + 1 < line.length; i++) {
    const [ta, sa] = line[i];
    const [tb, sb] = line[i + 1];
    if (t <= tb) return tb > ta ? sa + ((t - ta) / (tb - ta)) * (sb - sa) : sb;
  }
  return line[line.length - 1][1];
}

/** Piecewise-linear time map between two syllable timelines (user → model). */
export function timeMap(from: LaneSyllable[], to: LaneSyllable[]) {
  const a = [from[0].start, ...from.map((s) => s.end)];
  const b = [to[0].start, ...to.map((s) => s.end)];
  const n = Math.min(a.length, b.length);
  return (t: number) => {
    if (t <= a[0]) return b[0] + (t - a[0]);
    for (let i = 0; i + 1 < n; i++) {
      if (t <= a[i + 1]) {
        const k = a[i + 1] > a[i] ? (t - a[i]) / (a[i + 1] - a[i]) : 0;
        return b[i] + k * (b[i + 1] - b[i]);
      }
    }
    return b[n - 1] + (t - a[n - 1]);
  };
}

/** Fallback heights for unvoiced syllables: neighbours' average. */
export function fallbackHeights(syl: LaneSyllable[]): number[] {
  return syl.map((s, i) => {
    if (s.pitchSt !== null) return s.pitchSt;
    const prev = syl.slice(0, i).reverse().find((x) => x.pitchSt !== null)?.pitchSt;
    const next = syl.slice(i + 1).find((x) => x.pitchSt !== null)?.pitchSt;
    if (prev != null && next != null) return (prev + next) / 2;
    return prev ?? next ?? 0;
  });
}
