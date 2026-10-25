"use client";

/**
 * Placement result (/check/result): the three weak points with the biggest effect, each in its
 * unit's colour (the colours the route will use), with the evidence from the person's own voice.
 * What they already do well is listed as skipped — the route is shorter because of it.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import TelopText from "../TelopText";
import { IconCheck, IconClose, IconPlay } from "../icons";
import { sfx } from "../sfx";
import type { GrowthPoint } from "../mock";

const FIELD = { rl: "field-rl", rhythm: "field-rhythm", th: "field-th" } as const;

export type PlacementResultProps = {
  sentences: number;
  top: GrowthPoint[];
  skipped: string[];
  route: { units: number; minutesPerDay: number; days: number };
  startHref: string;
  backHref: string;
};

export default function PlacementResult({ sentences, top, skipped, route, startHref, backHref }: PlacementResultProps) {
  return (
    <div className="kara field-shell flex min-h-dvh flex-col">
      <header className="mx-auto flex h-[60px] w-full max-w-[720px] items-center px-2 md:h-[72px]">
        <Link href={backHref} aria-label="ホームにもどる" className="grid size-11 place-items-center rounded-full">
          <IconClose size={26} />
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-6">
        <h1 className="leading-none">
          <span className="block text-[18px] font-black md:text-[22px]">あなたの伸びしろ</span>
          <TelopText text="トップ3" className="mt-2 text-[68px] md:text-[104px]" />
        </h1>
        <p className="jp mt-4 text-[15px] font-bold leading-relaxed md:text-[17px]">
          <BreakText text={`${sentences}つの文から、◆直すと点がいちばん上がる順に選びました。`} />
        </p>

        <ol className="mt-7 flex flex-col gap-5">
          {top.map((g) => (
            <li key={g.rank} className={`${FIELD[g.unit]} rounded-[26px] bg-(--field) px-5 pb-5 pt-4 text-(--field-ink) shadow-[0_6px_0_var(--field-deep)]`}>
              <div className="flex items-start gap-4">
                <TelopText text={String(g.rank)} className="w-[0.7em] shrink-0 text-[58px] leading-none" />
                <div className="min-w-0 flex-1 pt-[6px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 className="text-[24px] font-black leading-tight md:text-[28px]">{g.title}</h2>
                    <span className="num text-[14px] font-black">
                      伸びしろ <span className="text-[20px]">+{g.gain.toFixed(1)}</span>点
                    </span>
                  </div>
                  <p className="jp mt-2 text-[15px] font-bold leading-snug">
                    <BreakText text={g.evidence} />
                  </p>
                </div>
              </div>
              {g.beats ? <Beats beats={g.beats} /> : g.word ? <Compare word={g.word} /> : null}
            </li>
          ))}
        </ol>

        <section className="mt-8" aria-labelledby="skipped-h">
          <h2 id="skipped-h" className="text-[16px] font-black">
            もうできていること
          </h2>
          <p className="jp mt-1 text-[13px] font-bold">ルートから外しました。</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {skipped.map((s) => (
              <li key={s} className="inline-flex h-10 items-center gap-2 rounded-full border-[3px] border-(--ink) bg-(--paper) px-4 text-[14px] font-black text-(--ink)">
                <IconCheck size={16} />
                {s}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <div className="sticky bottom-0 bg-(--field) px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-3px_0_var(--field-deep)]">
        <div className="mx-auto max-w-[720px]">
          <Link href={startHref} className="press h-[60px] w-full text-[18px]">
            このルートで始める
          </Link>
          <p className="jp mt-3 text-center text-[13px] font-bold">
            <BreakText text={`${route.units}つのユニット、◆1日${route.minutesPerDay}分で約${Math.round(route.days / 7)}週間。`} />
          </p>
        </div>
      </div>
    </div>
  );
}

/** ▶ お手本 / ▶ あなた for the word that gave it away. */
function Compare({ word }: { word: string }) {
  const [playing, setPlaying] = useState<"model" | "you" | null>(null);
  const t = useRef(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const play = (who: "model" | "you") => {
    sfx("tap");
    setPlaying(who);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setPlaying(null), 700);
  };
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 pl-[52px]">
      <button
        type="button"
        onClick={() => play("model")}
        aria-pressed={playing === "model"}
        aria-label={`お手本の ${word} を聞く`}
        className="press press-guide h-[48px] rounded-[14px] text-[15px]"
      >
        <IconPlay size={16} />
        お手本
      </button>
      <button
        type="button"
        onClick={() => play("you")}
        aria-pressed={playing === "you"}
        aria-label={`あなたの ${word} を聞く`}
        className="press press-voice h-[48px] rounded-[14px] text-[15px]"
      >
        <IconPlay size={16} />
        あなた
      </button>
    </div>
  );
}

/** Rhythm evidence in a small monitor: syllable lengths, the model's vs. yours. */
function Beats({ beats }: { beats: NonNullable<GrowthPoint["beats"]> }) {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const total = Math.max(sum(beats.model), sum(beats.you));
  const row = (lens: number[], tone: "guide" | "voice") => (
    <div className="flex h-[26px] items-end gap-[3px]">
      {lens.map((d, i) => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: `${(d / total) * 100}%`,
            height: beats.stress[i] && tone === "guide" ? 22 : tone === "voice" ? 14 : 9,
            background: tone === "guide" ? "var(--guide)" : "var(--voice)",
            opacity: tone === "guide" && !beats.stress[i] ? 0.7 : 1,
          }}
        />
      ))}
    </div>
  );
  return (
    <div className="monitor mt-4 ml-[52px] rounded-[18px] bg-(--monitor) px-4 py-3 text-(--monitor-ink)" role="img" aria-label="音節の長さ。お手本は強いところが長く、あなたはどれもほぼ同じ長さです。">
      <div className="grid grid-cols-[52px_1fr] items-end gap-x-3 gap-y-2">
        <span className="text-[12px] font-extrabold leading-[26px] text-(--monitor-muted)">お手本</span>
        {row(beats.model, "guide")}
        <span className="text-[12px] font-extrabold leading-[26px] text-(--monitor-muted)">あなた</span>
        {row(beats.you, "voice")}
      </div>
    </div>
  );
}
