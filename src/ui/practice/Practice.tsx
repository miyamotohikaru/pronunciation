"use client";

/**
 * The practice screen, wired to the real engines.
 *
 *   ready ─ mic tap ─► starting ─ first audio ─► count-in 3·2·1 ─► singing (guide runs at the chosen
 *   speed, the wave fills live from KaraokeJudge) ─ guide end + 0.8 s / tap ─► scoring (scorer worker
 *   + compareProsody) ─► result ⇄ sound card
 *
 * Per-frame work lives in requestAnimationFrame loops that read refs (guide canvas, lyric wipe,
 * mic ring, count-in clock). React state changes only on events: phase, count-in digit, result.
 */
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import BreakText from "@/components/BreakText";
import type { ItemData } from "@/data/schema";
import type { MicRecorder, Take } from "@/engine/audio";
import { KaraokeJudge, type BarGrade, type JudgeSummary } from "@/engine/karaoke/judge.ts";
import { compareProsody } from "@/engine/prosody/compare.ts";
import type { ProsodyResult } from "@/engine/prosody/types.ts";
import type { ScoreResult } from "@/engine/scoring/types.ts";
import { Guide, freshLive, offStretches, type GuideLive } from "../guide";
import { wordGrade } from "../guide/grades";
import { lineIpa } from "../ipa";
import Telop from "../Telop";
import TopBar from "../TopBar";
import MicButton from "../MicButton";
import RoundButton from "../RoundButton";
import ScoreHead, { PartsRow, shownTotal } from "../result/ScoreHead";
import ResultSentence from "../result/ResultSentence";
import DirectionSlider from "../result/DirectionSlider";
import type { RetryState } from "../SoundSheet";
import SoundCoach, { type CoachClips } from "../SoundCoach";
import type { Clip } from "./crossfade";
/** what a word-level play button is playing: お手本, your take, or what it was heard as */
type Voice = "model" | "you" | "heard";
import TelopText from "../TelopText";
import { IconMic, IconNext, IconPlay, IconRetry, IconSpeaker } from "../icons";
import { RETRY_FIRST_BELOW, mark, rangePosition, step7, tempoPosition, total, verdict } from "../score";
import { chartTipJa, heardShort, heardWord } from "../copy";
import { buzz, setMuted, sfx } from "../sfx";
import type { PhoneScore, ProsodyNote, Scores, WordScore } from "../types";
import { SPEEDS, VOICES, fetchItem, guideFor, keepItems, speedsFor, type GuideTake, type Speed, type VoiceId } from "./content";
import { getPlayer, keepBuffers, loadBuffer, newRecorder, newWordRecorder, onScoringStatus, playableTake, scoringStatus, startScoring, warmRecorder } from "./audio";
import { alignLetters } from "./letters";
import { DEFAULT_SETTINGS, bestOf, hintSeen, loadSettings, markHintSeen, saveBest, saveSettings, type Settings } from "./progress";
import type { FieldClass } from "./fields";

const COUNT_IN = 1.65; // 3 beats
const TAIL = 0.8; // keep recording after the guide ends
const LATE_MAX = 2.6; // …and up to this long while you are still speaking

type Phase = "loading" | "ready" | "starting" | "countin" | "singing" | "scoring" | "result" | "silent" | "error";

export type PracticeResult = {
  attempt: number;
  scores: Scores;
  words: WordScore[];
  counts: Record<BarGrade, number>;
  tempoRatio: number;
  rangeRatio: number;
  notes: ProsodyNote[];
  userOnRef: { t: number; st: number | null }[] | null;
  /** take time → guide time (replay, "あなた" cursor) */
  toGuide: (t: number) => number;
  /** your words in take time (segment playback) */
  spans: { start: number; end: number }[];
  bestBefore: number | null;
  /** total of the previous attempt on this line (this visit); null on the first */
  previous: number | null;
  /** guide-time stretches where your line left the band (≥ 150 ms) */
  off: { start: number; end: number }[];
  /** the word coached on the result (the worst flagged sound), fixed for this take; -1 = none */
  coach: number;
  /** the words with a wrong sound when the take was scored, in line order (the coach moves between them) */
  mistakes: number[];
};

/**
 * One line to practise. Reusable: a lesson passes an id; another flow (a dialogue) can pass the
 * item itself, fix the speed and voice, mark a partner's line (listen only), and embed it
 * without its own top bar.
 */
export type PracticeProps = {
  itemId: string;
  /** the item itself, when the caller already has it (nothing is fetched) */
  item?: ItemData;
  nextItemId?: string | null;
  field: FieldClass;
  index?: number;
  total?: number;
  combo?: number;
  backHref?: string;
  /** fix the speed / the voice for this line (their chips are then hidden; nothing is saved) */
  speed?: Speed;
  voice?: VoiceId;
  /** a dialogue line: "you" practise it (the default); "partner" only listen — no mic, no score */
  role?: "you" | "partner";
  /** inside another flow: no top bar of its own */
  embedded?: boolean;
  /** shown above the caption (a dialogue keeps the partner's line there during your turn) */
  context?: ReactNode;
  onResult?: (itemId: string, score: number) => void;
  /** a partner's line has been heard to the end */
  onListened?: () => void;
  onNext: () => void;
  /** minimal pairs from the catalog: word → the pair item that has both words recorded */
  pairs?: Record<string, { id: string; other: string; side: "main" | "pair" }>;
};

declare global {
  interface Window {
    /** test hook (tools/e2e/practice.e2e.mjs) */
    __practice?: { phase: Phase; debug?: unknown; rec?: () => unknown; result: { total: number; sounds: number; rhythm: number; intonation: number; counts: Record<BarGrade, number>; flagged: string[]; words: [string, number][]; coach: number } | null; scoring: ReturnType<typeof scoringStatus> };
  }
}

