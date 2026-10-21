/**
 * Home (/home): today's route as a stack of unit colours (the same colours the lessons wear),
 * a gentle streak, the ネイティブ度 trend in a small monitor, and one button to continue.
 */
import Link from "next/link";
import BreakText from "@/components/BreakText";
import TelopText from "../TelopText";
import { IconCheck, IconFlame, IconPlay, IconStar } from "../icons";
import type { RouteUnit } from "../mock";

const FIELD = { rl: "field-rl", rhythm: "field-rhythm", th: "field-th" } as const;
const DAYS = ["月", "火", "水", "木", "金", "土", "日"];

export type HomeScreenProps = {
  streakDays: number;
  week: boolean[];
  todayIndex: number;
  nativeness: number[];
  route: RouteUnit[];
  skipped: string[];
  continueHref: string;
  continueLabel: { unit: string; lesson: string };
  /** review shortcuts to every mock screen (hidden in a disclosure) */
  screens: { href: string; label: string }[];
};

export default function HomeScreen(p: HomeScreenProps) {
  const last = p.nativeness[p.nativeness.length - 1];
  const first = p.nativeness[0];
  return (
    <div className="kara field-shell flex min-h-dvh flex-col">
      <header className="mx-auto flex h-[64px] w-full max-w-[720px] items-center justify-between px-4 md:h-[76px]">
        <span className="leading-none">
          <TelopText text="発音カラオケ" className="text-[24px] md:text-[28px]" stroke={0.28} />
          <span className="sr-only">発音カラオケ</span>
        </span>
        <span className="inline-flex h-10 items-center gap-1 rounded-full bg-(--paper) px-3 text-[15px] font-black text-(--ink)">
          <IconFlame size={20} className="text-(--j-almost)" />
          {p.streakDays}日
          <span className="sr-only">つづいています</span>
        </span>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8">
        {/* trend + week */}
        <section aria-label="ネイティブ度" className="monitor rounded-(--radius-monitor) bg-(--monitor) px-5 pb-4 pt-4 text-(--monitor-ink) shadow-[0_6px_0_var(--field-deep)]">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] font-extrabold leading-none text-(--monitor-muted)">ネイティブ度</p>
              <p className="num mt-2 text-[44px] font-black leading-none text-(--voice)">{last.toFixed(1)}</p>
              <p className="num mt-2 whitespace-nowrap text-[13px] font-extrabold leading-none">2週間で +{(last - first).toFixed(1)}</p>
            </div>
            <Spark values={p.nativeness} />
          </div>
          <ol className="mt-4 grid grid-cols-7 gap-1 border-t border-(--monitor-line) pt-3" aria-label="今週の練習">
            {DAYS.map((d, i) => (
              <li key={d} className="flex flex-col items-center gap-[6px]">
                <span
                  className="grid size-7 place-items-center rounded-full"
                  style={{
                    background: p.week[i] ? "var(--voice)" : "transparent",
                    boxShadow: p.week[i] ? undefined : `inset 0 0 0 2px ${i === p.todayIndex ? "var(--paper)" : "var(--monitor-raised)"}`,
                    color: "var(--ink)",
                  }}
                  aria-label={`${d}曜日：${p.week[i] ? "練習した" : i === p.todayIndex ? "きょう" : "まだ"}`}
                >
                  {p.week[i] ? <IconCheck size={14} /> : null}
                </span>
                <span className={`text-[11px] font-extrabold leading-none ${i === p.todayIndex ? "text-white" : "text-(--monitor-muted)"}`}>{d}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* the route */}
        <section aria-labelledby="route-h" className="mt-8">
          <h1 id="route-h" className="text-[22px] font-black leading-none md:text-[26px]">
            今日のルート
          </h1>
          <ol className="mt-4 flex flex-col gap-4">
            {p.route.map((u) => (
              <li key={u.unit} className={`${FIELD[u.unit]} rounded-[24px] bg-(--field) px-5 py-4 text-(--field-ink) shadow-[0_6px_0_var(--field-deep)]`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[22px] font-black leading-tight">{u.title}</h2>
                  <span className="shrink-0 text-[13px] font-black">
                    {u.state === "done" ? (
                      <span className="inline-flex items-center gap-1">
                        <IconCheck size={16} />
                        できた
                      </span>
                    ) : u.state === "now" ? (
                      <span className="inline-flex h-7 items-center rounded-full bg-(--paper) px-3 text-(--ink)">いまここ</span>
                    ) : (
                      "次"
                    )}
                  </span>
                </div>
                {u.state !== "next" ? (
                  <ul className="mt-3 flex flex-col">
                    {u.lessons.map((l) => (
                      <li key={l.title} className="flex min-h-[40px] items-center justify-between gap-3 border-t-2 border-(--field-deep) first:border-t-0">
                        <span className={`text-[15px] leading-snug ${l.now ? "font-black" : "font-bold"}`}>{l.title}</span>
                        <Stars n={l.stars} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="jp mt-1 text-[14px] font-bold">{u.lessons.length}つのレッスン</p>
                )}
              </li>
            ))}
          </ol>
          <p className="jp mt-5 text-[13px] font-bold leading-relaxed">
            <BreakText text={`${p.skipped.join("、")}は、◆できているので、とばしました。`} />
          </p>
        </section>

        <details className="mt-10 rounded-[18px] bg-(--paper) px-4 py-3 text-(--ink)">
          <summary className="cursor-pointer text-[14px] font-black">画面の確認用リンク</summary>
          <ul className="mt-3 flex flex-col gap-1">
            {p.screens.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="inline-flex min-h-11 items-center text-[14px] font-bold underline decoration-2 underline-offset-4">
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </main>

      <div className="sticky bottom-0 bg-(--field) px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-3px_0_var(--field-deep)]">
        <div className="mx-auto max-w-[720px]">
          <Link href={p.continueHref} className="press h-[64px] w-full justify-between rounded-[20px] px-5">
            <span className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-(--voice) text-(--ink)">
                <IconPlay size={18} />
              </span>
              <span className="text-left leading-tight">
                <span className="block text-[18px] font-black">続きから</span>
                <span className="block text-[12px] font-bold">
                  {p.continueLabel.unit}　{p.continueLabel.lesson}
                </span>
              </span>
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="flex shrink-0 items-center gap-[2px]" aria-label={`星 ${n} / 3`}>
      {[0, 1, 2].map((i) => (
        <IconStar key={i} size={18} filled={i < n} />
      ))}
    </span>
  );
}

/** Small trend line in the voice colour (it is your voice's progress). */
function Spark({ values }: { values: number[] }) {
  const w = 132;
  const h = 52;
  const lo = Math.min(...values) - 2;
  const hi = Math.max(...values) + 2;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 8) + 4, h - 4 - ((v - lo) / (hi - lo)) * (h - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden className="h-[52px] w-[132px] shrink-0 md:h-[72px] md:w-[300px]" preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--voice)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="4" fill="var(--voice)" />
    </svg>
  );
}
