"use client";

/**
 * A row of lines on the karaoke practice screen (Practice), one after another, then a short
 * summary. ?i=N starts at line N (kept in the URL, so a reload resumes there). A line whose
 * recording is not built yet gets a 準備中 screen instead of the practice screen.
 * Used by チャレンジ (長い文・自己紹介), 発音記号 (each sound's sentences) and アルファベット.
 */
import { LineById } from "../../marks/Marked";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import BreakText from "@/components/BreakText";
import Practice from "../../practice/Practice";
import type { FieldClass } from "../../practice/fields";
import type { PairRef } from "../../practice/catalog.server";
import TopBar from "../../TopBar";
import TelopText from "../../TelopText";
import { IconNext, IconRetry } from "../../icons";
import { BestMark } from "./bits";
import { useBest } from "./useBest";

export type ChainItem = { id: string; text: string; ja: string; ready: boolean };

export type PracticeChainProps = {
  field: FieldClass;
  /** the set's name, for the summary */
  title: string;
  items: ChainItem[];
  backHref: string;
  /** minimal pairs for these lines' words (the sound card plays both) */
  pairs?: Record<string, PairRef>;
  /** the summary's main way on (next set, the whole script …) */
  next?: { href: string; label: string } | null;
  /** extra line under the summary's title */
  summaryNote?: ReactNode;
  /** start here instead of ?i= */
  start?: number;
  /** each line has its own page ("/challenge/long/{id}"): keep the URL on the line being said */
  itemHref?: string;
};

export default function PracticeChain({ field, title, items, backHref, pairs, next, summaryNote, start, itemHref }: PracticeChainProps) {
  const sp = useSearchParams();
  const first = (() => {
    const raw = sp.get("i");
    const n = start ?? (raw !== null && /^\d+$/.test(raw) ? Number(raw) : 0);
    return Math.min(Math.max(0, n), Math.max(0, items.length - 1));
  })();
  const [index, setIndex] = useState(first);
  const [step, setStep] = useState<"item" | "summary">("item");
  const [combo, setCombo] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});

  // keep the line in the URL so a reload resumes here (?i=, or the line's own page)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (itemHref) {
      if (step !== "item") return;
      url.pathname = itemHref.replace("{id}", items[index].id);
    } else if (step === "item") url.searchParams.set("i", String(index));
    else url.searchParams.delete("i");
    window.history.replaceState(window.history.state, "", url);
  }, [step, index, itemHref, items]);

  const advance = () => {
    if (index + 1 < items.length) setIndex(index + 1);
    else setStep("summary");
  };

  if (step === "summary")
    return (
      <ChainSummary
        field={field}
        title={title}
        items={items}
        scores={scores}
        backHref={backHref}
        next={next ?? null}
        note={summaryNote}
        onAgain={() => {
          setScores({});
          setCombo(0);
          setIndex(0);
          setStep("item");
        }}
      />
    );

  const it = items[index];
  if (!it.ready) return <NotReady key={it.id} field={field} index={index} total={items.length} backHref={backHref} item={it} onNext={advance} />;
  // the next line that has a recording (the practice screen prefetches it while this one plays)
  const upcoming = items.slice(index + 1).find((x) => x.ready)?.id ?? null;
  return (
    <Practice
      key={it.id}
      itemId={it.id}
      nextItemId={upcoming}
      field={field}
      index={index}
      total={items.length}
      combo={combo}
      backHref={backHref}
      pairs={pairs}
      onResult={(id, s) => {
        setScores((m) => ({ ...m, [id]: Math.max(m[id] ?? 0, s) }));
        setCombo((c) => (s >= 75 ? c + 1 : 0));
      }}
      onNext={advance}
    />
  );
}

/** a line whose recording is not built yet: say so, and let the row go on */
export function NotReady({ field, index, total, backHref, item, onNext }: { field: FieldClass; index: number; total: number; backHref: string; item: ChainItem; onNext: () => void }) {
  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <TopBar backHref={backHref} index={index + 1} total={total} />
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pb-[max(18px,calc(env(safe-area-inset-bottom)+10px))]">
        <div className="flex flex-1 flex-col justify-center">
          <p className="en text-[clamp(28px,7.6vw,56px)] font-bold leading-[1.3]">
            <LineById id={item.id} text={item.text} ready={item.ready} />
          </p>
          <p className="jp mt-3 text-[15px] font-medium leading-snug">
            <BreakText text={item.ja.replace(/\n/g, "◆")} />
          </p>
          <p className="jp mt-8 rounded-[18px] bg-(--paper) px-4 py-4 text-[15px] font-bold leading-relaxed text-(--ink)">
            <BreakText text="この文のお手本は、◆いま録音しています。◇できあがったら、◆ここで練習できます。" />
          </p>
        </div>
        <div className="grid gap-3 pt-6">
          <button type="button" onClick={onNext} className="press h-14 w-full text-[17px]">
            {index + 1 < total ? "次の文へ" : "おわりにする"}
            <IconNext size={20} />
          </button>
        </div>
      </main>
    </div>
  );
}

function ChainSummary({
  field,
  title,
  items,
  scores,
  backHref,
  next,
  note,
  onAgain,
}: {
  field: FieldClass;
  title: string;
  items: ChainItem[];
  scores: Record<string, number>;
  backHref: string;
  next: { href: string; label: string } | null;
  note?: ReactNode;
  onAgain: () => void;
}) {
  const best = useBest();
  const router = useRouter();
  const done = items.filter((it) => scores[it.id] !== undefined);
  const avg = done.length ? done.reduce((a, it) => a + scores[it.id], 0) / done.length : null;
  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pt-8">
        <p className="text-[15px] font-bold">おつかれさまでした</p>
        <h1 className="jp mt-2 text-[30px] font-black leading-tight md:text-[40px]">{title}</h1>
        {note ? <div className="jp mt-2 text-[14px] font-medium leading-relaxed">{note}</div> : null}
        {avg !== null ? (
          <p className="num mt-5 flex items-baseline gap-2 leading-none">
            <span className="text-[14px] font-bold">今回の平均</span>
            <TelopText text={String(Math.round(avg))} className="text-[52px]" />
            <span className="text-[16px] font-bold">点</span>
          </p>
        ) : null}
        <ul className="mt-6 flex flex-col overflow-hidden rounded-[22px] bg-(--paper) text-(--ink)">
          {items.map((it) => {
            const s = scores[it.id] ?? best?.[it.id];
            return (
              <li key={it.id} className="flex min-h-[64px] items-center gap-3 border-b border-[#e6e8f1] px-4 py-3 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="en block text-[16px] font-bold leading-snug">
                    <LineById id={it.id} text={it.text} ready={it.ready} />
                  </span>
                  {scores[it.id] === undefined && s !== undefined ? <span className="block text-[13px] font-medium opacity-70">前回までのいちばん</span> : null}
                </span>
                <BestMark score={s} />
              </li>
            );
          })}
        </ul>
        <div className="sticky bottom-0 mt-auto grid gap-3 bg-(--field) pt-6 [padding-bottom:max(18px,calc(env(safe-area-inset-bottom)+10px))]">
          {next ? (
            <Link href={next.href} className="press h-14 w-full text-[17px]">
              {next.label}
              <IconNext size={20} />
            </Link>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={onAgain} className="press press-ghost h-14 text-[16px]">
              <IconRetry size={18} />
              もう一度
            </button>
            <button type="button" onClick={() => router.push(backHref)} className={`press ${next ? "press-ghost" : ""} h-14 text-[16px]`}>
              もどる
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
