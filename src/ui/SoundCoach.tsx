"use client";

/**
 * One sound, coached, with one live tool: the mouth section and the slider are a single thing.
 * The slider runs from お手本's sound (left) to what the AI heard (right); its two ends are the
 * play buttons, written the same way (word, /IPA/, what it is). Dragging the handle blends the
 * two recordings (equal-power crossfade) and the filled tongue follows it like a spring; where
 * r turns into l the tip lands on the ridge (a light tick). Your own place is a pin that does not
 * move (AI の推定; tap it to hear yourself). One main action: 「rice だけ言う」.
 * Sounds are written one way: dictionary-style IPA with a short Japanese name.
 * Dragging updates the SVG, the gains and the spring directly (no React state per move).
 */
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import BreakText from "@/components/BreakText";
import type { WordScore } from "./types";
import { mark } from "./score";
import { fixFor, mouthSound } from "./copy";
import { chipIpa, heardWordIpa, soundNameJa, wordIpa } from "./ipa";
import MouthSection, { tongueD, touches } from "./MouthSection";
import { marked } from "./result/wavy";
import { Crossfader, type Clip } from "./practice/crossfade";
import { buzz } from "./sfx";
import { IconMic, IconPlay, IconSpeaker } from "./icons";
import type { RetryState } from "./SoundSheet";

/** the slider's ends, made only when pressed: お手本 ↔ what it was heard as (else your own take) */
export type CoachClips = { model: () => Clip | null; other: () => Clip | null; mine: () => Clip | null };

export type SoundCoachProps = {
  word: WordScore;
  token: string;
  /** the word's score before the last「だけ言う」(null: not retried yet) */
  before: number | null;
  /** the far end: the word it sounded like ("lice") or the sound ("日本語のラ行の音") */
  heardEnd: string | null;
  tipFor: (phone: string) => string | null;
  clips: CoachClips;
  /** the left end: お手本's word */
  onPlayModel: () => void;
  /** the right end: what it was heard as */
  onPlayHeard: () => void;
  /** the pin: your own word */
  onPlayMine: () => void;
  playing: "model" | "you" | "heard" | null;
  retry: RetryState;
  level?: { current: number };
  onRetry: () => void;
  /** inline on the result: a little tighter */
  compact?: boolean;
  /** 「だけ言う」 is this state's one main action */
  primary?: boolean;
  /** where 「だけ言う」 lives: in a bar that stays at the bottom of the sheet, or not here at all (the page's own bottom bar has it) */
  retryAt?: "footer" | "none";
};

