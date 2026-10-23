/**
 * Server only: the listen-only word clips of content/phonemes.json. tools/tts/jobs_from_curriculum.py
 * records each distinct (word, IPA) of the phonemes' examples and minimal pairs once, as
 * "w-<word>" (a second IPA for the same spelling gets "-2", "-3" …, in file order). This walks the
 * file in the same order with the same rules, so the ids match without reading .work/.
 */
import raw from "../../../content/phonemes.json";

type P = { id: string; examples?: { word: string; ipa?: string }[]; pairs?: { a: string; b: string; a_ipa?: string; b_ipa?: string }[] };
const phonemes = (raw as unknown as { phonemes: P[] }).phonemes;

const slug = (w: string) =>
  "w-" +
  w
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const keyOf = (word: string, ipa: string) => `${word.trim().toLowerCase()}|${ipa.replace(/^[/ ]+|[/ ]+$/g, "")}`;

let table: Map<string, string> | null = null;

function build(): Map<string, string> {
  const ids = new Set<string>();
  const m = new Map<string, string>();
  const add = (word: string, ipa: string) => {
    const k = keyOf(word, ipa);
    if (m.has(k)) return;
    let id = slug(word.trim());
    for (let n = 2; ids.has(id); n++) id = `${slug(word.trim())}-${n}`;
    ids.add(id);
    m.set(k, id);
  };
  for (const p of phonemes) {
    for (const e of p.examples ?? []) add(e.word, e.ipa ?? "");
    for (const pr of p.pairs ?? []) {
      add(pr.a, pr.a_ipa ?? "");
      add(pr.b, pr.b_ipa ?? "");
    }
  }
  return m;
}

/** the clip id of a word as recorded for the phoneme pages (null: not recorded) */
export function wordClip(word: string, ipa: string): string | null {
  table ??= build();
  return table.get(keyOf(word, ipa)) ?? null;
}
