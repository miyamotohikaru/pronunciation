"use client";

/**
 * Sound-by-sound comparison for one word (the detail card).
 * Every flagged sound: what we heard (as a two-sided slider between the two words),
 * the mouth tip for Japanese speakers, ▶ お手本 / ▶ あなた / ⇄ 交互に.
 */
import { useEffect, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import type { WordScore } from "./types";
import { JUDGEMENT_VAR, judge, mark } from "./score";
import { heardLine, heardWord, mouthSound, mouthTip, soundIpa, soundLabel } from "./copy";
import { Chip } from "./result/WordJudgements";
import TelopText from "./TelopText";
import MouthDiagram from "./MouthDiagram";
import { IconClose, IconPlay, IconSpeaker, IconSwap } from "./icons";

export type Voice = "model" | "you";

export type SoundCardProps = {
  word: WordScore;
  /** the item's own tip for a sound of this word (focus.tipJa, ◇/◆ breaks); falls back to a generic tip */
  tipFor?: (phone: string) => string | null;
  onClose: () => void;
  /** play one voice's slice of this sound (the engine picks the slice: sound + its vowel) */
  onPlay: (who: Voice, phone: number) => void;
  onAlternate: (phone: number) => void;
  /** which voice is sounding right now */
  playing: Voice | null;
  alternating: boolean;
};

export default function SoundCard({ word, tipFor, onClose, onPlay, onAlternate, playing, alternating }: SoundCardProps) {
  const flagged = word.phones.map((p, i) => ({ p, i })).filter(({ p }) => mark(p) !== "hit");
  const worst = [...word.phones.map((p, i) => ({ p, i }))].sort((a, b) => a.p.score - b.p.score)[0];
  const [sel, setSel] = useState(flagged[0]?.i ?? worst.i);
  const [ipa, setIpa] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const j = judge(word.score);
  const phone = word.phones[sel];
  const heard = heardLine(phone);
  const other = heardWord(word, phone);
  const own = tipFor?.(phone.phone) ?? null;
  const generic = mouthTip(phone.phone);
  const tip: [string, string] | null = own ? [own, ""] : generic;
  const mouth = mouthSound(phone.phone);
  const ghost = phone.heardAs ? mouthSound(phone.heardAs) : null;
  const label = (ph: string) => (ipa ? soundIpa(ph) : soundLabel(ph));

  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="sound-card-title"
      className="anim-sheet relative max-h-[78dvh] w-full overflow-y-auto rounded-t-[28px] bg-(--paper) px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-5 text-(--ink) shadow-[0_-6px_0_var(--field-deep)] md:max-h-none md:overflow-visible md:rounded-[28px] md:px-7 md:pb-7 md:shadow-[0_6px_0_var(--field-deep)]"
    >
      <div className="flex items-start gap-3">
        <h2 id="sound-card-title" ref={headRef} tabIndex={-1} className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2 outline-none">
          <TelopText text={word.text} fill={JUDGEMENT_VAR[j]} className="text-[44px] leading-none" />
          <Chip j={j} />
          <span className="sr-only">{word.score}点</span>
        </h2>
        <button type="button" onClick={onClose} aria-label="閉じる" className="-mr-2 -mt-1 grid size-11 place-items-center rounded-full">
          <IconClose size={24} />
        </button>
      </div>

      {/* the sounds of the word: tap one to compare it */}
      <div className="mt-4 flex items-center gap-2" role="radiogroup" aria-label="音をえらぶ">
        {word.phones.map((p, i) => {
          const m = mark(p);
          const on = i === sel;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${soundLabel(p.phone)}、${m === "hit" ? "できています" : m === "near" ? "もう少し" : "ずれています"}`}
              onClick={() => setSel(i)}
              className="relative flex h-[50px] min-w-[50px] items-center justify-center gap-1 rounded-[14px] border-[3px] px-3 text-[20px] font-black leading-none"
              style={{
                borderColor: on ? "var(--ink)" : "#d5d9f2",
                background: on ? "#eef1ff" : "var(--paper)",
              }}
            >
              {label(p.phone)}
              <MarkDot m={m} />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setIpa((v) => !v)}
          aria-pressed={ipa}
          className="ml-auto h-11 rounded-full px-3 text-[12px] font-extrabold underline decoration-2 underline-offset-4"
        >
          {ipa ? "ローマ字で" : "発音記号で"}
        </button>
      </div>

      {heard ? (
        <div className="mt-5">
          <p className="jp text-[19px] font-black leading-snug">{heardLine(phone)}</p>
          {other ? (
            <div className="mt-4" aria-label={`どっちに聞こえたか：${other} 寄り`}>
              <p className="text-[12px] font-extrabold leading-none">どっちに聞こえた？</p>
              <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-3" aria-hidden>
                <span className="text-[16px] font-black leading-none">{word.text}</span>
                <div className="relative h-[26px]">
                  <span className="absolute inset-x-0 top-[11px] h-[4px] rounded-full bg-[#d5d9f2]" />
                  <span
                    className="absolute top-1/2 size-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-(--ink) bg-(--voice)"
                    style={{ left: `${Math.min(96, Math.max(4, 100 - phone.score))}%` }}
                  />
                </div>
                <span className="text-[16px] font-black leading-none">{other}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 text-[17px] font-black">{soundLabel(phone.phone)} は、よくできています。</p>
      )}

      {tip ? (
        <div className="mt-5 grid grid-cols-[112px_1fr] items-center gap-4">
          {mouth ? (
            <MouthDiagram sound={mouth} ghost={ghost} labels={false} className="w-[112px] rounded-[14px] bg-[#f6f7ff]" />
          ) : (
            <span aria-hidden className="grid h-[90px] place-items-center rounded-[14px] bg-[#f6f7ff] text-[34px] font-black">
              {label(phone.phone)}
            </span>
          )}
          <ul className="jp flex flex-col gap-2 text-[15px] font-bold leading-snug">
            <li>
              <BreakText text={tip[0]} />
            </li>
            {tip[1] ? (
              <li>
                <BreakText text={tip[1]} />
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onPlay("model", sel)}
          aria-pressed={playing === "model"}
          data-down={playing === "model"}
          className="press press-guide h-[56px] text-[16px]"
        >
          {playing === "model" ? <IconSpeaker size={22} /> : <IconPlay size={20} />}
          お手本
        </button>
        <button
          type="button"
          onClick={() => onPlay("you", sel)}
          aria-pressed={playing === "you"}
          data-down={playing === "you"}
          className="press press-voice h-[56px] text-[16px]"
        >
          {playing === "you" ? <IconSpeaker size={22} /> : <IconPlay size={20} />}
          あなた
        </button>
        <button
          type="button"
          onClick={() => onAlternate(sel)}
          aria-pressed={alternating}
          className="press col-span-2 h-[56px] text-[16px]"
        >
          <IconSwap size={22} />
          {alternating ? "止める" : "交互に聞く"}
        </button>
      </div>
    </section>
  );
}

function MarkDot({ m }: { m: "hit" | "near" | "miss" }) {
  if (m === "hit") return <span aria-hidden className="size-[7px] rounded-full bg-(--ink)" />;
  if (m === "near")
    return (
      <svg aria-hidden viewBox="0 0 20 20" className="size-[11px]">
        <path d="M10 2 L18.5 17 H1.5 Z" fill="var(--j-good)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-[12px]">
      <path d="M4 4 L16 16 M16 4 L4 16" stroke="var(--j-almost)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
