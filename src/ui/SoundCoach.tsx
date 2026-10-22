"use client";

/**
 * One sound, coached. The hero is the scrubber: drag from お手本's sound to what the AI heard and
 * the two clips blend (equal-power crossfade) while the yellow tongue in the section moves with
 * it; your own position is a pin. Above it: what we heard as sound chips (/r/ → /l/), and one line
 * of what to do. Below: お手本 / あなた, and 「もう一度言う」 (records just this word).
 * Used inline on the result (the worst sound, opened by itself) and in the sound sheet.
 * Dragging updates the SVG and the gains directly (no React state per move).
 */
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { marked, useFitWaves } from "./result/wavy";
import BreakText from "@/components/BreakText";
import type { WordScore } from "./types";
import { mark } from "./score";
import { fixFor, mouthSound, soundChip, soundLabel } from "./copy";
import MouthSection, { tongueD } from "./MouthSection";
import { Crossfader, type Clip } from "./practice/crossfade";
import { IconMic, IconPlay, IconSpeaker } from "./icons";
import type { RetryState } from "./SoundSheet";

/** the scrubber's ends, made only when pressed: お手本 ↔ what it was heard as (else your own take) */
export type CoachClips = { model: () => Clip | null; other: () => Clip | null; mine: () => Clip | null };

export type SoundCoachProps = {
  word: WordScore;
  token: string;
  before: number | null;
  /** the far end: the word it sounded like ("lice") or the sound ("ラ行") */
  heardEnd: string | null;
  tipFor: (phone: string) => string | null;
  clips: CoachClips;
  onPlayModel: () => void;
  onPlayMine: () => void;
  playing: "model" | "you" | null;
  retry: RetryState;
  level?: { current: number };
  onRetry: () => void;
  /** inline on the result: a little tighter */
  compact?: boolean;
};

