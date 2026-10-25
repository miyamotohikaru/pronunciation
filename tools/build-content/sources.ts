/**
 * Every recorded line of content/ as one list, whichever file it comes from:
 *   curriculum.json  units[].lessons[].items[] (v1 words / pairs, v2 sentences, boss lessons) + placement[]
 *   challenge.json   long[] sentences, intro[] scripts, dialogues[] scenes (partner / you lines)
 *   phonemes.json    each phoneme's practice sentences; its examples / pairs are the "w-<word>" words
 *                    (one item per recorded word, src/data/word-clips.ts), scored on the sounds page
 *   alphabet.json    practice lines with letter tokens ("My name is Ken. K, E, N.")
 * A line is any object with a string id and text, found by walking the file (so a new grouping
 * level or key needs no code here); listen-only reference parts are skipped by key. A line's
 * group is its nearest ancestor with an id (a scene, a phoneme, a confusion set); dialogue lines
 * carry their speaker ("partner" lines are listen-only in the app).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ItemType } from "../../src/data/schema.ts";
import { wordClips, type PhonemeWords } from "../../src/data/word-clips.ts";

export type CFocus = { word: string; phone: string; watch_for: string[]; tip_ja?: string; tag?: string };
export type CItem = { id: string; type: ItemType; text: string; ja: string; pair?: string; tts_text?: string; focus: CFocus[]; difficulty: number };
export type CLesson = { id: string; title_ja: string; goal_ja: string; feature: string; boss?: boolean; items: CItem[] };
export type CUnit = { id: string; title_ja: string; subtitle_ja: string; feature: string; why_ja: string; how_ja: string; lessons: CLesson[] };
export type CPlacement = { id: string; text: string; ja: string; tts_text?: string; diagnoses: string[]; focus: CFocus[] };
export type Curriculum = { version: number; placement: CPlacement[]; units: CUnit[] };

/** One line to record, score and ship as public/content/items/<id>.json. */
export type SourceLine = {
  id: string;
  text: string;
  ja: string;
  tts_text?: string;
  focus: CFocus[];
  difficulty: number;
  type: ItemType;
  /** curriculum: unit / lesson ids. Other files: the file ("challenge") / the line's group */
  unit: string;
  lesson: string;
  pair?: string;
  diagnoses?: string[];
  role?: "partner" | "you";
  /** self-introduction lines: words a learner replaces with their own (name, town …) */
  swap?: { word: string; note_ja: string }[];
  /** alphabet lines: the tokens said as letter names ("K, E, N." -> ["K", "E", "N"]) */
  spell?: string[];
};

/** A group of lines outside the curriculum, for the catalog (a scene, a script, a phoneme's practice set). */
export type SourceSet = { source: string; section: string; id: string; titleJa?: string; situationJa?: string; noteJa?: string; ids: string[] };

/** Files besides curriculum.json, and the keys under which they hold listen-only reference data. */
export const EXTRA_FILES = ["challenge.json", "phonemes.json", "alphabet.json"];
const REFERENCE_KEYS = new Set(["examples", "pairs", "letters", "confusions", "legend", "focus"]);
const ROLE_KEYS = ["speaker", "role", "who", "by"];

const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x : undefined);
const isLine = (o: Record<string, unknown>) => !!str(o.id) && !!str(o.text);

function roleOf(o: Record<string, unknown>): "partner" | "you" | undefined {
  for (const k of ROLE_KEYS) {
    const v = str(o[k])?.toLowerCase();
    if (v === "you" || v === "partner") return v;
  }
  return undefined;
}

function lineOf(o: Record<string, unknown>, unit: string, lesson: string): SourceLine {
  const role = roleOf(o);
  return {
    id: String(o.id),
    text: String(o.text).trim(),
    ja: str(o.ja) ?? "",
    ...(str(o.tts_text) ? { tts_text: String(o.tts_text).trim() } : {}),
    focus: Array.isArray(o.focus) ? (o.focus as CFocus[]) : [],
    difficulty: typeof o.difficulty === "number" ? o.difficulty : 0,
    type: (["word", "pair", "phrase", "sentence"].includes(String(o.type)) ? o.type : "sentence") as ItemType,
    unit,
    lesson,
    ...(str(o.pair) ? { pair: String(o.pair) } : {}),
    ...(role ? { role } : {}),
    ...(Array.isArray(o.swap) && o.swap.length ? { swap: o.swap as { word: string; note_ja: string }[] } : {}),
    ...(Array.isArray(o.spell) && o.spell.length ? { spell: o.spell as string[] } : {}),
  };
}

