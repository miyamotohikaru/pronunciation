/**
 * The sound card's mouth: which drawing a sound uses, and how two drawings blend. Every outline of
 * the moving part starts at the same point and runs the same way round, so after resampling both
 * to the same number of points by arc length they can be blended point by point (only the tongue,
 * jaw and lower lip move; the head, palate and upper teeth never do).
 */
import { SAGITTAL_SHAPES, type ShapeKey } from "./sagittal-data";

export type Pt = [number, number];
export type { ShapeKey };

const HALF = 120; // points per half of an outline: start → tongue tip, tongue tip → end
const N = HALF * 2 - 1;

/** a sound (ARPAbet, or one of the scorer's Japanese-like units) → the drawing that shows it */
export function shapeFor(unit: string | null | undefined): ShapeKey | null {
  if (!unit) return null;
  const b = unit.replace(/[0-2]?\??$/, "");
  const map: Record<string, ShapeKey> = {
    R: "r", ER: "r", L: "t", T: "t", D: "t", N: "t", DX: "t", TH: "th", DH: "th", S: "s", Z: "s", SH: "sh", ZH: "sh", CH: "sh", JH: "sh",
    F: "f", V: "f", B: "b", P: "b", M: "b", K: "k", G: "k", NG: "k", HH: "neutral", Y: "i", W: "u",
    AE: "ae", EH: "eh", EY: "eh", IH: "ih", IY: "i", UH: "uh", UW: "u", OW: "uh", AA: "a", AO: "a", AW: "a", AY: "a", OY: "a", AH: "neutral",
    // the scorer's Japanese-like sounds, by their nearest drawing
    "ɾ": "t", r: "t", a: "a", e: "eh", i: "ih", o: "uh", "ɯ": "u", "ɕ": "sh", "tɕ": "sh", "dʑ": "sh", ts: "t", "ɸ": "b", "β": "b", "ç": "sh", "aː": "a", "eː": "eh", "oː": "uh",
  };
  return map[b] ?? null;
}

const cache = new Map<ShapeKey, Pt[]>();
/**
 * A drawing's outline, resampled in two halves around the tongue's tip (start → tip, tip → end),
 * so that in any two drawings point i means the same place: the tips meet the tips, the jaw the jaw.
 */
export function outline(key: ShapeKey): Pt[] {
  const hit = cache.get(key);
  if (hit) return hit;
  const flat = SAGITTAL_SHAPES[key];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const tip = tipOf(pts);
  const at = pts.findIndex((p) => p[0] === tip[0] && p[1] === tip[1]);
  const k = at > 0 && at < pts.length - 1 ? at : pts.length >> 1;
  const out = [...resample(pts.slice(0, k + 1), HALF), ...resample(pts.slice(k), HALF).slice(1)];
  cache.set(key, out);
  return out;
}

/** the index of the tongue's tip in every outline() */
export const TIP = HALF - 1;

function resample(pts: Pt[], n: number): Pt[] {
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = seg[seg.length - 1];
  const out: Pt[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    while (j < seg.length - 1 && seg[j] < d) j++;
    const t = (d - seg[j - 1]) / Math.max(1e-9, seg[j] - seg[j - 1]);
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t]);
  }
  return out;
}

/** 0 = a … 1 = b */
export function blend(a: Pt[], b: Pt[], k: number): Pt[] {
  const t = Math.min(1, Math.max(0, k));
  return a.map(([x, y], i) => [x + (b[i][0] - x) * t, y + (b[i][1] - y) * t]);
}

export function closedPath(pts: Pt[]): string {
  return `M${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L")} Z`;
}

/** how far a point is from a polyline (nearest vertex; the outlines are dense) */
function away(p: Pt, poly: Pt[]): number {
  let d = Infinity;
  for (const q of poly) d = Math.min(d, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2);
  return Math.sqrt(d);
}

/** the runs of `a` that are not on `b` at all (what really differs between the two sounds), as open paths */
export function differingPath(a: Pt[], b: Pt[], tol = 0.9): string {
  let d = "";
  let open = false;
  const from = tongueStart(a);
  for (let i = 0; i < a.length; i++) {
    // the tongue only (the drawings' lips, teeth and chins differ a little too, but that is not the lesson)
    const far = i >= from && a[i][1] < 160 && a[i][0] > 104 && away(a[i], b) > tol;
    if (far) {
      d += `${open ? " L" : " M"}${a[i][0].toFixed(2)},${a[i][1].toFixed(2)}`;
      open = true;
    } else open = false;
  }
  return d.trim();
}

/**
 * Where the tongue's tip is. Every outline runs neck → chin → lower lip → lower incisor → floor of
 * the mouth → tongue tip → back of the tongue; so: past the lip and the incisor, the frontmost point.
 */
/** the index where the tongue begins: the floor of the mouth, just behind the lower incisor */
export function tongueStart(pts: Pt[]): number {
  let i = pts.findIndex((p) => p[0] > 151 && p[1] < 150); // the lower lip
  if (i < 0) i = 0;
  const j = pts.findIndex((p, k) => k > i && p[0] < 146 && p[1] > 148); // the floor behind the incisor
  return j < 0 ? i : j;
}

export function tipOf(pts: Pt[]): Pt {
  const j = tongueStart(pts);
  let best: Pt = pts[j];
  let score = -Infinity;
  for (let k = j + 1; k < pts.length; k++) {
    const p = pts[k];
    if (p[1] > 147 || p[1] < 110 || p[0] < 118) continue;
    const sc = p[0] - 0.15 * p[1];
    if (sc > score) {
      score = sc;
      best = p;
    }
  }
  return best;
}
