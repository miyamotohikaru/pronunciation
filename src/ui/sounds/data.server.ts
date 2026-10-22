/**
 * Server only: 発音記号 from content/phonemes.json (42 sounds) and content/ipa-legend.json
 * (53 symbols). The grid, one sound's page, and the legend each get only their slice.
 */
import phonemesRaw from "../../../content/phonemes.json";
import legendRaw from "../../../content/ipa-legend.json";
import { clipsReady, itemReady } from "../challenge/common/ready.server";
import { wordClip } from "./clips.server";

type CExample = { word: string; position?: string; marked?: string; ipa: string };
type CPair = { a: string; b: string; a_ipa: string; b_ipa: string };
type CLine = { id: string; text: string; ja: string; difficulty?: number };
type CPhoneme = {
  id: string;
  arpabet: string;
  ipa: string;
  category: string;
  name_ja: string;
  how_ja: string;
  jp_trap_ja: string;
  tip_ja: string;
  watch_for: string[];
  voiced?: boolean;
  allophone_of?: string;
  examples: CExample[];
  pairs: CPair[];
  practice: CLine[];
};
type CSymbol = { symbol: string; kind: string; name_ja: string; how_ja: string; examples: string[]; example_ipa: string[] };

const phonemes = (phonemesRaw as unknown as { style_ja: string; phonemes: CPhoneme[] }).phonemes;
const legend = legendRaw as unknown as { style_ja: string; symbols: CSymbol[] };

export const STYLE_JA = legend.style_ja;

export const slugOf = (id: string) => id.toLowerCase();
const bySlug = (slug: string) => phonemes.find((p) => slugOf(p.id) === slug) ?? null;

/** 母音 / 二重母音 / 子音 — and inside 子音, by how the sound is made (plain words, no jargon) */
export const GROUPS = [
  { id: "vowel", titleJa: "母音", cats: ["vowel", "r-colored vowel"] },
  { id: "diphthong", titleJa: "二重母音", cats: ["diphthong"] },
  { id: "consonant", titleJa: "子音", cats: ["stop", "affricate", "fricative", "nasal", "liquid", "glide", "allophone"] },
] as const;

const MANNER: Record<string, string> = {
  vowel: "母音",
  "r-colored vowel": "r の響きの母音",
  diphthong: "二重母音",
  stop: "はじける音",
  affricate: "はじけてこすれる音",
  fricative: "こすれる音",
  nasal: "鼻に響く音",
  liquid: "舌の形で決まる音",
  glide: "次の母音へすべる音",
  allophone: "はじく t",
};
const POSITION: Record<string, string> = { initial: "はじめ", medial: "なか", final: "おわり" };

/** the name without its trailing symbol, and the symbol, so the symbol can be set in the IPA face */
function nameParts(p: CPhoneme): { text: string; symbol: string } {
  const n = p.name_ja.trim();
  const paren = n.match(/^(.*?)（(.+)）$/);
  if (paren) return { text: paren[1].trim(), symbol: paren[2] };
  if (n.endsWith(p.ipa)) return { text: n.slice(0, -p.ipa.length).trim(), symbol: p.ipa };
  return { text: n, symbol: "" };
}

// ---------------------------------------------------------------- the grid

export type SoundTile = { slug: string; ipa: string; name: { text: string; symbol: string }; example: { word: string; marked?: string } | null; practiceIds: string[]; manner: string };
export type SoundGroup = { id: string; titleJa: string; tiles: SoundTile[] };

export function soundGroups(): SoundGroup[] {
  return GROUPS.map((g) => ({
    id: g.id,
    titleJa: g.titleJa,
    tiles: phonemes
      .filter((p) => (g.cats as readonly string[]).includes(p.category))
      .map((p) => ({
        slug: slugOf(p.id),
        ipa: p.ipa,
        name: nameParts(p),
        example: p.examples[0] ? { word: p.examples[0].word, marked: p.examples[0].marked } : null,
        practiceIds: p.practice.map((x) => x.id),
        manner: MANNER[p.category] ?? "",
      })),
  }));
}

export const allSoundSlugs = () => phonemes.map((p) => slugOf(p.id));

