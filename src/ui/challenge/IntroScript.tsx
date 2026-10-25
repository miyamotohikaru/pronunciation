"use client";

/**
 * /challenge/intro/[id] — one self-introduction as a printed script: the lines in order, the parts
 * to make your own under a yellow highlighter with what to put there. Two steps, in order:
 *   ① 1文ずつ — every line on the karaoke practice screen (scored as written)
 *   ② 通しで — the whole script in one go; the highlighted parts can be your own (not scored)
 */
import Link from "next/link";
import BreakText from "@/components/BreakText";
import type { FieldClass } from "../practice/fields";
import { BestMark, PageHeader, flow } from "./common/bits";
import { averageOf, useBest } from "./common/useBest";
import { MARKER, SwapLine, type Swap } from "./Swap";
import { useRunBest } from "./runStore";

export type IntroScriptProps = {
  field: FieldClass;
  script: { id: string; titleJa: string; situationJa: string; noteJa: string; lines: { id: string; text: string; ja: string; ready: boolean; swaps: Swap[] }[] };
};

export default function IntroScript({ field, script }: IntroScriptProps) {
  const best = useBest();
  const run = useRunBest(script.id);
  const ids = script.lines.map((l) => l.id);
  const practised = best ? ids.filter((id) => best[id] !== undefined).length : 0;
  const avg = averageOf(ids, best);
  const ready = script.lines.every((l) => l.ready);
  const sample = script.lines.flatMap((l) => l.swaps)[0]?.word ?? null;
  // ① is the main action until every line has been said once; then ②
  const runFirst = practised === ids.length;
  const base = `/challenge/intro/${script.id}`;

  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <PageHeader backHref="/challenge#intro" backLabel="チャレンジにもどる" title="自己紹介" />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4">
        <h2 className="jp mt-1 text-[28px] font-black leading-tight md:text-[36px]">{script.titleJa}</h2>
        <p className="jp mt-2 text-[15px] font-medium leading-relaxed">
          <BreakText text={flow(script.situationJa)} />
        </p>

        {/* the script, as printed: numbered lines, your parts highlighted */}
        <section aria-label="台本" className="mt-5 rounded-[24px] bg-(--paper) px-4 pb-2 pt-4 text-(--ink)">
          {sample ? (
            <p className="jp flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-[#eceef5] pb-3 text-[14px] font-medium leading-relaxed">
              <span className="en text-[15px] font-bold" style={MARKER}>
                {sample}
              </span>
              <span>
                <BreakText text="ここを、あなたのことに。◇1文ずつはこのまま、◆通しで言うときに変えてみましょう。" />
              </span>
            </p>
          ) : null}
          <ol>
            {script.lines.map((l, i) => (
              <li key={l.id} className="flex gap-3 border-b border-[#eceef5] py-3 last:border-b-0">
                <span aria-hidden className="num mt-[2px] grid size-6 shrink-0 place-items-center rounded-full bg-(--ink) text-[12px] font-bold text-(--paper)">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="en text-[18px] font-bold leading-[1.4]">
                    <SwapLine id={l.id} text={l.text} swaps={l.swaps} ready={l.ready} />
                  </p>
                  <p className="jp mt-1 text-[13px] font-medium leading-snug opacity-75">{l.ja.replace(/\n/g, "")}</p>
                  {l.swaps.length ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {l.swaps.map((s) => (
                        <li key={s.word} className="jp flex items-baseline gap-2 text-[13px] font-medium leading-snug">
                          <span className="en shrink-0 font-bold" style={MARKER}>
                            {s.word}
                          </span>
                          <span className="opacity-80">{s.note}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {l.ready ? <BestMark score={best?.[l.id]} /> : <span className="shrink-0 self-start rounded-full bg-[#eef0f6] px-2 py-1 text-[12px] font-bold">準備中</span>}
              </li>
            ))}
          </ol>
        </section>
        <div className="h-6" aria-hidden />
      </main>

      {/* the two steps; the one to do now is filled */}
      <div className="sticky bottom-0 z-10 bg-(--field) px-4 pt-3 shadow-[0_-1px_0_color-mix(in_srgb,var(--field-ink)_22%,transparent)] [padding-bottom:max(16px,calc(env(safe-area-inset-bottom)+10px))]">
        <div className="mx-auto grid max-w-[720px] grid-cols-2 gap-3">
          <Link href={`${base}/lines`} className={`press ${runFirst ? "press-ghost" : ""} flex h-[60px] flex-col !gap-0 text-[16px] leading-tight`}>
            <span>① 1文ずつ</span>
            <span className="num text-[12px] font-medium opacity-80">{avg !== null ? `${practised}/${ids.length}文 ・ 平均${Math.round(avg)}点` : `${ids.length}文`}</span>
          </Link>
          {ready ? (
            <Link href={`${base}/run`} className={`press ${runFirst ? "" : "press-ghost"} flex h-[60px] flex-col !gap-0 text-[16px] leading-tight`}>
              <span>② 通しで</span>
              <span className="num text-[12px] font-medium opacity-80">{run ? `いちばん ${Math.round(run.score)}点` : "全部を続けて"}</span>
            </Link>
          ) : (
            <span className="press press-ghost flex h-[60px] flex-col !gap-0 text-[16px] leading-tight opacity-60" aria-disabled="true">
              <span>② 通しで</span>
              <span className="text-[12px] font-medium">準備中</span>
            </span>
          )}
        </div>
        {runFirst && run ? null : (
          <p className="jp mx-auto mt-2 max-w-[720px] text-center text-[13px] font-medium opacity-90">{runFirst ? "全部の文を言えました。次は通しで。" : "まずは1文ずつ、そのあと通しで。"}</p>
        )}
      </div>
    </div>
  );
}
