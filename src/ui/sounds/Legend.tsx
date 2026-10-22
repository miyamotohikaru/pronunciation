"use client";

/**
 * /sounds/symbols — how to read the 53 symbols and marks, the way the front pages of an English–
 * Japanese dictionary explain them: the symbol, its name, how to say it, two words that have it
 * (they play when they were recorded for the sound pages), and its own sound page when it is one
 * of the 42.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import BreakText from "@/components/BreakText";
import { IconChevron, PageHeader, PlayGlyph, flow } from "../challenge/common/bits";
import { clipUrl, myVoice, play, useNowPlaying } from "../challenge/common/listen";
import type { VoiceId } from "../practice/content";
import type { LegendGroup } from "./data.server";

export default function Legend({ groups, styleJa }: { groups: LegendGroup[]; styleJa: string }) {
  const now = useNowPlaying();
  const [voice, setVoice] = useState<VoiceId>("af_heart");
  useEffect(() => setVoice(myVoice()), []);
  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <PageHeader backHref="/sounds" backLabel="発音記号の一覧にもどる" title="記号の読み方" />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 [padding-bottom:max(32px,calc(env(safe-area-inset-bottom)+20px))]">
        <p className="jp mt-1 text-[15px] font-medium leading-relaxed text-[color-mix(in_srgb,var(--ink)_80%,transparent)]">
          <BreakText text={flow(styleJa)} />
        </p>
        {groups.map((g) => (
          <section key={g.kind} aria-labelledby={`k-${g.kind}`} className="mt-7">
            <h2 id={`k-${g.kind}`} className="flex items-baseline gap-2 px-1 text-[20px] font-black">
              {g.titleJa}
              <span className="num text-[13px] font-medium opacity-70">{g.symbols.length}</span>
            </h2>
            <ul className="mt-3 overflow-hidden rounded-[22px] bg-(--paper)">
              {g.symbols.map((s) => (
                <li key={s.symbol} id={`sym-${encodeURIComponent(s.symbol)}`} className="flex gap-3 border-b border-[#eceef5] px-4 py-3 last:border-b-0">
                  <span aria-hidden className="ipa ipa-dict w-[64px] shrink-0 pt-[2px] text-[34px] leading-[1.05]">
                    {s.symbol}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[16px] font-bold leading-snug">
                      <span className="sr-only">{s.symbol}、</span>
                      {s.nameJa}
                    </p>
                    <p className="jp mt-1 text-[14px] font-medium leading-relaxed opacity-90">
                      <BreakText text={flow(s.howJa)} />
                    </p>
                    <p className="mt-2 flex flex-wrap gap-2">
                      {s.examples.map((e) => {
                        const key = `lg-${s.symbol}-${e.word}`;
                        return e.clip ? (
                          <button
                            key={e.word}
                            type="button"
                            onClick={() => void play([clipUrl(e.clip!, voice)], { key })}
                            aria-label={`${e.word} を聞く`}
                            className="inline-flex h-11 items-center gap-2 rounded-full pl-1 pr-3"
                            style={{ background: "color-mix(in srgb, var(--guide) 16%, white)", boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--guide) 70%, white)" }}
                          >
                            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-(--paper)">
                              <PlayGlyph playing={now.key === key} size={11} />
                            </span>
                            <span className="en text-[16px] font-medium">{e.word}</span>
                            <span className="ipa ipa-dict text-[14px] opacity-75">{e.ipa}</span>
                          </button>
                        ) : (
                          <span key={e.word} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#f1f2f8] px-3">
                            <span className="en text-[16px] font-medium">{e.word}</span>
                            <span className="ipa ipa-dict text-[14px] opacity-75">{e.ipa}</span>
                          </span>
                        );
                      })}
                    </p>
                    {s.sound ? (
                      <Link href={`/sounds/${s.sound}`} className="mt-1 inline-flex min-h-11 items-center gap-1 text-[14px] font-bold">
                        この音のページ
                        <IconChevron size={16} />
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
