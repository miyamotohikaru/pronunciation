/**
 * 練習アイテムのデータ形式（ビルド時に tools/build-content が書き出し、アプリが読む）。
 * 1アイテム = public/content/items/<id>.json。一覧は src/data/catalog.json。
 */

/** ARPAbet。母音は強勢の数字つき（AH0, IY1 …）。 */
export type Arpabet = string;

export type ItemWord = {
  /** 画面に出す綴り（句読点は含めない） */
  text: string;
  /** お手本が実際に言った音（目標の音素列） */
  phones: Arpabet[];
};

export type FocusPoint = {
  /** words のインデックス */
  word: number;
  /** ARPAbet の基本記号（強勢なし）。例: "R" */
  phone: string;
  /** 出やすい言い間違い。"EPEN" は子音のあとに母音を足すクセ */
  watchFor: string[];
  tipJa: string;
};

/** お手本の音節（音程レーンの棒1本） */
export type RefSyllable = {
  word: number;
  start: number;
  end: number;
  nucleusStart: number;
  nucleusEnd: number;
  /** 話者の中央値からの半音差 */
  pitchSt: number | null;
  /** 目立ち具合（長さ・大きさ・高さの z 合成） */
  prominence: number;
  /** 辞書上の強勢（0/1/2） */
  stress: 0 | 1 | 2;
};

export type RefVoice = {
  voice: string;
  /** /audio/<voice>/<id>.mp3 */
  audio: string;
  slowAudio: string;
  duration: number;
  slowDuration: number;
  /** 単語ごとの区間（秒） */
  words: { start: number; end: number }[];
  /** 目標音素ごとの強制アラインメント（秒）。prosody の Take.phones にそのまま渡せる形 */
  phones: { phone: Arpabet; word: number; start: number; end: number }[];
  /** 声の出ていた区間 */
  speech: [number, number];
  /** 音程。[t(秒, 小数2桁), f0(Hz の整数, 無声は 0), rms(×1000 の整数)] を 10ms ごと */
  pitch: [number, number, number][];
  syllables: RefSyllable[];
  /** 自分の採点器でお手本を採点した結果（ネイティブ基準の確認用。95 以上が目標） */
  selfScore: { sounds: number; rhythm: number; intonation: number };
};

export type ItemType = "word" | "pair" | "phrase" | "sentence";

export type ItemData = {
  id: string;
  unit: string;
  lesson: string;
  type: ItemType;
  /** 画面に出す英文 */
  text: string;
  /** 意味（和訳） */
  ja: string;
  /** 最小対（pair のとき）の相手の語 */
  pair?: string;
  words: ItemWord[];
  focus: FocusPoint[];
  difficulty: number;
  refs: RefVoice[];
};

export type CatalogItem = Pick<ItemData, "id" | "type" | "text" | "ja" | "difficulty"> & { focus: string[] };

export type Catalog = {
  version: number;
  placement: { id: string; text: string; ja: string; diagnoses: string[] }[];
  units: {
    id: string;
    titleJa: string;
    subtitleJa: string;
    feature: string;
    whyJa: string;
    howJa: string;
    lessons: { id: string; titleJa: string; goalJa: string; items: CatalogItem[] }[];
  }[];
};
