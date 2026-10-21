/**
 * 音の採点エンジン（src/engine/scoring）の型。
 * ブラウザの Web Worker でも Node でも動く。フレームワーク・DOM・Node API に依存しない。
 *
 * Phone notation (input): ARPAbet, stress digit optional ("AY1", "AY" are the same sound).
 * Extensions accepted in target pronunciations:
 *   "DX"  flap T/D (misaki ɾ / T): accepts T or D
 *   "Q"   glottal T (misaki ʔ): accepts T or D, and may be silent (optional)
 *   "X?"  any phone followed by "?" is optional (e.g. a reduced vowel "AH0?")
 */

// ------------------------------------------------------------------ model metadata

/** Log-mel front end that matches openai-whisper's log_mel_spectrogram(). */
export type WhisperMelFrontEnd = {
  type: "whisper-log-mel";
  sampleRate: number; // 16000
  nFft: number; // 400
  hop: number; // 160
  nMels: number; // 80
  /** Seconds of zero samples appended after the audio before the mel (0 = trim). */
  tailPadSeconds: number;
  /** Pad (with zeros) so that the clip is at least this long, in seconds (0 = off). */
  minSeconds: number;
};

/** Sparse mel filterbank: filters[m] covers FFT bins [start, start + weights.length). */
export type MelFilterBank = {
  nFft: number;
  nMels: number;
  /** "float32": every weight is an exact float32 value (written with 9 significant digits). */
  dtype: "float32";
  filters: { start: number; weights: number[] }[];
};

/**
 * Description of a CTC phone model. One JSON file per model (public/models/<id>/meta.json).
 * Nothing else in the engine knows the model's vocabulary.
 */
export type ModelMeta = {
  schema: 1;
  id: string;
  /** Human-readable source and license (shown in credits). */
  source: string;
  license: string;
  /** File names relative to the meta.json URL. */
  files: {
    onnx: Record<string, string>; // e.g. { int8: "model.int8.onnx", fp32: "model.fp32.onnx" }
    defaultOnnx: string; // key of onnx
    regressor: string; // regressor.json
    melFilters: string; // mel_filters_80.json
  };
  frontEnd: WhisperMelFrontEnd;
  onnx: {
    input: string; // "mel", shape [1, nMels, L]
    output: string; // "log_probs", shape [1, T, vocabSize]
    /** true if the graph already applies log_softmax */
    logSoftmax: boolean;
    /** encoder frames per second (whisper: 50) */
    frameRate: number;
    /** audio samples per encoder frame (whisper: 320) */
    samplesPerFrame: number;
    /** longest input the model accepts, in encoder frames (whisper: 1500 = 30 s) */
    maxFrames: number;
  };
  vocab: string[];
  /** Output dimension of the model (may be larger than vocab.length). */
  vocabSize: number;
  blank: number;
  /**
   * ARPAbet base symbol -> model token ids. A phone's log-prob is the logsumexp over its
   * ids (this is where stress variants AA/AA0/AA1/AA2 are merged). Every ARPAbet phone
   * the content may use must be present. Keys may also carry a stress digit (AA1) if a
   * model wants stress-specific units; lookup tries the exact symbol, then the base.
   */
  units: Record<string, number[]>;
  /** Metadata for GOP features and the phone-score regressor. */
  regressor: {
    /** Order of the numeric features (then a one-hot of the phone class). */
    features: GopFeatureName[];
    oneHotSize: number;
    /** Phone symbol -> one-hot index. Lookup tries the exact symbol, then the base. */
    classOf: Record<string, number>;
    /** Range of the regressor's output (speechocean762: 0 wrong .. 2 correct). */
    range: [number, number];
  };
  /** 0..2 regressor output -> 0..100 (piecewise linear, x ascending). */
  calibration: { knots: [number, number][] };
  diagnosis: DiagnosisConfig;
};

export type GopFeatureName = "gop" | "logp_target" | "logp_competitor" | "logp_target_min" | "n_frames";

/** Thresholds for "heard as" / epenthesis / deletion. Log-prob units (natural log). */
export type DiagnosisConfig = {
  /** Allowed confusions: target base phone -> phones it is often heard as. */
  confusions: Record<string, string[]>;
  /** Vowels tried as insertions after consonants (Japanese epenthesis: u, o, i). */
  epentheticVowels: string[];
  /** Penalty for taking a confusion instead of the target (once per phone). */
  substitutionPenalty: number;
  /** Per-pair overrides, keyed "TARGET>HEARD" (e.g. "N>NG"). */
  pairPenalty?: Record<string, number>;
  /** Penalty for an inserted vowel. */
  insertionPenalty: number;
  /** Penalty for skipping a target phone. */
  deletionPenalty: number;
  /** Shortest inserted vowel we report, in encoder frames. */
  minInsertionFrames: number;
  /** A phone below this 0..100 score with no confusion found is a "distortion". */
  distortionBelow: number;
  /** Score cap for a phone diagnosed as substituted / deleted. */
  substitutionCap: number;
  deletionCap: number;
  /** 0..100 score of the pseudo-phone each inserted vowel adds to its word and the take. */
  insertionScore: number;
  /** A word never scores more than its worst phone + this margin. */
  worstPhoneMargin: number;
};

