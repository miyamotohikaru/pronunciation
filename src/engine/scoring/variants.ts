/**
 * Pronunciation variants: one Viterbi pass over the union of every word's variants picks,
 * per word, the variant (and the optional phones) that explain the take best.
 */
import { viterbiGraph, type CtcGraph, type GraphNode } from "./graph.ts";

export type VariantPhone = { column: number; optional: boolean };

export type VariantChoice = {
  /** chosen variant per word */
  variant: number[];
  /** per word: indices (into the chosen variant) of the phones that were realized */
  realized: number[][];
  score: number;
};

/**
 * words[w][v] = phones of variant v of word w. Optional phones may be skipped for free.
 * A variant made only of optional phones keeps its first phone mandatory.
 */
export function chooseVariants(
  em: Float32Array,
  T: number,
  C: number,
  blank: number,
  words: VariantPhone[][][],
): VariantChoice {
  const nodes: GraphNode[] = [];
  const info: { w: number; v: number; i: number }[] = [];
  // first node id of each (w, v)
  const base: number[][] = [];
  const opt = (w: number, v: number, i: number) => {
    const ph = words[w][v];
    if (!ph.some((p) => !p.optional)) return i !== 0 && ph[i].optional;
    return ph[i].optional;
  };
  words.forEach((vs, w) => {
    base.push([]);
    vs.forEach((ph, v) => {
      base[w].push(nodes.length);
      ph.forEach((p, i) => {
        nodes.push({ column: p.column, next: [], nextCost: [] });
        info.push({ w, v, i });
      });
    });
  });
  // entry nodes of word w: phones reachable from the word start by skipping optional ones
  const entries = (w: number): number[] => {
    const out: number[] = [];
    words[w].forEach((ph, v) => {
      for (let i = 0; i < ph.length; i++) {
        out.push(base[w][v] + i);
        if (!opt(w, v, i)) break;
      }
    });
    return out;
  };
  const isExit = (w: number, v: number, i: number): boolean => {
    const ph = words[w][v];
    for (let k = i + 1; k < ph.length; k++) if (!opt(w, v, k)) return false;
    return true;
  };
  const entryOf = words.map((_, w) => entries(w));
  words.forEach((vs, w) => {
    vs.forEach((ph, v) => {
      ph.forEach((_, i) => {
        const n = nodes[base[w][v] + i];
        for (let k = i + 1; k < ph.length; k++) {
          n.next.push(base[w][v] + k);
          n.nextCost.push(0);
          if (!opt(w, v, k)) break;
        }
        if (isExit(w, v, i) && w + 1 < words.length) {
          for (const m of entryOf[w + 1]) {
            n.next.push(m);
            n.nextCost.push(0);
          }
        }
      });
    });
  });
  const last = words.length - 1;
  const finalCost = nodes.map((_, n) => {
    const { w, v, i } = info[n];
    return w === last && isExit(w, v, i) ? 0 : Infinity;
  });
  const g: CtcGraph = { nodes, init: entryOf[0], initCost: entryOf[0].map(() => 0), finalCost };
  const path = viterbiGraph(em, T, C, blank, g);
  const variant = words.map(() => 0);
  const realized: number[][] = words.map(() => []);
  const seen = new Set<number>();
  for (let t = 0; t < T; t++) {
    const n = path.nodeAt[t];
    if (n < 0 || seen.has(n)) continue;
    seen.add(n);
    const { w, v, i } = info[n];
    variant[w] = v;
    realized[w].push(i);
  }
  if (!Number.isFinite(path.score)) {
    // no feasible path (clip far too short): fall back to the first variant, all phones
    return { variant: words.map(() => 0), realized: words.map((vs) => vs[0].map((_, i) => i)), score: -Infinity };
  }
  return { variant, realized, score: path.score };
}
