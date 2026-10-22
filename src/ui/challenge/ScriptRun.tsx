"use client";

/**
 * 自己紹介 ② 通しで言う: the whole script in one take, like a karaoke song with several lines.
 * 3·2·1, then each line's cursor runs at the model's pace while you speak; when you finish a line
 * (its guide has ended and you have stopped), the next one comes after a short beat. One recording
 * for the whole script; each line is then cut out at its own boundaries and scored for its sounds,
 * except the yellow parts — those are yours to change, so they are not scored.
 * The model can be heard straight through first (お手本). Per-frame work reads refs in one rAF loop.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import type { ItemData } from "@/data/schema";
import type { MicRecorder, Take } from "@/engine/audio";
import { normalizeLoudness } from "@/engine/audio/loudness.ts";
import { KaraokeJudge } from "@/engine/karaoke/judge.ts";
import { takeScore } from "@/engine/scoring/calibrate.ts";
import { fetchItem, guideFor, type GuideTake } from "../practice/content";
import { newRecorder, onScoringStatus, scoringStatus, startScoring, warmRecorder } from "../practice/audio";
import type { FieldClass } from "../practice/fields";
import { Guide, freshLive, type GuideLive } from "../guide";
import { lineIpa } from "../ipa";
import TopBar from "../TopBar";
import MicButton from "../MicButton";
import RoundButton from "../RoundButton";
import TelopText from "../TelopText";
import { IconRetry, IconSpeaker } from "../icons";
import { buzz, sfx } from "../sfx";
import { BestMark, PlayGlyph, captionSize } from "./common/bits";
import { myVoice, play, stopListening, useNowPlaying } from "./common/listen";
import RunCaption from "./RunCaption";
import { SwapText, type Swap } from "./Swap";
import { saveRunBest } from "./runStore";

const COUNT_IN = 1.65;
const TAIL = 0.8;
const LATE_MAX = 2.6;
const GAP = 0.8; // the beat between two lines

export type ScriptRunProps = {
  field: FieldClass;
  script: { id: string; titleJa: string; lines: { id: string; text: string; ja: string; swaps: Swap[] }[] };
  backHref: string;
};

type Phase = "loading" | "ready" | "starting" | "countin" | "running" | "scoring" | "done" | "error";
type Clip = { pcm: Float32Array; sampleRate: number; playback?: Float32Array };
type LineResult = { score: number | null; clip: Clip | null };

/** your line at the model's loudness, computed once, when you first play it */
const playable = (c: Clip): Clip => {
  if (!c.playback) c.playback = normalizeLoudness(c.pcm, c.sampleRate).pcm;
  return c;
};

/** word indices of a line that are a swap phrase ("kitchen tools" → [7, 8]) */
function swapIndices(words: { text: string }[], swaps: Swap[]): Set<number> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, "");
  const ws = words.map((w) => norm(w.text));
  const out = new Set<number>();
  for (const s of swaps) {
    const ph = s.word.split(/\s+/).map(norm).filter(Boolean);
    for (let i = 0; i + ph.length <= ws.length; i++) {
      if (ph.every((p, k) => ws[i + k] === p)) {
        ph.forEach((_, k) => out.add(i + k));
        break;
      }
    }
  }
  return out;
}

