/**
 * Dictionary-style IPA: the one way the app writes a sound — word and line transcriptions,
 * chips (/ð/ → /z/), "heard as" lines. American English as Japanese English–Japanese
 * dictionaries (ジーニアス / ウィズダム) write it:
 *
 *   rice /ráɪs/   think /θíŋk/   book /búk/   seat /síːt/   okay /òʊkéɪ/   about /əbáʊt/
 *   bird /bɚ́ːd/   teacher /tíːtʃɚ/   car /kɑ́ːr/   here /híɚ/   happy /hǽpi/   water /wɔ́ːtɚ/
 *
 * - English r is r. Primary stress = acute over the vowel's first letter, secondary = grave
 *   (combining U+0301 / U+0300 after the letter, not normalized — as content/ipa.py writes them).
 * - Lax vowels i / u (think, book), long ones with ː; weak IY / UW are short (happy).
 * - r-coloured vowels ɚ / ɚ́ː; a vowel + r that closes the syllable is one block (IPA_VOWEL_R).
 * - The flap (DX) and the glottal T (Q) are written t; FLAP_NOTE_JA is the note that goes with it.
 *
 * Same tables and rules as content/ipa.py (the curriculum's CMUdict side), so a word reads the
 * same in content/*.json and in an item; tools/scoring-tests checks the two agree on CMUdict.
 * The student model's Japanese-like sounds (ɾ ɯ ɕ …) have no dictionary symbol: ipaSymbol gives
 * their IPA, but learner-facing text names them in Japanese (heard-labels.ts).
 */

export const ACUTE = "́";
export const GRAVE = "̀";

/** ARPAbet consonant → IPA. DX / Q (flap, glottal T) are written t, as the dictionaries do. */
export const IPA_CONSONANTS: Readonly<Record<string, string>> = {
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "g", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m", N: "n",
  NG: "ŋ", P: "p", R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
  DX: "t", Q: "t",
};

/** ARPAbet vowel → [stressed (1 / 2), unstressed (0)] */
export const IPA_VOWELS: Readonly<Record<string, readonly [string, string]>> = {
  AA: ["ɑ", "ɑ"], AE: ["æ", "æ"], AH: ["ʌ", "ə"], AO: ["ɔː", "ɔ"], AW: ["aʊ", "aʊ"], AY: ["aɪ", "aɪ"],
  EH: ["e", "e"], ER: ["ɚː", "ɚ"], EY: ["eɪ", "eɪ"], IH: ["i", "i"], IY: ["iː", "i"], OW: ["oʊ", "oʊ"],
  OY: ["ɔɪ", "ɔɪ"], UH: ["u", "u"], UW: ["uː", "u"],
};

/** vowel + R closing the syllable → [the vowel's part, the r's part]: car /kɑ́ːr/, here /híɚ/ */
export const IPA_VOWEL_R: Readonly<Record<string, readonly [string, string]>> = {
  AA: ["ɑː", "r"], AO: ["ɔː", "r"], OW: ["ɔː", "r"], IY: ["i", "ɚ"], IH: ["i", "ɚ"], EH: ["e", "ɚ"],
  EY: ["e", "ɚ"], AE: ["e", "ɚ"], UH: ["u", "ɚ"], UW: ["u", "ɚ"], AY: ["aɪ", "ɚ"], AW: ["aʊ", "ɚ"],
  OY: ["ɔɪ", "ɚ"], AH: ["ɚ", ""],
};

/** The note for a word whose t is a flap (same text as content/ipa.py FLAP_NOTE). */
export const FLAP_NOTE_JA = "米国英語では、この t は舌先で軽くはじく音（ラ行に近い音）になります。";

const ARPA = /^([A-Z]{1,2})([0-2])?\??$/;

/** An ARPAbet phone of English (stress digit and the "?" of optional phones allowed). */
export function isEnglishPhone(unit: string): boolean {
  const m = ARPA.exec(unit);
  return !!m && (m[1] in IPA_VOWELS || m[1] in IPA_CONSONANTS);
}

/** The accent on a vowel symbol's first letter: ("aɪ", "1") → áɪ, ("oʊ", "2") → òʊ. */
export function accent(symbol: string, stress: string | undefined): string {
  if (stress !== "1" && stress !== "2") return symbol;
  return symbol.slice(0, 1) + (stress === "1" ? ACUTE : GRAVE) + symbol.slice(1);
}

/**
 * One sound without an accent, for chips: "DH" → ð, "AH0" → ə, "AH1" / "AH" → ʌ, "IY0" → i,
 * "ER" → ɚː, "DX" → t. Anything else (the student's IPA units ɾ, ɯ …) comes back as it is.
 */
export function ipaSymbol(unit: string): string {
  const u = unit.replace(/\?$/, "");
  const m = ARPA.exec(u);
  if (!m) return u;
  const v = IPA_VOWELS[m[1]];
  if (v) return v[m[2] === "0" ? 1 : 0];
  return IPA_CONSONANTS[m[1]] ?? u.toLowerCase();
}

/** A chip: /ð/ */
export function ipaChip(unit: string): string {
  return `/${ipaSymbol(unit)}/`;
}

/**
 * Stress as a dictionary prints the word. misaki stresses words in their sentence and can leave
 * one with only a secondary ("I" AY2, "go" OW2): then its last secondary becomes the primary.
 */
function citationStress(phones: string[]): string[] {
  if (phones.some((p) => /^[A-Z]+1$/.test(p))) return phones;
  let k = -1;
  phones.forEach((p, i) => {
    if (/^[A-Z]+2$/.test(p)) k = i;
  });
  if (k < 0) return phones;
  const out = phones.slice();
  out[k] = out[k].replace("2", "1");
  return out;
}

/**
 * A word's IPA, one string per phone (accents included): R AY1 S → ["r", "áɪ", "s"]. A vowel + R
 * block splits into the vowel's part and the r's part (K AA1 R → ["k", "ɑ́ː", "r"], HH IH1 R →
 * ["h", "í", "ɚ"]; AH + R gives the r an empty part), so a phone can be highlighted or swapped.
 * "X?" (optional) is written like X. Unknown symbols pass through.
 */
export function ipaSegments(phones: readonly string[]): string[] {
  const ps = citationStress(phones.map((p) => p.replace(/\?$/, "")));
  const out: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    const m = ARPA.exec(ps[i]);
    if (!m) {
      out.push(ps[i]);
      continue;
    }
    const [, b, s] = m;
    const v = IPA_VOWELS[b];
    if (!v) {
      out.push(IPA_CONSONANTS[b] ?? b.toLowerCase());
      continue;
    }
    const vr = IPA_VOWEL_R[b];
    const after = ps[i + 2] ? ARPA.exec(ps[i + 2])?.[1] : undefined;
    if (vr && ps[i + 1] === "R" && !(after && after in IPA_VOWELS)) {
      out.push(accent(vr[0], s), vr[1]);
      i++;
      continue;
    }
    out.push(accent(v[s === "1" || s === "2" ? 0 : 1], s));
  }
  return out;
}

/** A word: /ráɪs/ */
export function ipaWord(phones: readonly string[]): string {
  return `/${ipaSegments(phones).join("")}/`;
}

/** A line, one pair of slashes: /ðə ráɪs ɪz rédi/ */
export function ipaLine(words: readonly (readonly string[])[]): string {
  return `/${words.map((w) => ipaSegments(w).join("")).filter(Boolean).join(" ")}/`;
}