export default function Practice({ itemId, item: itemProp, nextItemId, field, index = 0, total: totalItems = 1, combo = 0, backHref = "/home", speed: speedProp, voice: voiceProp, role = "you", embedded, context, onResult, onListened, onNext, pairs }: PracticeProps) {
  const [item, setItem] = useState<ItemData | null>(itemProp ?? null);
  const [stored, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // what this line uses: the saved settings, unless the caller fixes the speed or the voice
  const settings = useMemo<Settings>(() => ({ ...stored, ...(speedProp ? { speed: speedProp } : {}), ...(voiceProp ? { voice: voiceProp } : {}) }), [stored, speedProp, voiceProp]);
  const partner = role === "partner";
  const [phase, setPhase] = useState<Phase>("loading");
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState<null | "model" | "replay" | "seg">(null);
  const [segVoice, setSegVoice] = useState<Voice | null>(null);
  const [result, setResult] = useState<PracticeResult | null>(null);
  // the word the result's card is on (null = the worst one); a pair recording arriving re-renders it
  const [coachSel, setCoachSel] = useState<number | null>(null);
  const [, setPairVersion] = useState(0);
  const [revealKey, setRevealKey] = useState(0);
  const [skip, setSkip] = useState(false);
  const [revealDone, setRevealDone] = useState(false);
  const [stage, setStage] = useState(0);
  // 「くわしく」 mounts its chart only when opened
  const [details, setDetails] = useState(false);
  const [scorer, setScorer] = useState(scoringStatus());
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [bufferReady, setBufferReady] = useState(false);

  const live = useRef<GuideLive>(freshLive());
  const level = useRef(0);
  // 0..1 until the take stops by itself (the ring around the stop button)
  const stopAt = useRef(0);
  // the caption's gold: per word, how far your voice has been inside the band (0..1, left to right)
  const hits = useRef<number[]>([]);
  // the bottom bar's 「だけ言う」: its mic ring follows your level while the word is recorded
  const barRing = useRef<HTMLSpanElement>(null);
  // the first take on this device gets one hint in the lane
  const [hint, setHint] = useState(false);
  const reveal = useRef(1);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const takeRef = useRef<Take | null>(null);
  const recRef = useRef<MicRecorder | null>(null);
  const raf = useRef(0);
  const alive = useRef(true);
  const lastTotal = useRef<number | null>(null);
  // word retries inside the sound card
  const [retry, setRetry] = useState<RetryState>({ state: "idle" });
  const [sheetBefore, setSheetBefore] = useState<number | null>(null);
  const heardEnd = useRef<Record<number, string | null>>({});
  const wordTakes = useRef<Record<number, { take: Take; start: number; end: number }>>({});
  // the scrubber's two ends from the catalog's minimal pair (rice / lice), per word; null = loading or none
  const pairClips = useRef<Record<number, { model: Clip; other: Clip } | null>>({});
  const debugRef = useRef<unknown>(null);

  const guide: GuideTake | null = useMemo(() => (item ? guideFor(item, settings.voice, settings.speed) : null), [item, settings.voice, settings.speed]);
  const speeds = useMemo(() => (item ? speedsFor(item, settings.voice) : (["native"] as Speed[])), [item, settings.voice]);
  const clock = useMemo(
    () => ({
      get current() {
        const l = live.current;
        return l.follow ? l.t : null;
      },
    }),
    [],
  );

  // ---------------------------------------------------------------- load: this item (+ the next, idle)
  useEffect(() => {
    alive.current = true;
    setSettings(loadSettings());
    warmRecorder();
    const off = onScoringStatus(() => setScorer(scoringStatus()));
    return () => {
      alive.current = false;
      off();
      cancelAnimationFrame(raf.current);
      recRef.current?.cancel();
      getPlayer().stop();
      takeRef.current = null;
    };
  }, []);

  useEffect(() => {
    let ok = true;
    if (itemProp) {
      setItem(itemProp);
      return;
    }
    setItem(null);
    setPhase("loading");
    keepItems([itemId, ...(nextItemId ? [nextItemId] : [])]);
    fetchItem(itemId)
      .then((it) => ok && setItem(it))
      .catch((e: unknown) => {
        if (!ok) return;
        setError(String((e as Error)?.message ?? e));
        setPhase("error");
      });
    return () => {
      ok = false;
    };
  }, [itemId, nextItemId, itemProp]);

  useEffect(() => {
    if (!guide) return;
    let ok = true;
    setBufferReady(false);
    loadBuffer(guide.audio)
      .then((b) => {
        if (!ok) return;
        bufferRef.current = b;
        setBufferReady(true);
        setPhase((p) => (p === "loading" ? "ready" : p));
        // only now: the next item's JSON and the same voice/speed audio, when the page is idle
        const prefetch = () => {
          if (!nextItemId) return keepBuffers([guide.audio]);
          fetchItem(nextItemId)
            .then((next) => {
              const g = guideFor(next, settings.voice, settings.speed);
              keepBuffers([guide.audio, g.audio]);
              return loadBuffer(g.audio);
            })
            .catch(() => undefined);
        };
        const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
        if (ric) ric(prefetch, { timeout: 2500 });
        else setTimeout(prefetch, 1200);
      })
      .catch((e: unknown) => {
        if (!ok) return;
        setError(String((e as Error)?.message ?? e));
        setPhase("error");
      });
    return () => {
      ok = false;
    };
  }, [guide, nextItemId, settings.voice, settings.speed]);

  useEffect(() => setMuted(muted), [muted]);

  const changeSettings = (s: Partial<Settings>) => {
    getPlayer().stop();
    setSettings((prev) => {
      const next = { ...prev, ...s };
      saveSettings(next);
      return next;
    });
  };

  // ---------------------------------------------------------------- お手本
  const stopPlayback = useCallback(() => {
    getPlayer().stop();
    setPlaying(null);
    setSegVoice(null);
  }, []);

  const playModel = () => {
    const buf = bufferRef.current;
    if (!buf) return;
    if (playing === "model") return stopPlayback();
    const player = getPlayer();
    player.events = {
      onPlayhead: (e) => {
        const l = live.current;
        l.t = e.t;
        l.follow = phase !== "result";
        l.tone = "guide";
      },
      onEnd: (completed) => {
        const l = live.current;
        l.t = null;
        l.follow = false;
        l.version++;
        if (!alive.current) return;
        setPlaying(null);
        if (partner && completed) onListened?.(); // a partner's line: heard to the end
      },
    };
    void player.play(buf); // synchronous unlock inside the tap
    setPlaying("model");
  };

  // ---------------------------------------------------------------- the take
  const onMic = () => {
    if (phase === "starting" || phase === "countin" || phase === "singing") {
      recRef.current?.stop();
      return;
    }
    const g = guide;
    if (!g || !bufferRef.current) return;
    const player = getPlayer();
    player.stop();
    player.events = {}; // "お手本と一緒に" must not move the guide cursor

    // the judge gets the same wave the lane draws: every point of your line then says inBand
    const judge = new KaraokeJudge(g.syllables, { wave: g.wave });
    const l = live.current;
    l.line = judge.line;
    l.bars = judge.bars;
    l.t = -COUNT_IN;
    l.follow = true;
    l.tone = "guide";
    l.version++;
    level.current = 0;
    takeRef.current = null; // the previous take can go
    wordTakes.current = {};
    heardEnd.current = {};
    pairClips.current = {};

    let anchor: { rec: number; perf: number } | null = null;
    let stopping = false;
    let loudAt = 0; // last time the input was clearly above the noise floor (performance.now)
    const buzzedWords = g.words.map(() => false); // words already given their haptic tick
    hits.current = g.words.map(() => 0);
    let lineAt = 0; // judge.line points already turned into gold
    let digit = 4;
    let startedModel = false;
    const together = settings.together;
    const buf = bufferRef.current;

    const tick = () => {
      if (!anchor) return;
      const gt = (performance.now() - anchor.perf) / 1000 - COUNT_IN;
      l.t = gt;
      const d = gt < 0 ? Math.min(3, Math.ceil(-gt / (COUNT_IN / 3))) : 0;
      if (d !== digit) {
        digit = d;
        startTransition(() => {
          setCount(d);
          if (d === 0) setPhase("singing");
        });
      }
      if (together && !startedModel && gt >= -0.03) {
        startedModel = true;
        void getPlayer().play(buf); // allowed without a gesture while capturing
      }
      judge.advance(gt);
      // real karaoke: while your line is inside the band, the word at that moment paints gold from the left
      const line = judge.line;
      for (; lineAt < line.length; lineAt++) {
        const q = line[lineAt];
        if (!q.inBand) continue;
        for (let w = 0; w < g.words.length; w++) {
          const W = g.words[w];
          if (q.t < W.start - 0.04 || q.t > W.end + 0.04) continue;
          const at = Math.min(1, (q.t + 0.06 - W.start) / Math.max(0.05, W.end - W.start));
          if (at > hits.current[w]) hits.current[w] = at;
          break;
        }
      }
      // one light tick per judged word (the lane pops its judgement right above it)
      for (let w = 0; w < buzzedWords.length; w++) {
        if (buzzedWords[w]) continue;
        const wg = wordGrade(judge.bars, g.syllables, w);
        if (!wg) continue;
        buzzedWords[w] = true;
        if (wg.grade === "perfect" || wg.grade === "great") hits.current[w] = 1; // a won word ends fully gold
        if (wg.grade === "perfect" || wg.grade === "great") buzz(10);
        else if (wg.grade === "good") buzz(5);
      }
      stopAt.current = Math.min(1, Math.max(0, (gt + COUNT_IN) / (COUNT_IN + g.duration + TAIL)));
      // stop after the guide; if you are still talking (a little behind the cursor), wait for you
      const speaking = performance.now() - loudAt < 350;
      if (!stopping && gt >= g.duration + TAIL && (!speaking || gt >= g.duration + LATE_MAX)) {
        stopping = true;
        rec.stop();
      }
      raf.current = requestAnimationFrame(tick);
    };

    const rec = newRecorder(COUNT_IN + g.duration + LATE_MAX + 1.5, {
      onLevel: (e) => {
        level.current = Math.min(1, Math.max(0, (e.db + 60) / 45));
        if (e.db > e.floorDb + 9) loudAt = performance.now();
        if (!anchor) {
          clearTimeout(watchdog);
          anchor = { rec: e.t, perf: performance.now() };
          startTransition(() => setPhase("countin"));
          raf.current = requestAnimationFrame(tick);
        }
      },
      onPitch: (f) => {
        if (!anchor) return;
        const gt = f.t - anchor.rec - COUNT_IN;
        if (gt < -0.25) return;
        judge.push({ t: gt, f0: f.f0, rms: f.rms });
      },
    });
    recRef.current = rec;
    const pending = rec.record(); // must stay synchronous in the tap handler (iOS)
    const guideStartRec = () => (anchor ? anchor.rec + COUNT_IN : 0);
    // no sound at all from the mic within 5 s: say so instead of waiting forever
    const watchdog = setTimeout(() => {
      if (anchor || !alive.current) return;
      rec.cancel();
      setError("マイクの音が届いていません。◇もう一度、◆押してください。");
      setPhase("error");
    }, 5000);
    const n = attempt + 1;
    // everything else leaves the tap's task: the scorer starts in the background, the screen
    // updates as a transition (React slices it), the tap sound and buzz follow
    setTimeout(() => {
      startScoring();
      sfx("tap");
      buzz(8);
    }, 0);
    const showHint = !hintSeen();
    startTransition(() => {
      setPlaying(null);
      setPhase("starting");
      setAttempt(n);
      setHint(showHint);
    });
    pending
      .then((take) => {
        clearTimeout(watchdog);
        return finishTake(trimCountIn(take, guideStartRec()), judge, g, n);
      })
      .catch((e: unknown) => {
        clearTimeout(watchdog);
        cancelAnimationFrame(raf.current);
        l.follow = false;
        l.t = null;
        l.version++;
        if (!alive.current) return;
        const name = (e as DOMException)?.name;
        if (name === "AbortError") return setPhase((p) => (p === "error" ? p : "ready"));
        setError(name === "NotAllowedError" ? "マイクが使えません。◇ブラウザの設定で、◆マイクを許可してください。" : String((e as Error)?.message ?? e));
        setPhase("error");
      });
  };

  const finishTake = async (take: Take, judge: KaraokeJudge, g: GuideTake, n: number) => {
    cancelAnimationFrame(raf.current);
    markHintSeen();
    getPlayer().stop();
    const summary = judge.finish();
    const l = live.current;
    l.follow = false;
    l.t = null;
    l.version++;
    level.current = 0;
    if (!alive.current) return;
    if (!take.speech) {
      setPhase("silent");
      return;
    }
    takeRef.current = take;
    setPhase("scoring");
    try {
      const it = item!;
      const scored = await startScoring().score(take.pcm16k, it.words, { ...it.scoring, alignTo: g.phones });
      if (!alive.current) return;
      const r = buildResult(it, g, take, scored, summary, n);
      reveal.current = 0;
      // render the result as a transition: React slices the work, so no long task when it appears;
      // the lower half follows in a second transition once the score is counting
      startTransition(() => {
        setSkip(false);
        setRevealDone(false);
        setStage(0);
        setDetails(false);
        setCoachSel(null);
        setResult(r);
        setRevealKey((k) => k + 1);
        setPhase("result");
      });
      // the rest follows in small steps while the score counts (each step's layout stays short):
      // the line, then the coach
      setTimeout(() => startTransition(() => setStage(1)), 120);
      setTimeout(() => startTransition(() => setStage(2)), 420);
    } catch (e) {
      if (!alive.current) return;
      setError(String((e as Error)?.message ?? e));
      setPhase("error");
    }
  };

  const buildResult = (it: ItemData, g: GuideTake, take: Take, scored: ScoreResult, summary: JudgeSummary, n: number): PracticeResult => {
    let prosody: ProsodyResult | null = null;
    if (scored.alignedTo && take.speech) {
      try {
        prosody = compareProsody(
          { phones: g.phones, pitch: g.pitch, speech: g.speech },
          { phones: scored.alignedTo, pitch: take.pitch, speech: [take.speech.start, take.speech.end] },
          it.words.map((w) => w.text.toLowerCase()),
        );
      } catch {
        prosody = null;
      }
    }
    const hit = 100 * summary.hitRate;
    debugRef.current = {
      speech: take.speech,
      duration: take.duration,
      aligned: scored.alignedTo?.map((a) => [a.phone, +a.start.toFixed(2), +a.end.toFixed(2)]),
      detail: prosody?.detail,
      pitchVoiced: take.pitch.filter((f) => f.f0 !== null).length,
      pitchN: take.pitch.length,
    };
    const scores: Scores = {
      overall: 0,
      sounds: clamp100(scored.sounds),
      rhythm: clamp100(prosody ? prosody.rhythm : hit),
      intonation: clamp100(prosody ? prosody.intonation : hit),
    };
    scores.overall = total(scores);
    const words: WordScore[] = scored.words.map((w, i) => toWordScore(it.words[i]?.text ?? w.text, scored, i));
    // take time → guide time, through the forced alignment to the model's phones
    const knots: [number, number][] = [];
    if (scored.alignedTo && scored.alignedTo.length === g.phones.length)
      scored.alignedTo.forEach((a, i) => knots.push([a.start, g.phones[i].start], [a.end, g.phones[i].end]));
    else if (take.speech) knots.push([take.speech.start, g.speech[0]], [take.speech.end, g.speech[1]]);
    const k2 = knots.sort((a, b) => a[0] - b[0]).filter((p, i, a) => i === 0 || (p[0] > a[i - 1][0] && p[1] >= a[i - 1][1]));
    const toGuide = (t: number) => {
      if (k2.length < 2) return t;
      if (t <= k2[0][0]) return k2[0][1] + (t - k2[0][0]);
      for (let i = 0; i + 1 < k2.length; i++) if (t <= k2[i + 1][0]) return k2[i][1] + ((t - k2[i][0]) / (k2[i + 1][0] - k2[i][0])) * (k2[i + 1][1] - k2[i][1]);
      const e = k2[k2.length - 1];
      return e[1] + (t - e[0]);
    };
    const span = (ph: { start: number; end: number }[]) => (ph.length ? ph[ph.length - 1].end - ph[0].start : 1);
    const tempoRatio = scored.alignedTo?.length ? span(scored.alignedTo) / Math.max(0.05, span(g.phones)) : 1;
    let rangeRatio = 1;
    if (prosody) {
      const range = (xs: (number | null)[]) => {
        const v = xs.filter((x): x is number => x !== null);
        return v.length >= 2 ? Math.max(...v) - Math.min(...v) : 0;
      };
      const ru = range(prosody.user.map((s) => s.pitchSt));
      const rr = range(prosody.ref.map((s) => s.pitchSt));
      rangeRatio = rr >= 1 ? Math.max(0.2, ru) / rr : 1;
    }
    const prev = bestOf(it.id);
    return {
      attempt: n,
      scores,
      words,
      counts: summary.counts,
      tempoRatio,
      rangeRatio,
      notes: prosody ? prosody.issues.map((x) => ({ kind: x.kind, word: x.word, weight: x.weight })) : [],
      userOnRef: prosody ? prosody.userOnRefTime : null,
      toGuide,
      spans: scored.words.map((w) => ({ start: w.start, end: w.end })),
      bestBefore: prev ? prev.score : null,
      previous: lastTotal.current,
      off: prosody ? offStretches(prosody.userOnRefTime, g.wave, 2.5) : [],
      coach: worstFlagged(words),
      mistakes: words.map((w, i) => (w.phones.some((ph) => mark(ph) === "miss") ? i : -1)).filter((i) => i >= 0),
    };
  };

  const onRevealDone = () => {
    if (!result) return;
    reveal.current = 1;
    setRevealDone(true);
    const s = result.scores.overall;
    lastTotal.current = s;
    saveBest(itemId, s);
    onResult?.(itemId, s);
    sfx(result.bestBefore !== null && s > result.bestBefore ? "best" : "score");
    buzz(12);
  };

  // ---------------------------------------------------------------- replay / compare
  const replayMine = () => {
    const take = takeRef.current;
    if (!take || !result) return;
    if (playing === "replay") return stopPlayback();
    const player = getPlayer();
    player.events = {
      onPlayhead: (e) => {
        const l = live.current;
        l.t = result.toGuide(e.t);
        l.follow = false;
        l.tone = "voice";
      },
      onEnd: () => {
        const l = live.current;
        l.t = null;
        l.version++;
        if (alive.current) setPlaying(null);
      },
    };
    void player.play(playableTake(take));
    setPlaying("replay");
  };

  const segItems = (word: number) => {
    const g = guide!;
    const w = g.words[word];
    const mine = result!.spans[word];
    const again = wordTakes.current[word];
    return {
      model: { source: bufferRef.current!, t0: Math.max(0, w.start - 0.04), t1: w.end + 0.06, label: "model" },
      you: again
        ? { source: playableTake(again.take), t0: Math.max(0, again.start - 0.05), t1: again.end + 0.05, label: "you" }
        : { source: playableTake(takeRef.current!), t0: Math.max(0, mine.start), t1: mine.end, label: "you" },
    };
  };
  const playSeq = (seq: ("model" | "you")[], word: number) => {
    if (!result || !takeRef.current || !bufferRef.current) return;
    const player = getPlayer();
    const it = segItems(word);
    player.events = {
      onPlayhead: (e) => {
        const l = live.current;
        l.follow = false;
        if (e.label === "you") {
          l.t = wordTakes.current[word] ? null : result.toGuide(e.t);
          l.tone = "voice";
        } else {
          l.t = e.t;
          l.tone = "guide";
        }
        const v = (e.label as Voice) ?? null;
        setSegVoice((cur) => (cur === v ? cur : v)); // only on change
      },
      onEnd: () => {
        const l = live.current;
        l.t = null;
        l.version++;
        if (!alive.current) return;
        setSegVoice(null);
        setPlaying(null);
      },
    };
    void player.playSequence(seq.map((s) => it[s]), { gap: 0.35 });
    setPlaying("seg");
  };

  /**
   * The scrubber's two ends. With a minimal pair in the catalog whose other word is what the AI
   * heard (rice → "lice"), both come from that pair's recordings (same voice, same speed); else
   * お手本's word ↔ your own take of it. Clips are made only when pressed (no work on render).
   */
  /**
   * The sound card's two words: お手本's word and the word it was heard as. In order of preference:
   *  1. the listen-only word clips (/audio/<voice>/w-<word>[.slow|.slower].mp3): the target word and
   *     the heard word (spelled from what the AI heard; else the item's `pair`, else the focus's
   *     watchFor) — isolated words, the same voice and speed, so they blend cleanly;
   *  2. both words inside this very line ("Turn right at the light.");
   *  3. the catalog's old pair item (content v1).
   */
  const loadPair = (i: number) => {
    if (!item || !result || i < 0 || i in pairClips.current) return;
    const w = result.words[i];
    const g = guide;
    const b0 = bufferRef.current;
    const spoken = (x: string) => x.toLowerCase().replace(/[^a-z']/g, "");
    const target = spoken(item.words[i]?.text ?? w.text);
    // the heard word: spelled from the AI's heard sound, else the line's pair word, else the focus's watchFor
    const worst = [...w.phones].filter((ph) => mark(ph) === "miss").sort((a, b) => a.score - b.score)[0];
    const fromFocus = (() => {
      const f = item.focus.find((x) => !x.inPair && x.word === i && x.watchFor.length && x.watchFor[0] !== "EPEN");
      if (!f) return null;
      const ph = w.phones.find((x) => x.phone.replace(/\d/g, "") === f.phone);
      return ph ? heardWord(w, { ...ph, heardAs: f.watchFor[0] }) : null;
    })();
    const pairWord = item.pair && spoken(item.pair) !== target ? spoken(item.pair) : null;
    const end = [(heardEnd.current[i] ?? heardEndFor(w)) ?? null, worst?.heardAs ? null : pairWord, fromFocus]
      .map((x) => (x ? spoken(x) : ""))
      .find((x) => /^[a-z']{2,}$/.test(x) && x !== target);
    if (!end || !g) return;
    pairClips.current[i] = null; // loading
    const sfx = g.speed === "slow" ? ".slow" : g.speed === "slower" ? ".slower" : "";
    const url = (word: string) => `/audio/${settings.voice}/w-${word}${sfx}.mp3`;
    const whole = (buffer: AudioBuffer): Clip => ({ buffer, t0: 0, t1: buffer.duration });
    const done = (pc: { model: Clip; other: Clip }) => {
      if (!alive.current) return;
      pairClips.current[i] = pc;
      setPairVersion((v) => v + 1); // the card can now offer 「聞こえた音」
    };
    Promise.all([loadBuffer(url(target)), loadBuffer(url(end))])
      .then(([a, b]) => done({ model: whole(a), other: whole(b) }))
      .catch(() => {
        // 2. both words in this very line
        const j = item.words.findIndex((x, k) => k !== i && spoken(x.text) === end);
        if (j >= 0 && b0 && g.words[i] && g.words[j]) {
          const seg = (k: number): Clip => ({ buffer: b0, t0: Math.max(0, g.words[k].start - 0.04), t1: g.words[k].end + 0.06 });
          return done({ model: seg(i), other: seg(j) });
        }
        // 3. the catalog's old pair item, when it has its own recording of the other word
        const ref = pairs?.[target];
        if (!ref || spoken(ref.other) !== end) return;
        const voice = settings.voice;
        return fetchItem(ref.id).then(async (pi) => {
          const a = ref.side === "main" ? pi : pi.pairItem;
          const b = ref.side === "main" ? pi.pairItem : pi;
          if (!a || !b) return;
          const ga = guideFor(a, voice, "native");
          const gb = guideFor(b, voice, "native");
          const [ba, bb] = await Promise.all([loadBuffer(ga.audio), loadBuffer(gb.audio)]);
          const clip = (gt: GuideTake, buffer: AudioBuffer): Clip => ({ buffer, t0: Math.max(0, (gt.words[0]?.start ?? gt.speech[0]) - 0.04), t1: (gt.words[0]?.end ?? gt.speech[1]) + 0.06 });
          done({ model: clip(ga, ba), other: clip(gb, bb) });
        });
      })
      .catch(() => undefined);
  };
  const clipsFor = (i: number): CoachClips => ({
    model: () => {
      const pc = pairClips.current[i];
      if (pc) return pc.model;
      const w = guide?.words[i];
      const buffer = bufferRef.current;
      return w && buffer ? { buffer, t0: Math.max(0, w.start - 0.04), t1: w.end + 0.06 } : null;
    },
    other: () => pairClips.current[i]?.other ?? null,
    mine: () => {
      const again = wordTakes.current[i];
      if (again) return { buffer: getPlayer().toBuffer(playableTake(again.take)), t0: Math.max(0, again.start - 0.05), t1: again.end + 0.05 };
      const take = takeRef.current;
      const sp = result?.spans[i];
      return take && sp ? { buffer: getPlayer().toBuffer(playableTake(take)), t0: Math.max(0, sp.start), t1: sp.end } : null;
    },
  });
  // the coached word's pair loads once the score has landed (idle), the others when opened
  useEffect(() => {
    if (!result || result.coach < 0) return;
    const id = setTimeout(() => loadPair(result.coach), 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.attempt]);

  /**
   * The sound card's slider ends. With the catalog's minimal pair loaded, both ends play that pair's
   * own recordings (the same two clips the slider blends); otherwise お手本's word at this speed,
   * and for 「聞こえた音」 your own take (that is what was heard).
   */
  const playEnd = (kind: "model" | "heard", word: number) => {
    const pc = pairClips.current[word];
    if (!pc) return playSeq([kind === "model" ? "model" : "you"], word);
    const clip = kind === "model" ? pc.model : pc.other;
    const player = getPlayer();
    player.events = {
      onPlayhead: () => setSegVoice((cur) => (cur === kind ? cur : kind)),
      onEnd: () => {
        if (!alive.current) return;
        setSegVoice(null);
        setPlaying(null);
      },
    };
    void player.playSequence([{ source: clip.buffer, t0: clip.t0, t1: clip.t1, label: kind }]);
    setPlaying("seg");
  };

  // say one word again from the sound card: record (VAD stop), score it alone, update in place
  const retryWord = (i: number) => {
    if (retry.state === "recording") {
      recRef.current?.stop();
      return;
    }
    if (retry.state === "scoring" || !item || !result) return;
    const player = getPlayer();
    player.stop();
    player.events = {};
    const rec = newWordRecorder({ onLevel: (e) => (level.current = Math.min(1, Math.max(0, (e.db + 60) / 45))) });
    recRef.current = rec;
    const pending = rec.record(); // synchronous inside the tap (iOS)
    const before = result.words[i];
    if (heardEnd.current[i] === undefined) {
      const worstPh = [...before.phones].sort((a, b) => a.score - b.score)[0];
      heardEnd.current[i] = worstPh ? heardShort(before, worstPh) : null;
    }
    setTimeout(startScoring, 0);
    startTransition(() => setRetry({ state: "recording" }));
    pending
      .then(async (take) => {
        level.current = 0;
        if (!alive.current) return;
        if (!take.speech) {
          setRetry({ state: "error", message: "声が聞こえませんでした。◇もう一度、◆押してください。" });
          return;
        }
        setRetry({ state: "scoring" });
        const w = item.words[i];
        const scored = await startScoring().score(take.pcm16k, [w], { ...item.scoring });
        if (!alive.current) return;
        const ws = toWordScore(w.text, scored, 0);
        wordTakes.current[i] = { take, start: scored.words[0].start, end: scored.words[0].end };
        startTransition(() => {
          setSheetBefore(before.score);
          setResult((r) => (r ? { ...r, words: r.words.map((x, k) => (k === i ? ws : x)) } : r));
          setRetry({ state: "idle" });
        });
        sfx(ws.score > before.score ? "best" : "tap");
      })
      .catch((e: unknown) => {
        level.current = 0;
        if (!alive.current) return;
        const name = (e as DOMException)?.name;
        setRetry(name === "AbortError" ? { state: "idle" } : { state: "error", message: "マイクが使えません。◇もう一度、◆押してください。" });
      });
  };
  /** move the result's card to another mistake */
  const pickCoach = (i: number) => {
    stopPlayback();
    setSheetBefore(null);
    setRetry({ state: "idle" });
    setCoachSel(i);
    loadPair(i);
  };
  useEffect(() => {
    if (retry.state !== "recording") return;
    let raf = 0;
    const loop = () => {
      if (barRing.current) barRing.current.style.transform = `scale(${1 + level.current * 0.18})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [retry.state]);

  // test hook
  useEffect(() => {
    window.__practice = {
      phase,
      debug: debugRef.current,
      rec: () => ({ state: recRef.current?.state, diag: recRef.current?.diagnostics }),
      scoring: scorer,
      result: result
        ? {
            total: result.scores.overall,
            sounds: result.scores.sounds,
            rhythm: result.scores.rhythm,
            intonation: result.scores.intonation,
            counts: result.counts,
            flagged: result.words.flatMap((w) => w.phones.filter((p) => p.issue || p.inserted).map((p) => `${w.text}.${p.phone}:${p.issue ?? "inserted"}${p.heardAs ? ">" + p.heardAs : ""}`)),
            words: result.words.map((w) => [w.text, w.score]),
            coach: result.coach,
          }
        : null,
    };
  }, [phase, result, scorer]);

  // ---------------------------------------------------------------- view
  const isResult = phase === "result";
  const busyTake = phase === "starting" || phase === "countin" || phase === "singing";
  const fold = busyTake || phase === "scoring";
  const score = result ? shownTotal(result.scores) : 0;
  const words = item?.words.map((w) => w.text) ?? [];
  const reading = result ? chartTipJa(result.notes, words) : "";
  // the sound coached on the result: the worst flagged word of this take
  const coachIdx = result ? (coachSel ?? result.coach) : -1;
  const passed = score >= RETRY_FIRST_BELOW;
  // one main action per state: first the worst word (its 「だけ言う」); once that sound is fixed —
  // or when there was none — 次へ; a weak line with nothing to fix asks for the line again
  const coachWord = result && coachIdx >= 0 ? result.words[coachIdx] : null;
  const coachFixed = coachWord ? !coachWord.phones.some((ph) => mark(ph) === "miss") : true;
  const main: "word" | "next" | "again" = coachWord && !coachFixed ? "word" : passed || coachWord ? "next" : "again";
  const tipFor = (word: number) => (phone: string) => {
    const base = phone.replace(/\d/g, "");
    const f = item?.focus.find((x) => !x.inPair && x.word === word && x.phone === base && x.tipJa);
    return f ? f.tipJa.replace(/\n/g, "◇") : null;
  };
  const label = item ? `${item.text} のお手本の声の高さの波。` : "お手本の声の高さの波";
  const speedLabel = SPEEDS.find((s) => s.id === (guide?.speed ?? settings.speed))?.label ?? "ネイティブ";
  const voiceLabel = VOICES.find((v) => v.id === settings.voice)?.label ?? "女性";

  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      {embedded ? null : <TopBar backHref={backHref} index={index + 1} total={totalItems} combo={busyTake ? 0 : combo} />}

      {/* fetch the font subsets the result uses while the learner is still on the guide */}
      <span aria-hidden className="pointer-events-none absolute -left-[9999px] top-0 select-none whitespace-nowrap font-bold opacity-0">
        点伝わりますいい感じお手本にそっくりここから伸びます前回比音リズム抑揚波線の文字を押すと直し方が出ます高さの幅が小さく平らに聞こえます日本語のラ行が入っています
      </span>
      <span aria-hidden className="pointer-events-none absolute -left-[9999px] top-0 select-none whitespace-nowrap font-black opacity-0">
        0123456789.点伝わりますいい感じお手本にそっくりパーフェクトここから伸びますもう一度話す言う次へあとで自分の声交互止める聞こえました
      </span>

      <main className="flex flex-1 flex-col">
        {isResult && result && item && guide ? (
          // ------------------------------------------------ the result: one coaching moment, the rest folded away
          <section aria-label="結果" className="mx-auto w-full max-w-[680px] px-4 pt-1 md:pt-6" onPointerDown={() => !revealDone && setSkip(true)}>
            <ScoreHead key={revealKey} scores={result.scores} run skip={skip} onDone={onRevealDone} verdict={verdict(score)} previous={result.previous} celebrate={score >= 90} />
            {!revealDone ? (
              <button type="button" className="sr-only" onClick={() => setSkip(true)}>
                結果をすぐに見る
              </button>
            ) : null}

            {/* the line, once, with its wrong letters marked */}
            {stage >= 1 ? (
              <div className="anim-fade mt-3">
                <ResultSentence
                  text={item.text}
                  words={result.words}
                  onOpen={(i) => {
                    if (i !== coachIdx) pickCoach(i);
                    document.getElementById("coach")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  selected={coachIdx}
                />
              </div>
            ) : null}

            {/* the worst sound, opened by itself: the one thing to do now */}
            {coachIdx >= 0 && stage >= 2 ? (
              <section id="coach" aria-label="いちばんの直しどころ" className="anim-fade mt-3 scroll-mt-4 rounded-[22px] bg-(--paper) px-5 pb-5 pt-4">
                <SoundCoach
                  key={`${result.attempt}-${coachIdx}`}
                  compact
                  retryAt="none"
                  primary={main === "word"}
                  word={result.words[coachIdx]}
                  token={item.words[coachIdx]?.text ?? result.words[coachIdx].text}
                  ipa={item.words[coachIdx]?.ipa}
                  before={sheetBefore}
                  heardEnd={heardEnd.current[coachIdx] ?? heardEndFor(result.words[coachIdx])}
                  heardClip={!!pairClips.current[coachIdx]}
                  nav={{
                    items: result.mistakes.map((i) => ({ label: (item.words[i]?.text ?? result.words[i].text).replace(/[.,!?]/g, ""), done: !result.words[i].phones.some((ph) => mark(ph) === "miss") })),
                    index: Math.max(0, result.mistakes.indexOf(coachIdx)),
                    onPick: (k) => pickCoach(result.mistakes[k]),
                  }}
                  tipFor={tipFor(coachIdx)}
                  clips={clipsFor(coachIdx)}
                  onPlayModel={() => playEnd("model", coachIdx)}
                  onPlayHeard={() => playEnd("heard", coachIdx)}
                  onPlayMine={() => playSeq(["you"], coachIdx)}
                  playing={segVoice}
                  retry={retry}
                  level={level}
                  onRetry={() => retryWord(coachIdx)}
                />
              </section>
            ) : null}

            <details
              open={details}
              onToggle={(e) => setDetails((e.currentTarget as HTMLDetailsElement).open)}
              className="group mt-2 px-1 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-[15px] font-bold">
                くわしく
                {/* an SVG chevron: a rare text glyph (⌄) costs a system-wide font lookup on its first layout */}
                <svg aria-hidden viewBox="0 0 12 12" className="size-3 transition-transform group-open:rotate-180">
                  <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              {details ? (
              <div className="pb-4">
                <PartsRow scores={result.scores} />
                <div className="monitor relative mt-3 overflow-hidden rounded-[18px] bg-(--monitor) text-(--monitor-ink) [contain:layout_paint]">
                  <div className="relative h-[150px] md:h-[180px]">
                    <Guide className="absolute inset-0" wave={guide.wave} syllables={guide.syllables} words={guide.words} live={live} overlay={result.userOnRef} offStretches={result.off} progressive={playing === "replay"} focusWord={null} tolSt={2.5} label={`${label}${reading}`} />
                  </div>
                  <p className="jp border-t border-(--monitor-line) px-4 py-[10px] text-[14px] font-bold leading-snug">{reading}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={playModel} aria-pressed={playing === "model"} className="press h-12 text-[15px]">
                    <span aria-hidden className="size-3 rounded-full bg-(--guide)" />
                    {playing === "model" ? <IconSpeaker size={18} /> : <IconPlay size={14} />}
                    お手本
                  </button>
                  <button type="button" onClick={replayMine} aria-pressed={playing === "replay"} className="press h-12 text-[15px]">
                    <span aria-hidden className="size-3 rounded-full bg-(--voice-fill)" />
                    {playing === "replay" ? <IconSpeaker size={18} /> : <IconPlay size={14} />}
                    あなた
                  </button>
                </div>
                <div className="mt-4 rounded-[16px] bg-(--paper) px-4 py-4 text-(--ink)">
                  <p className="text-[13px] font-medium opacity-75">話している間の当たり（音節ごと）</p>
                  <ul className="mt-2 grid grid-cols-4 gap-2 text-center">
                    {(["perfect", "great", "good", "miss"] as const).map((k) => (
                      <li key={k} className="rounded-[12px] bg-[#f1f2f8] py-2">
                        <span className="en block text-[13px] font-bold">{k.toUpperCase()}</span>
                        <span className="num text-[20px] font-bold leading-none">{result.counts[k]}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    <DirectionSlider label="テンポ" left="ゆっくり" right="早口" step={step7(tempoPosition(result.tempoRatio))} />
                    <DirectionSlider label="抑揚" left="平坦" right="大げさ" step={step7(rangePosition(result.rangeRatio))} />
                  </div>
                </div>
              </div>
              ) : null}
            </details>
            <div className="h-4" aria-hidden />
          </section>
        ) : (
          <>
            {/* ------------------------------------------------ the stage: caption + guide */}
            <section aria-label="練習する文" className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col justify-center px-4 py-2 md:px-8">
              {/* another flow's own line above ours (a dialogue: the partner's line) */}
              {context ? <div className="mx-auto mb-3 w-full max-w-[1040px] px-1">{context}</div> : null}
              {/* the caption fits its length (a 100-letter line keeps the lane and the mic on screen) and
                  steps back while you speak: the sentence then rides the band below */}
              <div className="mx-auto w-full max-w-[1040px] px-1" style={{ fontSize: captionSize(item?.text.length ?? 0, fold) }}>
                {item && guide ? <Telop text={item.text} words={guide.words} mode="karaoke" clock={clock} reveal={reveal} selected={null} hits={hits} /> : <div className="h-[1.3em]" aria-hidden />}
              </div>
              {item ? (
                <div className="mx-auto w-full max-w-[1040px] px-1">
                  {/* English → its sounds right under it → the meaning */}
                  <p className="ipa mt-1 text-[15px] leading-snug opacity-90 md:text-[17px]">{lineIpa(item)}</p>
                  {fold ? null : (
                    <p className="jp mt-2 text-[15px] font-medium leading-snug md:mt-3 md:text-[18px]">
                      <BreakText text={item.ja.replace(/\n/g, "◆")} />
                      {item.note ? <span className="mt-1 block text-[13px]">もとの形：{item.note}</span> : null}
                    </p>
                  )}
                </div>
              ) : null}

              {/* the lane takes the room left on the phone (up to a cap); fixed heights from md up */}
              <div className="monitor relative mx-auto mt-5 flex max-h-[420px] min-h-[200px] w-full max-w-[960px] flex-1 flex-col overflow-hidden rounded-(--radius-monitor) bg-(--monitor) text-(--monitor-ink) [contain:layout_paint] md:mt-7 md:max-h-none md:flex-none">
                <div className="relative min-h-[200px] flex-1 md:h-[300px] md:flex-none lg:h-[330px]">
                  {guide ? (
                    <Guide className="absolute inset-0" wave={guide.wave} syllables={guide.syllables} words={guide.words} live={live} overlay={null} progressive={false} focusWord={null} tolSt={2.5} label={label} />
                  ) : null}
                  {hint && (phase === "countin" || phase === "singing") ? (
                    // top left, clear of the playhead in the middle
                    <div className="pointer-events-none absolute left-4 top-3 flex">
                      <span className="rounded-full bg-[rgba(255,255,255,0.14)] px-3 py-[6px] text-[13px] font-bold">線を青い帯に重ねよう</span>
                    </div>
                  ) : null}
                  {phase === "countin" && count > 0 ? (
                    <div aria-live="assertive" className="pointer-events-none absolute inset-0 grid place-items-center">
                      <span key={count} className="anim-pop leading-none">
                        <TelopText text={String(count)} className="text-[88px] md:text-[120px]" />
                        <span className="sr-only">{count}</span>
                      </span>
                    </div>
                  ) : null}
                </div>
                {phase === "scoring" || phase === "silent" ? (
                  <div className="flex min-h-[44px] items-center border-t border-(--monitor-line) px-4 py-2 text-[13px] font-bold" aria-live="polite">
                    {phase === "silent" ? "声が聞こえませんでした。もう一度どうぞ。" : scorer.ready ? "お手本とくらべています" : `採点の準備中 ${Math.round(scorer.progress * 100)}%`}
                  </div>
                ) : null}
              </div>
            </section>

            {/* ------------------------------------------------ the remote */}
            <div className="mx-auto w-full max-w-[560px] px-4 pt-4 [contain:layout] [padding-bottom:max(18px,calc(env(safe-area-inset-bottom)+10px))] md:pb-10">
              {/* settings can't change mid-take: they fold away (once, at the tap) and the lane takes their room */}
              {fold ? null : (
                <>
              <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="練習の設定">
                {speedProp ? null : (
                <Chip
                  label="速さ"
                  value={speedLabel}
                  disabled={busyTake}
                  onClick={() => {
                    const i = speeds.indexOf(guide?.speed ?? "native");
                    changeSettings({ speed: speeds[(i + 1) % speeds.length] });
                  }}
                />
                )}
                {voiceProp ? null : <Chip label="声" value={voiceLabel} disabled={busyTake} onClick={() => changeSettings({ voice: settings.voice === "af_heart" ? "am_michael" : "af_heart" })} />}
                <Chip label="お手本と一緒に" value={settings.together ? "オン" : "オフ"} pressed={settings.together} disabled={busyTake} onClick={() => changeSettings({ together: !settings.together })} />
              </div>
              <p className="mt-2 h-4 text-center text-[12px] font-bold leading-4" style={{ visibility: settings.together ? "visible" : "hidden" }}>
                イヤホンをおすすめします
              </p>
                </>
              )}
              <div className={`${fold ? "" : "mt-3"} flex items-start justify-center gap-5 md:gap-10`}>
                {fold || partner ? null : (
                <RoundButton
                  icon={<IconSpeaker size={28} />}
                  label="お手本"
                  ariaLabel={playing === "model" ? "お手本を止める" : "お手本を聞く"}
                  onPress={playModel}
                  playingMs={playing === "model" && guide ? guide.duration * 1000 : null}
                  disabled={!bufferReady}
                />
                )}
                {partner ? (
                  // a partner's line: only listen (the caption follows お手本)
                  <RoundButton
                    icon={<IconSpeaker size={30} />}
                    label="相手の番：聞く"
                    ariaLabel={playing === "model" ? "止める" : "相手の文を聞く"}
                    onPress={playModel}
                    playingMs={playing === "model" && guide ? guide.duration * 1000 : null}
                    disabled={!bufferReady}
                  />
                ) : (
                <MicButton
                  state={busyTake ? "recording" : phase === "scoring" ? "thinking" : "idle"}
                  level={level}
                  onPress={onMic}
                  label={phase === "starting" || phase === "loading" ? "準備中" : busyTake ? "止める" : phase === "scoring" ? "くらべています" : "押して話す"}
                  progress={stopAt}
                />
                )}
                {fold || partner ? null : (
                <RoundButton
                  icon={<IconPlay size={24} />}
                  label="自分の声"
                  ariaLabel="さっきの自分の声を聞く"
                  onPress={replayMine}
                  playingMs={null}
                  disabled={!takeRef.current || !result}
                />
                )}
              </div>
              {phase === "error" && error ? (
                <p className="jp mt-4 rounded-[16px] bg-(--paper) px-4 py-3 text-center text-[14px] font-bold text-(--ink)" role="alert">
                  <BreakText text={error} />
                </p>
              ) : null}
            </div>
          </>
        )}



        {isResult ? (
          <div className="sticky bottom-0 z-10 mt-auto bg-(--field) px-4 pt-3 [padding-bottom:max(16px,calc(env(safe-area-inset-bottom)+10px))]">
            {/* what scrolls under the bar fades out instead of being cut */}
            <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 h-8" style={{ background: "linear-gradient(to bottom, color-mix(in srgb, var(--field) 0%, transparent), var(--field))" }} />
            <div className="mx-auto flex max-w-[680px] gap-3">
              {main === "word" && coachWord && item ? (
                // first: say the worst word again (the coach above shows how)
                <button type="button" onClick={() => retryWord(coachIdx)} disabled={retry.state === "scoring"} className="press press-ink h-14 flex-[1.5] text-[15px]">
                  <span ref={barRing} aria-hidden className="grid size-8 place-items-center rounded-full bg-(--paper) text-(--ink) will-change-transform">
                    <IconMic size={16} />
                  </span>
                  {retry.state === "recording" ? (
                    "聞いています"
                  ) : retry.state === "scoring" ? (
                    "くらべています"
                  ) : (
                    <span className="en">
                      {(item.words[coachIdx]?.text ?? coachWord.text).replace(/[.,!?]/g, "")}
                      <span className="jp"> だけ言う</span>
                    </span>
                  )}
                </button>
              ) : null}
              {main === "word" ? (
                // the whole line again stays one tap away, quietly
                <button type="button" onClick={onMic} aria-label="文をもう一度話す" className="press press-ghost h-14 flex-1 text-[15px]">
                  <IconRetry size={16} />
                  文ごと
                </button>
              ) : (
              <button type="button" onClick={onMic} className={`press ${main === "again" ? "press-ink" : "press-ghost"} h-14 flex-[1.25] text-[15px]`}>
                <IconMic size={20} />
                もう一度話す
              </button>
              )}
              <button type="button" onClick={onNext} className={`press ${main === "next" ? "" : "press-ghost"} h-14 flex-1 text-[15px]`}>
                {!passed && attempt >= 3 ? "あとでもう一回" : "次へ"}
                <IconNext size={20} />
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

/** the word with the worst flagged sound (lowest-scoring missed phone; first on a tie), -1 if none */
function worstFlagged(words: WordScore[]): number {
  let at = -1;
  let low = Infinity;
  words.forEach((w, i) => {
    for (const p of w.phones)
      if (mark(p) === "miss" && p.score < low) {
        low = p.score;
        at = i;
      }
  });
  return at;
}

/**
 * The caption's size from the line's length, so even a 100-letter line leaves the lane and the mic on
 * a phone; while you speak it steps back to about 60 % (the words ride the band then).
 */
function captionSize(len: number, speaking: boolean): string {
  const [vw, min, max] = len <= 15 ? [12.4, 40, 104] : len <= 26 ? [10.6, 36, 96] : len <= 40 ? [8.4, 30, 80] : len <= 64 ? [6.4, 24, 60] : len <= 96 ? [5.2, 20, 48] : [4.4, 17, 40];
  const k = speaking ? 0.6 : 1;
  return `clamp(${Math.round(Math.max(15, min * k))}px, ${(vw * k).toFixed(2)}vw, ${Math.round(max * k)}px)`;
}

/** the far end of the sound card's meter: what the AI heard for the worst sound */
function heardEndFor(w: WordScore): string | null {
  const worst = [...w.phones].filter((p) => mark(p) === "miss").sort((a, b) => a.score - b.score)[0];
  return worst ? heardShort(w, worst) : null;
}

function Chip({ label, value, onClick, pressed, disabled }: { label: string; value: string; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={`${label}：${value}。押すと切り替わります`}
      className="inline-flex h-11 items-center gap-2 rounded-full bg-(--paper) px-4 text-[13px] font-black text-(--ink) disabled:opacity-50"
    >
      <span className="font-extrabold">{label}</span>
      <span className="rounded-full px-2 py-[2px]" style={pressed ? { background: "var(--ink)", color: "var(--paper)" } : { background: "#e6e8f6" }}>
        {value}
      </span>
    </button>
  );
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

/** one scored word → what the screen draws (letters for the marks, inserted vowels on their phone) */
function toWordScore(text: string, scored: ScoreResult, i: number): WordScore {
  const w = scored.words[i];
  const letters = alignLetters(text, w.phones.map((p) => p.phone));
  const phones: PhoneScore[] = w.phones.map((p, k) => ({ phone: p.phone, score: p.score, heardAs: p.heardAs, issue: p.issue, letters: letters[k] }));
  for (const ins of scored.insertions) if (ins.wordIndex === i && phones[ins.afterPhoneIndex]) phones[ins.afterPhoneIndex].inserted = ins.vowel;
  return { text, score: Math.round(w.score), phones };
}

/**
 * Anything said during the 3·2·1 is not part of the line: cut the take to start just before the
 * guide (recording clock → take time through Take.offset). Views share memory (no copies).
 */
function trimCountIn(take: Take, guideStartRec: number): Take {
  const cut = Math.round((guideStartRec - 0.3 - take.offset) * 100) / 100; // 10 ms grid
  if (!(cut > 0.05) || cut >= take.duration - 0.2) return take;
  const sr = take.sampleRate;
  const a = Math.round(cut * sr);
  const a16 = Math.round(cut * 16000);
  const speech = take.speech ? { start: Math.max(0, take.speech.start - cut), end: take.speech.end - cut } : null;
  return {
    ...take,
    pcm: take.pcm.subarray(a),
    playback: take.playback.subarray(Math.min(a, take.playback.length)),
    pcm16k: take.pcm16k.subarray(a16),
    duration: take.duration - cut,
    offset: take.offset + cut,
    speech: speech && speech.end > 0.05 ? speech : null,
    pitch: take.pitch.filter((f) => f.t >= cut).map((f) => ({ ...f, t: Math.round((f.t - cut) * 100) / 100 })),
  };
}

