"use client";

/**
 * The practice screen (the hero): one line, sung like karaoke.
 *   listen → recording → thinking → result ⇄ detail
 * Everything time-critical (playhead, live pitch, level, colour-in) moves through refs.
 *
 * The mock engine lives in this file (useMockEngine-style functions below). The real audio +
 * scoring engines replace exactly these: play the model at a rate, record a take (append live
 * pitch, level, onset), and return a TakeResult. The components only ever see props.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import TopBar from "./TopBar";
import Telop from "./Telop";
import PitchLane, { LANE_PAD, type FinishedTake, type LiveTake } from "./lane/PitchLane";
import { laneFrame, timeMap } from "./lane/geometry";
import MicButton from "./MicButton";
import RoundButton from "./RoundButton";
import ScoreReadout from "./result/ScoreReadout";
import Breakdown from "./result/Breakdown";
import DirectionSlider from "./result/DirectionSlider";
import WordJudgements from "./result/WordJudgements";
import SoundCard, { type Voice } from "./SoundCard";
import { IconNext, IconPlay, IconRetry, IconSpeaker, IconSwap, IconTurtle } from "./icons";
import { JUDGEMENT_LABEL, JUDGEMENT_VAR, RETRY_FIRST_BELOW, judge, rangePosition, step7, tempoPosition, total, verdict } from "./score";
import { STATUS, noteLine, soundLabel } from "./copy";
import { buzz, setMuted, sfx } from "./sfx";
import type { Judgement, PracticeItem, TakeResult } from "./types";

export type PracticeState = "listen" | "recording" | "thinking" | "result" | "detail";
export type PracticeTake = TakeResult & { live?: Judgement[] };

export type PracticeScreenProps = {
  item: PracticeItem;
  /** what the (mock) engine returns for attempt 1, 2, 3 … (the last one repeats) */
  takes: PracticeTake[];
  progress: { index: number; total: number; combo: number };
  backHref: string;
  nextHref: string;
  /** review entry: ?state=…&take=…&t=…&word=… pins the screen in that state until you touch it */
  initial?: { state?: PracticeState; take?: number; t?: number | null; word?: number | null };
};

type Pop = { id: number; syl: number; j: Judgement; stay: boolean };

const FIELD: Record<PracticeItem["unit"], string> = { rl: "field-rl", rhythm: "field-rhythm", th: "field-th" };

