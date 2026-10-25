/**
 * CTC forced alignment, span merging and greedy decoding.
 *
 * forcedAlign() is a line-by-line port of torchaudio.functional.forced_align (CPU kernel,
 * torchaudio 2.x): float32 accumulation, the same tie-breaking (skip > previous > stay
 * only on strict ">"), the same start/end windows and the same final-state choice, so the
 * path is identical given identical log-probs. mergeTokens() = torchaudio merge_tokens.
 */

export type TokenSpan = { token: number; start: number; end: number };

/**
 * @param em row-major [T, C] log-probs (any number of columns; targets index columns)
 * @param targets column indices of the target sequence (must not contain blank)
 * @returns per-frame column index of the best path (blank where no label)
 */
export function forcedAlign(em: Float32Array, T: number, C: number, targets: ArrayLike<number>, blank: number): Int32Array {
  const L = targets.length;
  const S = 2 * L + 1;
  for (let i = 0; i < L; i++) {
    if (targets[i] === blank) throw new Error("targets must not contain the blank");
    if (targets[i] < 0 || targets[i] >= C) throw new Error("target out of range");
  }
  let R = 0;
  for (let i = 1; i < L; i++) if (targets[i] === targets[i - 1]) R++;
  if (T < L + R) throw new Error(`targets too long for CTC: T=${T}, L=${L}, repeats=${R}`);

  const NEG = -Infinity;
  const alphas = [new Float32Array(S).fill(NEG), new Float32Array(S).fill(NEG)];
  const back = new Int8Array(T * S).fill(-1);
  const label = (i: number) => (i % 2 === 0 ? blank : targets[i >> 1]);

  let start = T - (L + R) > 0 ? 0 : 1;
  let end = S === 1 ? 1 : 2;
  for (let i = start; i < end; i++) alphas[0][i] = em[label(i)];

  for (let t = 1; t < T; t++) {
    if (T - t <= L + R) {
      // (start/2 + 1 >= L would read past the end in C++; treat as "different")
      if (start % 2 === 1 && ((start >> 1) + 1 >= L || targets[start >> 1] !== targets[(start >> 1) + 1])) start += 1;
      start += 1;
    }
    if (t <= L + R) {
      if (end % 2 === 0 && end < 2 * L && targets[(end >> 1) - 1] !== targets[end >> 1]) end += 1;
      end += 1;
    }
    let startLoop = start;
    const cur = alphas[t % 2];
    const prev = alphas[(t - 1) % 2];
    cur.fill(NEG);
    const row = t * C;
    const brow = t * S;
    if (start === 0) {
      cur[0] = prev[0] + em[row + blank];
      back[brow] = 0;
      startLoop += 1;
    }
    for (let i = startLoop; i < end; i++) {
      const x0 = prev[i];
      const x1 = prev[i - 1];
      let x2 = NEG;
      if (i % 2 !== 0 && i !== 1 && targets[i >> 1] !== targets[(i >> 1) - 1]) x2 = prev[i - 2];
      let result: number;
      if (x2 > x1 && x2 > x0) {
        result = x2;
        back[brow + i] = 2;
      } else if (x1 > x0 && x1 > x2) {
        result = x1;
        back[brow + i] = 1;
      } else {
        result = x0;
        back[brow + i] = 0;
      }
      cur[i] = result + em[row + label(i)]; // Float32Array store = float32 addition
    }
  }
  const last = alphas[(T - 1) % 2];
  let idx = last[S - 1] > last[S - 2] ? S - 1 : S - 2;
  const path = new Int32Array(T);
  for (let t = T - 1; t > -1; t--) {
    path[t] = label(idx);
    idx -= back[t * S + idx];
  }
  return path;
}

/** Runs of the same non-blank token, [start, end) in frames. */
export function mergeTokens(path: ArrayLike<number>, blank: number): TokenSpan[] {
  const spans: TokenSpan[] = [];
  let s = 0;
  for (let t = 1; t <= path.length; t++) {
    if (t === path.length || path[t] !== path[t - 1]) {
      if (path[s] !== blank) spans.push({ token: path[s], start: s, end: t });
      s = t;
    }
  }
  return spans;
}

/**
 * Best column per frame (first maximum, like torch.argmax), collapsed, blanks removed.
 * Only columns [0, maxColumn) take part (to leave out alias columns such as T|D).
 */
export function greedyDecode(em: Float32Array, T: number, C: number, blank: number, maxColumn = C): TokenSpan[] {
  const out: TokenSpan[] = [];
  let prev = -1;
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bv = em[t * C];
    for (let c = 1; c < maxColumn; c++) {
      const v = em[t * C + c];
      if (v > bv) {
        bv = v;
        best = c;
      }
    }
    if (best !== prev && best !== blank) out.push({ token: best, start: t, end: t + 1 });
    else if (best === prev && best !== blank && out.length) out[out.length - 1].end = t + 1;
    prev = best;
  }
  return out;
}
