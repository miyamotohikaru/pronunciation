/**
 * Split a dictionary-style transcription (/ráɪs/, /kɑ́ːr/, /fáɪɚ/) into the legend's symbols, longest
 * first, keeping each symbol's accent: ["r", "áɪ" (primary), "s"]. Same inventory as
 * content/ipa-legend.json (written here so splitting needs no data; the names load on demand).
 */
const SYMBOLS = [
  "aʊɚ", "aɪɚ", "ɑːr", "ɔːr",
  "iː", "uː", "ɔː", "ɚː", "iɚ", "eɚ", "uɚ", "eɪ", "aɪ", "ɔɪ", "aʊ", "oʊ", "tʃ", "dʒ",
  "i", "e", "æ", "ɑ", "u", "ʌ", "ə", "ɚ",
  "p", "b", "t", "d", "k", "g", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "m", "n", "ŋ", "l", "r", "w", "j", "ɾ",
].sort((a, b) => b.length - a.length);

const ACUTE = "́";
const GRAVE = "̀";

export type IpaToken = { text: string; symbol: string | null; stress: 0 | 1 | 2 };

export function ipaTokens(ipa: string): IpaToken[] {
  const s = ipa.replace(/^\/|\/$/g, "").replace(/ɡ/g, "g");
  // the string without accents, and where each of its letters sits in the original
  const plain: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ACUTE || s[i] === GRAVE) continue;
    plain.push(s[i]);
    at.push(i);
  }
  const p = plain.join("");
  const out: IpaToken[] = [];
  let i = 0;
  while (i < p.length) {
    const sym = p[i] === " " ? null : (SYMBOLS.find((x) => p.startsWith(x, i)) ?? null);
    const len = sym ? sym.length : 1;
    const a = at[i];
    const b = i + len < at.length ? at[i + len] : s.length;
    const text = s.slice(a, b);
    out.push({ text, symbol: sym, stress: text.includes(ACUTE) ? 1 : text.includes(GRAVE) ? 2 : 0 });
    i += len;
  }
  return out;
}
