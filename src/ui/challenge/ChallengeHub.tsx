"use client";

/**
 * /challenge — three corners on one page, like the sections of a karaoke song book.
 * First, the three corners as doors, each in its own flat colour with a line from it (the long
 * sentence, the script with your parts in yellow, the first exchange of a scene); then the lists:
 *   長い文   20 sentences in three levels (number, the line, the meaning, your best)
 *   自己紹介 6 scripts
 *   会話     8 scenes (相手 in the model's cyan, あなた in yellow)
 * Once you scroll past the doors, a small index stays at the top. Best scores are this device's.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import BreakText from "@/components/BreakText";
import { BestMark, IconChevron, PageHeader, Stars } from "./common/bits";
import { averageOf, useBest } from "./common/useBest";
import { SwapText, type Swap } from "./Swap";
import RoleChip from "./RoleChip";

export type HubLong = { id: string; titleJa: string; noteJa: string; items: { id: string; text: string; ja: string; ready: boolean }[] };
export type HubScript = { id: string; titleJa: string; situationJa: string; first: { text: string; swaps: Swap[] }; lineIds: string[]; swapCount: number };
export type HubScene = { id: string; titleJa: string; situationJa: string; preview: { role: "partner" | "you"; text: string }[]; turns: number; youIds: string[] };

export type ChallengeHubProps = { long: HubLong[]; scripts: HubScript[]; scenes: HubScene[] };

type CornerId = "long" | "intro" | "dialogue";
/** each corner's flat colour (the practice screens wear berry / blue; the script door a deeper berry) */
const COLOR: Record<CornerId, { bg: string; ink: string }> = {
  long: { bg: "#c92d70", ink: "#ffffff" },
  intro: { bg: "#8f1a4c", ink: "#ffffff" },
  dialogue: { bg: "#2d5bff", ink: "#ffffff" },
};
const TABS: { id: CornerId; label: string }[] = [
  { id: "long", label: "長い文" },
  { id: "intro", label: "自己紹介" },
  { id: "dialogue", label: "会話" },
];

