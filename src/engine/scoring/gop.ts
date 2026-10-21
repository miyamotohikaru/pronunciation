/**
 * Goodness-of-Pronunciation features of one aligned phone (upstream forced_align_and_gop):
 *   gop             mean over the span of (log p(target) - log p(best competitor))
 *   logp_target     mean log p(target)
 *   logp_competitor mean log p(best competitor)
 *   logp_target_min worst frame of the target
 *   n_frames        span length
 * Competitors are every phone column that shares no model token with the target
 * (the blank never competes). Values are rounded to float32 like the reference.
 */
import type { GopFeatureName } from "./types.ts";
import type { TokenSpan } from "./ctc.ts";
import { overlaps, type UnitSpace } from "./phones.ts";

export type GopFeatures = Record<GopFeatureName, number> & {
  /** Competitor column that won most frames (first one on ties), for "heard as". */
  topCompetitor: number;
};

export function gopFeatures(em: Float32Array, C: number, span: TokenSpan, space: UnitSpace): GopFeatures {
  const target = span.token;
  const comps = space.phoneColumns.filter((c) => c !== target && !overlaps(space, c, target));
  let sumGop = 0;
  let sumT = 0;
  let sumC = 0;
  let minT = Infinity;
  const votes = new Map<number, number>();
  for (let t = span.start; t < span.end; t++) {
    const row = t * C;
    let best = -Infinity;
    let arg = -1;
    for (const c of comps) {
      const v = em[row + c];
      if (v > best) {
        best = v;
        arg = c;
      }
    }
    const tv = em[row + target];
    sumGop += tv - best;
    sumT += tv;
    sumC += best;
    if (tv < minT) minT = tv;
    votes.set(arg, (votes.get(arg) ?? 0) + 1);
  }
  const n = span.end - span.start;
  let top = -1;
  let topVotes = 0;
  for (const [c, k] of votes) {
    if (k > topVotes) {
      top = c;
      topVotes = k;
    }
  }
  return {
    gop: Math.fround(sumGop / n),
    logp_target: Math.fround(sumT / n),
    logp_competitor: Math.fround(sumC / n),
    logp_target_min: Math.fround(minT),
    n_frames: n,
    topCompetitor: top,
  };
}
