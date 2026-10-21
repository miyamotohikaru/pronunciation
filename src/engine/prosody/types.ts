/**
 * リズムと抑揚（プロソディ）の比較に使う型。
 * 音の採点（src/engine/scoring）とは独立していて、
 * 「同じ目標の音素列に強制アラインメントした結果」と「音程の時系列」だけを受け取る。
 * ブラウザにもNodeにも依存しない（ビルド時にお手本音声の解析でも同じコードを使う）。
 */

/** 音程の1フレーム。t は秒、f0 は Hz（無声なら null）、rms は線形の振幅。 */
export type PitchFrame = { t: number; f0: number | null; rms: number };

/**
 * 強制アラインメントで得た1音素の区間（秒）。
 * phone は ARPAbet。母音は強勢の数字つき（AH0, IY1 …）でもなしでもよい。
 * CTC の区間はスパイク状で短いので、境界はこちらで作り直す（boundaries.ts）。
 */
export type PhoneSpan = { phone: string; word: number; start: number; end: number };

/** 1音節。phones は [開始, 終了) の音素インデックス。nucleus は母音のインデックス。 */
export type Syllable = {
  word: number;
  phones: [number, number];
  nucleus: number;
  /** 辞書上の強勢（0=弱 1=第1強勢 2=第2強勢） */
  lexicalStress: 0 | 1 | 2;
  /** 文の中での強さの見込み（機能語は弱める）。0=弱 1=強 */
  sentenceStress: 0 | 1;
};

/** 1音節の測定値。 */
export type SyllableStats = {
  start: number;
  end: number;
  /** 母音（核）の区間 */
  nucleusStart: number;
  nucleusEnd: number;
  dur: number;
  /** 話者の中央値からの半音差。声が取れなければ null */
  pitchSt: number | null;
  /** 核の平均の大きさ（dBFS） */
  db: number;
  /** 発話内で z 化した長さ・大きさ・高さの合成。大きいほど目立つ */
  prominence: number;
};

export type ProsodyIssueKind =
  | "equal-timing" // 音節がみな同じ長さ（モーラ拍っぽい）
  | "weak-contrast" // 強い音節と弱い音節の差が小さい
  | "stress-misplaced" // 単語の中で目立つ音節がずれている
  | "flat-intonation" // 抑揚の幅が狭い
  | "contour-mismatch" // 上がり下がりの形が違う
  | "final-contour" // 文末の上げ下げが逆
  | "pause" // お手本にない間
  | "too-slow"
  | "too-fast";

export type ProsodyIssue = {
  kind: ProsodyIssueKind;
  /** 関係する単語（あれば） */
  word?: number;
  /** 0..1 の重さ。表示の順番に使う */
  weight: number;
};

export type ContourPoint = { t: number; st: number | null };

export type ProsodyResult = {
  /** 0..100 */
  rhythm: number;
  /** 0..100 */
  intonation: number;
  /** 0..100（間と速さ） */
  fluency: number;
  /** 音節が少なすぎて判定を弱めたか */
  lowConfidence: boolean;
  syllables: Syllable[];
  ref: SyllableStats[];
  user: SyllableStats[];
  /** 複数音節の単語ごとの強勢の当たり外れ */
  stress: { word: number; expected: number; got: number; ok: boolean }[];
  /** お手本の時間軸に合わせて伸縮した自分の音程（重ねて描く用） */
  userOnRefTime: ContourPoint[];
  refContour: ContourPoint[];
  issues: ProsodyIssue[];
  /** 内訳（デバッグと調整用） */
  detail: Record<string, number>;
};
