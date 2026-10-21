/**
 * misaki (Kokoro's G2P) phoneme string -> ARPAbet variant for the scorer.
 *   "ɹˈiᵊli"  -> "R IY1 AH0? L IY0"   (ᵊ = reduced vowel, optional)
 *   "wˈɔTəɹ"  -> "W AO1 DX ER0"       (T / ɾ = flap -> DX, accepts T or D)
 *   "bˈʌʔn"   -> "B AH1 Q N"          (ʔ = glottal T -> Q, accepts T/D or nothing)
 * misaki capitals: A=eɪ I=aɪ W=aʊ Y=ɔɪ O=oʊ Q=əʊ(GB) T=flap.
 * Plain IPA spellings of the diphthongs (aɪ, eɪ, oʊ, aʊ, ɔɪ) and ɝ/ɚ are accepted too.
 */

export type MisakiOptions = {
  /** Make every unstressed ə optional too (ᵊ is always optional). Default false. */
  optionalSchwa?: boolean;
};

const VOWEL_MAP: [string, string][] = [
  ["aɪ", "AY"], ["eɪ", "EY"], ["oʊ", "OW"], ["aʊ", "AW"], ["ɔɪ", "OY"], ["əʊ", "OW"],
  ["ɜɹ", "ER"], ["ɝ", "ER"], ["əɹ", "ER*"], ["ɚ", "ER*"],
  ["A", "EY"], ["I", "AY"], ["W", "AW"], ["Y", "OY"], ["O", "OW"], ["Q", "OW"],
  ["ɑ", "AA"], ["ɒ", "AA"], ["ɔ", "AO"], ["æ", "AE"], ["a", "AE"], ["ɛ", "EH"], ["e", "EH"], ["ɪ", "IH"], ["ᵻ", "IH*"],
  ["i", "IY"], ["ʊ", "UH"], ["u", "UW"], ["ʌ", "AH"], ["ə", "AH*"], ["ɐ", "AH*"], ["ᵊ", "AH?"], ["ɜ", "ER"],
];

const CONS_MAP: [string, string][] = [
  ["ʤ", "JH"], ["dʒ", "JH"], ["ʧ", "CH"], ["tʃ", "CH"],
  ["b", "B"], ["d", "D"], ["f", "F"], ["h", "HH"], ["j", "Y"], ["k", "K"], ["l", "L"], ["m", "M"], ["n", "N"],
  ["p", "P"], ["s", "S"], ["t", "T"], ["v", "V"], ["w", "W"], ["z", "Z"], ["ɡ", "G"], ["g", "G"], ["ŋ", "NG"],
  ["ɹ", "R"], ["r", "R"], ["ʃ", "SH"], ["ʒ", "ZH"], ["ð", "DH"], ["θ", "TH"], ["T", "DX"], ["ɾ", "DX"], ["ʔ", "Q"],
  ["x", "K"], ["ç", "HH"],
];

const VOWEL_START = new Set(VOWEL_MAP.map(([k]) => k[0]));

function startsVowel(s: string, i: number): boolean {
  while (i < s.length && (s[i] === "ˈ" || s[i] === "ˌ")) i++;
  return i < s.length && VOWEL_START.has(s[i]);
}

const IGNORE = new Set(["ː", "̩", "͡", "-", "‿", " ", ".", ",", "?", "!", ";", ":", "—", "…", "'", '"', "(", ")", "/"]);

/** Converts one misaki/IPA string (one word or a linked chunk) to an ARPAbet phone list. */
export function misakiToArpabet(ipa: string, opts: MisakiOptions = {}): string[] {
  const out: string[] = [];
  let stress: "0" | "1" | "2" = "0";
  let i = 0;
  const s = ipa.normalize("NFC");
  outer: while (i < s.length) {
    const ch = s[i];
    if (ch === "ˈ") {
      stress = "1";
      i++;
      continue;
    }
    if (ch === "ˌ") {
      stress = "2";
      i++;
      continue;
    }
    if (IGNORE.has(ch)) {
      i++;
      continue;
    }
    for (const [k, v] of VOWEL_MAP) {
      if (s.startsWith(k, i)) {
        // "əɹ"/"ɜɹ" before a vowel is a vowel + R ("around" əɹˈWnd), not ER
        if (k.endsWith("ɹ") && startsVowel(s, i + k.length)) continue;
        let sym = v;
        let optional = false;
        if (sym.endsWith("?")) {
          optional = true;
          sym = sym.slice(0, -1);
        }
        const reduced = sym.endsWith("*");
        if (reduced) sym = sym.slice(0, -1);
        if (reduced && stress === "0" && opts.optionalSchwa && sym === "AH") optional = true;
        out.push(`${sym}${stress}${optional ? "?" : ""}`);
        stress = "0";
        i += k.length;
        continue outer;
      }
    }
    for (const [k, v] of CONS_MAP) {
      if (s.startsWith(k, i)) {
        out.push(v);
        i += k.length;
        continue outer;
      }
    }
    throw new Error(`unknown phoneme "${ch}" in "${ipa}"`);
  }
  return out;
}
