/**
 * 練習アイテムのデータ形式（ビルド時に tools/build-content が書き出し、アプリが読む）。
 * 1アイテム = public/content/items/<id>.json。一覧は src/data/catalog.json。
 */

/** ARPAbet。母音は強勢の数字つき（AH0, IY1 …）。 */
export type Arpabet = string;

export type ItemWord = {
  /** 画面に出す綴り（句読点は含めない） */
  text: string;
  /**
   * 目標の音素列: refs[0] の声が言うよう指示された音（misaki → ARPAbet）。
   * DX ははじき音の T/D、Q は声門閉鎖の T。採点器が実際に聞き取った並びは refs[].phones
   */
  phones: Arpabet[];
  /**
   * 採点で受け入れる読み（src/engine/scoring の TargetWord.variants にそのまま渡す）。
   * お手本の misaki・CMUdict・弱形・お手本の音声から学んだ読み。"X?" は省略可、DX ははじき音、Q は声門閉鎖。
   */
  variants: string[];
};

export type FocusPoint = {
  /** words のインデックス（inPair なら pairItem.words のインデックス） */
  word: number;
  /** 最小対の相手の語の音を指す */
  inPair?: boolean;
  /** ARPAbet の基本記号（強勢なし）。例: "R" */
  phone: string;
  /** 出やすい言い間違い。"EPEN" は子音のあとに母音を足すクセ */
  watchFor: string[];
  /** コツ（実力チェックの文には無い） */
  tipJa: string;
  /** 実力チェックの診断タグ（"r-l", "th" …） */
  tag?: string;
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

/** お手本の1テイク分の時間情報（ゆっくり版に使う。普通の速さは RefVoice 自体が持つ） */
export type RefTiming = {
  duration: number;
  words: { start: number; end: number }[];
  phones: { phone: Arpabet; word: number; start: number; end: number }[];
  speech: [number, number];
  pitch: [number, number, number][];
  syllables: RefSyllable[];
  selfScore: { sounds: number; minWord: number };
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
  /**
   * 自分の採点器でお手本を採点した結果（ネイティブ基準の確認用。95 以上が目標）。
   * sounds / minWord はこの声自身、rhythm / intonation はもう一方の声をこの声と比べた値。
   */
  selfScore: { sounds: number; minWord: number; rhythm: number; intonation: number };
  /** ゆっくり版（slowAudio）の時間情報 */
  slow: RefTiming;
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
  /** 言い換えて録音した文（gonna, wanna …）のもとの書き方。text は実際に言った形 */
  note?: string;
  /** 実力チェックの文: 何を診断するか */
  diagnoses?: string[];
  words: ItemWord[];
  focus: FocusPoint[];
  difficulty: number;
  /**
   * このアイテム用の採点の調整（お手本4テイクから作る）。
   * 採点のとき ScoreOptions にそのまま混ぜる: scorer.score({ audio, words }, { ...item.scoring })
   */
  scoring?: ItemScoring;
  refs: RefVoice[];
  /** 最小対の相手の語（pair のとき）。お手本も採点用の読みも、調整も同じ形で持つ */
  pairItem?: { id: string; text: string; words: ItemWord[]; scoring?: ItemScoring; refs: RefVoice[] };
};

/**
 * diagnosis: お手本自身に出る聞き違い・脱落・母音の挿入の余裕 + 1 にしきい値を上げたもの
 *   （pairPenalty "T>Q"、deletionPenaltyFor "T"、insertionPenaltyAfter "T"。対数確率）
 * baseline: お手本でも採点器の評価が低い音（"<語>:<音素>:<語の中で何番目>" -> 0..2）。同じハンデを付ける
 */
export type ItemScoring = {
  diagnosis?: { pairPenalty?: Record<string, number>; deletionPenaltyFor?: Record<string, number>; insertionPenaltyAfter?: Record<string, number> };
  baseline?: Record<string, number>;
};

/** focus: 注目する音（ARPAbet の基本記号、重複なし） */
export type CatalogItem = Pick<ItemData, "id" | "type" | "text" | "ja" | "difficulty"> & { focus: string[]; pair?: string; note?: string };

export type Catalog = {
  version: number;
  placement: { id: string; text: string; ja: string; diagnoses: string[]; focus: { word: string; phone: string; watchFor: string[]; tag: string }[] }[];
  units: {
    id: string;
    titleJa: string;
    subtitleJa: string;
    feature: string;
    whyJa: string;
    howJa: string;
    lessons: { id: string; titleJa: string; goalJa: string; feature: string; items: CatalogItem[] }[];
  }[];
};
