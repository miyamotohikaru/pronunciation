/**
 * Server only: 発音記号 from content/phonemes.json (42 sounds) and content/ipa-legend.json
 * (53 symbols). The grid, one sound's page, and the legend each get only their slice.
 */
import phonemesRaw from "../../../content/phonemes.json";
import legendRaw from "../../../content/ipa-legend.json";
import { clipsReady, itemReady } from "../challenge/common/ready.server";
import { wordClip } from "./clips.server";
import { shapeFor, type ShapeKey } from "../mouth/geometry";
import { ipaTokens } from "./ipaTokens";

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
/** other: the sound b has where a has this one (sheep / ship → /i/), with its mouth shape */
export type SoundPair = { a: string; b: string; aIpa: string; bIpa: string; aClip: string | null; bClip: string | null; diff: [[number, number], [number, number]]; other: { ipa: string; shape: ShapeKey | null } | null };
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
  /**
   * the mouth section (src/ui/mouth's drawings): this sound's shape, and what it moves to — a
   * diphthong's end (glide) or the sound its minimal pairs are confused with; null for h (no shape)
   */
  mouth: { target: ShapeKey; glideTo: ShapeKey | null; doJa: string | null } | null;
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
    pairs: p.pairs.map((pr) => ({ a: pr.a, b: pr.b, aIpa: pr.a_ipa, bIpa: pr.b_ipa, aClip: clipOrNull(pr.a, pr.a_ipa), bClip: clipOrNull(pr.b, pr.b_ipa), diff: diffOf(pr.a, pr.b), other: contrastOf(pr) })),
    practice: p.practice.map((x) => ({ id: x.id, text: x.text, ja: x.ja, ready: itemReady(x.id) })),
    mouth: mouthOf(p),
    prev: nb(phonemes[i - 1]),
    next: nb(phonemes[i + 1]),
  };
}

/** a diphthong's end (the tongue glides to it) */
const GLIDE_TO: Record<string, string> = { EY: "IY", AY: "IY", OY: "IY", AW: "UW", OW: "UW" };
/** what the tongue does, in one plain line, by drawing */
const DO_JA: Partial<Record<ShapeKey, string>> = {
  r: "舌先は、どこにも付けない",
  t: "舌先を、歯ぐきに付ける",
  th: "舌先を、上下の歯の間に",
  s: "舌先は付けずに、細い息を",
  sh: "舌先は付けず、くちびるを前へ",
  f: "上の歯を、下くちびるに",
  b: "くちびるを閉じる",
  k: "舌の奥を、上あごに付ける",
};

function mouthOf(p: CPhoneme): SoundView["mouth"] {
  const target = shapeFor(p.arpabet);
  if (!target || p.arpabet === "HH") return null;
  const glide = GLIDE_TO[p.arpabet];
  return { target, glideTo: glide ? shapeFor(glide) : null, doJa: DO_JA[target] ?? null };
}

/** the 42 by their symbol (/ʌ/ is AH, /ə/ AH0) */
const bySymbol = new Map(phonemes.map((q) => [q.ipa, q]));

/** the one sound where b differs from a (sheep /ʃíːp/ – ship /ʃíp/ → /i/); null if more than one differs */
function contrastOf(pr: CPair): SoundPair["other"] {
  const syms = (x: string) => ipaTokens(x).flatMap((t) => (t.symbol ? [t.symbol] : []));
  const a = syms(pr.a_ipa);
  const b = syms(pr.b_ipa);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const d = b.slice(i, b.length - j);
  if (d.length !== 1) return null;
  const q = bySymbol.get(d[0]);
  return q ? { ipa: q.ipa, shape: shapeFor(q.arpabet) } : null;
}

// ---------------------------------------------------------------- 発音一覧 (one screen)

/** one sound as the 発音一覧 needs it (lean: the whole list goes to the page) */
export type BoardSound = {
  slug: string;
  /** content's id ("IY", "AH0") and the scorer's phone ("AH" with stress 0 for ə) */
  id: string;
  arpabet: string;
  ipa: string;
  name: { text: string; symbol: string };
  group: "vowel" | "diphthong" | "consonant";
  /** how a consonant is made (the list's small headings) */
  manner: string;
  tipJa: string;
  howJa: string;
  examples: { word: string; marked?: string; ipa: string; clip: string | null }[];
  pairs: { a: string; b: string; aClip: string | null; bClip: string | null; other: { ipa: string; arpabet: string; shape: ShapeKey | null } | null }[];
  mouth: { target: ShapeKey; glideTo: ShapeKey | null } | null;
  practice: { count: number; ready: boolean };
};

/** the 42 for the 発音一覧, in the list's order (母音, 二重母音, 子音 by how they are made) */
export function boardSounds(): BoardSound[] {
  const order = ["stop", "affricate", "fricative", "nasal", "liquid", "glide", "allophone"];
  const groupOf = (cat: string): BoardSound["group"] => (cat === "diphthong" ? "diphthong" : cat === "vowel" || cat === "r-colored vowel" ? "vowel" : "consonant");
  const rank = (p: CPhoneme) => {
    const g = groupOf(p.category);
    return g === "vowel" ? 0 : g === "diphthong" ? 1 : 2 + Math.max(0, order.indexOf(p.category));
  };
  return [...phonemes]
    .map((p, i) => ({ p, i }))
    .sort((x, y) => rank(x.p) - rank(y.p) || x.i - y.i)
    .map(({ p }) => {
      const m = mouthOf(p);
      return {
        slug: slugOf(p.id),
        id: p.id,
        arpabet: p.arpabet,
        ipa: p.ipa,
        name: nameParts(p),
        group: groupOf(p.category),
        manner: MANNER[p.category] ?? "",
        tipJa: p.tip_ja,
        howJa: p.how_ja,
        examples: p.examples.map((e) => ({ word: e.word, marked: e.marked, ipa: e.ipa, clip: clipOrNull(e.word, e.ipa) })),
        pairs: p.pairs.map((pr) => {
          const o = contrastOf(pr);
          const q = o ? bySymbol.get(o.ipa) : undefined;
          return { a: pr.a, b: pr.b, aClip: clipOrNull(pr.a, pr.a_ipa), bClip: clipOrNull(pr.b, pr.b_ipa), other: o && q ? { ipa: o.ipa, arpabet: q.id, shape: o.shape } : null };
        }),
        mouth: m ? { target: m.target, glideTo: m.glideTo } : null,
        practice: { count: p.practice.length, ready: p.practice.some((x) => itemReady(x.id)) },
      };
    });
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
