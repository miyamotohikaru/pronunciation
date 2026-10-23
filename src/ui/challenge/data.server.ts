/**
 * Server only: チャレンジ from content/challenge.json — 長い文 (by level), 自己紹介 (scripts with the
 * parts to make your own), 会話 (scenes, partner / you). Pages get small slices of it; whether a
 * line's recording is built yet comes from ready.server.ts.
 */
import raw from "../../../content/challenge.json";
import { getPairs, type PairRef } from "../practice/catalog.server";
import type { FieldClass } from "../practice/fields";
import { itemReady } from "./common/ready.server";

type CLine = { id: string; text: string; ja: string; difficulty?: number; swap?: { word: string; note_ja: string }[]; speaker?: "partner" | "you" };
type CScript = { id: string; title_ja: string; situation_ja: string; note_ja?: string; lines: CLine[] };
type CScene = { id: string; title_ja: string; situation_ja: string; turns: CLine[] };
type CChallenge = { version: number; long: CLine[]; intro: CScript[]; dialogues: CScene[] };

const data = raw as unknown as CChallenge;

/** one colour per corner (tokens.css fields that keep the white caption readable) */
export const FIELD = { long: "field-berry", intro: "field-berry", dialogue: "field-rl" } as const satisfies Record<string, FieldClass>;

export type Line = { id: string; text: string; ja: string; ready: boolean };
export type SwapLine = Line & { swaps: { word: string; note: string }[] };
export type Turn = Line & { role: "partner" | "you" };

const line = (l: CLine): Line => ({ id: l.id, text: l.text, ja: l.ja, ready: itemReady(l.id) });

// ---------------------------------------------------------------- 長い文

export const LEVELS = [
  { difficulty: 3, id: "easy", titleJa: "やさしめ", noteJa: "1つの文に、2つの区切り。" },
  { difficulty: 4, id: "middle", titleJa: "ふつう", noteJa: "息つぎの場所を決めて。" },
  { difficulty: 5, id: "hard", titleJa: "むずかしめ", noteJa: "最後まで同じ速さで。" },
] as const;

export type LongLevel = { id: string; titleJa: string; noteJa: string; items: Line[] };

export function longLevels(): LongLevel[] {
  return LEVELS.map((lv) => ({ id: lv.id, titleJa: lv.titleJa, noteJa: lv.noteJa, items: data.long.filter((l) => (l.difficulty ?? 0) === lv.difficulty).map(line) })).filter((lv) => lv.items.length);
}

/** the level a sentence belongs to, and where it sits in it */
export function longOf(id: string): { level: LongLevel; index: number } | null {
  for (const level of longLevels()) {
    const index = level.items.findIndex((x) => x.id === id);
    if (index >= 0) return { level, index };
  }
  return null;
}

export const allLongIds = () => data.long.map((l) => l.id);

// ---------------------------------------------------------------- 自己紹介

export type Script = { id: string; titleJa: string; situationJa: string; noteJa: string; lines: SwapLine[] };

export function scripts(): Script[] {
  return data.intro.map((s) => ({
    id: s.id,
    titleJa: s.title_ja,
    situationJa: s.situation_ja,
    noteJa: s.note_ja ?? "",
    lines: s.lines.map((l) => ({ ...line(l), swaps: (l.swap ?? []).map((x) => ({ word: x.word, note: x.note_ja })) })),
  }));
}

export const scriptOf = (id: string) => scripts().find((s) => s.id === id) ?? null;
export const allScriptIds = () => data.intro.map((s) => s.id);

// ---------------------------------------------------------------- 会話

export type Scene = { id: string; titleJa: string; situationJa: string; turns: Turn[] };

export function scenes(): Scene[] {
  return data.dialogues.map((d) => ({
    id: d.id,
    titleJa: d.title_ja,
    situationJa: d.situation_ja,
    turns: d.turns.map((t) => ({ ...line(t), role: t.speaker === "partner" ? "partner" : "you" })),
  }));
}

export const sceneOf = (id: string) => scenes().find((s) => s.id === id) ?? null;
export const allSceneIds = () => data.dialogues.map((d) => d.id);

// ---------------------------------------------------------------- shared

/** the catalog's minimal pairs for the words of these lines (the sound card's scrubber) */
export function pairsFor(texts: string[]): Record<string, PairRef> {
  const words = new Set(texts.flatMap((t) => t.toLowerCase().match(/[a-z']+/g) ?? []));
  return Object.fromEntries(Object.entries(getPairs()).filter(([w]) => words.has(w)));
}
