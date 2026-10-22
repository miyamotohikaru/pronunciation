/**
 * Server only: アルファベット from content/alphabet.json — the 26 letter names (each a listen-only
 * clip "abc-letter-<L>"), the sets that get mixed up (B/V, L/R …), and the practice lines that
 * spell or name letters. Pages get small slices; built-or-not comes from ready.server.ts.
 */
import raw from "../../../content/alphabet.json";
import { clipsReady, itemReady } from "../challenge/common/ready.server";
import type { FieldClass } from "../practice/fields";

type CLetter = { letter: string; ipa: string; name_ja: string; how_ja: string; ipa_note_ja?: string; confusions: string[] };
type CConfusion = { id: string; letters: string[]; tip_ja: string };
type CLine = { id: string; text: string; ja: string; spell?: string[] };
type CSet = { id: string; title_ja: string; confusion: string; lines: CLine[] };
type CAlphabet = { style_ja: string; letters: CLetter[]; confusions: CConfusion[]; practice: CSet[] };

const data = raw as unknown as CAlphabet;

export const ABC_FIELD: FieldClass = "field-berry";

export const letterClip = (L: string) => `abc-letter-${L}`;

export type Letter = { letter: string; ipa: string; nameJa: string; howJa: string; noteJa: string | null; confusions: string[]; clip: string | null };
export type Confusion = { id: string; letters: string[]; tipJa: string; title: string; practice: string | null };
export type AbcLine = { id: string; text: string; ja: string; spell: string[]; ready: boolean };
export type AbcSet = { id: string; titleJa: string; confusion: string; lines: AbcLine[] };

const confTitle = (c: CConfusion) => (c.id === "ee-set" ? "「イー」で終わる文字" : c.letters.join(" と "));

export function letters(): Letter[] {
  return data.letters.map((l) => ({
    letter: l.letter,
    ipa: l.ipa,
    nameJa: l.name_ja,
    howJa: l.how_ja,
    noteJa: l.ipa_note_ja ?? null,
    confusions: l.confusions,
    clip: clipsReady("alphabet") ? letterClip(l.letter) : null,
  }));
}

export function confusions(): Confusion[] {
  return data.confusions.map((c) => ({ id: c.id, letters: c.letters, tipJa: c.tip_ja, title: confTitle(c), practice: data.practice.find((p) => p.confusion === c.id)?.id ?? null }));
}

export function abcSets(): AbcSet[] {
  return data.practice.map((p) => ({
    id: p.id,
    titleJa: p.title_ja,
    confusion: p.confusion,
    lines: p.lines.map((l) => ({ id: l.id, text: l.text, ja: l.ja, spell: l.spell ?? [], ready: itemReady(l.id) })),
  }));
}

export const abcSetOf = (id: string) => abcSets().find((s) => s.id === id) ?? null;
export const allAbcSetIds = () => data.practice.map((p) => p.id);
