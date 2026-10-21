"use client";

/**
 * The sound card: one word, sound by sound.
 *   - the hero is one Japanese line: what we heard (heard-labels) and, under it, how to fix it
 *   - 「AIにはこう聞こえた」: a read-only meter from the model's sound to what was heard; its ends play
 *     お手本 / あなた; it slides toward お手本 when a retry gets closer
 *   - a big side view: お手本's tongue solid, yours (probably) dashed
 *   - 「もう一度言う」 records just this word and updates the card in place
 * Bottom sheet over a dimmed page on phones (clear of the home bar), a dialog on desktop.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import BreakText from "@/components/BreakText";
import type { WordScore } from "./types";
import { mark } from "./score";
import { diagnosisJa, fixLineJa, heardShort, mouthSound, soundLabel } from "./copy";
import MouthDiagram from "./MouthDiagram";
import { IconClose, IconMic, IconPlay, IconSpeaker, IconSwap } from "./icons";

export type RetryState = { state: "idle" | "recording" | "scoring" | "error"; message?: string };

export type SoundSheetProps = {
  word: WordScore;
  /** the word as written in the sentence */
  token: string;
  /** previous score of this word before the latest retry (for the +N) */
  before: number | null;
  /** what the AI heard on the first try (the meter's far end); kept while you retry */
  heardEnd: string | null;
  tipFor: (phone: string) => string | null;
  onClose: () => void;
  onPlayModel: () => void;
  onPlayMine: () => void;
  onAlternate: () => void;
  playing: "model" | "you" | null;
  alternating: boolean;
  retry: RetryState;
  level?: { current: number };
  /** must call the recorder synchronously (iOS) */
  onRetry: () => void;
};