export default function PracticeScreen({ item, takes, progress, backHref, nextHref, initial = {} }: PracticeScreenProps) {
  const pinned = useRef(Boolean(initial.state));
  const freezeT = initial.t ?? null;

  const firstState = initial.state ?? "listen";
  const firstAttempt =
    initial.take ?? (firstState === "recording" ? 2 : 1);
  const [state, setState] = useState<PracticeState>(firstState);
  const [attempt, setAttempt] = useState(firstAttempt);
  const take = takes[Math.min(attempt, takes.length) - 1];
  const totals = useMemo(() => takes.map((t) => total(t.scores)), [takes]);
  const bestBefore = attempt > 1 ? Math.max(...totals.slice(0, Math.min(attempt, takes.length) - 1)) : null;
  const bestTakeBefore = attempt > 1 ? takes[totals.indexOf(bestBefore!)] : null;
  const score = totals[Math.min(attempt, takes.length) - 1];

  const [playing, setPlaying] = useState<null | "model" | "slow" | "replay" | "seg">(
    firstState === "listen" && freezeT !== null ? "model" : null,
  );
  const [segVoice, setSegVoice] = useState<Voice | null>(null);
  const [alternating, setAlternating] = useState(false);
  const [selected, setSelected] = useState<number | null>(
    firstState === "detail"
      ? initial.word != null && initial.word >= 0 && initial.word < take.words.length
        ? initial.word
        : worstWord(take)
      : null,
  );
  const [revealRun, setRevealRun] = useState(firstState === "result");
  const [revealKey, setRevealKey] = useState(0);
  const [skip, setSkip] = useState(false);
  const [revealDone, setRevealDone] = useState(firstState !== "result");
  const [combo, setCombo] = useState(progress.combo);
  const [muted, setMutedState] = useState(false);
  const [pops, setPops] = useState<Pop[]>([]);
  const [liveCombo, setLiveCombo] = useState(0);

  const playhead = useRef<number | null>(firstState === "listen" && freezeT !== null ? freezeT : null);
  const live = useRef<LiveTake>({ points: [], t: null });
  const level = useRef(0);
  const reveal = useRef(firstState === "result" ? 0 : 1);
  const raf = useRef(0);
  const timers = useRef<number[]>([]);
  const lastFocus = useRef<HTMLElement | null>(null);
  const popId = useRef(0);

  const frame = useMemo(
    () => laneFrame(item.syllables, [item.contour, ...takes.map((t) => t.userOnRefTime)]),
    [item, takes],
  );
  const finished: FinishedTake = useMemo(
    () => ({ contour: take.user.contour, syllables: take.user.syllables, onRef: take.userOnRefTime, onset: take.user.speech[0] }),
    [take],
  );
  const ghost = bestTakeBefore ? bestTakeBefore.userOnRefTime : null;

  // ------------------------------------------------------------------ mock engine
  const stopAll = useCallback(() => {
    cancelAnimationFrame(raf.current);
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    playhead.current = null;
    level.current = 0;
    setPlaying(null);
    setSegVoice(null);
    setAlternating(false);
  }, []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  /** animate the playhead over [from, to] (model timeline) at a rate; map lets a user-time clock drive it */
  const runPlayhead = useCallback(
    (from: number, to: number, rate: number, done: () => void, map?: (t: number) => number) => {
      cancelAnimationFrame(raf.current);
      const t0 = performance.now();
      const loop = (now: number) => {
        const t = from + ((now - t0) / 1000) * rate;
        if (t >= to) {
          playhead.current = null;
          done();
          return;
        }
        playhead.current = map ? map(t) : t;
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
    },
    [],
  );

  const playModel = (kind: "model" | "slow") => {
    pinned.current = false;
    if (playing === kind) {
      stopAll();
      return;
    }
    stopAll();
    sfx("tap");
    setPlaying(kind);
    runPlayhead(0, item.duration, kind === "slow" ? item.slowRate : 1, () => setPlaying(null));
  };

  const replayMine = () => {
    pinned.current = false;
    if (playing === "replay") {
      stopAll();
      return;
    }
    stopAll();
    sfx("tap");
    setPlaying("replay");
    const map = timeMap(take.user.syllables, item.syllables);
    runPlayhead(take.user.speech[0] - 0.04, take.user.speech[1] + 0.02, 1, () => setPlaying(null), map);
  };

  const startRecording = (nextAttempt: number, keepPinned = false) => {
    stopAll();
    pinned.current = keepPinned;
    sfx("tap");
    buzz(8);
    setAttempt(nextAttempt);
    setSelected(null);
    setState("recording");
    setPops([]);
    setLiveCombo(0);
    const tk = takes[Math.min(nextAttempt, takes.length) - 1];
    // the mock lines the take up with the model by its voice onset (the real flow uses the guide clock)
    const off = item.syllables[0].start - tk.user.speech[0];
    live.current = { points: [], t: null };
    let k = 0;
    let syl = 0;
    let run = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = freezeT !== null && keepPinned ? freezeT : (now - t0) / 1000;
      const pts = tk.user.contour;
      while (k < pts.length && pts[k].t <= t) {
        live.current.points.push({ t: pts[k].t + off, st: pts[k].st });
        k++;
      }
      live.current.t = t + off;
      level.current = tk.user.level[Math.min(tk.user.level.length - 1, Math.floor(t * 100))] ?? 0;
      while (syl < tk.user.syllables.length && t >= tk.user.syllables[syl].end) {
        const j = tk.live?.[syl] ?? "good";
        run = j === "perfect" || j === "great" ? run + 1 : 0;
        const id = ++popId.current;
        const stay = freezeT !== null && keepPinned;
        const thisRun = run;
        const at = syl;
        setPops((p) => [...p.filter((x) => x.stay || id - x.id < 3), { id, syl: at, j, stay }]);
        setLiveCombo(thisRun);
        if (j === "perfect" || j === "great") sfx("hit");
        syl++;
      }
      if (freezeT !== null && keepPinned) return; // frozen frame for review
      if (t >= tk.user.duration) {
        if (pinned.current) {
          // review loop: start the take again after a breath
          later(() => startRecording(nextAttempt, true), 700);
          return;
        }
        finishRecording();
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };

  const finishRecording = () => {
    cancelAnimationFrame(raf.current);
    level.current = 0;
    setState("thinking");
    later(() => {
      if (!pinned.current) showResult();
    }, 820);
  };

  const showResult = () => {
    setState("result");
    reveal.current = 0;
    setRevealDone(false);
    setSkip(false);
    setRevealRun(true);
    setRevealKey((k) => k + 1);
  };

  const onRevealDone = () => {
    reveal.current = 1;
    setRevealDone(true);
    const isBest = bestBefore === null || score > bestBefore;
    sfx(isBest && bestBefore !== null ? "best" : "score");
    buzz(12);
    setCombo((c) => (judge(score) === "perfect" || judge(score) === "great" ? Math.max(c, 0) + 1 : 0));
  };

  const openWord = (i: number) => {
    stopAll();
    pinned.current = false;
    lastFocus.current = document.activeElement as HTMLElement | null;
    setSelected(i);
    setState("detail");
  };
  const closeWord = useCallback(() => {
    stopAll();
    setState("result");
    setSelected(null);
    requestAnimationFrame(() => lastFocus.current?.focus());
  }, [stopAll]);

  const playSegment = (who: Voice, word: number, then?: () => void) => {
    cancelAnimationFrame(raf.current);
    setPlaying("seg");
    setSegVoice(who);
    const end = () => {
      setSegVoice(null);
      if (then) then();
      else setPlaying(null);
    };
    if (who === "model") {
      const w = item.words[word];
      runPlayhead(w.start - 0.03, w.end + 0.03, 0.8, end);
    } else {
      const w = take.user.words[word];
      runPlayhead(w.start - 0.03, w.end + 0.03, 0.8, end, timeMap(take.user.syllables, item.syllables));
    }
  };
  const alternate = (word: number) => {
    if (alternating) {
      stopAll();
      return;
    }
    stopAll();
    setAlternating(true);
    const seq: Voice[] = ["model", "you", "model", "you"];
    const step = (i: number) => {
      if (i >= seq.length) {
        setAlternating(false);
        setPlaying(null);
        return;
      }
      playSegment(seq[i], word, () => later(() => step(i + 1), 320));
    };
    step(0);
  };

  // pinned review states that need a kick on mount
  useEffect(() => {
    if (firstState === "recording") startRecording(firstAttempt, true);
    if (firstState === "thinking") {
      const off = item.syllables[0].start - take.user.speech[0];
      live.current = { points: take.user.contour.map((p) => ({ t: p.t + off, st: p.st })), t: null };
    }
    return () => {
      cancelAnimationFrame(raf.current);
      timers.current.forEach((t) => window.clearTimeout(t));
    };
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setMuted(muted), [muted]);

  // ------------------------------------------------------------------ view
  const words = item.words.map((w) => w.text);
  const isResult = state === "result" || state === "detail";
  const laneMode = state === "listen" ? "guide" : state === "recording" ? "live" : state === "thinking" ? "warp" : "overlay";
  const tone = playing === "replay" || segVoice === "you" ? "voice" : "guide";
  const retryFirst = score < RETRY_FIRST_BELOW;
  const tempoStep = step7(tempoPosition(take.tempoRatio));
  const rangeStep = step7(rangePosition(take.rangeRatio));
  const worst = worstWord(take);
  const worstPhone = [...take.words[worst].phones].sort((a, b) => a.score - b.score)[0];
  const topNote = [...take.notes].sort((a, b) => b.weight - a.weight)[0];
  const comment =
    take.words[worst].score < 75
      ? `いちばんの伸びしろは、◆${take.words[worst].text} の ${soundLabel(worstPhone.phone)}。${topNote ? "◇" + noteLine(topNote, words) : ""}`
      : topNote
        ? `音は、お手本に近いです。◇${noteLine(topNote, words)}`
        : "お手本に、かなり近いです。◇次の文へ進みましょう。";

  const laneLabel =
    `お手本の高さ：${describeMelody(item)}` +
    (isResult || state === "thinking"
      ? take.rangeRatio < 0.85
        ? "あなたの声は、お手本より平らです。"
        : "あなたの声は、お手本に近い高さです。"
      : "");

  return (
    <div className={`kara ${FIELD[item.unit]} flex min-h-dvh flex-col`}>
      <TopBar
        backHref={backHref}
        index={progress.index}
        total={progress.total}
        combo={state === "recording" ? 0 : combo}
        muted={muted}
        onToggleMute={() => setMutedState((m) => !m)}
      />

      <main className="flex flex-1 flex-col">
        {/* ---------------- the stage: telop + monitor (same place in every state) */}
        <section
          aria-label="練習する文"
          className={`mx-auto flex w-full max-w-[1120px] flex-col px-4 md:px-8 ${isResult ? "pt-2 md:pt-4" : "flex-1 justify-center py-2"}`}
        >
          <div className="mx-auto w-full max-w-[1040px] px-1 text-[clamp(44px,13.2vw,108px)]">
            <Telop
              text={item.text}
              words={item.words}
              mode={isResult ? "result" : "karaoke"}
              clock={playhead}
              results={take.words}
              reveal={reveal}
              selected={state === "detail" ? selected : null}
              onSelect={openWord}
            />
          </div>
          <p className="jp mt-3 text-center text-[15px] font-bold leading-snug md:mt-4 md:text-[18px]">
            <BreakText text={item.ja} />
          </p>

          <div className="monitor relative mx-auto mt-5 w-full max-w-[960px] overflow-hidden rounded-(--radius-monitor) bg-(--monitor) text-(--monitor-ink) shadow-[0_6px_0_var(--field-deep)] md:mt-7">
            <div className="relative h-[clamp(168px,25dvh,230px)] md:h-[250px] lg:h-[280px]">
              <PitchLane
                className="absolute inset-0"
                syllables={item.syllables}
                contour={item.contour}
                words={item.words}
                mode={laneMode}
                frame={frame}
                playhead={playhead}
                playheadTone={tone}
                live={live}
                take={state === "listen" || state === "recording" ? null : finished}
                ghost={state === "recording" || isResult ? ghost : null}
                progressive={playing === "replay"}
                focusWord={state === "detail" ? selected : null}
                label={laneLabel}
              />
              {state === "recording" ? <Pops pops={pops} item={item} frame={frame} /> : null}
              {isResult ? (
                // phones: the footer holds the replay buttons, so the key sits in the lane's corner
                <div aria-hidden className="pointer-events-none absolute right-3 top-3 rounded-full bg-(--monitor)/80 px-3 py-[6px] sm:hidden">
                  <Legend state={state} ghost={Boolean(ghost)} />
                </div>
              ) : null}
            </div>
            <MonitorFooter
              state={state}
              ghost={Boolean(ghost) && (state === "recording" || isResult)}
              liveCombo={liveCombo}
              playing={playing}
              onReplay={replayMine}
              onModel={() => playModel("model")}
            />
          </div>
        </section>

        {/* ---------------- the remote: listen / speak */}
        {!isResult ? (
          <div className="mx-auto w-full max-w-[560px] px-4 pb-[calc(22px+env(safe-area-inset-bottom))] pt-6 md:pb-12">
            <div className="flex items-start justify-center gap-5 md:gap-10">
              <div>
                <RoundButton
                  icon={<IconSpeaker size={28} />}
                  label="お手本"
                  ariaLabel={playing === "model" ? "お手本を止める" : "お手本を聞く"}
                  onPress={() => playModel("model")}
                  playingMs={playing === "model" && freezeT === null ? item.duration * 1000 : null}
                  disabled={state !== "listen"}
                />
              </div>
              <MicButton
                state={state === "recording" ? "recording" : state === "thinking" ? "thinking" : "idle"}
                level={level}
                onPress={() => {
                  if (state === "recording") {
                    pinned.current = false;
                    finishRecording();
                  } else startRecording(attempt);
                }}
                label={state === "recording" ? STATUS.recording : state === "thinking" ? STATUS.thinking : STATUS.listenIdle}
                hint={state === "recording" ? STATUS.recordingHint : undefined}
              />
              <div>
                <RoundButton
                  icon={<IconTurtle size={30} />}
                  label="ゆっくり"
                  ariaLabel={playing === "slow" ? "ゆっくりを止める" : "ゆっくり聞く"}
                  onPress={() => playModel("slow")}
                  playingMs={playing === "slow" ? (item.duration / item.slowRate) * 1000 : null}
                  disabled={state !== "listen"}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------------- sound-by-sound card: a bottom sheet on phones, in the flow under the monitor on desktop */}
        {state === "detail" && selected !== null ? (
          <div className="fixed inset-x-0 bottom-0 z-20 md:static md:z-auto md:mt-8 md:px-4">
            <div className="mx-auto max-w-[680px]">
              <SoundCard
                key={selected}
                word={take.words[selected]}
                onClose={closeWord}
                onPlay={(who) => playSegment(who, selected)}
                onAlternate={() => alternate(selected)}
                playing={segVoice}
                alternating={alternating}
              />
            </div>
          </div>
        ) : null}

        {/* ---------------- the result */}
        {isResult ? (
          <div
            className="mx-auto w-full max-w-[680px] px-5 pb-8 pt-6 md:pt-8"
            onPointerDown={() => {
              if (!revealDone) setSkip(true);
            }}
          >
            <ScoreReadout
              key={revealKey}
              value={score}
              run={revealRun && state === "result"}
              skip={skip}
              onProgress={(k) => {
                reveal.current = Math.min(1, Math.max(0, (k - 0.1) / 0.75));
              }}
              onDone={onRevealDone}
              verdict={verdict(score)}
              delta={bestBefore === null ? null : Math.round((score - bestBefore) * 1000) / 1000}
              attempt={take.attempt}
            />
            {!revealDone ? (
              <button type="button" className="sr-only" onClick={() => setSkip(true)}>
                結果をすぐに見る
              </button>
            ) : null}

            <div className="mt-6">
              <Breakdown key={revealKey} scores={take.scores} run={revealRun} />
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2 md:gap-8">
              <DirectionSlider label="テンポ" left="ゆっくり" right="早口" step={tempoStep} />
              <DirectionSlider label="抑揚" left="平坦" right="大げさ" step={rangeStep} />
            </div>

            <div className="mt-8 rounded-[20px] bg-(--paper) px-5 py-4 text-(--ink)">
              <p className="jp text-[16px] font-black leading-relaxed md:text-[18px]">
                <BreakText text={comment} />
              </p>
              {take.words[worst].score < 75 ? (
                <button
                  type="button"
                  onClick={() => openWord(worst)}
                  className="press press-guide mt-4 h-[52px] w-full text-[16px]"
                >
                  <IconSwap size={20} />
                  {take.words[worst].text} を音ごとに聞きくらべる
                </button>
              ) : null}
            </div>

            <div className="mt-8">
              <WordJudgements words={take.words} notes={take.notes} onOpen={openWord} />
            </div>
          </div>
        ) : null}

        {isResult ? (
          <div className="sticky bottom-0 z-10 mt-auto bg-(--field) px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-3px_0_var(--field-deep)]">
            <div className="mx-auto flex max-w-[680px] gap-3">
              <button
                type="button"
                onClick={() => startRecording(attempt + 1)}
                className={`press ${retryFirst ? "" : "press-ghost"} h-[60px] flex-[1.25] text-[18px]`}
              >
                <IconRetry size={22} />
                もう一回
              </button>
              <Link href={nextHref} className={`press ${retryFirst ? "press-ghost" : ""} h-[60px] flex-1 text-[18px]`}>
                {retryFirst && take.attempt >= 3 ? "あとでもう一回" : "次へ"}
                <IconNext size={20} />
              </Link>
            </div>
          </div>
        ) : null}
      </main>

    </div>
  );
}

function worstWord(t: TakeResult) {
  let k = 0;
  t.words.forEach((w, i) => {
    if (w.score < t.words[k].score) k = i;
  });
  return k;
}

function describeMelody(item: PracticeItem) {
  const voiced = item.syllables.filter((s) => s.pitchSt !== null);
  const peak = voiced.reduce((a, b) => ((b.pitchSt ?? -99) > (a.pitchSt ?? -99) ? b : a), voiced[0]);
  const last = item.words[item.words.length - 1].text;
  return `${item.words[peak.word].text} がいちばん高く、${last} で下がります。`;
}

/** Live judgement words that pop over the bars as each syllable is sung. */
function Pops({ pops, item, frame }: { pops: Pop[]; item: PracticeItem; frame: ReturnType<typeof laneFrame> }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {pops.map((p) => {
        const s = item.syllables[p.syl];
        const tc = (s.start + s.end) / 2;
        const fx = (tc - frame.t0) / (frame.t1 - frame.t0);
        const fy = (frame.st1 - (s.pitchSt ?? 0)) / (frame.st1 - frame.st0);
        return (
          <span
            key={p.id}
            className={`${p.stay ? "anim-pop" : "anim-float"} absolute whitespace-nowrap text-[15px] font-black leading-none md:text-[20px]`}
            style={{
              left: `calc(${LANE_PAD.l}px + ${fx} * (100% - ${LANE_PAD.l + LANE_PAD.r}px))`,
              top: `max(4px, calc(${LANE_PAD.t}px + ${fy} * (100% - ${LANE_PAD.t + LANE_PAD.b}px) - 30px))`,
              transform: p.stay ? "translate(-50%, 0)" : undefined,
              color: JUDGEMENT_VAR[p.j],
              WebkitTextStroke: "5px var(--monitor)",
              paintOrder: "stroke fill",
            }}
          >
            {JUDGEMENT_LABEL[p.j]}
          </span>
        );
      })}
    </div>
  );
}

function Legend({ state, ghost }: { state: PracticeState; ghost: boolean }) {
  return (
    <span className="flex items-center gap-4 text-[12px] font-extrabold leading-none text-(--monitor-muted)">
      <span className="flex items-center gap-[6px]">
        <span aria-hidden className="h-[7px] w-[18px] rounded-full bg-(--guide)" />
        {state === "listen" ? "お手本の声の高さと長さ" : "お手本"}
      </span>
      {state !== "listen" ? (
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-[3px] w-[18px] rounded-full bg-(--voice)" />
          あなた
        </span>
      ) : null}
      {ghost ? (
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="h-0 w-[18px] border-t-[3px] border-dotted border-(--voice) opacity-70" />
          ベスト
        </span>
      ) : null}
    </span>
  );
}

function MonitorFooter({
  state,
  ghost,
  liveCombo,
  playing,
  onReplay,
  onModel,
}: {
  state: PracticeState;
  ghost: boolean;
  liveCombo: number;
  playing: string | null;
  onReplay: () => void;
  onModel: () => void;
}) {
  const legend = <Legend state={state} ghost={ghost} />;
  return (
    <div className="flex min-h-[56px] items-center gap-3 border-t border-(--monitor-line) px-4 py-2">
      {state === "thinking" ? (
        <span className="text-[13px] font-extrabold leading-none" aria-live="polite">
          あなたの声を、お手本の長さにそろえています
        </span>
      ) : state === "result" || state === "detail" ? (
        <>
          <button
            type="button"
            onClick={onReplay}
            aria-pressed={playing === "replay"}
            className="press press-voice h-[40px] rounded-[14px] px-4 text-[14px]"
            style={{ ["--edge" as string]: "4px" }}
          >
            <IconPlay size={16} />
            自分の声
          </button>
          <button
            type="button"
            onClick={onModel}
            aria-pressed={playing === "model"}
            className="press press-guide h-[40px] rounded-[14px] px-4 text-[14px]"
            style={{ ["--edge" as string]: "4px" }}
          >
            <IconPlay size={16} />
            お手本
          </button>
          <span className="ml-auto hidden sm:block">{legend}</span>
        </>
      ) : (
        <>
          {legend}
          {state === "recording" && liveCombo >= 2 ? (
            <span
              key={liveCombo}
              className="anim-pop ml-auto inline-flex h-7 items-center rounded-full bg-(--hit) px-3 text-[13px] font-black leading-none text-white"
            >
              {liveCombo}コンボ
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

