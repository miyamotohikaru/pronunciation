/**
 * 発音記号のページの単語（content/phonemes.json の例と最小対）の id。音声もその採点データも同じ id。
 * つづり＋発音記号ごとに1つ、"w-<語>"。同じつづりで発音記号が違うものは、ファイルの順に "-2", "-3" …。
 * tools/tts/jobs_from_curriculum.py が録音したときと同じ規則・同じ順（例 → 最小対の a → b）で数える。
 */
export type PhonemeWords = {
  id: string;
  watch_for?: string[];
  examples?: { word: string; ipa?: string }[];
  pairs?: { a: string; b: string; a_ipa?: string; b_ipa?: string }[];
};

/** 単語 1 つ: id と、その音を練習する音（例と最小対の a。最小対の b は別の音なので入らない） */
export type WordClip = { id: string; word: string; ipa: string; phones: string[] };

const slug = (w: string) =>
  "w-" +
  w
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const wordKey = (word: string, ipa: string) => `${word.trim().toLowerCase()}|${ipa.replace(/^[/ ]+|[/ ]+$/g, "")}`;

/** つづり＋発音記号 → 単語（録音した順） */
export function wordClips(phonemes: readonly PhonemeWords[]): Map<string, WordClip> {
  const ids = new Set<string>();
  const m = new Map<string, WordClip>();
  const add = (word: string, ipa: string, phone: string | null) => {
    const k = wordKey(word, ipa);
    let c = m.get(k);
    if (!c) {
      let id = slug(word.trim());
      for (let n = 2; ids.has(id); n++) id = `${slug(word.trim())}-${n}`;
      ids.add(id);
      c = { id, word: word.trim(), ipa: ipa.trim(), phones: [] };
      m.set(k, c);
    }
    if (phone && !c.phones.includes(phone)) c.phones.push(phone);
  };
  for (const p of phonemes) {
    for (const e of p.examples ?? []) add(e.word, e.ipa ?? "", p.id);
    for (const pr of p.pairs ?? []) {
      add(pr.a, pr.a_ipa ?? "", p.id);
      add(pr.b, pr.b_ipa ?? "", null);
    }
  }
  return m;
}