// ------------------------------------------------------------------ input

export type TargetWord = {
  /** What is shown (may be a multi-word chunk such as "check it out"). */
  text: string;
  /**
   * Accepted pronunciations, best-known first: CMUdict variants plus the one the native
   * reference audio actually used. Each is an array of phones or a space-separated string.
   */
  variants: (string | string[])[];
};

export type ScoreRequest = {
  /** 16 kHz mono PCM, -1..1. */
  audio: Float32Array;
  words: TargetWord[];
};

export type ScoreOptions = {
  /** Override diagnosis thresholds for this call (deriveVariants uses a sensitive set). */
  diagnosis?: Partial<DiagnosisConfig>;
  /**
   * "score" (default): Viterbi over the union of variants, then per word the variant with
   * the best word score. "likelihood": the Viterbi choice only (faster, a little harsher).
   */
  variantChoice?: "score" | "likelihood";
};

// ------------------------------------------------------------------ output

export type PhoneIssue = "substitution" | "distortion" | "deletion";

export type PhoneResult = {
  /** Target phone as given in the chosen variant (stress digit kept). */
  phone: string;
  /** Position of this phone in the chosen variant (optional phones may be missing). */
  index: number;
  /** 0..100 */
  score: number;
  /** Raw regressor output on the model's own scale (0..2 for speechocean762). */
  raw: number;
  /** Set when a likely confusion was found (ARPAbet base symbol, e.g. "L"). */
  heardAs?: string;
  issue?: PhoneIssue;
  /** Seconds. CTC spans are short spikes; see README. */
  start: number;
  end: number;
};

export type WordResult = {
  text: string;
  /** 0..100 */
  score: number;
  start: number;
  end: number;
  /** Index into TargetWord.variants that fitted this take best. */
  variant: number;
  /** Phones of the chosen variant that were realized (optional phones may be absent). */
  phones: PhoneResult[];
};

export type Insertion = {
  wordIndex: number;
  /** Index into words[wordIndex].phones; the vowel was inserted after that phone. */
  afterPhoneIndex: number;
  /** ARPAbet base symbol of the inserted vowel (UW, OW, IH ...). */
  vowel: string;
  start: number;
  end: number;
};

/** Same shape as src/engine/prosody's PhoneSpan: one span per realized target phone. */
export type AlignedPhoneSpan = { phone: string; word: number; start: number; end: number };

export type ScoreResult = {
  words: WordResult[];
  insertions: Insertion[];
  /** 0..100: the sounds (segmental) score of the whole take. */
  sounds: number;
  /** Flat list for src/engine/prosody. */
  spans: AlignedPhoneSpan[];
  /** Free (greedy) CTC decode, ARPAbet base symbols. For debugging and the lab page. */
  heard: string[];
  /** Milliseconds per stage. */
  timing: { mel: number; model: number; align: number; total: number };
  backend: string;
};

// ------------------------------------------------------------------ runtime plumbing

/** Per-frame log-probabilities over the model vocabulary, row-major [frames, vocabSize]. */
export type LogProbs = { data: Float32Array; frames: number; vocabSize: number };

/** Runs the acoustic model. Implemented with onnxruntime-web / onnxruntime-node. */
export interface AcousticBackend {
  readonly name: string;
  /** mel: row-major [nMels, nFrames]. */
  run(mel: Float32Array, nMels: number, nFrames: number): Promise<LogProbs>;
  dispose(): Promise<void>;
}

/** Exported HistGradientBoostingRegressor (sklearn) - see hgbr.ts. */
export type RegressorJson = {
  type: "sklearn.HistGradientBoostingRegressor";
  sklearn: string;
  nFeatures: number;
  baseline: number;
  trees: TreeJson[];
};

/** Arrays indexed by node id. threshold null = +Infinity. */
export type TreeJson = {
  feature: number[];
  threshold: (number | null)[];
  left: number[];
  right: number[];
  leaf: number[]; // 1 = leaf
  value: number[];
  missingLeft: number[]; // 1 = NaN goes left
};

export type ScorerAssets = {
  meta: ModelMeta;
  regressor: RegressorJson;
  melFilters: MelFilterBank;
};