// ---------------------------------------------------------------- one sound

export type SoundExample = { word: string; marked?: string; ipa: string; position: string; clip: string | null };
export type SoundPair = { a: string; b: string; aIpa: string; bIpa: string; aClip: string | null; bClip: string | null; diff: [[number, number], [number, number]] };
export type SoundView = {
  slug: string;
  arpabet: string;
  ipa: string;
  name: { text: string; symbol: string };
  group: string;
  manner: string;
  howJa: string;
  trapJa: string;
  tipJa: string;
  examples: SoundExample[];
  pairs: SoundPair[];
  practice: { id: string; text: string; ja: string; ready: boolean }[];
  /** the mouth section exists for r and l only */
  mouth: "r" | "l" | null;
  prev: { slug: string; ipa: string } | null;
  next: { slug: string; ipa: string } | null;
};

/** the letters where two words differ: sh[ee]p / sh[i]p (common start and end left plain) */
function diffOf(a: string, b: string): [[number, number], [number, number]] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0;
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  return [
    [s, x.length - e],
    [s, y.length - e],
  ];
}

const clipOrNull = (word: string, ipa: string) => (clipsReady("phonemes") ? wordClip(word, ipa) : null);

export function soundOf(slug: string): SoundView | null {
  const p = bySlug(slug);
  if (!p) return null;
  const i = phonemes.indexOf(p);
  const nb = (q: CPhoneme | undefined) => (q ? { slug: slugOf(q.id), ipa: q.ipa } : null);
  const group = GROUPS.find((g) => (g.cats as readonly string[]).includes(p.category))?.titleJa ?? "";
  return {
    slug: slugOf(p.id),
    arpabet: p.arpabet,
    ipa: p.ipa,
    name: nameParts(p),
    group,
    manner: MANNER[p.category] ?? "",
    howJa: p.how_ja,
    trapJa: p.jp_trap_ja,
    tipJa: p.tip_ja,
    examples: p.examples.map((e) => ({ word: e.word, marked: e.marked, ipa: e.ipa, position: POSITION[e.position ?? ""] ?? "", clip: clipOrNull(e.word, e.ipa) })),
    pairs: p.pairs.map((pr) => ({ a: pr.a, b: pr.b, aIpa: pr.a_ipa, bIpa: pr.b_ipa, aClip: clipOrNull(pr.a, pr.a_ipa), bClip: clipOrNull(pr.b, pr.b_ipa), diff: diffOf(pr.a, pr.b) })),
    practice: p.practice.map((x) => ({ id: x.id, text: x.text, ja: x.ja, ready: itemReady(x.id) })),
    mouth: p.id === "R" ? "r" : p.id === "L" ? "l" : null,
    prev: nb(phonemes[i - 1]),
    next: nb(phonemes[i + 1]),
  };
}

// ---------------------------------------------------------------- the legend

const KIND_JA: Record<string, string> = { vowel: "母音", diphthong: "二重母音", consonant: "子音", mark: "記号" };

export type LegendSymbol = { symbol: string; nameJa: string; howJa: string; examples: { word: string; ipa: string; clip: string | null }[]; sound: string | null };
export type LegendGroup = { kind: string; titleJa: string; symbols: LegendSymbol[] };

/** a symbol's own sound page, when it is one of the 42 */
function soundForSymbol(sym: string): string | null {
  const p = phonemes.find((q) => q.ipa === sym);
  return p ? slugOf(p.id) : null;
}

export function legendGroups(): LegendGroup[] {
  const kinds = [...new Set(legend.symbols.map((s) => s.kind))];
  return kinds.map((kind) => ({
    kind,
    titleJa: KIND_JA[kind] ?? kind,
    symbols: legend.symbols
      .filter((s) => s.kind === kind)
      .map((s) => ({
        symbol: s.symbol,
        nameJa: s.name_ja,
        howJa: s.how_ja,
        examples: s.examples.map((w, i) => ({ word: w, ipa: s.example_ipa[i] ?? "", clip: clipOrNull(w, s.example_ipa[i] ?? "") })),
        sound: kind === "mark" ? null : soundForSymbol(s.symbol),
      })),
  }));
}
