/**
 * The 53 symbols of content/ipa-legend.json for IpaTip — loaded only when a tip is first opened
 * (a separate chunk, ~10 KB). `sound` is the symbol's own page among the 42 sounds (from
 * content/phonemes.json, where the symbol is that sound's `ipa`).
 */
import raw from "../../../content/ipa-legend.json";

export type TipSymbol = { symbol: string; kind: string; nameJa: string; howJa: string; sound: string | null };

const SOUND: Record<string, string> = {
  "iː": "iy", i: "ih", e: "eh", "æ": "ae", "ɑ": "aa", "ɔː": "ao", u: "uh", "uː": "uw", "ʌ": "ah", "ə": "ah0", "ɚ": "er0", "ɚː": "er",
  "eɪ": "ey", "aɪ": "ay", "ɔɪ": "oy", "aʊ": "aw", "oʊ": "ow",
  p: "p", b: "b", t: "t", d: "d", k: "k", g: "g", "tʃ": "ch", "dʒ": "jh", f: "f", v: "v", "θ": "th", "ð": "dh", s: "s", z: "z", "ʃ": "sh", "ʒ": "zh",
  h: "hh", m: "m", n: "n", "ŋ": "ng", l: "l", r: "r", w: "w", j: "y", "ɾ": "dx",
};

const legend = raw as unknown as { symbols: { symbol: string; kind: string; name_ja: string; how_ja: string }[] };

export const SYMBOLS: TipSymbol[] = legend.symbols.map((s) => ({ symbol: s.symbol, kind: s.kind, nameJa: s.name_ja, howJa: s.how_ja, sound: SOUND[s.symbol] ?? null }));

export const MARKS = {
  primary: SYMBOLS.find((s) => s.symbol === "´") ?? null,
  secondary: SYMBOLS.find((s) => s.symbol === "`") ?? null,
};