export default function ChallengeHub({ long, scripts, scenes }: ChallengeHubProps) {
  const best = useBest();
  const [active, setActive] = useState<CornerId>("long");
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const doors = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(false);
  const counts = { long: long.reduce((a, l) => a + l.items.length, 0), intro: scripts.length, dialogue: scenes.length };
  const longAll = long.flatMap((l) => l.items);
  // the door shows the next long sentence not said yet (the first one before you have any)
  const nextLong = (best && longAll.find((x) => best[x.id] === undefined)) || longAll[0];
  let n = 0;

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id as CornerId);
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    TABS.forEach((t) => {
      const el = sections.current[t.id];
      if (el) io.observe(el);
    });
    // the index appears once the doors have scrolled away
    const io2 = new IntersectionObserver(([e]) => setPast(!e.isIntersecting && e.boundingClientRect.top < 0));
    if (doors.current) io2.observe(doors.current);
    return () => {
      io.disconnect();
      io2.disconnect();
    };
  }, []);

  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <PageHeader backHref="/home" backLabel="ホームにもどる" title="チャレンジ" />

      {/* the index, once you are past the doors: opaque, at the top */}
      <nav
        aria-label="コーナー"
        aria-hidden={!past}
        className="fixed inset-x-0 top-0 z-20 bg-(--field) px-4 pb-2 pt-[max(8px,env(safe-area-inset-top))] shadow-[0_1px_0_#e3e5ef] transition-transform duration-200"
        style={{ transform: past ? "translateY(0)" : "translateY(-110%)" }}
      >
        <ul className="mx-auto grid max-w-[720px] grid-cols-3 gap-1 rounded-[16px] bg-[#e7e9f2] p-1">
          {TABS.map((t) => (
            <li key={t.id}>
              <a
                href={`#${t.id}`}
                tabIndex={past ? 0 : -1}
                aria-current={active === t.id ? "true" : undefined}
                onClick={() => setActive(t.id)}
                className="flex h-11 items-center justify-center gap-[6px] rounded-[12px] text-[15px] font-bold"
                style={active === t.id ? { background: COLOR[t.id].bg, color: COLOR[t.id].ink } : { color: "var(--ink)" }}
              >
                {t.label}
                <span className="num text-[12px] font-medium opacity-75">{counts[t.id]}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 [padding-bottom:max(32px,calc(env(safe-area-inset-bottom)+20px))]">
        <p className="jp mt-1 text-[15px] font-medium leading-relaxed text-[color-mix(in_srgb,var(--ink)_80%,transparent)]">
          <BreakText text="覚えた音を、◆ひとまとまりの話で使います。" />
        </p>

        {/* ------------------------------------------------ the doors */}
        <div ref={doors} className="mt-4 flex flex-col gap-3">
          <Door id="long" title="長い文" count={`${counts.long}文`} lead="12〜20語を、最後まで同じ調子で。">
            <span className="en line-clamp-3 text-[19px] font-bold leading-[1.3]">{nextLong?.text}</span>
          </Door>
          <Door id="intro" title="自己紹介" count={`${counts.intro}つ`} lead="1文ずつ練習して、通しで話す。">
            <span className="en line-clamp-2 text-[19px] font-bold leading-[1.3]">
              <DoorSwap text={scripts[0]?.first.text ?? ""} swaps={scripts[0]?.first.swaps ?? []} />
            </span>
          </Door>
          <Door id="dialogue" title="会話" count={`${counts.dialogue}場面`} lead="相手のせりふに、あなたが答える。">
            <span className="flex flex-col gap-[6px]">
              {scenes[0]?.preview.map((p, i) => (
                <span key={i} className="flex items-start gap-2">
                  <RoleChip role={p.role} />
                  <span className="en line-clamp-1 min-w-0 flex-1 text-[16px] font-bold leading-[1.4]">{p.text}</span>
                </span>
              ))}
            </span>
          </Door>
        </div>

        {/* ------------------------------------------------ 長い文 */}
        <section
          id="long"
          ref={(el) => {
            sections.current.long = el;
          }}
          aria-labelledby="long-h"
          className="scroll-mt-[72px] pt-10"
        >
          <CornerTitle id="long-h" corner="long" title="長い文" count={`${counts.long}文`} />
          {long.map((lv) => {
            const avg = averageOf(
              lv.items.map((x) => x.id),
              best,
            );
            return (
              <div key={lv.id} className="mt-4">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h3 className="text-[16px] font-bold">
                    {lv.titleJa}
                    <span className="ml-2 text-[13px] font-medium opacity-70">{lv.noteJa}</span>
                  </h3>
                  <span className="num shrink-0 text-[13px] font-medium opacity-75">{avg !== null ? `平均 ${Math.round(avg)}点` : `${lv.items.length}文`}</span>
                </div>
                <ol className="mt-2 overflow-hidden rounded-[20px] bg-(--paper)">
                  {lv.items.map((it) => {
                    n++;
                    return (
                      <li key={it.id} className="border-b border-[#eceef5] last:border-b-0">
                        <Link href={`/challenge/long/${it.id}`} className="flex min-h-[76px] items-center gap-3 px-4 py-3">
                          <span className="num w-6 shrink-0 self-start pt-[3px] text-[13px] font-bold" style={{ color: COLOR.long.bg }}>
                            {String(n).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="en line-clamp-2 text-[17px] font-bold leading-[1.35]">{it.text}</span>
                            <span className="jp mt-1 line-clamp-1 text-[13px] font-medium opacity-70">{it.ja.replace(/\n/g, "")}</span>
                          </span>
                          {it.ready ? <BestMark score={best?.[it.id]} /> : <Soon />}
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </section>

        {/* ------------------------------------------------ 自己紹介 */}
        <section
          id="intro"
          ref={(el) => {
            sections.current.intro = el;
          }}
          aria-labelledby="intro-h"
          className="scroll-mt-[72px] pt-10"
        >
          <CornerTitle id="intro-h" corner="intro" title="自己紹介" count={`${counts.intro}つ`} note="黄色の所は、あなたのことに変えられます。" />
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {scripts.map((s) => {
              const avg = averageOf(s.lineIds, best);
              return (
                <li key={s.id}>
                  <Link href={`/challenge/intro/${s.id}`} className="flex h-full flex-col rounded-[20px] bg-(--paper) px-4 pb-4 pt-3">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[16px] font-bold leading-snug">{s.titleJa}</span>
                      <span className="num shrink-0 text-[13px] font-medium opacity-75">{s.lineIds.length}文</span>
                      <IconChevron />
                    </span>
                    <span className="jp mt-1 text-[13px] font-medium leading-snug opacity-75">{s.situationJa.replace(/\n/g, "")}</span>
                    <span className="en mt-3 block text-[17px] font-bold leading-snug">
                      <SwapText text={s.first.text} swaps={s.first.swaps} />
                    </span>
                    {avg !== null ? (
                      <span className="mt-3 flex items-center justify-end gap-2 text-[13px] font-medium">
                        <Stars score={avg} />
                        <span className="num font-bold">{Math.round(avg)}点</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ------------------------------------------------ 会話 */}
        <section
          id="dialogue"
          ref={(el) => {
            sections.current.dialogue = el;
          }}
          aria-labelledby="dialogue-h"
          className="scroll-mt-[72px] pt-10"
        >
          <CornerTitle id="dialogue-h" corner="dialogue" title="会話" count={`${counts.dialogue}場面`} note="相手は、あなたのお手本と別の声で話します。" />
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {scenes.map((s) => {
              const avg = averageOf(s.youIds, best);
              return (
                <li key={s.id}>
                  <Link href={`/challenge/dialogue/${s.id}`} className="flex h-full flex-col rounded-[20px] bg-(--paper) px-4 pb-4 pt-3">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[16px] font-bold leading-snug">{s.titleJa}</span>
                      <span className="num shrink-0 text-[13px] font-medium opacity-75">{s.turns}せりふ</span>
                      <IconChevron />
                    </span>
                    <span className="jp mt-1 text-[13px] font-medium leading-snug opacity-75">{s.situationJa.replace(/\n/g, "")}</span>
                    <span className="mt-3 flex flex-col gap-2">
                      {s.preview.map((p, i) => (
                        <span key={i} className="flex items-start gap-2">
                          <RoleChip role={p.role} />
                          <span className="en line-clamp-2 min-w-0 flex-1 pt-[1px] text-[15px] font-bold leading-snug">{p.text}</span>
                        </span>
                      ))}
                    </span>
                    {avg !== null ? (
                      <span className="mt-3 flex items-center justify-end gap-2 text-[13px] font-medium">
                        <Stars score={avg} />
                        <span className="num font-bold">{Math.round(avg)}点</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}

/** a corner's door: its flat colour, the name and how many, one line on what you do, a line from it */
function Door({ id, title, count, lead, children }: { id: CornerId; title: string; count: string; lead: string; children: ReactNode }) {
  const c = COLOR[id];
  return (
    <a href={`#${id}`} className="block rounded-[24px] px-5 pb-5 pt-4 active:scale-[0.99]" style={{ background: c.bg, color: c.ink }}>
      <span className="flex items-baseline gap-3">
        <span className="text-[24px] font-black leading-tight">{title}</span>
        <span className="num text-[14px] font-bold opacity-90">{count}</span>
        <span className="ml-auto rotate-90 self-center opacity-90">
          <IconChevron size={20} />
        </span>
      </span>
      <span className="jp mt-1 block text-[14px] font-medium opacity-90">{lead}</span>
      <span className="mt-3 block">{children}</span>
    </a>
  );
}

/** on a coloured door the highlighter is an underline (a yellow band under white type would not read) */
function DoorSwap({ text, swaps }: { text: string; swaps: Swap[] }) {
  const out: ReactNode[] = [];
  let at = 0;
  const rs = swaps
    .map((s) => ({ a: text.indexOf(s.word), b: text.indexOf(s.word) + s.word.length }))
    .filter((r) => r.a >= 0)
    .sort((x, y) => x.a - y.a);
  rs.forEach((r, k) => {
    if (r.a < at) return;
    out.push(text.slice(at, r.a));
    out.push(
      <span key={k} className="underline decoration-(--voice) decoration-[0.14em] underline-offset-[0.2em]">
        {text.slice(r.a, r.b)}
      </span>,
    );
    at = r.b;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

/** a list's heading: the corner's colour as a small key, the name, how many, one note */
function CornerTitle({ id, corner, title, count, note }: { id: string; corner: CornerId; title: string; count: string; note?: string }) {
  return (
    <div className="px-1">
      <h2 id={id} className="flex items-center gap-2 text-[22px] font-black leading-tight">
        <span aria-hidden className="size-3 rounded-[4px]" style={{ background: COLOR[corner].bg }} />
        {title}
        <span className="num text-[14px] font-medium opacity-70">{count}</span>
      </h2>
      {note ? <p className="jp mt-1 text-[13px] font-medium opacity-75">{note}</p> : null}
    </div>
  );
}

function Soon() {
  return <span className="shrink-0 rounded-full bg-[#eef0f6] px-2 py-1 text-[12px] font-bold opacity-80">準備中</span>;
}
