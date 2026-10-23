/**
 * Mock data until the audio + scoring engines are wired in.
 * "I really like rice." — the model's melody, and three takes by a Japanese adult:
 *   1st: r in "rice" heard as l, intonation a little flat, a bit slow (68.352)
 *   2nd: r better but still unclear, higher "really" (74.570, +6.218)
 *   3rd: close to the model (88.300)
 *   4th: native-like (96.225, the PERFECT burst)
 * Numbers are shaped like the engines' output (src/engine/prosody, src/engine/scoring).
 */
import type { ContourPoint, LaneSyllable, PracticeItem, TakeResult, WordSpan } from "./types";
import type { Judgement } from "./types";

type Anchor = [t: number, st: number];

/** Smooth 10 ms contour through anchors, with unvoiced gaps and a little natural jitter. */
function contourFrom(anchors: Anchor[], gaps: [number, number][], seed: number): ContourPoint[] {
  const out: ContourPoint[] = [];
  const t0 = anchors[0][0];
  const t1 = anchors[anchors.length - 1][0];
  let k = 0;
  for (let i = 0; ; i++) {
    const t = Math.round((t0 + i * 0.01) * 100) / 100;
    if (t > t1 + 1e-9) break;
    while (k + 1 < anchors.length - 1 && t > anchors[k + 1][0]) k++;
    const [ta, sa] = anchors[k];
    const [tb, sb] = anchors[k + 1];
    const a = tb > ta ? (t - ta) / (tb - ta) : 0;
    const c = (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, a)))) / 2;
    const jitter = 0.16 * Math.sin(t * 53 + seed) + 0.09 * Math.sin(t * 131 + seed * 2.3);
    const unvoiced = gaps.some(([g0, g1]) => t >= g0 && t < g1);
    out.push({ t, st: unvoiced ? null : Math.round((sa + (sb - sa) * c + jitter) * 100) / 100 });
  }
  return out;
}

/** Piecewise-linear map between two sets of boundaries (syllable edges). */
function boundaryMap(from: number[], to: number[]) {
  return (t: number) => {
    if (t <= from[0]) return to[0] + (t - from[0]);
    for (let i = 0; i + 1 < from.length; i++) {
      if (t <= from[i + 1]) {
        const a = (t - from[i]) / (from[i + 1] - from[i]);
        return to[i] + a * (to[i + 1] - to[i]);
      }
    }
    return to[to.length - 1] + (t - from[from.length - 1]);
  };
}
const edges = (s: LaneSyllable[]) => [s[0].start, ...s.map((x) => x.end)];

function warp(points: ContourPoint[], user: LaneSyllable[], ref: LaneSyllable[]): ContourPoint[] {
  const u = edges(user);
  const map = boundaryMap(u, edges(ref));
  return points
    .filter((p) => p.t >= u[0] && p.t <= u[u.length - 1])
    .map((p) => ({ t: Math.round(map(p.t) * 1000) / 1000, st: p.st }));
}

/** Input level 0..1 every 10 ms, loud on vowels, quieter on consonants, near zero in silence. */
function levelFrom(duration: number, syl: LaneSyllable[], gaps: [number, number][]): number[] {
  const n = Math.round(duration * 100);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / 100;
    const s = syl.find((x) => t >= x.start && t < x.end);
    let v = 0.03 + 0.02 * Math.abs(Math.sin(i * 1.7));
    if (s) {
      const inNuc = t >= s.nucleusStart && t < s.nucleusEnd;
      const mid = (s.nucleusStart + s.nucleusEnd) / 2;
      const half = Math.max(0.02, (s.nucleusEnd - s.nucleusStart) / 2);
      const env = inNuc ? 1 - 0.35 * Math.min(1, Math.abs(t - mid) / half) : 0.42;
      v = (0.45 + 0.45 * Math.min(1, (s.prominence + 2) / 4)) * env;
      if (gaps.some(([g0, g1]) => t >= g0 && t < g1)) v *= 0.45;
      v += 0.05 * Math.sin(i * 2.1);
    }
    out.push(Math.round(Math.min(1, Math.max(0, v)) * 100) / 100);
  }
  return out;
}

// ---------------------------------------------------------------- the model voice

