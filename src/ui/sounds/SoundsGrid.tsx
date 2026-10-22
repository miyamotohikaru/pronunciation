"use client";

/**
 * /sounds — the 42 sounds of American English as dictionary symbols, in three groups (母音 /
 * 二重母音 / 子音). Each tile: the symbol large (the face that has every IPA letter), its name in
 * plain Japanese, one word that has it (the letters that spell it underlined), and how many of
 * its six sentences you have said on this device.
 */
import Link from "next/link";
import BreakText from "@/components/BreakText";
import { Marked, PageHeader, IconChevron, softBreaks } from "../challenge/common/bits";
import { useBest } from "../challenge/common/useBest";
import type { SoundGroup } from "./data.server";

export default function SoundsGrid({ groups }: { groups: SoundGroup[] }) {
  const best = useBest();
  const total = groups.reduce((a, g) => a + g.tiles.length, 0);
  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <PageHeader backHref="/home" backLabel="ホームにもどる" title="発音記号" />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 [padding-bottom:max(32px,calc(env(safe-area-inset-bottom)+20px))]">
        <p className="jp mt-1 text-[15px] font-medium leading-relaxed text-[color-mix(in_srgb,var(--ink)_80%,transparent)]">
          <BreakText text={`アメリカ英語の${total}の音です。◇記号を押すと、言い方と練習が出ます。`} />
        </p>
        <Link href="/sounds/symbols" className="mt-4 flex min-h-[56px] items-center gap-3 rounded-[18px] bg-(--paper) px-4 py-3">
          <span aria-hidden className="ipa w-[76px] shrink-0 text-[22px] leading-none">
            /ráɪs/
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">記号の読み方</span>
            <span className="jp block text-[13px] font-medium leading-snug opacity-75">
              英和辞典と同じ書き方です。
            </span>
          </span>
          <IconChevron />
        </Link>

        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`g-${g.id}`} className="mt-8">
            <h2 id={`g-${g.id}`} className="flex items-baseline gap-2 px-1 text-[20px] font-black">
              {g.titleJa}
              <span className="num text-[13px] font-medium opacity-70">{g.tiles.length}</span>
            </h2>
            <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {g.tiles.map((t, i) => {
                const said = best ? t.practiceIds.filter((id) => best[id] !== undefined).length : 0;
                const heading = g.id === "consonant" && (i === 0 || g.tiles[i - 1].manner !== t.manner) ? t.manner : null;
                return (
                  <li key={t.slug} className="contents">
                    {heading ? (
                      <span className="col-span-full mt-3 px-1 text-[13px] font-bold opacity-75 first:mt-0" aria-hidden>
                        {heading}
                      </span>
                    ) : null}
                    <Link
                      href={`/sounds/${t.slug}`}
                      aria-label={`${t.name.text} ${t.name.symbol}。例：${t.example?.word ?? ""}${said ? `。${said}文練習済み` : ""}`}
                      className="flex min-h-[132px] flex-col rounded-[18px] bg-(--paper) px-3 pb-3 pt-2 active:scale-[0.98]"
                    >
                      <span className="ipa block text-[46px] leading-[1.1]">{t.ipa}</span>
                      <span className="jp mt-1 text-[13px] font-medium leading-snug opacity-80">{softBreaks(t.name.text)}</span>
                      <span className="mt-auto flex items-end justify-between gap-1 pt-2">
                        <span className="en text-[15px] font-medium leading-none">{t.example ? <Marked word={t.example.word} marked={t.example.marked} /> : null}</span>
                        <Dots n={said} of={t.practiceIds.length} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}

/** six small dots: the sentences of this sound said at least once */
function Dots({ n, of }: { n: number; of: number }) {
  if (!n) return null;
  return (
    <span className="flex gap-[2px]" aria-hidden>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="size-[5px] rounded-full" style={{ background: "var(--ink)", opacity: i < n ? 1 : 0.18 }} />
      ))}
    </span>
  );
}
