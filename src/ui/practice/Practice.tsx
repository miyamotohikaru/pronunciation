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
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import type { ItemData } from "@/data/schema";
import type { MicRecorder, Take } from "@/engine/audio";
import { KaraokeJudge, type BarGrade, type JudgeSummary } from "@/engine/karaoke/judge.ts";
import { compareProsody } from "@/engine/prosody/compare.ts";
import type { ProsodyResult } from "@/engine/prosody/types.ts";
import type { ScoreResult } from "@/engine/scoring/types.ts";
import { Guide, freshLive, type GuideLive } from "../guide";
import Telop from "../Telop";
import TopBar from "../TopBar";
import MicButton from "../MicButton";
import RoundButton from "../RoundButton";
import ScoreReadout from "../result/ScoreReadout";
import Breakdown from "../result/Breakdown";
import DirectionSlider from "../result/DirectionSlider";
import WordJudgements from "../result/WordJudgements";
import SoundCard, { type Voice } from "../SoundCard";
import TelopText from "../TelopText";
import { IconNext, IconPlay, IconRetry, IconSpeaker, IconSwap } from "../icons";
import { RETRY_FIRST_BELOW, rangePosition, step7, tempoPosition, total, verdict } from "../score";
import { noteLine, soundLabel } from "../copy";
import { buzz, setMuted, sfx } from "../sfx";
import type { PhoneScore, ProsodyNote, Scores, WordScore } from "../types";
import { SPEEDS, VOICES, fetchItem, guideFor, keepItems, speedsFor, type GuideTake, type Speed } from "./content";
import { getPlayer, keepBuffers, loadBuffer, newRecorder, onScoringStatus, playableTake, scoringStatus, startScoring, warmRecorder } from "./audio";
import { alignLetters } from "./letters";
import { DEFAULT_SETTINGS, bestOf, loadSettings, saveBest, saveSettings, type Settings } from "./progress";
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
};

export type PracticeProps = {
  itemId: string;
  nextItemId?: string | null;
  field: FieldClass;
  index: number;
  total: number;
  combo: number;
  backHref: string;
  onResult?: (itemId: string, score: number) => void;
  onNext: () => void;
};

declare global {
  interface Window {
    /** test hook (tools/e2e/practice.e2e.mjs) */
    __practice?: { phase: Phase; debug?: unknown; rec?: () => unknown; result: { total: number; sounds: number; rhythm: number; intonation: number; counts: Record<BarGrade, number>; flagged: string[]; words: [string, number][] } | null; scoring: ReturnType<typeof scoringStatus> };
  }
}

