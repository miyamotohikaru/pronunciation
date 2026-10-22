/**
 * The sound card's mouth: which drawing a sound uses, and how two drawings blend. Every outline of
 * the moving part starts at the same point and runs the same way round, so after resampling both
 * to the same number of points by arc length they can be blended point by point (only the tongue,
 * jaw and lower lip move; the head, palate and upper teeth never do).
 */
import { SAGITTAL_SHAPES, type ShapeKey } from "./sagittal-data";

export type Pt = [number, number];
export type { ShapeKey };

const N = 240; // points per blended outline

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
/** a drawing's outline, resampled to N points by arc length */
export function outline(key: ShapeKey): Pt[] {
  const hit = cache.get(key);
  if (hit) return hit;
  const flat = SAGITTAL_SHAPES[key];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const out = resample(pts, N);
  cache.set(key, out);
  return out;
}

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

/** the runs of `a` where it is away from `b` (what moves between the two sounds), as open paths */
export function differingPath(a: Pt[], b: Pt[], tol = 0.7): string {
  let d = "";
  let open = false;
  for (let i = 0; i < a.length; i++) {
    const far = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]) > tol;
    if (far) {
      d += `${open ? " L" : " M"}${a[i][0].toFixed(2)},${a[i][1].toFixed(2)}`;
      open = true;
    } else open = false;
  }
  return d.trim();
}

/** where the tongue's tip is: the frontmost point of the tongue above the lower teeth */
export function tipOf(pts: Pt[]): Pt {
  let best: Pt = pts[0];
  let score = -Infinity;
  for (const p of pts) {
    if (p[1] > 141 || p[1] < 110 || p[0] < 118) continue; // the oral cavity, above the lower incisors
    const s = p[0] - 0.15 * p[1];
    if (s > score) {
      score = s;
      best = p;
    }
  }
  return best;
}

/** the index of the point that moves most between two sounds (where the arrow and the grip go) */
export function mostMoved(a: Pt[], b: Pt[]): number {
  let at = 0;
  let far = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
    if (d > far) {
      far = d;
      at = i;
    }
  }
  return at;
}