export default function SoundCoach(p: SoundCoachProps) {
  const { word, token } = p;
  const phones = word.phones.map((ph) => ph.phone);
  const flagged = word.phones.map((ph, i) => ({ ph, i })).filter(({ ph }) => mark(ph) !== "hit");
  const worst = [...word.phones.map((ph, i) => ({ ph, i }))].sort((a, b) => a.ph.score - b.ph.score)[0];
  const [sel, setSel] = useState(flagged[0]?.i ?? worst.i);
  const phone = word.phones[sel] ?? word.phones[0];
  const ok = mark(phone) === "hit";
  const fix = fixFor(phone.phone, p.tipFor(phone.phone))?.replace(/◆/g, "") ?? null;
  const fixLines = fix ? fix.split("◇") : [];
  const target = mouthSound(phone.phone);
  // your place on the slider: 0 = お手本 … 1 = what it was heard as (from the sound's score)
  const mine = ok ? 0.04 : Math.min(0.94, Math.max(0.08, 1 - phone.score / 100));
  const better = p.before !== null && word.score > p.before;
  const ipaModel = `/${wordIpa(phones)}/`;
  // what it was heard as, kept after a good retry (the slider's far end stays the same word)
  const heardNow = phone.heardAs ? `/${heardWordIpa(phones, sel, phone.heardAs)}/` : null;
  const [heardFirst] = useState(heardNow);
  const ipaHeard = heardNow ?? heardFirst;
  const clean = token.replace(/[.,!?]/g, "");

  // ---- the tool (imperative while dragging)
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const body = useRef<SVGPathElement | null>(null);
  const line = useRef<SVGPathElement | null>(null);
  const dot = useRef<SVGCircleElement | null>(null);
  const callout = useRef<SVGGElement | null>(null);
  const fader = useRef<Crossfader | null>(null);
  const pos = useRef(mine);
  const dragging = useRef(false);
  const spring = useRef({ x: mine, v: 0, to: mine, raf: 0, touch: target ? touches(target, mine) : false });
  const ring = useRef<HTMLSpanElement>(null);

  const drawTongue = (x: number) => {
    if (!target) return;
    const d = tongueD(target, x);
    body.current?.setAttribute("d", d.body);
    line.current?.setAttribute("d", d.line);
    const t = touches(target, x);
    const s = spring.current;
    if (t !== s.touch) {
      s.touch = t;
      if (dot.current) dot.current.style.opacity = t ? "1" : "0";
      if (callout.current) callout.current.style.opacity = (target === "r" ? t : !t) ? "1" : "0";
      if (dragging.current) buzz(10); // r ↔ l: the tip lands on (or leaves) the ridge
    }
  };
  // the filled tongue follows the handle like a spring (a little overshoot), only while it moves
  const animate = () => {
    const s = spring.current;
    if (s.raf) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const a = 230 * (s.to - s.x) - 19 * s.v;
      s.v += a * dt;
      s.x += s.v * dt;
      if (Math.abs(s.to - s.x) < 0.0015 && Math.abs(s.v) < 0.003) {
        s.x = s.to;
        s.v = 0;
        drawTongue(s.x);
        s.raf = 0;
        return;
      }
      drawTongue(s.x);
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  };

  const place = (v: number, now = false) => {
    pos.current = v;
    if (thumb.current) thumb.current.style.transform = `translateX(${v * 100}%)`;
    fader.current?.setMix(v);
    const s = spring.current;
    s.to = v;
    if (now || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.x = v;
      s.v = 0;
      drawTongue(v);
    } else animate();
  };
  useEffect(() => place(mine, true), [mine, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      fader.current?.stop();
      cancelAnimationFrame(spring.current.raf);
    },
    [],
  );

  const at = (e: RPointerEvent) => {
    const r = rail.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
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
  const up = () => {
    dragging.current = false;
    fader.current?.stop();
  };
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
      {/* the word, its wrong letters marked, and how it sounds */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="en text-[40px] font-bold leading-none">{marked(token, word)}</span>
        <span className="ipa text-[17px] text-[color-mix(in_srgb,var(--ink)_75%,transparent)]">{ipaModel}</span>
        {better ? (
          <span key={word.score} className="anim-pop rounded-full bg-(--ink) px-3 py-1 text-[13px] font-bold text-(--paper)">
            よくなりました
          </span>
        ) : null}
      </div>

      {flagged.length > 1 ? (
        <div className="mt-4 flex gap-2" role="radiogroup" aria-label="音をえらぶ">
          {flagged.map(({ ph, i }) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === sel}
              onClick={() => setSel(i)}
              className="ipa h-11 min-w-12 rounded-[12px] px-3 text-[17px]"
              style={{ background: i === sel ? "var(--ink)" : "#eef0f8", color: i === sel ? "var(--paper)" : "var(--ink)" }}
            >
              {chipIpa(ph.phone)}
            </button>
          ))}
        </div>
      ) : null}

      {/* what we heard, as sound chips with their Japanese names */}
      <div className="mt-4 flex flex-wrap items-start gap-x-2 gap-y-2 text-[17px] font-bold leading-snug" id="coach-diag">
        {ok ? (
          <>
            <SoundChip phone={phone.phone} />
            <span className="pt-2">は、お手本に近い音になりました。</span>
          </>
        ) : phone.heardAs ? (
          <>
            <SoundChip phone={phone.phone} />
            <span aria-hidden className="pt-2">→</span>
            <SoundChip phone={phone.heardAs} miss />
            <span className="pt-2">に聞こえました</span>
          </>
        ) : phone.inserted ? (
          <>
            <SoundChip phone={phone.phone} />
            <span className="pt-2">のあとに</span>
            <SoundChip phone={phone.inserted} miss />
            <span className="pt-2">が入りました</span>
          </>
        ) : (
          <>
            <SoundChip phone={phone.phone} />
            <span className="pt-2">{phone.issue === "deletion" ? "が聞こえませんでした" : "が少しあいまいでした"}</span>
          </>
        )}
      </div>
      {fixLines.length && !ok ? (
        <ol className="jp mt-3 flex flex-col gap-1 text-[15px] font-medium leading-relaxed">
          {fixLines.map((l, k) => (
            <li key={k} className="flex gap-2">
              {target ? (
                <span aria-hidden className="mt-[3px] grid size-5 shrink-0 place-items-center rounded-full bg-(--ink) text-[12px] font-bold text-(--paper)">
                  {k + 1}
                </span>
              ) : null}
              <BreakText text={l} />
            </li>
          ))}
        </ol>
      ) : null}

      {/* the tool: the mouth and the slider, one thing */}
      {p.heardEnd || target ? (
        <div className="mt-4 rounded-[18px] bg-[#f6f7fb] px-3 pb-3 pt-2">
          {target ? (
            <figure>
              <MouthSection target={target} pos={mine} numbered={!ok} refs={{ body, line, dot, callout }} className={`mx-auto block w-full ${p.compact ? "max-w-[260px]" : "max-w-[300px]"}`} />
              <figcaption className="flex justify-center gap-4 pb-1 text-[13px] font-medium">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="h-3 w-5 rounded-[3px] border-[1.5px] border-dashed border-(--guide-ink) bg-[color-mix(in_srgb,var(--guide)_30%,white)]" />
                  お手本
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="h-3 w-5 rounded-[3px] border-[1.5px] border-(--voice-ink) bg-(--voice-fill)" />
                  あなた（なぞると動きます）
                </span>
              </figcaption>
            </figure>
          ) : null}

          {p.heardEnd ? (
            <div className="mt-2">
              {/* the two ends: the same form, and each one plays */}
              <div className="flex items-stretch justify-between gap-2">
                <EndButton onClick={p.onPlayModel} active={p.playing === "model"} tone="guide" word={clean} ipa={ipaModel} what="お手本" />
                <EndButton onClick={p.onPlayHeard} active={p.playing === "heard"} tone="miss" word={p.heardEnd} ipa={ipaHeard} what="聞こえた音" alignEnd />
              </div>
              <div
                role="slider"
                tabIndex={0}
                aria-label={`${clean} と ${p.heardEnd} の間をなぞると、音と舌の形が切り替わります`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(mine * 100)}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onKeyDown={key}
                className="relative -mx-3 mt-1 cursor-grab touch-none select-none px-6 [overflow-x:clip]"
              >
                <div ref={rail} className="relative h-[60px]">
                  <span aria-hidden className="absolute inset-x-0 top-[38px] h-[6px] -translate-y-1/2 rounded-full" style={{ background: "linear-gradient(to right, var(--guide), #d9dcec 45%, #d9dcec 55%, color-mix(in srgb, var(--miss) 55%, #d9dcec))" }} />
                  {/* your place: a pin that does not move; press its label to hear yourself */}
                  <span className="pointer-events-none absolute inset-0" style={{ transform: `translateX(${mine * 100}%)` }}>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={p.onPlayMine}
                      aria-pressed={p.playing === "you"}
                      aria-label="あなたの声を聞く"
                      className="pointer-events-auto absolute top-0 inline-flex h-7 -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-(--voice-ink) px-[10px] text-[13px] font-bold text-(--paper)"
                    >
                      {p.playing === "you" ? <IconSpeaker size={13} /> : <IconPlay size={10} />}
                      あなた
                    </button>
                    <span className="absolute top-[28px] h-[22px] w-[3px] -translate-x-1/2 rounded-full bg-(--voice-ink)" />
                  </span>
                  {/* the handle you drag */}
                  <span ref={thumb} aria-hidden className="pointer-events-none absolute inset-0 will-change-transform">
                    <span className="absolute top-[38px] size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-(--ink) bg-(--paper) shadow-[0_2px_6px_rgba(12,15,51,0.25)]" />
                  </span>
                </div>
              </div>
              <p className="jp text-center text-[13px] font-medium leading-snug opacity-80">
                <BreakText text={target ? "なぞると、音と舌の形が切り替わります。◇「あなた」の位置は AI の推定です。" : "なぞると、音が切り替わります。◇「あなた」の位置は AI の推定です。"} />
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* the one main action: in a bar that stays at the bottom of the sheet (on the result, the page's bar has it) */}
      {p.retryAt === "none" ? null : (
      <div className="sticky bottom-0 z-[2] -mx-5 mt-3 bg-(--paper) px-5 pt-3 shadow-[0_-1px_0_#e6e8f1] [padding-bottom:max(16px,calc(env(safe-area-inset-bottom)+10px))]">
        <button type="button" onClick={p.onRetry} disabled={p.retry.state === "scoring"} className={`press ${p.primary === false ? "press-line" : "press-ink"} h-14 w-full text-[16px]`}>
          <span ref={ring} aria-hidden className={`grid size-8 place-items-center rounded-full will-change-transform ${p.primary === false ? "bg-(--ink) text-(--paper)" : "bg-(--paper) text-(--ink)"}`}>
            <IconMic size={16} />
          </span>
          {p.retry.state === "recording" ? (
            "聞いています"
          ) : p.retry.state === "scoring" ? (
            "くらべています"
          ) : (
            <span className="en">
              {clean}
              <span className="jp"> だけ言う</span>
            </span>
          )}
        </button>
        {p.retry.state === "error" && p.retry.message ? (
          <p className="jp mt-2 text-center text-[13px] font-medium" role="alert">
            <BreakText text={p.retry.message} />
          </p>
        ) : null}
      </div>
      )}
      {p.retryAt === "none" && p.retry.state === "error" && p.retry.message ? (
        <p className="jp mt-3 text-center text-[13px] font-medium" role="alert">
          <BreakText text={p.retry.message} />
        </p>
      ) : null}
    </div>
  );
}

/** one end of the slider: a play button, both ends written the same way */
function EndButton({ onClick, active, tone, word, ipa, what, alignEnd }: { onClick: () => void; active: boolean; tone: "guide" | "miss"; word: string; ipa: string | null; what: string; alignEnd?: boolean }) {
  const dot = tone === "guide" ? "var(--guide)" : "var(--miss)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${what}：${word} を聞く`}
      className={`flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-[14px] bg-(--paper) px-3 py-2 shadow-[inset_0_0_0_1.5px_#dfe2ee] ${alignEnd ? "flex-row-reverse text-right" : "text-left"}`}
    >
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${dot} 22%, white)`, color: "var(--ink)", boxShadow: `inset 0 0 0 2px ${dot}` }}>
        {active ? <IconSpeaker size={15} /> : <IconPlay size={12} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate leading-tight">
          <span className="en text-[17px] font-bold">{word}</span>
          {ipa ? <span className="ipa ml-1 text-[13px]">{ipa}</span> : null}
        </span>
        <span className="block text-[13px] font-medium leading-tight opacity-70">{what}</span>
      </span>
    </button>
  );
}

/** a sound as a chip — /ð/ — with its short Japanese name underneath */
function SoundChip({ phone, miss }: { phone: string; miss?: boolean }): ReactNode {
  return (
    <span className="inline-flex flex-col items-center">
      <span
        className="ipa inline-flex h-10 min-w-[52px] items-center justify-center rounded-[10px] px-3 text-[19px]"
        style={miss ? { background: "color-mix(in srgb, var(--miss) 10%, white)", color: "var(--miss)", boxShadow: "inset 0 0 0 2px var(--miss)" } : { background: "#eaf7ff", color: "var(--ink)", boxShadow: "inset 0 0 0 2px var(--guide)" }}
      >
        {chipIpa(phone)}
      </span>
      <span className="mt-1 text-[13px] font-medium leading-none opacity-75">{soundNameJa(phone)}</span>
    </span>
  );
}