export default function Practice({ itemId, nextItemId, field, index, total: totalItems, combo, backHref, onResult, onNext }: PracticeProps) {
  const [item, setItem] = useState<ItemData | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [phase, setPhase] = useState<Phase>("loading");
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState<null | "model" | "replay" | "seg">(null);
  const [segVoice, setSegVoice] = useState<Voice | null>(null);
  const [alternating, setAlternating] = useState(false);
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealKey, setRevealKey] = useState(0);
  const [skip, setSkip] = useState(false);
  const [revealDone, setRevealDone] = useState(false);
  const [more, setMore] = useState(false);
  const [stage, setStage] = useState(0);
  const [scorer, setScorer] = useState(scoringStatus());
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [bufferReady, setBufferReady] = useState(false);

  const live = useRef<GuideLive>(freshLive());
  const level = useRef(0);
  const reveal = useRef(1);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const takeRef = useRef<Take | null>(null);
  const recRef = useRef<MicRecorder | null>(null);
  const raf = useRef(0);
  const lastFocus = useRef<HTMLElement | null>(null);
  const alive = useRef(true);
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
  }, [itemId, nextItemId]);

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
    setAlternating(false);
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
      onEnd: () => {
        const l = live.current;
        l.t = null;
        l.follow = false;
        l.version++;
        if (alive.current) setPlaying(null);
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

    const judge = new KaraokeJudge(g.syllables);
    const l = live.current;
    l.line = judge.line;
    l.bars = judge.bars;
    l.t = -COUNT_IN;
    l.follow = true;
    l.tone = "guide";
    l.version++;
    level.current = 0;
    takeRef.current = null; // the previous take can go

    let anchor: { rec: number; perf: number } | null = null;
    let stopping = false;
    let loudAt = 0; // last time the input was clearly above the noise floor (performance.now)
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
    startTransition(() => {
      setPlaying(null);
      setSelected(null);
      setPhase("starting");
      setAttempt(n);
    });
    pending
      .then((take) => {
        clearTimeout(watchdog);
        return finishTake(take, judge, g, n);
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
        setMore(false);
        setStage(0);
        setResult(r);
        setRevealKey((k) => k + 1);
        setPhase("result");
      });
      setTimeout(() => startTransition(() => setStage(1)), 120);
      setTimeout(() => startTransition(() => setMore(true)), 600);
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
    const words: WordScore[] = scored.words.map((w, i) => {
      const text = it.words[i]?.text ?? w.text;
      const letters = alignLetters(text, w.phones.map((p) => p.phone));
      const phones: PhoneScore[] = w.phones.map((p, k) => ({ phone: p.phone, score: p.score, heardAs: p.heardAs, issue: p.issue, letters: letters[k] }));
      for (const ins of scored.insertions) if (ins.wordIndex === i && phones[ins.afterPhoneIndex]) phones[ins.afterPhoneIndex].inserted = ins.vowel;
      return { text, score: Math.round(w.score), phones };
    });
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
    };
  };

  const onRevealDone = () => {
    if (!result) return;
    reveal.current = 1;
    setRevealDone(true);
    const s = result.scores.overall;
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
    return {
      model: { source: bufferRef.current!, t0: Math.max(0, w.start - 0.04), t1: w.end + 0.06, label: "model" },
      you: { source: playableTake(takeRef.current!), t0: Math.max(0, mine.start), t1: mine.end, label: "you" },
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
          l.t = result.toGuide(e.t);
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
        setAlternating(false);
        setPlaying(null);
      },
    };
    void player.playSequence(seq.map((s) => it[s]), { gap: 0.35 });
    setPlaying("seg");
  };

  const openWord = useCallback(
    (i: number) => {
      stopPlayback();
      lastFocus.current = document.activeElement as HTMLElement | null;
      setSelected(i);
    },
    [stopPlayback],
  );
  const closeWord = useCallback(() => {
    stopPlayback();
    setSelected(null);
    requestAnimationFrame(() => lastFocus.current?.focus());
  }, [stopPlayback]);

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
          }
        : null,
    };
  }, [phase, result, scorer]);

  // ---------------------------------------------------------------- view
  const isResult = phase === "result";
  const busyTake = phase === "starting" || phase === "countin" || phase === "singing";
  const score = result?.scores.overall ?? 0;
  const retryFirst = score < RETRY_FIRST_BELOW;
  const words = item?.words.map((w) => w.text) ?? [];
  const worst = result ? result.words.reduce((a, w, i, arr) => (w.score < arr[a].score ? i : a), 0) : 0;
  const worstPhone = result ? [...result.words[worst].phones].sort((a, b) => a.score - b.score)[0] : null;
  const topNote = result ? [...result.notes].sort((a, b) => b.weight - a.weight)[0] : undefined;
  const comment = !result
    ? ""
    : result.words[worst].score < 75 && worstPhone
      ? `いちばんの伸びしろは、◆${result.words[worst].text} の ${soundLabel(worstPhone.phone)}。${topNote ? "◇" + noteLine(topNote, words) : ""}`
      : topNote
        ? `音は、お手本に近いです。◇${noteLine(topNote, words)}`
        : "お手本に、かなり近いです。◇次へ進みましょう。";
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
      <TopBar backHref={backHref} index={index + 1} total={totalItems} combo={busyTake ? 0 : combo} muted={muted} onToggleMute={() => setMutedState((m) => !m)} />

      {/* fetch the font subsets the result uses while the learner is still on the guide */}
      <span aria-hidden className="pointer-events-none absolute -left-[9999px] top-0 select-none whitespace-nowrap font-bold opacity-0">
        点伝わりますいい感じお手本にそっくりここから伸びます回目ベスト更新音リズム抑揚テンポゆっくり早口平坦大げさ聞こえました
      </span>
      <span aria-hidden className="pointer-events-none absolute -left-[9999px] top-0 select-none whitespace-nowrap font-black opacity-0">
        0123456789.点伝わりますいい感じお手本にそっくりパーフェクトここから伸びます回目ベスト更新までの音リズム抑揚テンポゆっくり早口平坦大げさ少しほんのかなりいちばん伸びしろは聞こえました母音が入りましたあいまいでした話している間判定節ごと単語自分声交互に聞く止める一回次へあとで
      </span>
      <main className="flex flex-1 flex-col">
        <section aria-label="練習する文" className={`mx-auto flex w-full max-w-[1120px] flex-col px-4 md:px-8 ${isResult ? "pt-2 md:pt-4" : "flex-1 justify-center py-2"}`}>
          <div className="mx-auto w-full max-w-[1040px] px-1 text-[clamp(44px,13.2vw,108px)]">
            {item && guide ? (
              <Telop
                text={item.text}
                words={guide.words}
                mode={isResult ? "result" : "karaoke"}
                clock={clock}
                results={result?.words}
                reveal={reveal}
                selected={selected}
                onSelect={openWord}
              />
            ) : (
              <div className="h-[1.3em]" aria-hidden />
            )}
          </div>
          {item ? (
            <p className="jp mt-3 text-center text-[15px] font-bold leading-snug md:mt-4 md:text-[18px]">
              <BreakText text={item.ja.replace(/\n/g, "◆")} />
              {item.note ? <span className="mt-1 block text-[13px]">もとの形：{item.note}</span> : null}
            </p>
          ) : null}

          <div className="monitor relative mx-auto mt-5 w-full max-w-[960px] overflow-hidden rounded-(--radius-monitor) bg-(--monitor) text-(--monitor-ink) shadow-[0_6px_0_var(--field-deep)] [contain:layout_paint] md:mt-7">
            <div className="relative h-[clamp(176px,26dvh,240px)] md:h-[260px] lg:h-[290px]">
              {guide ? (
                <Guide
                  className="absolute inset-0"
                  wave={guide.wave}
                  syllables={guide.syllables}
                  words={guide.words}
                  live={live}
                  overlay={isResult ? result?.userOnRef ?? null : null}
                  progressive={playing === "replay"}
                  focusWord={selected}
                  label={label}
                />
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
            <div className="flex min-h-[54px] items-center gap-3 border-t border-(--monitor-line) px-4 py-2 text-[13px] font-extrabold">
              {isResult ? (
                <>
                  <button type="button" onClick={replayMine} aria-pressed={playing === "replay"} className="press press-voice h-[40px] rounded-[14px] px-4 text-[14px]" style={{ ["--edge" as string]: "4px" }}>
                    <IconPlay size={16} />
                    自分の声
                  </button>
                  <button type="button" onClick={playModel} aria-pressed={playing === "model"} className="press press-guide h-[40px] rounded-[14px] px-4 text-[14px]" style={{ ["--edge" as string]: "4px" }}>
                    <IconPlay size={16} />
                    お手本
                  </button>
                </>
              ) : phase === "scoring" ? (
                <span aria-live="polite">{scorer.ready ? "お手本とくらべています" : `採点の準備中 ${Math.round(scorer.progress * 100)}%`}</span>
              ) : phase === "silent" ? (
                <span aria-live="polite">声が聞こえませんでした。もう一度どうぞ。</span>
              ) : (
                <span className="flex items-center gap-2 text-(--monitor-muted)">
                  <span aria-hidden className="h-[8px] w-[20px] rounded-full bg-(--guide)" />
                  お手本の声の波
                  <span aria-hidden className="ml-2 h-[3px] w-[18px] rounded-full bg-white" />
                  あなた
                </span>
              )}
            </div>
          </div>
        </section>

        {!isResult ? (
          <div className="mx-auto w-full max-w-[560px] px-4 pb-[calc(18px+env(safe-area-inset-bottom))] pt-4 [contain:layout] md:pb-10">
            {/* settings: speed, voice, the model alongside */}
            <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="練習の設定">
              <Chip
                label="速さ"
                value={speedLabel}
                disabled={busyTake}
                onClick={() => {
                  const i = speeds.indexOf(guide?.speed ?? "native");
                  changeSettings({ speed: speeds[(i + 1) % speeds.length] });
                }}
              />
              <Chip label="声" value={voiceLabel} disabled={busyTake} onClick={() => changeSettings({ voice: settings.voice === "af_heart" ? "am_michael" : "af_heart" })} />
              <Chip label="お手本と一緒に" value={settings.together ? "オン" : "オフ"} pressed={settings.together} disabled={busyTake} onClick={() => changeSettings({ together: !settings.together })} />
            </div>
            <p className="mt-2 h-4 text-center text-[12px] font-bold leading-4" style={{ visibility: settings.together ? "visible" : "hidden" }}>
              イヤホンをおすすめします
            </p>

            <div className="mt-4 flex items-start justify-center gap-5 md:gap-10">
              <RoundButton
                icon={<IconSpeaker size={28} />}
                label="お手本"
                ariaLabel={playing === "model" ? "お手本を止める" : "お手本を聞く"}
                onPress={playModel}
                playingMs={playing === "model" && guide ? guide.duration * 1000 : null}
                disabled={!bufferReady || busyTake || phase === "scoring"}
              />
              <MicButton
                state={busyTake ? "recording" : phase === "scoring" ? "thinking" : "idle"}
                level={level}
                onPress={onMic}
                label={
                  phase === "starting"
                    ? "準備中"
                    : phase === "countin"
                      ? "カウント"
                      : phase === "singing"
                        ? "波に合わせて"
                        : phase === "scoring"
                          ? "くらべています"
                          : phase === "loading"
                            ? "準備中"
                            : "押して話す"
                }
                hint={busyTake ? "最後まで行くと、自動で止まります" : undefined}
              />
              <RoundButton
                icon={<IconPlay size={24} />}
                label="自分の声"
                ariaLabel="さっきの自分の声を聞く"
                onPress={replayMine}
                playingMs={null}
                disabled={!takeRef.current || !result || busyTake || phase === "scoring"}
              />
            </div>
            {phase === "error" && error ? (
              <p className="jp mt-4 rounded-[16px] bg-(--paper) px-4 py-3 text-center text-[14px] font-bold text-(--ink)" role="alert">
                <BreakText text={error} />
              </p>
            ) : null}
          </div>
        ) : null}

        {isResult && result ? (
          <div className="mx-auto w-full max-w-[680px] px-5 pb-8 pt-6 md:pt-8" onPointerDown={() => !revealDone && setSkip(true)}>
            <ScoreReadout
              key={revealKey}
              value={score}
              run
              skip={skip}
              onProgress={(k) => {
                reveal.current = Math.min(1, Math.max(0, (k - 0.1) / 0.75));
              }}
              onDone={onRevealDone}
              verdict={verdict(score)}
              delta={result.bestBefore === null ? null : Math.round((score - result.bestBefore) * 1000) / 1000}
              attempt={result.attempt}
            />
            {!revealDone ? (
              <button type="button" className="sr-only" onClick={() => setSkip(true)}>
                結果をすぐに見る
              </button>
            ) : null}
            <div className="mt-6 min-h-[132px]">{stage >= 1 ? <Breakdown key={revealKey} scores={result.scores} run /> : null}</div>
            {more ? (
              <div className="[content-visibility:auto] [contain-intrinsic-size:auto_900px]">
                <div className="mt-8 grid gap-6 md:grid-cols-2 md:gap-8">
                  <DirectionSlider label="テンポ" left="ゆっくり" right="早口" step={step7(tempoPosition(result.tempoRatio))} />
                  <DirectionSlider label="抑揚" left="平坦" right="大げさ" step={step7(rangePosition(result.rangeRatio))} />
                </div>
                <div className="mt-8 rounded-[20px] bg-(--paper) px-5 py-4 text-(--ink)">
                  <p className="jp text-[16px] font-black leading-relaxed md:text-[18px]">
                    <BreakText text={comment} />
                  </p>
                  {result.words[worst].score < 75 ? (
                    <button type="button" onClick={() => openWord(worst)} className="press press-guide mt-4 h-[52px] w-full text-[16px]">
                      <IconSwap size={20} />
                      {result.words[worst].text} を音ごとに聞きくらべる
                    </button>
                  ) : null}
                </div>
                <div className="mt-8">
                  <WordJudgements words={result.words} notes={result.notes} onOpen={openWord} counts={result.counts} />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {selected !== null && result ? (
          <div className="fixed inset-x-0 bottom-0 z-20 md:static md:z-auto md:mt-8 md:px-4">
            <div className="mx-auto max-w-[680px]">
              <SoundCard
                key={selected}
                word={result.words[selected]}
                tipFor={tipFor(selected)}
                onClose={closeWord}
                onPlay={(who) => playSeq([who], selected)}
                onAlternate={() => {
                  if (alternating) return stopPlayback();
                  setAlternating(true);
                  playSeq(["model", "you", "model", "you"], selected);
                }}
                playing={segVoice}
                alternating={alternating}
              />
            </div>
          </div>
        ) : null}

        {isResult ? (
          <div className="sticky bottom-0 z-10 mt-auto bg-(--field) px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-3px_0_var(--field-deep)]">
            <div className="mx-auto flex max-w-[680px] gap-3">
              <button type="button" onClick={onMic} className={`press ${retryFirst ? "" : "press-deep"} h-[60px] flex-[1.25] text-[18px]`}>
                <IconRetry size={22} />
                もう一回
              </button>
              <button type="button" onClick={onNext} className={`press ${retryFirst ? "press-deep" : ""} h-[60px] flex-1 text-[18px]`}>
                {retryFirst && attempt >= 3 ? "あとでもう一回" : "次へ"}
                <IconNext size={20} />
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Chip({ label, value, onClick, pressed, disabled }: { label: string; value: string; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={`${label}：${value}。押すと切り替わります`}
      className="inline-flex h-11 items-center gap-2 rounded-full border-[3px] border-(--ink) bg-(--paper) px-4 text-[13px] font-black text-(--ink) disabled:opacity-50"
    >
      <span className="font-extrabold">{label}</span>
      <span className="rounded-full px-2 py-[2px]" style={{ background: pressed === false ? "#e6e8f6" : "var(--voice)" }}>
        {value}
      </span>
    </button>
  );
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

