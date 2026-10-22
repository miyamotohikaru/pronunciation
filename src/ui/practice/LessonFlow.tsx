"use client";

/**
 * One lesson: intro (why / how, from the catalog) → every item in order on the practice screen
 * → summary. ?i=N in the URL resumes at item N (the URL is kept in sync without navigation).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import BreakText from "@/components/BreakText";
import TelopText from "../TelopText";
import { IconCheck, IconClose, IconStar } from "../icons";
import Practice from "./Practice";
import { allBest, starsFor } from "./progress";
import type { FieldClass } from "./fields";

export type LessonFlowProps = {
  field: FieldClass;
  unit: { id: string; titleJa: string; subtitleJa: string; whyJa: string; howJa: string };
  lesson: { id: string; titleJa: string; goalJa: string; items: { id: string; type: string; text: string; ja: string; pair?: string }[] };
  next: { href: string; titleJa: string } | null;
  initialIndex: number | null;
  /** minimal pairs for this lesson's words (the sound card's scrubber plays both) */
  pairs?: Record<string, { id: string; other: string; side: "main" | "pair" }>;
};

const br = (s: string) => s.replace(/\n/g, "◇");

export default function LessonFlow({ field, unit, lesson, next, initialIndex, pairs }: LessonFlowProps) {
  const items = lesson.items;
  const [step, setStep] = useState<"intro" | "item" | "summary">(initialIndex === null ? "intro" : "item");
  const [index, setIndex] = useState(Math.min(Math.max(0, initialIndex ?? 0), items.length - 1));
  const [combo, setCombo] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});

  // keep ?i= in the URL so a reload resumes here
  useEffect(() => {
    const url = new URL(window.location.href);
    if (step === "item") url.searchParams.set("i", String(index));
    else url.searchParams.delete("i");
    window.history.replaceState(window.history.state, "", url);
  }, [step, index]);

  if (step === "item") {
    const it = items[index];
    return (
      <Practice
        key={it.id}
        itemId={it.id}
        nextItemId={items[index + 1]?.id ?? null}
        field={field}
        index={index}
        total={items.length}
        combo={combo}
        backHref="/home"
        pairs={pairs}
        onResult={(id, s) => {
          setScores((m) => ({ ...m, [id]: Math.max(m[id] ?? 0, s) }));
          setCombo((c) => (s >= 75 ? c + 1 : 0));
        }}
        onNext={() => {
          if (index + 1 < items.length) setIndex(index + 1);
          else setStep("summary");
        }}
      />
    );
  }

  if (step === "summary") return <Summary field={field} lesson={lesson} scores={scores} next={next} onAgain={() => (setIndex(0), setStep("item"))} />;

  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <header className="mx-auto flex h-[60px] w-full max-w-[720px] items-center px-2 md:h-[72px]">
        <Link href="/home" aria-label="ホームにもどる" className="grid size-11 place-items-center rounded-full">
          <IconClose size={26} />
        </Link>
        <span className="ml-2 text-[14px] font-black">{unit.titleJa}</span>
      </header>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pb-[calc(18px+env(safe-area-inset-bottom))]">
        {/* the heavy rounded face is for the karaoke caption and the score only */}
        <h1 className="jp mt-2 text-[34px] font-black leading-tight md:text-[48px]">{lesson.titleJa}</h1>
        <p className="jp mt-4 text-[17px] font-bold leading-snug md:text-[20px]">
          <BreakText text={br(lesson.goalJa)} />
        </p>

        <section className="mt-6 rounded-[24px] bg-(--paper) px-5 py-5 text-(--ink) shadow-[0_6px_0_var(--field-deep)]">
          <h2 className="text-[14px] font-black">なぜ大事？</h2>
          <p className="jp mt-2 text-[15px] font-medium leading-relaxed">
            <BreakText text={br(unit.whyJa)} />
          </p>
          <h2 className="mt-5 text-[14px] font-black">どう言う？</h2>
          <p className="jp mt-2 text-[15px] font-medium leading-relaxed">
            <BreakText text={br(unit.howJa)} />
          </p>
        </section>

        <ol className="mt-6 flex flex-wrap gap-2" aria-label="このレッスンの練習">
          {items.map((it, i) => (
            <li key={it.id} className="en inline-flex h-9 items-center rounded-full bg-(--paper) px-3 text-[14px] font-bold text-(--ink)">
              <span className="sr-only">{i + 1}. </span>
              {it.text}
            </li>
          ))}
        </ol>

        <div className="mt-auto pt-8">
          <button type="button" onClick={() => setStep("item")} className="press h-[60px] w-full text-[18px]">
            はじめる（{items.length}つ）
          </button>
        </div>
      </main>
    </div>
  );
}

function Summary({
  field,
  lesson,
  scores,
  next,
  onAgain,
}: {
  field: FieldClass;
  lesson: LessonFlowProps["lesson"];
  scores: Record<string, number>;
  next: LessonFlowProps["next"];
  onAgain: () => void;
}) {
  const [best, setBest] = useState<Record<string, number>>({});
  useEffect(() => {
    const all = allBest();
    setBest(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.score])));
  }, []);
  const done = lesson.items.filter((it) => scores[it.id] !== undefined);
  const avg = done.length ? done.reduce((a, it) => a + scores[it.id], 0) / done.length : 0;
  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pb-[calc(18px+env(safe-area-inset-bottom))] pt-8">
        <p className="text-[15px] font-black">レッスンおわり</p>
        <h1 className="jp mt-2 text-[32px] font-black leading-tight md:text-[44px]">{lesson.titleJa}</h1>
        <p className="num mt-5 flex items-baseline gap-2 leading-none">
          <span className="text-[14px] font-black">平均</span>
          <TelopText text={String(Math.round(avg))} className="text-[48px]" />
          <span className="text-[16px] font-black">点</span>
        </p>
        <ul className="mt-6 flex flex-col">
          {lesson.items.map((it) => {
            const s = scores[it.id] ?? best[it.id];
            const stars = s !== undefined ? starsFor(s) : 0;
            return (
              <li key={it.id} className="flex min-h-[52px] items-center gap-3 border-b-2 border-(--field-deep) last:border-b-0">
                <span className="en flex-1 text-[18px] font-bold">{it.text}</span>
                <span className="flex items-center gap-[2px]" aria-label={`星 ${stars} / 3`}>
                  {[0, 1, 2].map((i) => (
                    <IconStar key={i} size={18} filled={i < stars} />
                  ))}
                </span>
                <span className="num w-[72px] text-right text-[15px] font-black">{s !== undefined ? Math.round(s) : "—"}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto grid gap-3 pt-8">
          {next ? (
            <Link href={next.href} className="press h-[60px] w-full text-[18px]">
              <IconCheck size={20} />
              次のレッスン：{next.titleJa}
            </Link>
          ) : null}
          <button type="button" onClick={onAgain} className="press press-ghost h-[56px] w-full text-[16px]">
            もう一度このレッスン
          </button>
          <Link href="/home" className="press press-ghost h-[56px] w-full text-[16px]">
            ホームへ
          </Link>
        </div>
      </main>
    </div>
  );
}
