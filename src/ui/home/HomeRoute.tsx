"use client";

/**
 * Home: one "now playing" karaoke card for the lesson to do next (its first open line, big, in
 * the Latin face, the sound it trains lit like a caption, a mic to start), today's goal, and the
 * route as a numbered list (done ✓ / now ● / not yet) with one progress bar per unit.
 * Progress is this device's best score per item (localStorage).
 */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { ItemData } from "@/data/schema";
import { IconCheck, IconMic, IconStar } from "../icons";
import { allBest, type Best } from "../practice/progress";
import { fieldFor } from "../practice/fields";
import { alignLetters } from "../practice/letters";
import { fetchItem } from "../practice/content";

export type HomeUnitView = { id: string; titleJa: string; subtitleJa: string; lessons: { id: string; titleJa: string; href: string; items: string[] }[] };

const DAILY_GOAL = 5;

export default function HomeRoute({ units }: { units: HomeUnitView[] }) {
  const [best, setBest] = useState<Record<string, Best> | null>(null);
  useEffect(() => setBest(allBest()), []);

  const done = (id: string) => !!best?.[id];
  const starsOf = (ids: string[]) => (ids.length ? Math.floor(ids.reduce((a, id) => a + (best?.[id]?.stars ?? 0), 0) / ids.length) : 0);
  // the lesson to do next, and its first line not done yet
  let cur = { u: 0, l: 0, i: 0 };
  outer: for (let u = 0; u < units.length; u++)
    for (let l = 0; l < units[u].lessons.length; l++) {
      const items = units[u].lessons[l].items;
      const i = items.findIndex((id) => !done(id));
      if (i >= 0) {
        cur = { u, l, i };
        break outer;
      }
    }
  const unit = units[cur.u];
  const lesson = unit.lessons[cur.l];
  const itemId = lesson.items[cur.i];
  const today = new Date().toDateString();
  const todayCount = best ? Object.values(best).filter((b) => new Date(b.at).toDateString() === today).length : 0;

  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <header className="mx-auto flex h-[60px] w-full max-w-[720px] items-center justify-between px-4 md:h-[72px]">
        <span className="text-[22px] font-black leading-none tracking-tight md:text-[26px]">発音カラオケ</span>
        <span className="flex items-center gap-2 text-[13px] font-bold" aria-label={`今日の目標 ${Math.min(todayCount, DAILY_GOAL)} / ${DAILY_GOAL} 文`}>
          <span>今日</span>
          <span className="flex gap-[3px]" aria-hidden>
            {Array.from({ length: DAILY_GOAL }, (_, k) => (
              <span key={k} className="h-[8px] w-[14px] rounded-full" style={{ background: k < todayCount ? "var(--ink)" : "#d6d9e8" }} />
            ))}
          </span>
        </span>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-6">
        <NowPlaying unitId={unit.id} unitTitle={unit.titleJa} lessonTitle={lesson.titleJa} href={`${lesson.href}?i=${cur.i}`} itemId={itemId} index={cur.i} count={lesson.items.length} stars={best ? starsOf(lesson.items) : 0} />

        <h2 className="mt-8 text-[13px] font-bold text-[color-mix(in_srgb,var(--ink)_70%,transparent)]">ルート</h2>
        <ol className="mt-2 flex flex-col">
          {units.map((u, ui) => {
            const items = u.lessons.flatMap((l) => l.items);
            const n = items.filter(done).length;
            const state = ui < cur.u ? "done" : ui === cur.u ? "now" : "next";
            return (
              <li key={u.id} className="border-b border-[#e3e5ef] last:border-b-0">
                <Link href={u.lessons[ui === cur.u ? cur.l : 0].href} className="flex min-h-[60px] items-center gap-3 py-2" aria-current={state === "now" ? "step" : undefined}>
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-black ${state === "now" ? "anim-glow" : ""}`}
                    style={
                      state === "done"
                        ? { background: "var(--ink)", color: "var(--paper)" }
                        : state === "now"
                          ? { background: unitHex(u.id), color: "#fff", boxShadow: `0 0 0 4px color-mix(in srgb, ${unitHex(u.id)} 30%, transparent)` }
                          : { background: "transparent", color: "var(--ink)", boxShadow: "inset 0 0 0 2px #c9cde0" }
                    }
                  >
                    {state === "done" ? <IconCheck size={16} /> : <span className="num">{ui + 1}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[16px] leading-tight ${state === "now" ? "font-black" : "font-bold"}`}>{u.titleJa}</span>
                    <span className="mt-[6px] block h-[5px] overflow-hidden rounded-full bg-[#e3e5ef]" aria-hidden>
                      <span className="block h-full rounded-full" style={{ width: `${(n / Math.max(1, items.length)) * 100}%`, background: unitHex(u.id) }} />
                    </span>
                  </span>
                  <span className="num shrink-0 text-[12px] font-bold text-[color-mix(in_srgb,var(--ink)_65%,transparent)]">
                    {n}/{items.length}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}

/** the lesson to do next as a karaoke card: the line big, the trained sound lit, a mic to start */
function NowPlaying({ unitId, unitTitle, lessonTitle, href, itemId, index, count, stars }: { unitId: string; unitTitle: string; lessonTitle: string; href: string; itemId: string; index: number; count: number; stars: number }) {
  const [item, setItem] = useState<ItemData | null>(null);
  useEffect(() => {
    let ok = true;
    fetchItem(itemId).then((it) => ok && setItem(it)).catch(() => undefined); // also warms the practice screen
    return () => {
      ok = false;
    };
  }, [itemId]);
  const field = fieldFor(unitId);
  return (
    <section aria-label="次の練習" className={`${field} mt-2 overflow-hidden rounded-[28px] bg-(--field) px-5 pb-5 pt-4 text-(--field-ink)`}>
      <p className="flex items-center justify-between text-[13px] font-bold">
        <span>{unitTitle}</span>
        <span className="num">
          {index + 1} / {count}
        </span>
      </p>
      <p className="mt-1 text-[20px] font-black leading-tight">{lessonTitle}</p>
      <div className="mt-5 min-h-[86px]">{item ? <Line item={item} /> : <span className="en block h-[64px]" aria-hidden />}</div>
      {item ? (
        <p className="jp mt-1 text-[14px] font-bold" style={{ color: "color-mix(in srgb, var(--field-ink) 80%, transparent)" }}>
          {item.ja.replace(/\n/g, "")}
        </p>
      ) : null}
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1" aria-label={`このレッスンの星 ${stars} / 3`}>
          {[0, 1, 2].map((k) => (
            <IconStar key={k} size={22} filled={k < stars} />
          ))}
        </span>
        <Link href={href} className="press h-[56px] gap-3 rounded-full pl-2 pr-6 text-[17px]">
          <span className="grid size-10 place-items-center rounded-full bg-(--voice)">
            <IconMic size={20} />
          </span>
          {index === 0 ? "はじめる" : "続きから"}
        </Link>
      </div>
    </section>
  );
}

/** the line in the Latin face; the letters of the trained sound lit like a karaoke caption */
function Line({ item }: { item: ItemData }) {
  const focus = new Set(item.focus.filter((f) => !f.inPair).map((f) => `${f.word}:${f.phone}`));
  const tokens = item.text.split(/\s+/);
  const size = item.text.length > 18 ? "text-[34px]" : item.text.length > 10 ? "text-[44px]" : "text-[60px]";
  return (
    <p className={`en ${size} font-extrabold leading-[1.1]`}>
      {item.words.map((w, wi) => {
        const tok = tokens[wi] ?? w.text;
        const letters = alignLetters(w.text, w.phones);
        const lit = w.phones.map((ph, k) => (focus.has(`${wi}:${ph.replace(/\d/g, "")}`) ? letters[k] : null)).filter(Boolean) as [number, number][];
        const out: ReactNode[] = [];
        let at = 0;
        lit.sort((a, b) => a[0] - b[0]).forEach(([a, b], k) => {
          if (a > at) out.push(tok.slice(at, a));
          out.push(
            <span key={k} className="telop" style={{ ["--tl-fill" as string]: "var(--wipe)", fontWeight: 800 }}>
              <span className="tl-a" style={{ ["--tl-fill" as string]: "var(--wipe)", ["--telop-stroke" as string]: "0.2em" }}>
                {tok.slice(Math.max(a, at), b)}
              </span>
            </span>,
          );
          at = Math.max(at, b);
        });
        if (at < tok.length) out.push(tok.slice(at));
        return (
          <span key={wi}>
            {out}
            {wi < item.words.length - 1 ? " " : ""}
          </span>
        );
      })}
      {item.pair ? <span className="ml-3 text-[0.55em] font-bold opacity-80">／ {item.pair}</span> : null}
    </p>
  );
}

const HEX: Record<string, string> = { "field-rhythm": "#ff7a2e", "field-teal": "#19c3b5", "field-rl": "#2d5bff", "field-berry": "#c92d70", "field-amber": "#ffb300", "field-th": "#16b06a" };
const unitHex = (id: string) => HEX[fieldFor(id)] ?? "#2d5bff";
