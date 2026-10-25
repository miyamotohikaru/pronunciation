/**
 * Build-time helper: learn extra accepted pronunciations from the native reference audio.
 *
 * The recognizer does not always hear a native the way the dictionary spells the word
 * (Kokoro's fast "do" sounds like D UH to it, the vowel of "check" all but vanishes,
 * "gonna" comes out as G OW N ...). Scoring the reference with a sensitive diagnosis
 * network (any vowel may become any vowel, any consonant any consonant, any phone may be
 * skipped) finds those spots; each becomes a new variant of that word, so a learner who
 * sounds like the reference is never marked down for it. Insertions are never learned.
 * Run it once per item when the content is built, and ship the variants with the item.
 */
import type { DiagnosisConfig, PhoneResult, ScoreResult, TargetWord } from "./types.ts";
import type { Scorer } from "./engine.ts";
import { baseOf, isVowel, parseVariant, VOWELS } from "./phones.ts";

export type LearnedVariant = { word: number; variant: string; from: string; reason: string };

export type DeriveOptions = {
  /** Penalties of the sensitive network (log-prob). */
  substitutionPenalty?: number;
  deletionPenalty?: number;
  rounds?: number;
  /** An unstressed vowel scoring below this in a reference take becomes optional. */
  weakBelow?: number;
  /**
   * Base phones that must stay as they are (never replaced, never made optional, never
   * introduced): the contrast an item trains, e.g. ["N", "NG"] for win / wing.
   */
  protect?: string[];
};

/**
 * Consonant changes natives make (voicing in connected speech, palatalization ...).
 * Anything else a learner might do (R/L, TH/S, V/B ...) is never learned.
 */
const NATIVE_CONSONANT_CHANGES: Record<string, string[]> = {
  T: ["D"], D: ["T"], S: ["Z"], Z: ["S"], DH: ["D"], JH: ["Y"], Y: ["JH"], N: ["T", "D"],
};
/**
 * Vowel qualities a native's stressed vowel may take (cot-caught, lax/tense, the first
 * element of a diphthong ...). Unstressed vowels may also reduce to AH / IH / UH / ER.
 * "rice" heard as R IH S is not learned: that would accept a learner's "riss".
 */
const NATIVE_VOWEL_CHANGES: Record<string, string[]> = {
  AA: ["AO", "AH"], AO: ["AA", "AH", "OW"], AH: ["AA", "AO", "OW", "ER"], AE: ["EH"], EH: ["AE", "IH", "EY"],
  IH: ["IY", "EH", "AH"], IY: ["IH"], UH: ["UW", "AH"], UW: ["UH"], ER: ["AH"], EY: ["EH"],
  OW: ["AO", "AH", "UH"], AY: ["AA", "AH"], AW: ["AA", "AE"], OY: ["AO"],
};
const REDUCED = ["AH", "IH", "UH", "UW", "ER", "IY"];

/** Consonants a native may leave silent (unreleased or reduced). Vowels may always be. */
const NATIVE_DROPPABLE = new Set(["T", "D", "K", "P", "G", "HH", "DH", "M", "N"]);

function sensitive(units: Record<string, number[]>, opts: DeriveOptions): Partial<DiagnosisConfig> {
  const confusions: Record<string, string[]> = {};
  const vowels = [...VOWELS].filter((v) => v in units);
  for (const v of vowels) confusions[v] = vowels.filter((x) => x !== v);
  for (const [c, to] of Object.entries(NATIVE_CONSONANT_CHANGES)) if (c in units) confusions[c] = to.filter((x) => x in units);
  return {
    confusions,
    substitutionPenalty: opts.substitutionPenalty ?? 1.0,
    deletionPenalty: opts.deletionPenalty ?? 1.2,
    insertionPenalty: Infinity,
  };
}

function variantString(v: string | string[]): string {
  return (typeof v === "string" ? v.trim().split(/\s+/) : v).join(" ");
}

/**
 * Returns the words with learned variants appended (never removed or reordered), and
 * what was learned. refs: native reference takes of the same item (normal + slow ...).
 */
export async function deriveVariants(
  scorer: Scorer,
  words: TargetWord[],
  refs: { name: string; audio: Float32Array }[],
  opts: DeriveOptions = {},
): Promise<{ words: TargetWord[]; learned: LearnedVariant[] }> {
  const out: TargetWord[] = words.map((w) => ({ text: w.text, variants: w.variants.map(variantString) }));
  const learned: LearnedVariant[] = [];
  const diag = sensitive(scorer.meta.units, opts);
  const weakBelow = opts.weakBelow ?? 75;
  const protect = new Set((opts.protect ?? []).map(baseOf));
  for (let round = 0; round < (opts.rounds ?? 2); round++) {
    let added = 0;
    for (const ref of refs) {
      const r: ScoreResult = await scorer.score({ audio: ref.audio, words: out }, { diagnosis: diag });
      r.words.forEach((w, wi) => {
        // a weak unstressed vowel with nothing specific found is a reduced vowel: optional
        const weak = (p: PhoneResult) => !p.issue || p.issue === "distortion" ? isVowel(p.phone) && p.phone.endsWith("0") && p.score < weakBelow : false;
        const guarded = (p: PhoneResult) => protect.has(baseOf(p.phone)) || (p.heardAs !== undefined && protect.has(p.heardAs));
        const plausible = (p: PhoneResult) => {
          if (p.issue !== "substitution" || !p.heardAs || !isVowel(p.phone)) return true;
          const stressed = /[12]$/.test(p.phone);
          return (NATIVE_VOWEL_CHANGES[baseOf(p.phone)] ?? []).includes(p.heardAs) || (!stressed && REDUCED.includes(p.heardAs));
        };
        const flagged = w.phones.filter(
          (p) =>
            !guarded(p) &&
            plausible(p) &&
            (p.issue === "substitution" || (p.issue === "deletion" && (isVowel(p.phone) || NATIVE_DROPPABLE.has(baseOf(p.phone)))) || weak(p)),
        );
        if (!flagged.length) return;
        // a native realizes most of the word as spelled: at most 2 changes and at most half
        // of the phones, and never two neighbouring consonants (that is a shifted alignment)
        const limit = Math.max(1, Math.min(2, Math.floor(w.phones.length / 2)));
        if (flagged.length > limit) return;
        const at = flagged.map((p) => w.phones.indexOf(p));
        if (at.some((a, k) => k > 0 && a === at[k - 1] + 1 && !isVowel(w.phones[a].phone) && !isVowel(w.phones[at[k - 1]].phone))) return;
        const toks = parseVariant(out[wi].variants[w.variant]);
        const reasons: string[] = [];
        for (const p of flagged) {
          const t = toks[p.index];
          if (p.issue === "deletion" || weak(p)) {
            t.optional = true;
            reasons.push(`${p.phone} may be silent`);
          } else if (p.heardAs) {
            const stress = isVowel(t.symbol) && /[0-2]$/.test(t.symbol) ? t.symbol.slice(-1) : "";
            const sym = isVowel(p.heardAs) ? p.heardAs + (stress || "0") : p.heardAs;
            reasons.push(`${p.phone}~${baseOf(sym)}`);
            t.symbol = sym;
            t.base = baseOf(sym);
          }
        }
        const v = toks.map((t) => t.symbol + (t.optional && t.base !== "Q" ? "?" : "")).join(" ");
        if (out[wi].variants.includes(v)) return;
        out[wi].variants.push(v);
        learned.push({ word: wi, variant: v, from: ref.name, reason: reasons.join(", ") });
        added++;
      });
    }
    if (!added) break;
  }
  return { words: out, learned };
}