const refSyllables: LaneSyllable[] = [
  { word: 0, start: 0.08, end: 0.24, nucleusStart: 0.08, nucleusEnd: 0.22, pitchSt: 0.8, prominence: -1.1 },
  { word: 1, start: 0.24, end: 0.45, nucleusStart: 0.3, nucleusEnd: 0.42, pitchSt: 5.0, prominence: 1.9 },
  { word: 1, start: 0.45, end: 0.58, nucleusStart: 0.5, nucleusEnd: 0.58, pitchSt: 2.4, prominence: -1.5 },
  { word: 2, start: 0.58, end: 0.83, nucleusStart: 0.63, nucleusEnd: 0.76, pitchSt: 1.9, prominence: -0.3 },
  { word: 3, start: 0.83, end: 1.36, nucleusStart: 0.9, nucleusEnd: 1.18, pitchSt: 0.2, prominence: 2.3 },
];
const refGaps: [number, number][] = [
  [0.76, 0.83], // k of "like"
  [1.18, 1.37], // s of "rice"
];
const refAnchors: Anchor[] = [
  [0.08, 0.1], [0.16, 0.9], [0.24, 1.7], [0.34, 5.4], [0.42, 4.6], [0.5, 2.7], [0.58, 1.9],
  [0.66, 2.3], [0.76, 1.5], [0.83, 2.0], [0.93, 3.1], [1.05, 0.4], [1.18, -3.6], [1.36, -3.8],
];

const refWords: WordSpan[] = [
  { text: "I", start: 0.08, end: 0.24 },
  { text: "really", start: 0.24, end: 0.58 },
  { text: "like", start: 0.58, end: 0.83 },
  { text: "rice", start: 0.83, end: 1.36 },
];

export const demoItem: PracticeItem = {
  id: "rl-s04",
  unit: "rl",
  text: "I really like rice.",
  ja: "お米が、◆本当に好きです。",
  duration: 1.45,
  slowRate: 0.62,
  words: refWords,
  syllables: refSyllables,
  contour: contourFrom(refAnchors, refGaps, 1.3),
};

// ---------------------------------------------------------------- the user's takes

type TakeSpec = {
  attempt: number;
  scores: TakeResult["scores"];
  words: TakeResult["words"];
  /** syllables on the user's own timeline */
  syllables: LaneSyllable[];
  anchors: Anchor[];
  gaps: [number, number][];
  duration: number;
  notes: TakeResult["notes"];
  rangeRatio: number;
  live: Judgement[];
};

function buildTake(s: TakeSpec): TakeResult & { live: Judgement[] } {
  const contour = contourFrom(s.anchors, s.gaps, 2.1 + s.attempt);
  const syl = s.syllables;
  const words: WordSpan[] = refWords.map((w, i) => {
    const mine = syl.filter((x) => x.word === i);
    return { text: w.text, start: mine[0].start, end: mine[mine.length - 1].end };
  });
  const speech: [number, number] = [syl[0].start, syl[syl.length - 1].end];
  const refLen = refSyllables[refSyllables.length - 1].end - refSyllables[0].start;
  return {
    attempt: s.attempt,
    scores: s.scores,
    words: s.words,
    user: {
      duration: s.duration,
      speech,
      words,
      syllables: syl,
      contour,
      level: levelFrom(s.duration, syl, s.gaps),
    },
    userOnRefTime: warp(contour, syl, refSyllables),
    tempoRatio: Math.round(((speech[1] - speech[0]) / refLen) * 1000) / 1000,
    rangeRatio: s.rangeRatio,
    notes: s.notes,
    live: s.live,
  };
}