export default function SoundSheet(p: SoundSheetProps) {
  const { word, token } = p;
  const flagged = word.phones.map((ph, i) => ({ ph, i })).filter(({ ph }) => mark(ph) !== "hit");
  const worst = [...word.phones.map((ph, i) => ({ ph, i }))].sort((a, b) => a.ph.score - b.ph.score)[0];
  const [sel, setSel] = useState(flagged[0]?.i ?? worst.i);
  const phone = word.phones[sel] ?? word.phones[0];
  const spell = phone.letters && phone.letters[1] > phone.letters[0] ? token.slice(phone.letters[0], phone.letters[1]).toLowerCase() : soundLabel(phone.phone);
  const diag = diagnosisJa(phone, spell);
  const fix = fixLineJa(phone.phone, p.tipFor(phone.phone));
  const heard = p.heardEnd ?? heardShort(word, phone);
  const mouth = mouthSound(phone.phone);
  const ghost = phone.heardAs ? (/^(L|ɾ|r)$/.test(phone.heardAs) ? "l" : phone.heardAs === "R" ? "r" : null) : null;
  const ok = mark(phone) === "hit";
  const delta = p.before !== null ? word.score - p.before : null;
  const headRef = useRef<HTMLHeadingElement>(null);
  const ring = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the mic ring follows your level while the word is recorded (transform only)
  useEffect(() => {
    if (p.retry.state !== "recording") return;
    let raf = 0;
    const loop = () => {
      const v = p.level?.current ?? 0;
      if (ring.current) ring.current.style.transform = `scale(${1 + v * 0.18})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [p.retry.state, p.level]);

  // meter: 0 % = お手本's sound … 100 % = what was heard
  const pos = Math.min(94, Math.max(6, 100 - phone.score));

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center md:items-center" role="presentation">
      <button type="button" aria-label="閉じる" tabIndex={-1} onClick={p.onClose} className="anim-fade absolute inset-0 bg-[rgba(12,15,51,0.58)]" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-diag"
        className="anim-sheet relative max-h-[92dvh] w-full max-w-[600px] overflow-y-auto rounded-t-[28px] bg-(--paper) px-5 pt-4 text-(--ink) [padding-bottom:max(24px,calc(env(safe-area-inset-bottom)+18px))] md:rounded-[28px] md:pb-7"
      >
        <div className="flex items-start gap-3">
          <p className="en flex flex-1 flex-wrap items-baseline gap-x-3 text-[42px] font-bold leading-none">
            <Word token={token} word={word} />
            <span className="num rounded-full bg-[#eef0f8] px-3 py-1 text-[14px] font-black">
              {word.score}点
              {delta !== null && delta !== 0 ? (
                <span key={word.score} className="anim-pop ml-2 inline-block rounded-full bg-(--voice) px-2 text-(--ink)">
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              ) : null}
            </span>
          </p>
          <button type="button" onClick={p.onClose} aria-label="閉じる" className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full">
            <IconClose size={24} />
          </button>
        </div>

        {flagged.length > 1 ? (
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="音をえらぶ">
            {flagged.map(({ ph, i }) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={i === sel}
                onClick={() => setSel(i)}
                className="en h-11 min-w-11 rounded-[12px] px-3 text-[18px] font-bold"
                style={{ background: i === sel ? "var(--ink)" : "#eef0f8", color: i === sel ? "var(--paper)" : "var(--ink)" }}
              >
                {ph.letters ? token.slice(ph.letters[0], ph.letters[1]) : soundLabel(ph.phone)}
              </button>
            ))}
          </div>
        ) : null}

        {/* the hero: one line of what we heard, one line of how to fix it */}
        <h2 id="sheet-diag" ref={headRef} tabIndex={-1} className="jp mt-4 text-[21px] font-black leading-snug outline-none">
          {ok ? <BreakText text={`${spell} は、◆お手本に近い音になりました。`} /> : diag ? <BreakText text={diag + "。"} /> : <BreakText text={`${spell} は、◆よくできています。`} />}
        </h2>
        {fix && !ok ? (
          <p className="jp mt-2 text-[16px] font-bold leading-relaxed">
            <BreakText text={fix} />
          </p>
        ) : null}

        {heard ? (
          <div className="mt-5">
            <p className="text-[12px] font-extrabold leading-none">AIにはこう聞こえた</p>
            <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <EndButton onClick={p.onPlayModel} active={p.playing === "model"} label={`お手本の ${token} を聞く`}>
                <span className="en">{token.replace(/[.,!?]/g, "")}</span>
              </EndButton>
              <div className="relative h-[30px]" aria-hidden>
                <span className="absolute inset-x-0 top-[13px] h-[4px] rounded-full bg-[#dfe3f3]" />
                <span className="absolute left-0 top-[4px] h-[22px] w-[4px] rounded-full bg-(--guide)" title="お手本" />
                <span className="absolute inset-0 transition-transform duration-700 ease-out" style={{ transform: `translateX(${pos}%)` }}>
                  <span className="absolute top-1/2 size-[24px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-(--ink) bg-(--voice)" />
                </span>
              </div>
              <EndButton onClick={p.onPlayMine} active={p.playing === "you"} label="あなたの声を聞く">
                <span className="jp">{heard ?? "あなた"}</span>
              </EndButton>
            </div>
          </div>
        ) : null}

        {mouth ? (
          <figure className="mt-5 rounded-[20px] bg-[#f4f5fb] px-3 pb-3 pt-2">
            <MouthDiagram sound={mouth} ghost={ok ? null : ghost} labels className="mx-auto block w-full max-w-[340px]" />
            <figcaption className="mt-1 flex justify-center gap-5 text-[12px] font-bold">
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-[10px] w-[18px] rounded-[4px] bg-[#ff6fae]" />
                お手本の舌
              </span>
              {ghost && !ok ? (
                <span className="flex items-center gap-2">
                  <span aria-hidden className="h-0 w-[18px] border-t-[3px] border-dashed border-(--ink)" />
                  あなたの舌（たぶん）
                </span>
              ) : null}
            </figcaption>
          </figure>
        ) : null}

        {/* say it again, right here */}
        <button
          type="button"
          onClick={p.onRetry}
          disabled={p.retry.state === "scoring"}
          className="press press-voice relative mt-5 h-[64px] w-full text-[19px]"
          aria-live="polite"
        >
          <span ref={ring} aria-hidden className="grid size-9 place-items-center rounded-full bg-(--ink) text-(--voice) will-change-transform">
            <IconMic size={20} />
          </span>
          {p.retry.state === "recording" ? "聞いています…（言い終わると止まります）" : p.retry.state === "scoring" ? "くらべています…" : "もう一度言う"}
        </button>
        {p.retry.state === "error" && p.retry.message ? (
          <p className="jp mt-2 text-center text-[13px] font-bold" role="alert">
            <BreakText text={p.retry.message} />
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-3 gap-2">
          <SmallButton onClick={p.onPlayModel} active={p.playing === "model" && !p.alternating} icon={<IconPlay size={16} />}>
            お手本
          </SmallButton>
          <SmallButton onClick={p.onPlayMine} active={p.playing === "you" && !p.alternating} icon={<IconPlay size={16} />}>
            あなた
          </SmallButton>
          <SmallButton onClick={p.onAlternate} active={p.alternating} icon={<IconSwap size={18} />}>
            {p.alternating ? "止める" : "交互に"}
          </SmallButton>
        </div>
      </section>
    </div>
  );
}

function Word({ token, word }: { token: string; word: WordScore }) {
  const marks = word.phones.filter((ph) => mark(ph) === "miss" && ph.letters && ph.letters[1] > ph.letters[0]).map((ph) => ph.letters!) as [number, number][];
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], k) => {
    if (a > at) out.push(token.slice(at, a));
    out.push(
      <span key={k} className="font-extrabold text-(--miss) underline decoration-(--miss) decoration-wavy decoration-[3px] underline-offset-[7px] [text-decoration-skip-ink:none]">
        {token.slice(Math.max(a, at), b)}
      </span>,
    );
    at = Math.max(at, b);
  });
  if (at < token.length) out.push(token.slice(at));
  return <span>{out}</span>;
}

function EndButton({ children, onClick, active, label }: { children: ReactNode; onClick: () => void; active: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="flex h-11 max-w-[128px] items-center gap-1 rounded-full px-3 text-[15px] font-black"
      style={{ background: active ? "var(--ink)" : "#eef0f8", color: active ? "var(--paper)" : "var(--ink)" }}
    >
      {active ? <IconSpeaker size={16} /> : <IconPlay size={14} />}
      <span className="truncate">{children}</span>
    </button>
  );
}

function SmallButton({ children, onClick, active, icon }: { children: ReactNode; onClick: () => void; active: boolean; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex h-12 items-center justify-center gap-2 rounded-[14px] text-[15px] font-black"
      style={{ background: active ? "var(--ink)" : "#eef0f8", color: active ? "var(--paper)" : "var(--ink)" }}
    >
      {icon}
      {children}
    </button>
  );
}