/** Lines of one extra file: walks it, the group of a line = its nearest ancestor with an id. */
export function linesOfFile(source: string, data: unknown): { lines: SourceLine[]; sets: SourceSet[] } {
  const lines: SourceLine[] = [];
  const sets = new Map<string, SourceSet>();
  type Group = { id: string; titleJa?: string; situationJa?: string; noteJa?: string };
  const walk = (node: unknown, section: string, group: Group | null) => {
    if (Array.isArray(node)) {
      for (const x of node) walk(x, section, group);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (isLine(o)) {
      const g = group ?? { id: section };
      const line = lineOf(o, source, g.id);
      lines.push(line);
      const key = `${section}/${g.id}`;
      const set = sets.get(key) ?? { source, section, ...g, ids: [] };
      set.ids.push(line.id);
      sets.set(key, set);
      return;
    }
    const id = str(o.id) ?? str(o.arpabet);
    const texts = { titleJa: str(o.title_ja) ?? str(o.name_ja), situationJa: str(o.situation_ja), noteJa: str(o.note_ja) };
    const here = id ? { id, ...Object.fromEntries(Object.entries(texts).filter(([, v]) => v)) } : group;
    for (const [k, v] of Object.entries(o)) {
      if (REFERENCE_KEYS.has(k)) continue;
      walk(v, section || k, here);
    }
  };
  walk(data, "", null);
  return { lines, sets: [...sets.values()] };
}

/** 単語の行: id は録音した名前（src/data/word-clips.ts）、focus はその語で練習する音 */
function wordLines(phonemes: PhonemeWords[]): SourceLine[] {
  const watch = new Map(phonemes.map((p) => [p.id, p.watch_for ?? []]));
  return [...wordClips(phonemes).values()].map((c) => ({
    id: c.id,
    text: c.word,
    ja: "",
    focus: c.phones.map((phone) => ({ word: c.word, phone, watch_for: watch.get(phone) ?? [] })),
    difficulty: 0,
    type: "word" as ItemType,
    unit: "phonemes",
    lesson: "words",
  }));
}

export function loadSources(contentDir: string, curriculumPath = join(contentDir, "curriculum.json")) {
  const curriculum = JSON.parse(readFileSync(curriculumPath, "utf8")) as Curriculum;
  const lines: SourceLine[] = [
    ...curriculum.units.flatMap((u) =>
      u.lessons.flatMap((l) => l.items.map((it) => ({ ...it, focus: it.focus ?? [], unit: u.id, lesson: l.id }))),
    ),
    ...curriculum.placement.map((p) => ({ ...p, type: "sentence" as ItemType, difficulty: 0, unit: "placement", lesson: "placement" })),
  ];
  const sets: SourceSet[] = [];
  for (const f of EXTRA_FILES) {
    const path = join(contentDir, f);
    if (!existsSync(path)) continue;
    const r = linesOfFile(f.replace(/\.json$/, ""), JSON.parse(readFileSync(path, "utf8")));
    lines.push(...r.lines);
    sets.push(...r.sets);
  }
  // 発音記号のページの単語（例と最小対）: 1語ずつ録音済みの w-…。その場で録音して確かめられるように item にする
  // （どのレッスン・set にも入れない）
  const phonemesPath = join(contentDir, "phonemes.json");
  if (existsSync(phonemesPath)) lines.push(...wordLines(JSON.parse(readFileSync(phonemesPath, "utf8")).phonemes ?? []));
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.id)) throw new Error(`duplicate line id ${l.id}`);
    seen.add(l.id);
  }
  return { curriculum, lines, sets };
}