const take1 = buildTake({
  attempt: 1,
  scores: { overall: 68.352, sounds: 66.24, rhythm: 79.0, intonation: 61.928 },
  words: [
    { text: "I", score: 96, phones: [{ phone: "AY1", score: 96, letters: [0, 1] }] },
    {
      text: "really",
      score: 71,
      phones: [
        { phone: "R", score: 70, letters: [0, 1] },
        { phone: "IH1", score: 82, letters: [1, 3] },
        { phone: "L", score: 64, letters: [3, 5] },
        { phone: "IY0", score: 80, letters: [5, 6] },
      ],
    },
    {
      text: "like",
      score: 86,
      phones: [
        { phone: "L", score: 88, letters: [0, 1] },
        { phone: "AY1", score: 90, letters: [1, 2] },
        { phone: "K", score: 84, letters: [2, 4] },
      ],
    },
    {
      text: "rice",
      score: 41,
      phones: [
        { phone: "R", score: 18, heardAs: "L", issue: "substitution", letters: [0, 1] },
        { phone: "AY1", score: 84, letters: [1, 2] },
        { phone: "S", score: 79, letters: [2, 4] },
      ],
    },
  ],
  syllables: [
    { word: 0, start: 0.22, end: 0.42, nucleusStart: 0.22, nucleusEnd: 0.4, pitchSt: 0.3, prominence: -0.6 },
    { word: 1, start: 0.42, end: 0.64, nucleusStart: 0.48, nucleusEnd: 0.6, pitchSt: 3.0, prominence: 0.9 },
    { word: 1, start: 0.64, end: 0.86, nucleusStart: 0.7, nucleusEnd: 0.86, pitchSt: 1.7, prominence: 0.1 },
    { word: 2, start: 0.86, end: 1.12, nucleusStart: 0.91, nucleusEnd: 1.04, pitchSt: 1.1, prominence: -0.4 },
    { word: 3, start: 1.12, end: 1.68, nucleusStart: 1.2, nucleusEnd: 1.5, pitchSt: 0.0, prominence: 1.2 },
  ],
  anchors: [
    [0.22, -0.2], [0.32, 0.4], [0.42, 1.1], [0.52, 3.4], [0.6, 2.8], [0.7, 1.8], [0.82, 1.5], [0.92, 1.4],
    [1.02, 1.0], [1.12, 0.9], [1.22, 1.6], [1.34, 0.1], [1.48, -2.3], [1.68, -2.4],
  ],
  gaps: [
    [1.04, 1.12],
    [1.5, 1.7],
  ],
  duration: 2.1,
  notes: [
    { kind: "flat-intonation", word: 1, weight: 0.7 },
    { kind: "equal-timing", weight: 0.35 },
  ],
  rangeRatio: 0.67,
  live: ["great", "good", "great", "great", "good"],
});

const take2 = buildTake({
  attempt: 2,
  scores: { overall: 74.57, sounds: 71.0, rhythm: 82.4, intonation: 73.88 },
  words: [
    { text: "I", score: 95, phones: [{ phone: "AY1", score: 95, letters: [0, 1] }] },
    {
      text: "really",
      score: 78,
      phones: [
        { phone: "R", score: 76, letters: [0, 1] },
        { phone: "IH1", score: 84, letters: [1, 3] },
        { phone: "L", score: 72, letters: [3, 5] },
        { phone: "IY0", score: 82, letters: [5, 6] },
      ],
    },
    {
      text: "like",
      score: 88,
      phones: [
        { phone: "L", score: 89, letters: [0, 1] },
        { phone: "AY1", score: 91, letters: [1, 2] },
        { phone: "K", score: 85, letters: [2, 4] },
      ],
    },
    {
      text: "rice",
      score: 58,
      phones: [
        { phone: "R", score: 49, issue: "distortion", letters: [0, 1] },
        { phone: "AY1", score: 86, letters: [1, 2] },
        { phone: "S", score: 82, letters: [2, 4] },
      ],
    },
  ],
  syllables: [
    { word: 0, start: 0.2, end: 0.38, nucleusStart: 0.2, nucleusEnd: 0.36, pitchSt: 0.5, prominence: -0.8 },
    { word: 1, start: 0.38, end: 0.6, nucleusStart: 0.44, nucleusEnd: 0.57, pitchSt: 4.1, prominence: 1.5 },
    { word: 1, start: 0.6, end: 0.77, nucleusStart: 0.65, nucleusEnd: 0.77, pitchSt: 2.0, prominence: -0.6 },
    { word: 2, start: 0.77, end: 1.03, nucleusStart: 0.82, nucleusEnd: 0.95, pitchSt: 1.6, prominence: -0.3 },
    { word: 3, start: 1.03, end: 1.58, nucleusStart: 1.1, nucleusEnd: 1.4, pitchSt: 0.1, prominence: 1.9 },
  ],
  anchors: [
    [0.2, 0.0], [0.29, 0.7], [0.38, 1.4], [0.49, 4.5], [0.57, 3.9], [0.66, 2.3], [0.77, 1.8], [0.85, 2.0],
    [0.95, 1.3], [1.03, 1.6], [1.13, 2.5], [1.25, 0.2], [1.4, -3.0], [1.58, -3.1],
  ],
  gaps: [
    [0.95, 1.03],
    [1.4, 1.6],
  ],
  duration: 2.0,
  notes: [{ kind: "contour-mismatch", word: 3, weight: 0.45 }],
  rangeRatio: 0.84,
  live: ["great", "great", "great", "perfect", "good"],
});