export default function ScriptRun({ field, script, backHref }: ScriptRunProps) {
  const [items, setItems] = useState<ItemData[] | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [cur, setCur] = useState(0);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LineResult[] | null>(null);
  const [scored, setScored] = useState(0);
  const [scorer, setScorer] = useState(scoringStatus());
  const [modelOn, setModelOn] = useState(false);
  const now = useNowPlaying();
  const router = useRouter();
  const voice = useMemo(() => myVoice(), []);
  const live = useRef<GuideLive>(freshLive());
  const level = useRef(0);
  const stopAt = useRef(0);
  const recRef = useRef<MicRecorder | null>(null);
  const raf = useRef(0);
  const alive = useRef(true);
  const clock = useMemo(
    () => ({
      get current() {
        return live.current.follow ? live.current.t : null;
      },
    }),
    [],
  );

  useEffect(() => {
    alive.current = true;
    warmRecorder();
    const off = onScoringStatus(() => setScorer(scoringStatus()));
    let ok = true;
    Promise.all(script.lines.map((l) => fetchItem(l.id)))
      .then((its) => {
        if (!ok) return;
        setItems(its);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        if (!ok) return;
        setError(String((e as Error)?.message ?? e));
        setPhase("error");
      });
    return () => {
      ok = false;
      alive.current = false;
      off();
      cancelAnimationFrame(raf.current);
      recRef.current?.cancel();
      stopListening();
    };
  }, [script.lines]);

  const guides: GuideTake[] | null = useMemo(() => (items ? items.map((it) => guideFor(it, voice, "native")) : null), [items, voice]);
  const swaps = useMemo(() => (items ? items.map((it, i) => swapIndices(it.words, script.lines[i].swaps)) : null), [items, script.lines]);

  // ---------------------------------------------------------------- お手本, straight through
  const playModel = () => {
    if (!guides) return;
    const l = live.current;
    void play(
      guides.map((g) => g.audio),
      {
        key: "run-model",
        gap: GAP,
        onPlayhead: (e) => {
          l.t = e.t;
          l.follow = true;
          l.tone = "guide";
          setCur((c) => (c === e.item ? c : e.item));
        },
        onEnd: () => {
          l.t = null;
          l.follow = false;
          l.version++;
          setModelOn(false);
          setCur(0);
        },
      },
    );
    setModelOn((on) => !on);
  };

  // ---------------------------------------------------------------- the take
  const busy = phase === "starting" || phase === "countin" || phase === "running";

  const onMic = () => {
    if (busy) {
      recRef.current?.stop();
      return;
    }
    if (!guides || !items) return;
    stopListening();
    setModelOn(false);
    const n = guides.length;
    const starts = new Array<number>(n).fill(Number.NaN);
    const ends = new Array<number>(n).fill(Number.NaN);
    starts[0] = COUNT_IN;
    const judges = guides.map((g) => new KaraokeJudge(g.syllables, { wave: g.wave }));
    const planned = COUNT_IN + guides.reduce((a, g) => a + g.duration + TAIL + GAP, 0);
    let k = 0;
    const l = live.current;
    l.line = judges[0].line;
    l.bars = judges[0].bars;
    l.t = -COUNT_IN;
    l.follow = true;
    l.tone = "guide";
    l.version++;
    level.current = 0;
    stopAt.current = 0;
    let anchor: { rec: number; perf: number } | null = null;
    let loudAt = 0;
    let stopping = false;
    let digit = 4;

    const tick = () => {
      if (!anchor) return;
      const rt = (performance.now() - anchor.perf) / 1000;
      const gt = rt - starts[k];
      l.t = gt;
      if (k === 0) {
        const d = gt < 0 ? Math.min(3, Math.ceil(-gt / (COUNT_IN / 3))) : 0;
        if (d !== digit) {
          digit = d;
          startTransition(() => {
            setCount(d);
            if (d === 0) setPhase("running");
          });
        }
      }
      judges[k].advance(gt);
      stopAt.current = Math.min(1, rt / planned);
      const speaking = performance.now() - loudAt < 350;
      const g = guides[k];
      if (!stopping && gt >= g.duration + TAIL && (!speaking || gt >= g.duration + LATE_MAX)) {
        ends[k] = rt;
        judges[k].finish();
        if (k + 1 < n) {
          k++;
          starts[k] = rt + GAP;
          l.line = judges[k].line;
          l.bars = judges[k].bars;
          l.version++;
          buzz(8);
          const next = k;
          startTransition(() => setCur(next));
        } else {
          stopping = true;
          rec.stop();
        }
      }
      raf.current = requestAnimationFrame(tick);
    };

    const rec = newRecorder(planned + n * LATE_MAX + 1.5, {
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
        const rt = f.t - anchor.rec;
        const gt = rt - starts[k];
        if (gt < -0.25) return; // the beat before a line (or a late frame of the last one)
        judges[k].push({ t: gt, f0: f.f0, rms: f.rms });
      },
    });
    recRef.current = rec;
    const pending = rec.record(); // synchronous inside the tap (iOS)
    const watchdog = setTimeout(() => {
      if (anchor || !alive.current) return;
      rec.cancel();
      setError("マイクの音が届いていません。◇もう一度、◆押してください。");
      setPhase("error");
    }, 5000);
    setTimeout(() => {
      startScoring();
      sfx("tap");
      buzz(8);
    }, 0);
    startTransition(() => {
      setCur(0);
      setResults(null);
      setPhase("starting");
    });
    pending
      .then((take) => {
        clearTimeout(watchdog);
        cancelAnimationFrame(raf.current);
        l.follow = false;
        l.t = null;
        l.version++;
        level.current = 0;
        if (!alive.current || !anchor) return;
        // a line cut short by 止める ends where the take ended
        const endRt = take.offset + take.duration - anchor.rec;
        if (Number.isFinite(starts[k]) && !Number.isFinite(ends[k])) ends[k] = Math.max(starts[k], endRt);
        return scoreRun(take, anchor, starts, ends);
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

  /** cut each line out of the one take and score its sounds (your own parts left out) */
  const scoreRun = async (take: Take, anchor: { rec: number }, starts: number[], ends: number[]) => {
    if (!items) return;
    setPhase("scoring");
    setScored(0);
    const out: LineResult[] = items.map(() => ({ score: null, clip: null }));
    const client = startScoring();
    for (let j = 0; j < items.length; j++) {
      if (!Number.isFinite(starts[j]) || !Number.isFinite(ends[j])) continue;
      const a = Math.max(0, anchor.rec + starts[j] - 0.3 - take.offset);
      const b = Math.min(take.duration, anchor.rec + ends[j] + 0.1 - take.offset);
      if (b - a < 0.3) continue;
      const voiced = take.pitch.filter((f) => f.t >= a && f.t <= b && f.f0 !== null).length;
      const sr = take.sampleRate;
      const raw = take.pcm.subarray(Math.round(a * sr), Math.round(b * sr));
      out[j].clip = { pcm: raw, sampleRate: sr };
      if (voiced < 8) continue; // nothing said here
      try {
        const r = await client.score(take.pcm16k.subarray(Math.round(a * 16000), Math.round(b * 16000)), items[j].words, { ...items[j].scoring });
        const ins = r.words.map(() => 0);
        for (const x of r.insertions) ins[x.wordIndex]++;
        const kept = r.words.map((w, wi) => ({ score: w.score, sounds: w.phones.length + ins[wi], swap: swaps?.[j].has(wi) ?? false })).filter((w) => !w.swap);
        out[j].score = Math.round(takeScore(kept));
      } catch {
        out[j].score = null;
      }
      if (!alive.current) return;
      setScored(j + 1);
    }
    if (!alive.current) return;
    const got = out.map((x) => x.score).filter((x): x is number => x !== null);
    if (got.length) {
      const avg = got.reduce((s, x) => s + x, 0) / got.length;
      const prev = saveRunBest(script.id, avg);
      sfx(prev && avg > prev.score ? "best" : "score");
      buzz(12);
    }
    startTransition(() => {
      setResults(out);
      setPhase("done");
    });
  };

  // ---------------------------------------------------------------- view
  if (phase === "done" && results) return <RunResult field={field} script={script} results={results} guides={guides} backHref={backHref} onAgain={() => setPhase("ready")} />;

  const line = script.lines[cur];
  const g = guides?.[cur] ?? null;
  const item = items?.[cur] ?? null;
  const next = script.lines[cur + 1];
  const len = line.text.length;
  const fold = busy || phase === "scoring";
  const size = captionSize(len, busy);

  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <TopBar backHref={backHref} index={cur + 1} total={script.lines.length} />
      <main className="flex flex-1 flex-col">
        <section aria-label="通しで言う" className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col justify-center px-4 py-2 md:px-8">
          <div className="mx-auto w-full max-w-[1040px] px-1">
            <p className="pb-2 text-[14px] font-bold opacity-90">
              通しで言う<span className="num ml-2 font-medium">{`${cur + 1}/${script.lines.length}`}</span>
            </p>
            <div style={{ fontSize: size }}>{g ? <RunCaption key={cur} text={line.text} words={g.words} swap={swaps?.[cur] ?? new Set()} clock={clock} /> : <p className="en font-bold leading-[1.14]">{line.text}</p>}</div>
            {item ? <p className="ipa mt-1 text-[15px] leading-snug opacity-90 md:text-[17px]">{lineIpa(item)}</p> : null}
            {busy ? null : (
              <p className="jp mt-2 text-[15px] font-medium leading-snug md:text-[18px]">
                <BreakText text={line.ja.replace(/\n/g, "◆")} />
              </p>
            )}
            {next ? (
              <p className="mt-3 flex items-baseline gap-2 text-[14px] font-medium opacity-70">
                <span className="shrink-0 font-bold">次</span>
                <span className="en line-clamp-1">{next.text}</span>
              </p>
            ) : null}
          </div>

          <div className="monitor relative mx-auto mt-4 flex max-h-[400px] min-h-[180px] w-full max-w-[960px] flex-1 flex-col overflow-hidden rounded-(--radius-monitor) bg-(--monitor) text-(--monitor-ink) [contain:layout_paint] md:mt-6 md:max-h-none md:flex-none">
            <div className="relative min-h-[180px] flex-1 md:h-[280px] md:flex-none">
              {g ? <Guide key={cur} className="absolute inset-0" wave={g.wave} syllables={g.syllables} words={g.words} live={live} overlay={null} progressive={false} focusWord={null} tolSt={2.5} label={`${line.text} のお手本の声の高さの波`} /> : null}
              {phase === "countin" && count > 0 ? (
                <div aria-live="assertive" className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span key={count} className="anim-pop leading-none">
                    <TelopText text={String(count)} className="text-[88px]" />
                    <span className="sr-only">{count}</span>
                  </span>
                </div>
              ) : null}
            </div>
            {phase === "scoring" || phase === "ready" || phase === "error" ? (
              <div className="flex min-h-[44px] items-center border-t border-(--monitor-line) px-4 py-2 text-[13px] font-bold" aria-live="polite">
                {phase === "scoring"
                  ? scorer.ready
                    ? `お手本とくらべています ${scored}/${script.lines.length}`
                    : `採点の準備中 ${Math.round(scorer.progress * 100)}%`
                  : phase === "error"
                    ? <BreakText text={error ?? "うまく始められませんでした。"} />
                    : <span className="jp"><BreakText text="全部の文を、◆止めずに続けて言います。◇黄色の線の所は、◆あなたのことに変えてかまいません。" /></span>}
              </div>
            ) : null}
          </div>
        </section>

        <div className="mx-auto w-full max-w-[560px] px-4 pt-4 [padding-bottom:max(18px,calc(env(safe-area-inset-bottom)+10px))] md:pb-10">
          <div className="flex items-start justify-center gap-5 md:gap-10">
            {fold ? null : (
              <RoundButton icon={<IconSpeaker size={28} />} label="お手本" ariaLabel={modelOn ? "お手本を止める" : "お手本を通しで聞く"} onPress={playModel} playingMs={null} disabled={!guides} />
            )}
            <MicButton
              state={busy ? "recording" : phase === "scoring" ? "thinking" : "idle"}
              level={level}
              onPress={onMic}
              label={phase === "loading" || phase === "starting" ? "準備中" : busy ? "止める" : phase === "scoring" ? "くらべています" : "通しで話す"}
              progress={stopAt}
            />
            {fold ? null : <RoundButton icon={<IconRetry size={26} />} label="1文ずつ" ariaLabel="1文ずつの練習にもどる" onPress={() => router.push(`${backHref}/lines`)} playingMs={null} />}
          </div>
          {now.key === "run-model" ? <p className="mt-2 text-center text-[12px] font-bold">お手本を通しで再生しています</p> : null}
        </div>
      </main>
    </div>
  );
}

/** after the run: every line with its score, your voice and the model's, side by side */
function RunResult({ field, script, results, guides, backHref, onAgain }: { field: FieldClass; script: ScriptRunProps["script"]; results: LineResult[]; guides: GuideTake[] | null; backHref: string; onAgain: () => void }) {
  const now = useNowPlaying();
  const got = results.map((r) => r.score).filter((x): x is number => x !== null);
  const avg = got.length ? got.reduce((s, x) => s + x, 0) / got.length : null;
  const said = results.filter((r) => r.clip).length;
  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pt-8">
        <p className="text-[15px] font-bold">{said === script.lines.length ? "通しで言えました" : `${said}/${script.lines.length}文まで言えました`}</p>
        <h1 className="jp mt-2 text-[30px] font-black leading-tight md:text-[40px]">{script.titleJa}</h1>
        {avg !== null ? (
          <p className="num mt-5 flex items-baseline gap-2 leading-none">
            <span className="text-[14px] font-bold">音の平均</span>
            <TelopText text={String(Math.round(avg))} className="text-[52px]" />
            <span className="text-[16px] font-bold">点</span>
          </p>
        ) : null}
        <p className="jp mt-3 text-[13px] font-medium leading-relaxed opacity-90">
          <BreakText text="黄色の所は、◆あなたのことに変えてよい所なので、◆点に入れていません。" />
        </p>
        <ol className="mt-4 flex flex-col overflow-hidden rounded-[22px] bg-(--paper) text-(--ink)">
          {script.lines.map((l, i) => {
            const r = results[i];
            const mineKey = `run-you-${i}`;
            const modelKey = `run-model-${i}`;
            return (
              <li key={l.id} className="border-b border-[#e6e8f1] px-4 py-3 last:border-b-0">
                <div className="flex items-start gap-3">
                  <p className="en min-w-0 flex-1 text-[16px] font-bold leading-snug">
                    <SwapText text={l.text} swaps={l.swaps} />
                  </p>
                  {r.score !== null ? <BestMark score={r.score} /> : <span className="shrink-0 text-[13px] font-bold opacity-70">{r.clip ? "聞こえませんでした" : "—"}</span>}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={!r.clip}
                    onClick={() => r.clip && void play([playable(r.clip)], { key: mineKey })}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-[#f6f0dc] pl-1 pr-4 text-[14px] font-bold disabled:opacity-40"
                  >
                    <span aria-hidden className="grid size-9 place-items-center rounded-full bg-(--voice-fill) text-(--ink)">
                      <PlayGlyph playing={now.key === mineKey} size={11} />
                    </span>
                    あなた
                  </button>
                  <button
                    type="button"
                    disabled={!guides}
                    onClick={() => guides && void play([guides[i].audio], { key: modelKey })}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-[#eaf6fd] pl-1 pr-4 text-[14px] font-bold disabled:opacity-40"
                  >
                    <span aria-hidden className="grid size-9 place-items-center rounded-full bg-(--guide) text-(--ink)">
                      <PlayGlyph playing={now.key === modelKey} size={11} />
                    </span>
                    お手本
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="sticky bottom-0 mt-auto grid grid-cols-2 gap-3 bg-(--field) pt-6 [padding-bottom:max(18px,calc(env(safe-area-inset-bottom)+10px))]">
          <button type="button" onClick={onAgain} className="press h-14 text-[16px]">
            <IconRetry size={18} />
            もう一度通しで
          </button>
          <Link href={backHref} className="press press-ghost h-14 text-[16px]">
            台本にもどる
          </Link>
        </div>
      </main>
    </div>
  );
}
