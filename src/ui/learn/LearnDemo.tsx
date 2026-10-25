"use client";

/**
 * Lesson start (/learn/demo): how the sound is made (side view, r ⇄ l morph),
 * then ear training — two voices, "which one is rice?".
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import TelopText from "../TelopText";
import MouthDiagram from "../MouthDiagram";
import { IconCheck, IconClose, IconPlay, IconSpeaker } from "../icons";
import { sfx } from "../sfx";

export type LessonData = {
  title: string;
  lead: string;
  points: { r: [string, string]; l: [string, string] };
  ear: { target: string; other: string; answers: ("A" | "B")[]; voices: string[] };
};

type Step = "intro" | "ear";

export type LearnDemoProps = {
  lesson: LessonData;
  backHref: string;
  nextHref: string;
  initial?: { step?: Step; answer?: "A" | "B" | null; q?: number };
};

export default function LearnDemo({ lesson, backHref, nextHref, initial = {} }: LearnDemoProps) {
  const [step, setStep] = useState<Step>(initial.step ?? "intro");
  return (
    <div className="kara field-rl flex min-h-dvh flex-col">
      <header className="mx-auto flex h-[60px] w-full max-w-[720px] items-center gap-2 px-2 md:h-[72px]">
        <Link href={backHref} aria-label="レッスンをやめて、ホームにもどる" className="grid size-11 shrink-0 place-items-center rounded-full">
          <IconClose size={26} />
        </Link>
        <ol className="flex flex-1 items-center justify-center gap-[6px] text-[13px] font-extrabold" aria-label="レッスンの流れ">
          {(["しくみ", "聞き分け", "話す"] as const).map((s, i) => {
            const on = (step === "intro" && i === 0) || (step === "ear" && i === 1);
            const done = step === "ear" && i === 0;
            return (
              <li key={s} className="flex items-center gap-2">
                {i ? <span aria-hidden className="h-[3px] w-3 rounded-full bg-(--field-deep)" /> : null}
                <span
                  className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-[10px] leading-none"
                  style={{
                    background: on ? "var(--paper)" : done ? "var(--field-deep)" : "transparent",
                    color: on ? "var(--ink)" : "var(--field-ink)",
                    boxShadow: on || done ? undefined : "inset 0 0 0 2px var(--field-deep)",
                  }}
                  aria-current={on ? "step" : undefined}
                >
                  {done ? <IconCheck size={14} /> : <span className="num">{i + 1}</span>}
                  {s}
                </span>
              </li>
            );
          })}
        </ol>
        <span className="w-11" aria-hidden />
      </header>

      {step === "intro" ? (
        <Intro lesson={lesson} onNext={() => setStep("ear")} />
      ) : (
        <Ear lesson={lesson} nextHref={nextHref} initialAnswer={initial.answer ?? null} initialQ={initial.q ?? 0} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ intro

function Intro({ lesson, onNext }: { lesson: LessonData; onNext: () => void }) {
  const [sound, setSound] = useState<"r" | "l">("r");
  const [playing, setPlaying] = useState<"r" | "l" | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const play = (s: "r" | "l") => {
    sfx("tap");
    setSound(s);
    setPlaying(s);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPlaying(null), 800);
  };
  const tip = lesson.points[sound];
  const word = sound === "r" ? lesson.ear.target : lesson.ear.other;

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2 md:pt-10">
      <h1 className="text-center leading-none">
        <TelopText text={lesson.title} className="text-[56px] md:text-[96px]" />
        <span className="sr-only">{lesson.title}</span>
      </h1>
      <p className="jp mt-3 text-center text-[18px] font-black leading-snug md:text-[22px]">
        <BreakText text={lesson.lead} />
      </p>

      <section aria-label="口の中の様子" className="mt-5 rounded-[28px] bg-(--paper) p-4 text-(--ink) shadow-[0_6px_0_var(--field-deep)] md:p-6">
        <div role="radiogroup" aria-label="音をえらぶ" className="grid grid-cols-2 gap-2 rounded-[18px] bg-[#eef1ff] p-[6px]">
          {(["r", "l"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={sound === s}
              onClick={() => setSound(s)}
              className="h-12 rounded-[14px] text-[20px] font-black leading-none transition-colors"
              style={{
                background: sound === s ? "var(--field)" : "transparent",
                color: sound === s ? "var(--field-ink)" : "var(--ink)",
                boxShadow: sound === s ? "inset 0 0 0 3px var(--ink)" : undefined,
              }}
            >
              {s === "r" ? "r の舌" : "l の舌"}
            </button>
          ))}
        </div>
        <MouthDiagram sound={sound} className="mx-auto mt-3 block w-full max-w-[250px] overflow-hidden rounded-[18px] md:max-w-[360px]" />
        <ul className="jp mt-2 flex flex-col gap-2 text-[17px] font-bold leading-snug md:text-[19px]">
          <li>
            <BreakText text={tip[0]} />
          </li>
          <li>
            <BreakText text={tip[1]} />
          </li>
        </ul>
        <button
          type="button"
          onClick={() => play(sound)}
          aria-pressed={playing === sound}
          className="press press-guide mt-4 h-[56px] w-full text-[17px]"
        >
          {playing ? <IconSpeaker size={22} /> : <IconPlay size={20} />}
          {word} を聞く
        </button>
      </section>

      <div className="mt-auto pt-6">
        <button type="button" onClick={onNext} className="press h-[60px] w-full text-[18px]">
          聞き分けてみる
        </button>
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ ear training (A/B)

function Ear({ lesson, nextHref, initialAnswer, initialQ }: { lesson: LessonData; nextHref: string; initialAnswer: "A" | "B" | null; initialQ: number }) {
  const { target, other, answers, voices } = lesson.ear;
  const [q, setQ] = useState(Math.min(initialQ, answers.length - 1));
  const [heard, setHeard] = useState<{ A: boolean; B: boolean }>({ A: Boolean(initialAnswer), B: Boolean(initialAnswer) });
  const [playing, setPlaying] = useState<"A" | "B" | null>(null);
  const [answer, setAnswer] = useState<"A" | "B" | null>(initialAnswer);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const right = answers[q];
  const correct = answer !== null && answer === right;
  const wordOf = (tile: "A" | "B") => (tile === right ? target : other);

  const play = (tile: "A" | "B") => {
    sfx("tap");
    setPlaying(tile);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setPlaying(null);
      setHeard((h) => ({ ...h, [tile]: true }));
    }, 750);
  };
  const choose = (tile: "A" | "B") => {
    setAnswer(tile);
    sfx(tile === right ? "great" : "tap");
  };
  const next = () => {
    setQ((x) => Math.min(answers.length - 1, x + 1));
    setAnswer(null);
    setHeard({ A: false, B: false });
  };
  const last = q === answers.length - 1;
  const canAnswer = heard.A && heard.B;

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pb-[calc(20px+env(safe-area-inset-bottom))] pt-4 md:pt-10">
      <div className="flex items-center justify-between text-[13px] font-extrabold">
        <span>
          {q + 1} / {answers.length} 問
        </span>
        <span className="inline-flex h-8 items-center rounded-full bg-(--field-deep) px-3">声：{voices[q]}</span>
      </div>

      <h1 className="mt-6 text-center leading-none">
        <TelopText text={target} className="text-[64px] md:text-[88px]" />
        <span className="sr-only">{target}</span>
      </h1>
      <p className="mt-4 text-center text-[20px] font-black leading-none md:text-[24px]">は、どっち？</p>

      <div className="mt-8 grid grid-cols-2 gap-4">
        {(["A", "B"] as const).map((tile) => {
          const reveal = answer !== null;
          const isTarget = tile === right;
          return (
            <button
              key={tile}
              type="button"
              onClick={() => play(tile)}
              aria-label={`${tile} を聞く${reveal ? `（${wordOf(tile)}）` : ""}`}
              aria-pressed={playing === tile}
              className="press relative flex h-[168px] flex-col items-center justify-center gap-3 rounded-[24px] md:h-[200px]"
              style={reveal && isTarget ? { boxShadow: "0 6px 0 var(--field-deep), inset 0 0 0 5px var(--j-great)" } : undefined}
            >
              <span className="text-[44px] font-black leading-none">{tile}</span>
              <span
                className="grid size-12 place-items-center rounded-full"
                style={{ background: playing === tile ? "var(--voice)" : "#eef1ff" }}
              >
                {playing === tile ? <IconSpeaker size={24} /> : <IconPlay size={22} />}
              </span>
              <span className="h-4 text-[13px] font-extrabold leading-none">
                {reveal ? wordOf(tile) : heard[tile] ? "聞いた" : "タップで聞く"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 min-h-[124px]" aria-live="polite">
        {answer === null ? (
          <>
            <p className="jp text-center text-[14px] font-bold leading-snug">
              {canAnswer ? <BreakText text={`${target} だと思うほうを、◆えらんでください。`} /> : <BreakText text="両方聞いてから、◆えらびます。" />}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {(["A", "B"] as const).map((tile) => (
                <button
                  key={tile}
                  type="button"
                  onClick={() => choose(tile)}
                  disabled={!canAnswer}
                  className="press h-[56px] text-[17px] disabled:opacity-50"
                >
                  {tile} が {target}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-[22px] bg-(--paper) px-5 py-4 text-(--ink)">
            <p className="jp text-[19px] font-black leading-snug">
              <BreakText text={correct ? `正解。◇${right} が ${target} でした。` : `${right} が ${target} でした。◇もう一度、◆両方聞きくらべてみよう。`} />
            </p>
            <p className="jp mt-2 text-[14px] font-bold leading-snug">
              <BreakText text={`${target} の r は、◆舌先がどこにも付かない音です。`} />
            </p>
          </div>
        )}
      </div>

      <div className="mt-auto pt-6">
        {answer !== null ? (
          last ? (
            <Link href={nextHref} className="press h-[60px] w-full text-[18px]">
              話してみる
            </Link>
          ) : (
            <button type="button" onClick={next} className="press h-[60px] w-full text-[18px]">
              次の問題
            </button>
          )
        ) : null}
      </div>
    </main>
  );
}