const take3 = buildTake({
  attempt: 3,
  scores: { overall: 88.3, sounds: 88.5, rhythm: 90.2, intonation: 86.0 },
  words: [
    { text: "I", score: 97, phones: [{ phone: "AY1", score: 97, letters: [0, 1] }] },
    {
      text: "really",
      score: 90,
      phones: [
        { phone: "R", score: 88, letters: [0, 1] },
        { phone: "IH1", score: 92, letters: [1, 3] },
        { phone: "L", score: 86, letters: [3, 5] },
        { phone: "IY0", score: 91, letters: [5, 6] },
      ],
    },
    {
      text: "like",
      score: 91,
      phones: [
        { phone: "L", score: 92, letters: [0, 1] },
        { phone: "AY1", score: 93, letters: [1, 2] },
        { phone: "K", score: 88, letters: [2, 4] },
      ],
    },
    {
      text: "rice",
      score: 84,
      phones: [
        { phone: "R", score: 80, letters: [0, 1] },
        { phone: "AY1", score: 88, letters: [1, 2] },
        { phone: "S", score: 85, letters: [2, 4] },
      ],
    },
  ],
  syllables: [
    { word: 0, start: 0.18, end: 0.35, nucleusStart: 0.18, nucleusEnd: 0.33, pitchSt: 0.7, prominence: -1.0 },
    { word: 1, start: 0.35, end: 0.57, nucleusStart: 0.41, nucleusEnd: 0.54, pitchSt: 4.8, prominence: 1.8 },
    { word: 1, start: 0.57, end: 0.71, nucleusStart: 0.62, nucleusEnd: 0.71, pitchSt: 2.3, prominence: -1.3 },
    { word: 2, start: 0.71, end: 0.97, nucleusStart: 0.76, nucleusEnd: 0.89, pitchSt: 1.8, prominence: -0.3 },
    { word: 3, start: 0.97, end: 1.5, nucleusStart: 1.04, nucleusEnd: 1.32, pitchSt: 0.2, prominence: 2.2 },
  ],
  anchors: [
    [0.18, 0.1], [0.26, 0.9], [0.35, 1.6], [0.46, 5.1], [0.54, 4.4], [0.63, 2.6], [0.71, 1.9], [0.79, 2.2],
    [0.89, 1.5], [0.97, 2.0], [1.07, 3.0], [1.19, 0.3], [1.32, -3.4], [1.5, -3.5],
  ],
  gaps: [
    [0.89, 0.97],
    [1.32, 1.52],
  ],
  duration: 1.9,
  notes: [],
  rangeRatio: 0.96,
  live: ["perfect", "great", "perfect", "perfect", "great"],
});

// 4th: what a native-like take looks like (≥ 95 shows the PERFECT burst)
const take4 = buildTake({
  attempt: 4,
  scores: { overall: 96.225, sounds: 96.8, rhythm: 95.2, intonation: 96.1 },
  words: [
    { text: "I", score: 98, phones: [{ phone: "AY1", score: 98, letters: [0, 1] }] },
    {
      text: "really",
      score: 96,
      phones: [
        { phone: "R", score: 95, letters: [0, 1] },
        { phone: "IH1", score: 97, letters: [1, 3] },
        { phone: "L", score: 95, letters: [3, 5] },
        { phone: "IY0", score: 96, letters: [5, 6] },
      ],
    },
    {
      text: "like",
      score: 97,
      phones: [
        { phone: "L", score: 97, letters: [0, 1] },
        { phone: "AY1", score: 98, letters: [1, 2] },
        { phone: "K", score: 95, letters: [2, 4] },
      ],
    },
    {
      text: "rice",
      score: 94,
      phones: [
        { phone: "R", score: 93, letters: [0, 1] },
        { phone: "AY1", score: 96, letters: [1, 2] },
        { phone: "S", score: 94, letters: [2, 4] },
      ],
    },
  ],
  syllables: refSyllables.map((x) => ({
    ...x,
    start: x.start + 0.1,
    end: x.end + 0.1,
    nucleusStart: x.nucleusStart + 0.1,
    nucleusEnd: x.nucleusEnd + 0.1,
  })),
  anchors: refAnchors.map(([t, st], i) => [t + 0.1, st + (i % 2 ? 0.25 : -0.2)] as Anchor),
  gaps: refGaps.map(([a, b]) => [a + 0.1, b + 0.1] as [number, number]),
  duration: 1.8,
  notes: [],
  rangeRatio: 1.0,
  live: ["perfect", "perfect", "perfect", "perfect", "perfect"],
});

