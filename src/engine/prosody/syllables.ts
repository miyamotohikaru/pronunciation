import type { PhoneSpan, Syllable } from "./types.ts";

const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);

export const baseOf = (phone: string) => phone.replace(/[0-9]$/, "");
export const isVowel = (phone: string) => VOWELS.has(baseOf(phone));
export const stressOf = (phone: string): 0 | 1 | 2 => {
  const d = phone.match(/([0-2])$/);
  return d ? (Number(d[1]) as 0 | 1 | 2) : 0;
};

/**
 * 英語として語頭に立てる子音の並び（最大頭子音の原則に使う）。
 * 全部を網羅する必要はなく、音節の長さを測るのに十分ならよい。
 */
const ONSETS = new Set(
  [
    // 1子音（NG は語頭に立たない）
    "B", "CH", "D", "DH", "F", "G", "HH", "JH", "K", "L", "M", "N", "P", "R", "S", "SH", "T", "TH", "V", "W", "Y", "Z", "ZH",
    // 子音 + R / L / W / Y
    "P R", "B R", "T R", "D R", "K R", "G R", "F R", "TH R", "SH R",
    "P L", "B L", "K L", "G L", "F L", "S L",
    "T W", "D W", "K W", "G W", "S W", "TH W",
    "P Y", "B Y", "K Y", "G Y", "M Y", "F Y", "V Y", "HH Y", "N Y", "L Y",
    // S + 子音
    "S P", "S T", "S K", "S M", "S N", "S F",
    "S P R", "S T R", "S K R", "S P L", "S K L", "S K W", "S K Y", "S P Y",
  ],
);

/** 文の中では弱く読むのが普通の語（表示の太さに使う。採点はお手本の実測で行う）。 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "to", "of", "and", "or", "but", "in", "on", "at", "for", "with", "from", "by", "as", "than",
  "is", "are", "am", "was", "were", "be", "been", "do", "does", "did", "have", "has", "had",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "that", "there", "some", "just", "so",
  "i'm", "you're", "it's", "i'll", "we're", "they're", "let's",
]);

/**
 * 音素列を単語ごとに音節へ分ける。
 * 母音を核にして、母音にはさまれた子音は「語頭に立てる最長の並び」を後ろの音節へ回す。
 * 音節は単語をまたがない（つながる音は別の場所で扱う）。
 */
export function syllabify(phones: PhoneSpan[], words: string[]): Syllable[] {
  const out: Syllable[] = [];
  let i = 0;
  while (i < phones.length) {
    const w = phones[i].word;
    let j = i;
    while (j < phones.length && phones[j].word === w) j++;
    out.push(...syllabifyWord(phones, i, j, w, words[w] ?? ""));
    i = j;
  }
  return out;
}

function syllabifyWord(phones: PhoneSpan[], from: number, to: number, word: number, text: string): Syllable[] {
  const nuclei: number[] = [];
  for (let k = from; k < to; k++) if (isVowel(phones[k].phone)) nuclei.push(k);
  if (nuclei.length === 0) return []; // 母音のない語（"hmm" など）は音節にしない

  const starts: number[] = [from];
  for (let n = 1; n < nuclei.length; n++) {
    const prevV = nuclei[n - 1];
    const nextV = nuclei[n];
    // 母音にはさまれた子音の並び [prevV+1, nextV)
    let cut = nextV; // 何も回せなければ母音の直前で切る
    for (let s = prevV + 1; s <= nextV; s++) {
      const cluster = phones.slice(s, nextV).map((p) => baseOf(p.phone)).join(" ");
      if (cluster === "" || ONSETS.has(cluster)) {
        cut = s;
        break;
      }
    }
    starts.push(cut);
  }

  const fn = FUNCTION_WORDS.has(text.toLowerCase().replace(/[^a-z']/g, ""));
  return nuclei.map((nuc, n) => {
    const lexicalStress = stressOf(phones[nuc].phone);
    const single = nuclei.length === 1;
    // 1音節の内容語は強、機能語は弱。複数音節なら第1強勢のある音節だけ強
    const sentenceStress: 0 | 1 = fn ? 0 : single ? 1 : lexicalStress === 1 ? 1 : 0;
    return {
      word,
      phones: [starts[n], n + 1 < nuclei.length ? starts[n + 1] : to] as [number, number],
      nucleus: nuc,
      lexicalStress: single && !fn ? 1 : lexicalStress,
      sentenceStress,
    };
  });
}
