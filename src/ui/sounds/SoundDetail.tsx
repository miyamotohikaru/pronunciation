"use client";

/**
 * /sounds/[id] — one sound: the symbol large with its name and the one thing to do; words that
 * have it (listen only); how to make it (with the mouth for r and l); where Japanese gets in
 * the way; minimal pairs to hear side by side (A, B, or both in turn); and its six sentences on
 * the karaoke practice screen. Listen buttons play your お手本 voice (the practice settings').
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import BreakText from "@/components/BreakText";
import { BestMark, IconAlternate, IconChevron, Marked, PageHeader, PlayGlyph, flow } from "../challenge/common/bits";
import { clipUrl, myVoice, play, useNowPlaying, warmClips } from "../challenge/common/listen";
import { useBest } from "../challenge/common/useBest";
import type { VoiceId } from "../practice/content";
import type { FieldClass } from "../practice/fields";
import { IconMic } from "../icons";
import IpaTip from "./IpaTip";
import SoundMouth from "./SoundMouth";
import type { SoundView } from "./data.server";

export default function SoundDetail({ s, field }: { s: SoundView; field: FieldClass }) {
  const best = useBest();
  const now = useNowPlaying();
  const [voice, setVoice] = useState<VoiceId>("af_heart");
  // the mouth follows the pair word that is playing: 0 = this sound, 1 = the other
  const [mouthPos, setMouthPos] = useState(0);
  useEffect(() => setVoice(myVoice()), []);

  const url = (clip: string) => clipUrl(clip, voice);
  // decode the words on this page while it is idle, so a tap starts at once
  useEffect(() => {
    const clips = [...s.examples.map((e) => e.clip), ...s.pairs.flatMap((p) => [p.aClip, p.bClip])].filter((c): c is string => !!c);
    return warmClips(clips.map((c) => clipUrl(c, voice)));
  }, [s, voice]);

  // in a pair, the word with this page's sound (sheep in sheep / ship on /iː/) is the one listed first
  const playPair = (i: number, which: "a" | "b" | "ab") => {
    const p = s.pairs[i];
    if (!p.aClip || !p.bClip) return;
    const seq = which === "a" ? [p.aClip] : which === "b" ? [p.bClip] : [p.aClip, p.bClip, p.aClip, p.bClip];
    void play(seq.map(url), {
      key: `pair-${i}-${which}`,
      gap: 0.55,
      onPlayhead: (e) => s.mouth && setMouthPos(seq[e.item] === p.bClip ? 1 : 0),
      onEnd: () => setMouthPos(0),
    });
  };

  const said = best ? s.practice.filter((x) => best[x.id] !== undefined).length : 0;
  const ready = s.practice.some((x) => x.ready);
  const first = Math.max(0, s.practice.findIndex((x) => x.ready && best?.[x.id] === undefined));
  const practiceHref = `/sounds/${s.slug}/practice`;
  const mouthWord = useMemo(() => (s.mouth ? (s.mouth === "r" ? ["r", "l"] : ["l", "r"]) : null), [s.mouth]);

  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <PageHeader backHref="/sounds" backLabel="発音記号の一覧にもどる" title="発音記号" />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4">
        {/* the sound itself, as large as it gets; the one thing to do under it */}
        <section aria-labelledby="sound-name" className={`${field} rounded-[26px] bg-(--field) px-5 pb-5 pt-4 text-(--field-ink)`}>
          <p className="flex items-center gap-2 text-[13px] font-bold">
            <span className="rounded-full bg-[color-mix(in_srgb,var(--paper)_18%,transparent)] px-3 py-1">{s.group}</span>
            {s.manner && s.manner !== s.group ? <span className="opacity-90">{s.manner}</span> : null}
          </p>
          <div className="mt-1 flex items-end gap-4">
            <span className="ipa ipa-dict text-[112px] leading-[1.05]" aria-hidden>
              {s.ipa}
            </span>
          </div>
          <h2 id="sound-name" className="text-[19px] font-bold leading-snug">
            {s.name.text}
            {s.name.symbol ? <span className="ipa ipa-dict text-[21px]"> {s.name.symbol}</span> : null}
          </h2>
          <p className="jp mt-2 text-[15px] font-medium leading-relaxed">
            <BreakText text={flow(s.tipJa)} />
          </p>
        </section>

        {/* words that have it: listen only */}
        <Block title="聞いてみる" note="下線の文字が、この音です。">
          <ul className="-mx-1 flex flex-col">
            {s.examples.map((e, i) => {
              const key = `ex-${i}`;
              return (
                <li key={i} className="flex min-h-[56px] items-center gap-3 border-b border-[#eceef5] px-1 last:border-b-0">
                  <button
                    type="button"
                    disabled={!e.clip}
                    onClick={() => e.clip && void play([url(e.clip)], { key })}
                    aria-label={`${e.word} を聞く`}
                    className="flex min-h-12 min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
                  >
                    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: "color-mix(in srgb, var(--guide) 24%, white)", boxShadow: "inset 0 0 0 2px var(--guide)" }}>
                      <PlayGlyph playing={now.key === key} size={13} />
                    </span>
                    <span className="en text-[22px] font-medium leading-none">
                      <Marked word={e.word} marked={e.marked} />
                    </span>
                  </button>
                  <IpaTip ipa={e.ipa} of={e.word} className="ipa-dict text-[18px]" />
                  <span className="w-12 shrink-0 text-right text-[12px] font-medium opacity-60">{e.position}</span>
                </li>
              );
            })}
          </ul>
        </Block>

        {/* how to make it; the mouth for r and l */}
        <Block title="どう言う？">
          <p className="jp text-[15px] font-medium leading-relaxed">
            <BreakText text={flow(s.howJa)} />
          </p>
          {s.mouth && mouthWord ? (
            <figure className="mt-4 rounded-[18px] bg-[#f6f7fb] px-3 pb-3 pt-2">
              <SoundMouth target={s.mouth} pos={mouthPos} className="mx-auto block w-full max-w-[300px]" />
              <figcaption className="jp text-center text-[13px] font-medium leading-snug">
                {(mouthPos > 0.5 ? mouthWord[1] : mouthWord[0]) === "l" ? "l：舌先を歯ぐきに付ける" : "r：舌先はどこにも付けない"}
                <span className="mt-1 block opacity-70">聞きくらべを押すと、舌が動きます。</span>
              </figcaption>
            </figure>
          ) : null}
        </Block>

        <Block title="日本語の耳だと">
          <p className="jp text-[15px] font-medium leading-relaxed">
            <BreakText text={flow(s.trapJa)} />
          </p>
        </Block>

        {s.pairs.length ? (
          <Block title="聞きくらべ" note="1語ずつ、または交互に。">
            <ul className="flex flex-col gap-2">
              {s.pairs.map((p, i) => (
                <li key={i} className="flex items-stretch gap-2">
                  <PairWord word={p.a} ipa={p.aIpa} diff={p.diff[0]} playing={now.key === `pair-${i}-a` || (now.key === `pair-${i}-ab` && now.index % 2 === 0)} disabled={!p.aClip} onPlay={() => playPair(i, "a")} />
                  <PairWord word={p.b} ipa={p.bIpa} diff={p.diff[1]} playing={now.key === `pair-${i}-b` || (now.key === `pair-${i}-ab` && now.index % 2 === 1)} disabled={!p.bClip} onPlay={() => playPair(i, "b")} />
                  <button
                    type="button"
                    onClick={() => playPair(i, "ab")}
                    disabled={!p.aClip || !p.bClip}
                    aria-pressed={now.key === `pair-${i}-ab`}
                    aria-label={`${p.a} と ${p.b} を交互に聞く`}
                    className="grid w-12 shrink-0 place-items-center rounded-[14px] bg-[#eef0f8] disabled:opacity-40"
                    style={now.key === `pair-${i}-ab` ? { background: "var(--ink)", color: "var(--paper)" } : undefined}
                  >
                    <IconAlternate />
                  </button>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {/* the six sentences */}
        <Block title="文で練習" note={said ? `${said}/${s.practice.length}文 言えました` : `${s.practice.length}文`}>
          <ol className="-mx-1 flex flex-col">
            {s.practice.map((x, i) => (
              <li key={x.id} className="border-b border-[#eceef5] last:border-b-0">
                <Link href={`${practiceHref}?i=${i}`} className="flex min-h-[60px] items-center gap-3 px-1 py-2" aria-disabled={!x.ready}>
                  <span className="min-w-0 flex-1">
                    <span className="en block text-[17px] font-bold leading-snug">{x.text}</span>
                    <span className="jp block text-[13px] font-medium opacity-70">{x.ja.replace(/\n/g, "")}</span>
                  </span>
                  {x.ready ? <BestMark score={best?.[x.id]} /> : <span className="shrink-0 rounded-full bg-[#eef0f6] px-2 py-1 text-[12px] font-bold">準備中</span>}
                </Link>
              </li>
            ))}
          </ol>
        </Block>

        {/* the next sound / the one before */}
        <nav aria-label="ほかの音" className="mt-6 grid grid-cols-2 gap-2 pb-6">
          {s.prev ? (
            <Link href={`/sounds/${s.prev.slug}`} className="flex min-h-14 items-center gap-2 rounded-[16px] bg-(--paper) px-4">
              <span aria-hidden className="rotate-180">
                <IconChevron />
              </span>
              <span className="text-[13px] font-medium opacity-70">前の音</span>
              <span className="ipa ipa-dict text-[24px]">{s.prev.ipa}</span>
            </Link>
          ) : (
            <span />
          )}
          {s.next ? (
            <Link href={`/sounds/${s.next.slug}`} className="flex min-h-14 items-center justify-end gap-2 rounded-[16px] bg-(--paper) px-4">
              <span className="ipa ipa-dict text-[24px]">{s.next.ipa}</span>
              <span className="text-[13px] font-medium opacity-70">次の音</span>
              <IconChevron />
            </Link>
          ) : null}
        </nav>
      </main>

      {/* the one main action, in the thumb zone */}
      {ready ? (
        <div className="sticky bottom-0 z-10 bg-(--field) px-4 pt-3 shadow-[0_-1px_0_#e3e5ef] [padding-bottom:max(16px,calc(env(safe-area-inset-bottom)+10px))]">
          <div className="mx-auto max-w-[720px]">
            <Link href={`${practiceHref}?i=${first}`} className={`${field} press h-14 w-full bg-(--field) text-[17px] text-(--field-ink)`}>
              <IconMic size={20} />
              {said === s.practice.length ? "6つの文をもう一度" : said ? "続きの文を言う" : `/${s.ipa}/ の文を言う`}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 rounded-[22px] bg-(--paper) px-4 pb-4 pt-3">
      <h3 className="flex items-baseline justify-between gap-3 text-[16px] font-bold">
        {title}
        {note ? <span className="text-[13px] font-medium opacity-70">{note}</span> : null}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** one word of a pair: the letters that differ are underlined, its sounds under it */
function PairWord({ word, ipa, diff, playing, disabled, onPlay }: { word: string; ipa: string; diff: [number, number]; playing: boolean; disabled: boolean; onPlay: () => void }) {
  const [a, b] = diff;
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={disabled}
      aria-pressed={playing}
      aria-label={`${word} を聞く`}
      className="flex min-h-[60px] min-w-0 flex-1 items-center gap-2 rounded-[14px] bg-(--paper) px-3 py-2 text-left shadow-[inset_0_0_0_1.5px_#dfe2ee] disabled:opacity-40"
      style={playing ? { boxShadow: "inset 0 0 0 2.5px var(--guide)" } : undefined}
    >
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: "color-mix(in srgb, var(--guide) 24%, white)", boxShadow: "inset 0 0 0 2px var(--guide)" }}>
        <PlayGlyph playing={playing} size={11} />
      </span>
      <span className="min-w-0">
        <span className="en block truncate text-[19px] font-medium leading-tight">
          {word.slice(0, a)}
          <span className="font-bold underline decoration-[0.09em] underline-offset-[0.18em]">{word.slice(a, b)}</span>
          {word.slice(b)}
        </span>
        <span className="ipa ipa-dict block text-[14px] leading-tight opacity-75">{ipa}</span>
      </span>
    </button>
  );
}