export const demoTakes = [take1, take2, take3, take4];
export type DemoTake = (typeof demoTakes)[number];

/** Where this line sits in its lesson. */
export const demoProgress = { index: 3, total: 8, lesson: "舌先を付けない r", combo: 2 };

// ---------------------------------------------------------------- placement result (/check/result)

export type GrowthPoint = {
  rank: number;
  unit: "rl" | "rhythm" | "th";
  title: string;
  /** what we heard, from their own test */
  evidence: string;
  /** the word to replay in both voices */
  word?: string;
  /** average points this would add per line */
  gain: number;
  /** rhythm evidence: syllable lengths (model vs you), seconds */
  beats?: { model: number[]; you: number[]; stress: boolean[] };
};

export const placement = {
  sentences: 8,
  top: [
    {
      rank: 1,
      unit: "rl",
      title: "R と L",
      evidence: "right が light に聞こえました。",
      word: "right",
      gain: 9.8,
    },
    {
      rank: 2,
      unit: "rhythm",
      title: "英語のリズム",
      evidence: "強い音と弱い音の長さが、◆ほぼ同じでした。",
      gain: 7.4,
      beats: {
        model: [0.12, 0.26, 0.08, 0.2, 0.09, 0.3],
        you: [0.17, 0.19, 0.16, 0.18, 0.17, 0.21],
        stress: [false, true, false, true, false, true],
      },
    },
    {
      rank: 3,
      unit: "th",
      title: "th の音",
      evidence: "think が sink に聞こえました。",
      word: "think",
      gain: 5.1,
    },
  ] satisfies GrowthPoint[],
  skipped: ["v と b", "f と h", "文末の上げ下げ"],
  route: { units: 3, minutesPerDay: 10, days: 14 },
};

// ---------------------------------------------------------------- home (/home)

export type RouteUnit = {
  unit: "rl" | "rhythm" | "th";
  title: string;
  state: "done" | "now" | "next";
  lessons: { title: string; stars: 0 | 1 | 2 | 3; now?: boolean }[];
};

export const home = {
  streakDays: 3,
  /** this week, Mon → Sun */
  week: [true, true, true, false, false, false, false],
  todayIndex: 3,
  nativeness: [58.1, 60.3, 61.0, 63.7, 64.2, 66.4],
  route: [
    {
      unit: "rhythm",
      title: "英語のリズム",
      state: "done",
      lessons: [
        { title: "強いところはひとつ", stars: 3 },
        { title: "弱い母音", stars: 2 },
        { title: "強い単語と弱い単語", stars: 2 },
      ],
    },
    {
      unit: "rl",
      title: "R と L",
      state: "now",
      lessons: [
        { title: "舌先を付けない r", stars: 1, now: true },
        { title: "舌先を付ける l", stars: 0 },
        { title: "r と l を続けて", stars: 0 },
      ],
    },
    {
      unit: "th",
      title: "th の音",
      state: "next",
      lessons: [
        { title: "息だけの th", stars: 0 },
        { title: "声を出す th", stars: 0 },
      ],
    },
  ] satisfies RouteUnit[],
  skipped: ["v と b", "f と h"],
};

// ---------------------------------------------------------------- lesson (/learn/demo)

export const lesson = {
  unit: "rl" as const,
  title: "R と L",
  lead: "舌先が、◆付くか付かないか。",
  points: {
    r: ["舌先は、◆どこにも付けません。", "唇を少し丸めて、◆「ゥ」から入ります。"] as [string, string],
    l: ["舌先を、◆上の歯の裏に付けます。", "付けたまま、◆声を出します。"] as [string, string],
  },
  ear: {
    target: "rice",
    other: "lice",
    /** which tile plays the target, per question */
    answers: ["B", "A", "A", "B"] as ("A" | "B")[],
    voices: ["女性", "男性", "女性・速め", "男性・ゆっくり"],
  },
};
