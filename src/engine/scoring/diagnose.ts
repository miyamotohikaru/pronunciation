/**
 * Diagnosis beyond GOP: an extended recognition network over the realized target phones.
 *   - each phone may be replaced by one of its confusable phones (cost: substitutionPenalty)
 *     -> "heard as"
 *   - each phone may be skipped (cost: deletionPenalty) -> deletion
 *   - after a consonant that is followed by another consonant or ends the word, an extra
 *     vowel may be inserted (cost: insertionPenalty) -> epenthesis (Japanese u/o/i)
 * The canonical path costs nothing, so a finding needs the audio to beat it by the penalty.
 */
import type { DiagnosisConfig } from "./types.ts";
import { nodeSpans, slotGraph, viterbiGraph, type Slot } from "./graph.ts";
import { baseOf, columnFor, type UnitSpace } from "./phones.ts";

export type DiagPhone = {
  /** target symbol (e.g. "R", "AY1", "DX") */
  symbol: string;
  column: number;
  word: number;
  /** index within the word's realized phones */
  index: number;
  /**
   * An inserted vowel may follow this phone: a consonant before another consonant of its
   * word or at the word end, with no skipped optional vowel of the variant in between.
   */
  insertionAfter: boolean;
};

export type PhoneDiagnosis = {
  heardAs?: string;
  deleted: boolean;
  /** frames the network gave this phone (or its replacement) */
  start: number;
  end: number;
};

export type InsertionFinding = { word: number; afterIndex: number; vowel: string; start: number; end: number };

export type Diagnosis = { phones: PhoneDiagnosis[]; insertions: InsertionFinding[] };

/** Japanese-speaker oriented default: target phone -> phones it is often heard as. */
export const DEFAULT_CONFUSIONS: Record<string, string[]> = {
  R: ["L", "D", "W"],
  L: ["R"],
  TH: ["S", "T", "F"],
  DH: ["Z", "D"],
  V: ["B", "F", "W"],
  F: ["HH", "P"],
  S: ["SH", "TH"],
  SH: ["S"],
  Z: ["JH", "S"],
  ZH: ["JH", "SH"],
  W: ["UW"],
  HH: ["F"],
  N: ["NG"],
  NG: ["N"],
  AE: ["AH", "EH", "AA"],
  AH: ["AA", "AE"],
  AA: ["AH", "AO", "OW"],
  AO: ["AA", "OW"],
  IH: ["IY"],
  IY: ["IH"],
  UH: ["UW"],
  UW: ["UH"],
  ER: ["AA", "AH"],
  EY: ["EH"],
  OW: ["AO"],
};

export function diagnose(
  em: Float32Array,
  T: number,
  C: number,
  blank: number,
  phones: DiagPhone[],
  space: UnitSpace,
  cfg: DiagnosisConfig,
): Diagnosis {
  const slots: Slot[] = [];
  const phoneSlot: number[] = [];
  const insSlot: { slot: number; word: number; afterIndex: number }[] = [];
  const vowelCols = cfg.epentheticVowels.map((v) => ({ v, col: columnFor(space, v) }));
  phones.forEach((p, i) => {
    const alts = [{ column: p.column, cost: 0 }];
    const base = baseOf(p.symbol);
    const conf = cfg.confusions[base] ?? [];
    for (const q of conf) {
      const col = space.baseColumn.get(q);
      if (col === undefined || col === p.column) continue;
      alts.push({ column: col, cost: cfg.pairPenalty?.[`${base}>${q}`] ?? cfg.substitutionPenalty });
    }
    phoneSlot.push(slots.length);
    slots.push({ alts, optional: true, skipCost: cfg.deletionPenalty });
    if (p.insertionAfter) {
      insSlot.push({ slot: slots.length, word: p.word, afterIndex: p.index });
      slots.push({ alts: vowelCols.map((x) => ({ column: x.col, cost: cfg.insertionPenalty })), optional: true, skipCost: 0 });
    }
  });
  const { graph, slotOf, altOf } = slotGraph(slots);
  const path = viterbiGraph(em, T, C, blank, graph);
  const spans = nodeSpans(path, graph.nodes.length);
  // per slot: the node that was used
  const used: ({ alt: number; start: number; end: number } | null)[] = slots.map(() => null);
  spans.forEach((sp, n) => {
    if (!sp) return;
    used[slotOf[n]] = { alt: altOf[n], start: sp.start, end: sp.end };
  });
  const outPhones: PhoneDiagnosis[] = phones.map((p, i) => {
    const u = used[phoneSlot[i]];
    if (!u) return { deleted: true, start: -1, end: -1 };
    const col = slots[phoneSlot[i]].alts[u.alt].column;
    return { deleted: false, heardAs: u.alt > 0 ? space.names[col] : undefined, start: u.start, end: u.end };
  });
  const insertions: InsertionFinding[] = [];
  for (const s of insSlot) {
    const u = used[s.slot];
    if (!u || u.end - u.start < cfg.minInsertionFrames) continue;
    insertions.push({ word: s.word, afterIndex: s.afterIndex, vowel: vowelCols[u.alt].v, start: u.start, end: u.end });
  }
  return { phones: outPhones, insertions };
}
