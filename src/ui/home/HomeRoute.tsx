"use client";

/**
 * Home: the curriculum as a stack of unit colours (the same colours the lessons wear). Progress
 * comes from this device (best score per item). The unit in progress opens by itself; the others
 * are one tap away. One button continues where you left off.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import TelopText from "../TelopText";
import { IconPlay, IconStar } from "../icons";
import { allBest } from "../practice/progress";
import { fieldFor } from "../practice/fields";

export type HomeUnitView = { id: string; titleJa: string; subtitleJa: string; lessons: { id: string; titleJa: string; href: string; items: string[] }[] };

export default function HomeRoute({ units }: { units: HomeUnitView[] }) {
  const [best, setBest] = useState<Record<string, { score: number; stars: number }> | null>(null);
  useEffect(() => setBest(allBest()), []);

  const starsOf = (ids: string[]) => ids.reduce((a, id) => a + (best?.[id]?.stars ?? 0), 0);
  const doneOf = (ids: string[]) => ids.filter((id) => best?.[id]).length;
  // continue: the first lesson that still has an item without a score
  let cont = { unit: units[0], lesson: units[0].lessons[0] };
  outer: for (const u of units)
    for (const l of u.lessons)
      if (doneOf(l.items) < l.items.length) {
        cont = { unit: u, lesson: l };
        break outer;
      }
  const totalStars = units.reduce((a, u) => a + u.lessons.reduce((b, l) => b + starsOf(l.items), 0), 0);
  const maxStars = units.reduce((a, u) => a + u.lessons.reduce((b, l) => b + l.items.length * 3, 0), 0);

  return (
    <div className="kara field-shell flex min-h-dvh flex-col">
      <header className="mx-auto flex h-[64px] w-full max-w-[720px] items-center justify-between px-4 md:h-[76px]">
        <span className="leading-none">
          <TelopText text="発音カラオケ" className="text-[24px] md:text-[28px]" stroke={0.28} />
          <span className="sr-only">発音カラオケ</span>
        </span>
        <span className="num inline-flex h-10 items-center gap-1 rounded-full border-[3px] border-(--ink) bg-(--paper) px-3 text-[14px] font-black text-(--ink)" aria-label={`集めた星 ${totalStars} / ${maxStars}`}>
          <IconStar size={18} filled />
          {best ? totalStars : "—"}
          <span className="text-[11px] font-extrabold">/ {maxStars}</span>
        </span>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8">
        <h1 className="mt-2 text-[22px] font-black leading-none md:text-[26px]">ルート</h1>
        <ol className="mt-4 flex flex-col gap-4">
          {units.map((u) => {
            const items = u.lessons.flatMap((l) => l.items);
            const open = u.id === cont.unit.id;
            return (
              <li key={u.id}>
                <details open={open} className={`${fieldFor(u.id)} group rounded-[24px] bg-(--field) text-(--field-ink) shadow-[0_6px_0_var(--field-deep)]`}>
                  <summary className="flex min-h-[64px] cursor-pointer list-none items-center gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[20px] font-black leading-tight">{u.titleJa}</span>
                      <span className="mt-[2px] block text-[12px] font-bold leading-snug">{u.subtitleJa.replace(/\n/g, "")}</span>
                    </span>
                    <span className="num shrink-0 text-[13px] font-black">
                      {best ? `${doneOf(items)} / ${items.length}` : `${items.length}`}
                    </span>
                  </summary>
                  <ul className="px-5 pb-3">
                    {u.lessons.map((l) => {
                      const st = starsOf(l.items);
                      const max = l.items.length * 3;
                      return (
                        <li key={l.id} className="border-t-2 border-(--field-deep)">
                          <Link href={l.href} className="flex min-h-[48px] items-center gap-3 py-2">
                            <span className="flex-1 text-[15px] font-bold leading-snug">{l.titleJa}</span>
                            <span className="num flex shrink-0 items-center gap-1 text-[12px] font-black" aria-label={`星 ${st} / ${max}`}>
                              <IconStar size={15} filled={st > 0} />
                              {st}/{max}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </li>
            );
          })}
        </ol>
      </main>

      <div className="sticky bottom-0 bg-(--field) px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-3px_0_var(--field-deep)]">
        <div className="mx-auto max-w-[720px]">
          <Link href={cont.lesson.href} className="press h-[64px] w-full justify-start gap-3 rounded-[20px] px-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border-[3px] border-(--ink) bg-(--voice)">
              <IconPlay size={16} />
            </span>
            <span className="min-w-0 text-left leading-tight">
              <span className="block text-[18px] font-black">{best && Object.keys(best).length ? "続きから" : "はじめる"}</span>
              <span className="block truncate text-[12px] font-bold">
                {cont.unit.titleJa}　{cont.lesson.titleJa}
              </span>
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
