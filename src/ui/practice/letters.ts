/**
 * Which letters spell which sound: a small dynamic-programming aligner between a word's
 * spelling and its ARPAbet phones (the scorer's realized phones). Used only to put the
 * ● ▲ ▬ marks under the right letters — a near miss is fine, it is never shown as text.
 */

const G: Record<string, string[]> = {
  AA: ["o", "a", "ah", "au", "aw", "al", "ough"],
  AE: ["a", "ai", "au"],
  AH: ["u", "o", "a", "e", "ou", "oo", "i", "io", "ough"],
  AO: ["o", "au", "aw", "a", "oa", "al", "ough", "ou"],
  AW: ["ou", "ow", "ough"],
  AY: ["i", "y", "igh", "ie", "ye", "ai", "ei", "uy", "eye", "ui"],
  B: ["b", "bb"],
  CH: ["ch", "tch", "t", "ti"],
  D: ["d", "dd", "ed"],
  DH: ["th"],
  DX: ["t", "tt", "d", "dd"],
  EH: ["e", "ea", "ai", "a", "ie", "ay", "ue", "ae"],
  ER: ["er", "ir", "ur", "or", "ear", "ar", "our", "yr", "re", "r"],
  EY: ["a", "ai", "ay", "ei", "ey", "ea", "eigh", "e", "aigh"],
  F: ["f", "ff", "ph", "gh"],
  G: ["g", "gg", "gu", "gue"],
  HH: ["h", "wh"],
  IH: ["i", "y", "e", "ea", "ui", "ie", "ee", "a", "u"],
  IY: ["e", "ee", "ea", "y", "ie", "ei", "i", "ey", "eo", "ae", "ay"],
  JH: ["j", "g", "dg", "dge", "ge", "gi"],
  K: ["k", "c", "ck", "ch", "q", "qu", "x", "cc", "que"],
  L: ["l", "ll", "le"],
  M: ["m", "mm", "mb", "mn"],
  N: ["n", "nn", "kn", "gn", "pn"],
  NG: ["ng", "n"],
  OW: ["o", "oa", "ow", "oe", "ou", "ough", "eau", "ew"],
  OY: ["oi", "oy"],
  P: ["p", "pp"],
  Q: ["t", "tt"],
  R: ["r", "rr", "wr", "rh"],
  S: ["s", "ss", "c", "ce", "sc", "se", "x"],
  SH: ["sh", "ti", "ci", "s", "ss", "ch", "si", "sci", "ce"],
  T: ["t", "tt", "ed", "th", "pt"],
  TH: ["th"],
  UH: ["oo", "u", "ou", "o"],
  UW: ["oo", "u", "ue", "ew", "o", "ou", "ui", "oe", "wo"],
  V: ["v", "f", "ve"],
  W: ["w", "wh", "u", "o"],
  Y: ["y", "i", "j"],
  Z: ["z", "zz", "s", "ss", "x", "se", "ze"],
  ZH: ["s", "si", "g", "ge", "z"],
};

const silentCost = (ch: string, last: boolean) => (ch === "e" ? (last ? 0.3 : 0.9) : "hwgbkltu".includes(ch) ? 1 : 1.6);

/**
 * letters[i] = [start, end) in `word` for phone i (end may equal start when a phone has no
 * letter of its own, e.g. the S of "x" in "box").
 */
export function alignLetters(word: string, phones: string[]): [number, number][] {
  const idx: number[] = []; // positions of real letters in `word`
  for (let i = 0; i < word.length; i++) if (/[a-z]/i.test(word[i])) idx.push(i);
  const L = idx.map((i) => word[i].toLowerCase()).join("");
  const P = phones.map((p) => p.replace(/[0-9]/g, "").toUpperCase());
  const n = L.length;
  const m = P.length;
  if (m === 0) return [];
  const INF = 1e9;
  // cost[i][j]: best cost using the first i letters for the first j phones
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const from = Array.from({ length: n + 1 }, () => new Int32Array((m + 1) * 2).fill(-1)); // [prevI, prevJ]
  cost[0][0] = 0;
  const set = (i: number, j: number, c: number, pi: number, pj: number) => {
    if (c < cost[i][j]) {
      cost[i][j] = c;
      from[i][j * 2] = pi;
      from[i][j * 2 + 1] = pj;
    }
  };
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const c = cost[i][j];
      if (c >= INF) continue;
      if (j < m) {
        for (const g of G[P[j]] ?? []) if (L.startsWith(g, i)) set(i + g.length, j + 1, c - 0.05 * g.length, i, j);
        if (i < n) set(i + 1, j + 1, c + 2, i, j); // any one letter
        set(i, j + 1, c + 1.5, i, j); // no letter of its own
      }
      if (i < n && j > 0) set(i + 1, j, c + silentCost(L[i], i === n - 1), i, j); // silent letter, joins the previous sound
    }
  // walk back
  const span: [number, number][] = P.map(() => [0, 0]);
  let i = n;
  let j = m;
  if (cost[n][m] >= INF) {
    // fallback: spread the letters evenly
    return P.map((_, k) => [idx[Math.floor((k * n) / m)] ?? word.length, idx[Math.floor(((k + 1) * n) / m)] ?? word.length] as [number, number]);
  }
  const ends: number[] = new Array(m).fill(-1);
  const starts: number[] = new Array(m).fill(-1);
  while (i > 0 || j > 0) {
    const pi = from[i][j * 2];
    const pj = from[i][j * 2 + 1];
    if (pi < 0) break;
    if (pj === j - 1) {
      starts[j - 1] = pi;
      if (ends[j - 1] < 0) ends[j - 1] = i;
    } else if (pj === j && j > 0) {
      // silent letter: extend phone j-1
      if (ends[j - 1] < 0) ends[j - 1] = i;
    }
    i = pi;
    j = pj;
  }
  for (let k = 0; k < m; k++) {
    const a = Math.max(0, starts[k]);
    const b = Math.max(a, ends[k]);
    span[k] = [a < n ? idx[a] : word.length, b > 0 ? (b <= n ? (b === 0 ? 0 : idx[b - 1] + 1) : word.length) : idx[0] ?? 0];
    if (b === a) span[k] = [span[k][0], span[k][0]];
  }
  return span;
}
