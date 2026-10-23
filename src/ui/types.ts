/**
 * Data the game UI draws. Shapes follow the engines so real results can be passed straight in:
 *   - syllables / contours: src/engine/prosody (SyllableStats, ContourPoint) and src/data/schema.ts (RefSyllable)
 *   - words / phones:       src/engine/scoring (WordResult, PhoneResult)
 * The UI adds only what it needs for layout (`letters`: which characters spell a phone).
 */
import type { ContourPoint, ProsodyIssueKind } from "@/engine/prosody/types.ts";
import type { PhoneIssue } from "@/engine/scoring/types.ts";

export type { ContourPoint };

/** One bar of the pitch lane. A RefSyllable or a SyllableStats both fit. */
export type LaneSyllable = {
  /** index into the item's words */
  word: number;
  start: number;
  end: number;
  nucleusStart: number;
  nucleusEnd: number;
  /** semitones from the speaker's median; null = no voiced frames */
  pitchSt: number | null;
  /** z-sum of length, loudness, height (unbounded; the lane normalises it per utterance) */
  prominence: number;
};

/** A word on some timeline (the model's or the user's), seconds. */
export type WordSpan = { text: string; start: number; end: number };

export type PhoneScore = {
  /** ARPAbet, stress digit allowed ("AY1") */
  phone: string;
  /** 0..100 */
  score: number;
  /** ARPAbet base symbol the scorer heard instead ("L") */
  heardAs?: string;
  issue?: PhoneIssue;
  /** UI only: [start, end) character range of the word's text spelling this phone */
  letters?: [number, number];
  /** a vowel the scorer heard inserted right after this sound (ARPAbet, e.g. "UW") */
  inserted?: string;
};

export type WordScore = { text: string; score: number; phones: PhoneScore[] };

/** Each 0..100. `overall` is recomputed by the UI from the weighted parts so the sum is visible. */
export type Scores = { overall: number; sounds: number; rhythm: number; intonation: number };

export type ProsodyNote = { kind: ProsodyIssueKind; word?: number; weight: number };

export type UnitId = "rhythm" | "rl" | "th";

/** One practice line with everything the model voice gives us. */
export type PracticeItem = {
  id: string;
  unit: UnitId;
  /** the line as shown, with punctuation */
  text: string;
  /** meaning in Japanese; ◇ / ◆ breaks allowed */
  ja: string;
  /** seconds of model audio */
  duration: number;
  /** playback rate of the slow version */
  slowRate: number;
  words: WordSpan[];
  syllables: LaneSyllable[];
  contour: ContourPoint[];
};

/** One recorded attempt and its result. */
export type TakeResult = {
  attempt: number;
  scores: Scores;
  words: WordScore[];
  /** the take on the user's own timeline */
  user: {
    duration: number;
    /** voice onset/offset inside the recording */
    speech: [number, number];
    words: WordSpan[];
    syllables: LaneSyllable[];
    contour: ContourPoint[];
    /** input level 0..1 every 10 ms (drives the mic ring in the mock) */
    level: number[];
  };
  /** the user's contour warped onto the model's timeline */
  userOnRefTime: ContourPoint[];
  /** user duration / model duration (1.12 = 12 % slower) */
  tempoRatio: number;
  /** user pitch range / model pitch range (0.7 = flatter) */
  rangeRatio: number;
  notes: ProsodyNote[];
};

export type Judgement = "perfect" | "great" | "good" | "almost";