export default function SoundCoach(p: SoundCoachProps) {
  const { word, token } = p;
  const flagged = word.phones.map((ph, i) => ({ ph, i })).filter(({ ph }) => mark(ph) !== "hit");
  const worst = [...word.phones.map((ph, i) => ({ ph, i }))].sort((a, b) => a.ph.score - b.ph.score)[0];
  const [sel, setSel] = useState(flagged[0]?.i ?? worst.i);
  const phone = word.phones[sel] ?? word.phones[0];
  const ok = mark(phone) === "hit";
  // the sentences on their own lines; no extra phone-only breaks inside them (the card is wide enough)
  const fix = fixFor(phone.phone, p.tipFor(phone.phone))?.replace(/◆/g, "") ?? null;
  const target = mouthSound(phone.phone);
  // your position on the scrubber: 0 = お手本 … 1 = what it was heard as
  const mine = Math.min(0.95, Math.max(0.05, 1 - phone.score / 100));
  const delta = p.before !== null ? word.score - p.before : null;

  // ---- scrubber (imperative while dragging)
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const yCasing = useRef<SVGPathElement | null>(null);
  const yLine = useRef<SVGPathElement | null>(null);
  const fader = useRef<Crossfader | null>(null);
  const pos = useRef(mine);
  const ring = useRef<HTMLSpanElement>(null);
  const big = useRef<HTMLSpanElement>(null);
  useFitWaves(big, word);

  const place = (v: number) => {
    pos.current = v;
    if (thumb.current) thumb.current.style.transform = `translateX(${v * 100}%)`;
    if (target && yLine.current && yCasing.current) {
      const d = tongueD(target, v);
      yLine.current.setAttribute("d", d);
      yCasing.current.setAttribute("d", d);
    }
    fader.current?.setMix(v);
  };
  useEffect(() => place(mine), [mine]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => fader.current?.stop(), []);

  const at = (e: RPointerEvent) => {
    const r = rail.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = at(e);
    const a = p.clips.model();
    const b = p.clips.other() ?? p.clips.mine();
    if (a && b) {
      fader.current ??= new Crossfader();
      fader.current.start(a, b, v);
    }
    place(v);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) place(at(e));
  };
  const up = () => fader.current?.stop();
  const key = (e: RKeyboardEvent) => {
    const step = e.key === "ArrowLeft" ? -0.1 : e.key === "ArrowRight" ? 0.1 : 0;
    if (!step) return;
    e.preventDefault();
    place(Math.min(1, Math.max(0, pos.current + step)));
  };

  // the mic ring follows your level while the word is recorded
  useEffect(() => {
    if (p.retry.state !== "recording") return;
    let raf = 0;
    const loop = () => {
      if (ring.current) ring.current.style.transform = `scale(${1 + (p.level?.current ?? 0) * 0.18})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [p.retry.state, p.level]);

  return (
    <div className="text-(--ink)">
      <div className="flex items-baseline gap-3">
        <span ref={big} className="en text-[40px] font-bold leading-none">
          <span data-word>{marked(token, word)}</span>
        </span>
        <span className="num rounded-full bg-[#eef0f8] px-3 py-1 text-[14px] font-bold">
          {word.score}
          <span className="text-[11px] opacity-60">/100</span>
          {delta !== null && delta !== 0 ? (
            <span key={word.score} className="anim-pop ml-2 inline-block rounded-full bg-(--ink) px-2 text-(--paper)">
              {delta > 0 ? `+${delta}` : delta}
            </span>
          ) : null}
        </span>
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
              className="en h-11 min-w-11 rounded-[12px] px-3 text-[17px] font-bold"
              style={{ background: i === sel ? "var(--ink)" : "#eef0f8", color: i === sel ? "var(--paper)" : "var(--ink)" }}
            >
              {ph.letters ? token.slice(ph.letters[0], ph.letters[1]) : soundLabel(ph.phone)}
            </button>
          ))}
        </div>
      ) : null}

      {/* what we heard, as sound chips */}
      <p className="mt-4 flex flex-wrap items-center gap-2 text-[18px] font-bold leading-snug" id="coach-diag">
        {ok ? (
          <>
            <SoundChip>{soundChip(phone.phone)}</SoundChip>
            <span>は、お手本に近い音になりました。</span>
          </>
        ) : phone.heardAs ? (
          <>
            <SoundChip>{soundChip(phone.phone)}</SoundChip>
            <span aria-hidden>→</span>
            <SoundChip miss>{soundChip(phone.heardAs)}</SoundChip>
            <span>に聞こえました</span>
          </>
        ) : phone.inserted ? (
          <>
            <SoundChip>{soundChip(phone.phone)}</SoundChip>
            <span>のあとに</span>
            <SoundChip miss>{soundChip(phone.inserted)}</SoundChip>
            <span>が入りました</span>
          </>
        ) : (
          <>
            <SoundChip>{soundChip(phone.phone)}</SoundChip>
            <span>{phone.issue === "deletion" ? "が聞こえませんでした" : "が少しあいまいでした"}</span>
          </>
        )}
      </p>
      {fix && !ok ? (
        <p className="jp mt-2 text-[15px] font-medium leading-relaxed">
          <BreakText text={fix} />
        </p>
      ) : null}

      {/* the hero: お手本 ↔ what it was heard as */}
      {p.heardEnd ? (
        <div className="mt-4">
          <div className="flex items-end justify-between text-[13px] font-bold">
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-3 rounded-full bg-(--guide)" />
              <span className="en text-[16px]">{token}</span>
              <span className="text-[11px] opacity-70">お手本</span>
            </span>
            <span className="en text-[16px]">{p.heardEnd}</span>
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label={`${token} と ${p.heardEnd} の間をなぞると、音と舌の形が切り替わります`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(mine * 100)}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={key}
            className="relative -mx-4 mt-2 cursor-grab touch-none select-none px-4 [overflow-x:clip]"
          >
            <div ref={rail} className="relative h-14">
              <span aria-hidden className="absolute inset-x-0 top-[34px] h-[6px] -translate-y-1/2 rounded-full" style={{ background: "linear-gradient(to right, var(--guide), #d9dcec 50%, #d9dcec)" }} />
              {/* your pin */}
              <span aria-hidden className="absolute inset-0" style={{ transform: `translateX(${mine * 100}%)` }}>
                <span className="absolute top-0 -translate-x-1/2 rounded-full bg-(--voice) px-2 py-[1px] text-[11px] font-bold">あなた</span>
                <span className="absolute top-[22px] h-6 w-[3px] -translate-x-1/2 rounded-full bg-(--ink)" />
              </span>
              {/* the thumb you drag */}
              <span ref={thumb} aria-hidden className="pointer-events-none absolute inset-0 will-change-transform">
                <span className="absolute top-[34px] size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-(--ink) bg-(--paper)" />
              </span>
            </div>
          </div>
          <p className="mt-1 text-center text-[12px] font-medium opacity-70">{target ? "なぞると、音と舌の形が切り替わります" : "なぞると、音が切り替わります"}</p>
        </div>
      ) : null}

      {target ? (
        <figure className={`mt-3 rounded-[18px] bg-[#f6f7fb] px-2 pt-1 ${p.compact ? "pb-1" : "pb-2"}`}>
          <MouthSection target={target} mine={ok ? null : mine} yoursRefs={{ casing: yCasing, line: yLine }} className={`mx-auto block w-full ${p.compact ? "max-w-[300px]" : "max-w-[360px]"}`} />
          <figcaption className="flex justify-center gap-4 pb-1 text-[12px] font-medium">
            <span className="flex items-center gap-2">
              <span aria-hidden className="h-[5px] w-5 rounded-full bg-(--guide)" />
              お手本
            </span>
            {!ok ? (
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-[5px] w-5 rounded-full bg-(--voice)" />
                あなた（AI の推定）
              </span>
            ) : null}
          </figcaption>
        </figure>
      ) : null}

      {/* listen and compare, then say just this word */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={p.onPlayModel} aria-pressed={p.playing === "model"} className="press press-guide h-12 text-[15px]">
          {p.playing === "model" ? <IconSpeaker size={18} /> : <IconPlay size={15} />}
          お手本
        </button>
        <button type="button" onClick={p.onPlayMine} aria-pressed={p.playing === "you"} className="press press-voice h-12 text-[15px]">
          {p.playing === "you" ? <IconSpeaker size={18} /> : <IconPlay size={15} />}
          あなた
        </button>
      </div>
      <div className="mt-2">
        <button type="button" onClick={p.onRetry} disabled={p.retry.state === "scoring"} className="press press-ink h-12 w-full text-[15px]">
          <span ref={ring} aria-hidden className="grid size-7 place-items-center rounded-full bg-(--paper) text-(--ink) will-change-transform">
            <IconMic size={15} />
          </span>
          {p.retry.state === "recording" ? "聞いています" : p.retry.state === "scoring" ? "くらべています" : <span className="en">{token.replace(/[.,!?]/g, "")}<span className="jp"> だけ言う</span></span>}
        </button>
      </div>
      {p.retry.state === "error" && p.retry.message ? (
        <p className="jp mt-2 text-center text-[13px] font-medium" role="alert">
          <BreakText text={p.retry.message} />
        </p>
      ) : null}
    </div>
  );
}

function SoundChip({ children, miss }: { children: ReactNode; miss?: boolean }) {
  return (
    <span
      className="en inline-flex h-9 min-w-[48px] items-center justify-center rounded-[10px] px-3 text-[17px] font-bold"
      style={miss ? { background: "color-mix(in srgb, var(--miss) 12%, white)", color: "var(--miss)", boxShadow: "inset 0 0 0 2px var(--miss)" } : { background: "#eaf7ff", color: "var(--ink)", boxShadow: "inset 0 0 0 2px var(--guide)" }}
    >
      {children}
    </span>
  );
}
