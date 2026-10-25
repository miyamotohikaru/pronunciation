/**
 * Server only: the word clips of content/phonemes.json (examples and minimal pairs). Each distinct
 * (word, IPA) was recorded once as "w-<word>" and is also built into a scorable item of the same id
 * (public/content/items/w-<word>.json); the naming rule lives in src/data/word-clips.ts, shared with
 * the content build, so the ids match without reading .work/.
 */
import raw from "../../../content/phonemes.json";
import { wordClips, wordKey, type PhonemeWords, type WordClip } from "@/data/word-clips.ts";

const phonemes = (raw as unknown as { phonemes: PhonemeWords[] }).phonemes;

let table: Map<string, WordClip> | null = null;

/** the clip id of a word as recorded for the phoneme pages (null: not recorded) */
export function wordClip(word: string, ipa: string): string | null {
  table ??= wordClips(phonemes);
  return table.get(wordKey(word, ipa))?.id ?? null;
}
