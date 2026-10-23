/**
 * Viterbi over a CTC "token graph": a DAG of emitting nodes (each emits one column and may
 * repeat), with an optional blank after every node, as in CTC. It is used for
 *   - choosing the pronunciation variant of each word (parallel branches per word,
 *     optional phones that may be skipped), and
 *   - diagnosis (an extended recognition network: confusable alternatives per phone,
 *     optional inserted vowels, skippable phones).
 * Costs are positive log-penalties subtracted from the path score. CTC rule: moving
 * directly between two nodes that emit the same column is not allowed (a blank must
 * separate them).
 */

export type GraphNode = {
  column: number;
  /** successor nodes and the cost of entering each */
  next: number[];
  nextCost: number[];
};

export type CtcGraph = {
  nodes: GraphNode[];
  init: number[];
  initCost: number[];
  /** per node: cost of ending the utterance after it (Infinity = cannot end here) */
  finalCost: number[];
};

export type GraphPath = {
  /** node index per frame, -1 = blank */
  nodeAt: Int32Array;
  score: number;
};

export function viterbiGraph(em: Float32Array, T: number, C: number, blank: number, g: CtcGraph): GraphPath {
  const N = g.nodes.length;
  const S = 1 + 2 * N; // 0 = leading blank, 1 + 2n = node n, 2 + 2n = blank after node n
  // transitions in CSR form
  const dest: number[] = [];
  const cost: number[] = [];
  const offs = new Int32Array(S + 1);
  const col = new Int32Array(S);
  col[0] = blank;
  for (let n = 0; n < N; n++) {
    col[1 + 2 * n] = g.nodes[n].column;
    col[2 + 2 * n] = blank;
  }
  for (let s = 0; s < S; s++) {
    offs[s] = dest.length;
    if (s === 0) {
      dest.push(0);
      cost.push(0);
      g.init.forEach((m, i) => {
        dest.push(1 + 2 * m);
        cost.push(g.initCost[i]);
      });
    } else {
      const n = (s - 1) >> 1;
      const node = g.nodes[n];
      const isBlank = (s - 1) % 2 === 1;
      dest.push(s);
      cost.push(0);
      if (!isBlank) {
        dest.push(s + 1);
        cost.push(0);
      }
      node.next.forEach((m, i) => {
        if (!isBlank && g.nodes[m].column === node.column) return;
        dest.push(1 + 2 * m);
        cost.push(node.nextCost[i]);
      });
    }
  }
  offs[S] = dest.length;

  let prev = new Float64Array(S).fill(-Infinity);
  let cur = new Float64Array(S);
  const back = new Int32Array(T * S).fill(-1);
  prev[0] = em[blank];
  g.init.forEach((m, i) => {
    const s = 1 + 2 * m;
    const v = em[g.nodes[m].column] - g.initCost[i];
    if (v > prev[s]) prev[s] = v;
  });
  for (let t = 1; t < T; t++) {
    cur.fill(-Infinity);
    const brow = t * S;
    for (let s = 0; s < S; s++) {
      const p = prev[s];
      if (p === -Infinity) continue;
      for (let k = offs[s]; k < offs[s + 1]; k++) {
        const d = dest[k];
        const v = p - cost[k];
        if (v > cur[d]) {
          cur[d] = v;
          back[brow + d] = s;
        }
      }
    }
    const row = t * C;
    for (let s = 0; s < S; s++) if (cur[s] !== -Infinity) cur[s] += em[row + col[s]];
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  let best = -Infinity;
  let bs = -1;
  for (let n = 0; n < N; n++) {
    const fc = g.finalCost[n];
    if (fc === Infinity) continue;
    for (const s of [1 + 2 * n, 2 + 2 * n]) {
      const v = prev[s] - fc;
      if (v > best) {
        best = v;
        bs = s;
      }
    }
  }
  const nodeAt = new Int32Array(T).fill(-1);
  if (bs < 0) return { nodeAt, score: -Infinity };
  let s = bs;
  for (let t = T - 1; t >= 0; t--) {
    nodeAt[t] = s > 0 && (s - 1) % 2 === 0 ? (s - 1) >> 1 : -1;
    if (t > 0) s = back[t * S + s];
  }
  return { nodeAt, score: best };
}

/** Frames spent in each node: [start, end) or null if the path skipped it. */
export function nodeSpans(path: GraphPath, nNodes: number): ({ start: number; end: number } | null)[] {
  const out: ({ start: number; end: number } | null)[] = new Array(nNodes).fill(null);
  const a = path.nodeAt;
  for (let t = 0; t < a.length; t++) {
    const n = a[t];
    if (n < 0) continue;
    const sp = out[n];
    if (sp) sp.end = t + 1;
    else out[n] = { start: t, end: t + 1 };
  }
  return out;
}

/**
 * Builds a graph from a sequence of "slots". Each slot offers alternatives (column + cost);
 * an optional slot may be skipped at skipCost. Returns the graph and, per node, its slot
 * and alternative index.
 */
export type Slot = { alts: { column: number; cost: number }[]; optional: boolean; skipCost: number };

/**
 * maxSkips: how many consecutive optional slots with a non-zero skip cost (deletions) one
 * jump may pass; free optional slots (skipCost 0, e.g. insertions) do not count. This keeps
 * the graph linear in size when every phone may be deleted.
 */
export function slotGraph(slots: Slot[], maxSkips = 2): { graph: CtcGraph; slotOf: number[]; altOf: number[] } {
  const nodes: GraphNode[] = [];
  const slotOf: number[] = [];
  const altOf: number[] = [];
  const first: number[] = [];
  slots.forEach((sl, j) => {
    first.push(nodes.length);
    sl.alts.forEach((a, k) => {
      nodes.push({ column: a.column, next: [], nextCost: [] });
      slotOf.push(j);
      altOf.push(k);
    });
  });
  // reachable[j] = slots k > j reachable from j skipping only optional slots, with cost
  const reach = (from: number): { slot: number; cost: number }[] => {
    const out: { slot: number; cost: number }[] = [];
    let acc = 0;
    let skipped = 0;
    for (let k = from + 1; k < slots.length; k++) {
      out.push({ slot: k, cost: acc });
      if (!slots[k].optional) break;
      if (slots[k].skipCost > 0 && ++skipped > maxSkips) break;
      acc += slots[k].skipCost;
    }
    return out;
  };
  const init: number[] = [];
  const initCost: number[] = [];
  for (const r of reach(-1)) {
    slots[r.slot].alts.forEach((a, k) => {
      init.push(first[r.slot] + k);
      initCost.push(r.cost + a.cost);
    });
  }
  const finalCost: number[] = new Array(nodes.length).fill(Infinity);
  slots.forEach((sl, j) => {
    // can end after slot j if every later slot is optional
    let acc = 0;
    let ok = true;
    for (let k = j + 1; k < slots.length; k++) {
      if (!slots[k].optional) {
        ok = false;
        break;
      }
      acc += slots[k].skipCost;
    }
    sl.alts.forEach((_, k) => {
      const n = first[j] + k;
      if (ok) finalCost[n] = acc;
      for (const r of reach(j)) {
        slots[r.slot].alts.forEach((a, k2) => {
          nodes[n].next.push(first[r.slot] + k2);
          nodes[n].nextCost.push(r.cost + a.cost);
        });
      }
    });
  });
  return { graph: { nodes, init, initCost, finalCost }, slotOf, altOf };
}
