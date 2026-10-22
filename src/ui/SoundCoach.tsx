"use client";

/**
 * One sound, coached. The heading is the diagnosis (/r/ が /l/ に聞こえました) — no big word above it,
 * no row of sound chips: the card opens on the sound that failed. Then two steps, ① ②. Then the
 * mouth: a professionally drawn mid-sagittal section (Wright & McCloy, CC0) where only the tongue,
 * jaw and lower lip move — the blend of the sound it was heard as and お手本's. Drag the grip with
 * a finger and it springs along the way between them while the two recordings blend; where the
 * contact changes it ticks. お手本 / あなたの録音 / 聞こえた音 play and snap it; while お手本 or your
 * recording plays the tongue moves あなた → お手本 in time with it and お手本's line glows.
 * On the result the card moves between the line's mistakes (chips, swipe; ✓ once fixed).
 * Dragging updates the SVG, the gains and the spring directly (no React state per move).
 */
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import BreakText from "@/components/BreakText";
import type { WordScore } from "./types";
import { mark } from "./score";
import { stepsFor } from "./copy";
import { chipIpa, heardWordIpa, soundNameJa, wordIpa } from "./ipa";
import Sagittal, { gripIndex, sagittalPoints } from "./mouth/Sagittal";
import { closedPath, outline, shapeFor, tipOf } from "./mouth/geometry";
import { Crossfader, type Clip } from "./practice/crossfade";
import { buzz } from "./sfx";
import { IconCheck, IconMic, IconPlay, IconSpeaker } from "./icons";
import type { RetryState } from "./SoundSheet";

/** the tool's sounds, made only when pressed: お手本 ↔ what it was heard as (else your own take) */
export type CoachClips = { model: () => Clip | null; other: () => Clip | null; mine: () => Clip | null };

export type SoundCoachProps = {
  word: WordScore;
  token: string;
  /** the word's IPA from the data (/ráɪs/), if any */
  ipa?: string;
  /** the word's score before the last「だけ言う」(null: not retried yet) */
  before: number | null;
  /** what it sounded like ("lice") or the sound ("日本語のラ行の音") */
  heardEnd: string | null;
  /** a recording of what it was heard as exists */
  heardClip?: boolean;
  tipFor: (phone: string) => string | null;
  clips: CoachClips;
  onPlayModel: () => void;
  onPlayHeard: () => void;
  onPlayMine: () => void;
  playing: "model" | "you" | "heard" | null;
  retry: RetryState;
  level?: { current: number };
  onRetry: () => void;
  compact?: boolean;
  /** 「だけ言う」 is this state's one main action */
  primary?: boolean;
  /** where 「だけ言う」 lives: in a bar at the bottom of the sheet, or not here (the page's bar has it) */
  retryAt?: "footer" | "none";
  /** the line's mistakes, to move between (result) */
  nav?: { items: { label: string; done: boolean }[]; index: number; onPick: (i: number) => void };
};

export default function SoundCoach(p: SoundCoachProps) {
  const { word, token } = p;
  const phones = word.phones.map((ph) => ph.phone);
  const flagged = word.phones.map((ph, i) => ({ ph, i })).filter(({ ph }) => mark(ph) !== "hit");
  const worst = [...word.phones.map((ph, i) => ({ ph, i }))].sort((a, b) => a.ph.score - b.ph.score)[0];
  // open on the sound that failed worst; another failed sound in the word is one tap away
  const [sel, setSel] = useState((flagged.length ? [...flagged].sort((a, b) => a.ph.score - b.ph.score)[0] : worst).i);
  const phone = word.phones[sel] ?? word.phones[0];
  const ok = mark(phone) === "hit";
  const steps = stepsFor(phone.phone, p.tipFor(phone.phone));
  const [heardAsFirst] = useState(phone.heardAs ?? null);
  const heardSym = phone.heardAs ?? heardAsFirst;
  const target = shapeFor(phone.phone);
  const heardShape = shapeFor(heardSym);
  const heard = target && heardShape && heardShape !== target ? heardShape : null;
  // your place: 0 = お手本 … 1 = what it was heard as (from the sound's score; AI の推定)
  const mine = ok ? 0.04 : Math.min(0.94, Math.max(0.08, 1 - phone.score / 100));
  const better = p.before !== null && word.score > p.before;
  const ipaModel = `/${wordIpa(phones, p.ipa)}/`;
  const heardNow = phone.heardAs ? `/${heardWordIpa(phones, sel, phone.heardAs)}/` : null;
  const [heardFirst] = useState(heardNow);
  const ipaHeard = heardNow ?? heardFirst;
  const clean = token.replace(/[.,!?]/g, "");
  const others = flagged.filter(({ i }) => i !== sel);

  // ---- the tool (imperative while dragging / playing)
  const svg = useRef<SVGSVGElement | null>(null);
  const body = useRef<SVGPathElement | null>(null);
  const edge = useRef<SVGPathElement | null>(null);
  const grip = useRef<SVGGElement | null>(null);
  const fader = useRef<Crossfader | null>(null);
  const dragging = useRef(false);
  const gi = gripIndex();
  const ridge = target === "r" || target === "t" || target === "s" || target === "sh" ? tipOf(outline("t")) : null;
  const touching = (x: number) => {
    if (!target || !heard || !ridge) return false;
    const q = sagittalPoints(target, heard, x)[gi];
    return Math.hypot(q[0] - ridge[0], q[1] - ridge[1]) < 2.4;
  };
  const spring = useRef({ x: mine, v: 0, to: mine, raf: 0, touch: touching(mine) });
  const ring = useRef<HTMLSpanElement>(null);
  const tween = useRef(0);

  const drawTongue = (x: number) => {
    if (!target) return;
    const pts = sagittalPoints(target, heard, x);
    const d = closedPath(pts);
    body.current?.setAttribute("d", d);
    edge.current?.setAttribute("d", d);
    grip.current?.setAttribute("transform", `translate(${pts[gi][0].toFixed(2)},${pts[gi][1].toFixed(2)})`);
    const t = touching(x);
    const s = spring.current;
    if (t !== s.touch) {
      s.touch = t;
      if (dragging.current) buzz(10); // the tip lands on (or leaves) the ridge
    }
  };
  // the tongue follows like a spring (a little overshoot), only while it moves
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
    const s = spring.current;
    s.to = Math.min(1, Math.max(0, v));
    fader.current?.setMix(s.to);
    if (now || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.x = s.to;
      s.v = 0;
      drawTongue(s.x);
    } else animate();
  };
  useEffect(() => place(mine, true), [mine, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      fader.current?.stop();
      cancelAnimationFrame(spring.current.raf);
      cancelAnimationFrame(tween.current);
    },
    [],
  );

  // while お手本 or your recording plays: あなた → お手本, in time with the clip; 聞こえた音: to its end
  useEffect(() => {
    cancelAnimationFrame(tween.current);
    if (!target || !heard || !p.playing) return;
    if (p.playing === "heard") return place(1);
    const clip = p.playing === "model" ? p.clips.model() : p.clips.mine();
    const dur = clip ? Math.max(0.25, clip.t1 - clip.t0) * 1000 : 600;
    const t0 = performance.now();
    place(mine, true);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      place(mine * (1 - k * k * (3 - 2 * k)));
      if (k < 1) tween.current = requestAnimationFrame(step);
    };
    tween.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.playing]);

  // drag the grip: the finger's point, projected onto the way between your tongue and お手本's
  const posAt = (e: RPointerEvent) => {
    const el = svg.current;
    if (!el || !target || !heard) return spring.current.to;
    const ctm = el.getScreenCTM();
    if (!ctm) return spring.current.to;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const A = outline(target)[gi];
    const B = outline(heard)[gi];
    const vx = B[0] - A[0];
    const vy = B[1] - A[1];
    const len2 = Math.max(1e-6, vx * vx + vy * vy);
    return ((q.x - A[0]) * vx + (q.y - A[1]) * vy) / len2;
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!target || !heard) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const v = posAt(e);
    const a = p.clips.model();
    const b = p.clips.other() ?? p.clips.mine();
    if (a && b) {
      fader.current ??= new Crossfader();
      fader.current.start(a, b, Math.min(1, Math.max(0, v)));
    }
    place(v);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) place(posAt(e));
  };
  const up = () => {
    if (!dragging.current) return;
    dragging.current = false;
    fader.current?.stop();
    // it settles on the nearest of お手本 / あなたの録音 / 聞こえた音
    const x = spring.current.to;
    const near = [0, mine, 1].reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
    if (Math.abs(near - x) < 0.14) place(near);
  };
  const key = (e: RKeyboardEvent) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? 0.1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? -0.1 : 0;
    if (!step || !heard) return;
    e.preventDefault();
    place(spring.current.to + step);
  };

  // swipe the card sideways to the next / previous mistake
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const navDown = (e: RPointerEvent) => (swipe.current = { x: e.clientX, y: e.clientY });
  const navUp = (e: RPointerEvent) => {
    const s0 = swipe.current;
    swipe.current = null;
    const n = p.nav;
    if (!s0 || !n) return;
    const dx = e.clientX - s0.x;
    if (Math.abs(dx) < 60 || Math.abs(e.clientY - s0.y) > 40) return;
    const k = n.index + (dx < 0 ? 1 : -1);
    if (k >= 0 && k < n.items.length) n.onPick(k);
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

  const playingNow = p.playing;
  const snapAndPlay = (at: number, play: () => void) => {
    if (heard) place(at);
    play();
  };

  return (
    <div className="text-(--ink)">
      {p.nav && p.nav.items.length > 1 ? (
        // the line's mistakes (they wrap; no second count): press one, or swipe the card; ✓ once fixed
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="直す所">
          {p.nav.items.map((it, k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === p.nav!.index}
              onClick={() => p.nav!.onPick(k)}
              className="en inline-flex h-11 items-center gap-1 rounded-full px-4 text-[15px] font-bold"
              style={k === p.nav!.index ? { background: "var(--ink)", color: "var(--paper)" } : { background: "#eef0f8", color: "var(--ink)" }}
            >
              {it.done ? <IconCheck size={13} /> : null}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}

      <div onPointerDown={navDown} onPointerUp={navUp} className="touch-pan-y">
        {/* the heading: the diagnosis, about the failed sound itself */}
        <h3 className="flex flex-wrap items-start gap-x-2 gap-y-2 text-[18px] font-bold leading-snug" id="coach-diag">
          <span className="en pt-2">{clean} の</span>
          {ok ? (
            <>
              <SoundChip phone={phone.phone} />
              <span className="pt-2">は、お手本に近い音になりました</span>
            </>
          ) : phone.heardAs ? (
            <>
              <SoundChip phone={phone.phone} />
              <span className="pt-2">が</span>
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
          {better ? (
            <span key={word.score} className="anim-pop mt-1 rounded-full bg-(--ink) px-3 py-1 text-[13px] font-bold text-(--paper)">
              よくなりました
            </span>
          ) : null}
        </h3>
        {others.length ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-medium">
            この語のもう1つの音：
            {others.map(({ ph, i }) => (
              <button key={i} type="button" onClick={() => setSel(i)} className="ipa inline-flex h-11 items-center rounded-full bg-[#eef0f8] px-3 text-[15px]">
                {chipIpa(ph.phone)}
              </button>
            ))}
          </p>
        ) : null}
        {steps.length && !ok ? (
          <ol className="jp mt-3 flex flex-col gap-1 text-[15px] font-normal leading-relaxed">
            {steps.map((l, k) => (
              <li key={k} className="flex gap-2">
                <span aria-hidden className="mt-[3px] grid size-5 shrink-0 place-items-center rounded-full bg-(--ink) text-[13px] font-bold text-(--paper)">
                  {k + 1}
                </span>
                <span>{boldVerbs(l)}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {/* the mouth: drag the tongue; the buttons play and snap it */}
      {target ? (
        <div
          role={heard ? "slider" : undefined}
          tabIndex={heard ? 0 : undefined}
          aria-label={heard ? "あなたの舌。指で動かすと、音と舌の形が お手本 との間で変わります" : undefined}
          aria-valuemin={heard ? 0 : undefined}
          aria-valuemax={heard ? 100 : undefined}
          aria-valuenow={heard ? Math.round(mine * 100) : undefined}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
          className={`mt-4 select-none ${heard ? "cursor-grab touch-none" : ""}`}
        >
          <Sagittal target={target} heard={heard} pos={mine} grip={!!heard} active={!!playingNow && playingNow !== "heard"} refs={{ svg, body, edge, grip }} className={`mx-auto block w-full ${p.compact ? "max-w-[330px]" : "max-w-[360px]"}`} />
          {heard ? <p className="jp mt-1 text-center text-[13px] font-medium opacity-75">舌を指で動かして、くらべられます</p> : null}
        </div>
      ) : null}
      <div className={`mt-3 grid gap-2 ${p.heardClip ? "grid-cols-3" : "grid-cols-2"}`}>
        <PlayButton onClick={() => snapAndPlay(0, p.onPlayModel)} active={playingNow === "model"} dot="var(--guide)" what="お手本" sub={ipaModel} />
        <PlayButton onClick={() => snapAndPlay(mine, p.onPlayMine)} active={playingNow === "you"} dot="var(--voice-fill)" what="あなたの録音" sub="AI の推定" />
        {p.heardClip ? <PlayButton onClick={() => snapAndPlay(1, p.onPlayHeard)} active={playingNow === "heard"} dot="var(--miss)" what="聞こえた音" sub={ipaHeard ?? (heardSym ? chipIpa(heardSym) : "")} /> : null}
      </div>

      {/* the one main action: in a bar at the bottom of the sheet (on the result, the page's bar has it) */}
      {p.retryAt === "none" ? null : (
        <div className="sticky bottom-0 z-[2] -mx-5 mt-3 bg-(--paper) px-5 pt-3 shadow-[0_-1px_0_#e6e8f1] [padding-bottom:max(16px,calc(env(safe-area-inset-bottom)+10px))]">
          <button type="button" onClick={p.onRetry} disabled={p.retry.state === "scoring"} className={`press ${p.primary === false ? "press-line" : "press-ink"} h-14 w-full text-[15px]`}>
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

/** "舌先を少し奥へ**引く**" → the verb in bold, the rest in the normal weight */
function boldVerbs(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith("**") ? <b key={i} className="font-bold">{part.slice(2, -2)}</b> : part));
}

/** a play button that also snaps the tongue: its colour as the play mark, what it is, and its sounds */
function PlayButton({ onClick, active, dot, what, sub }: { onClick: () => void; active: boolean; dot: string; what: string; sub: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={`${what}を聞く`} className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-[2px] rounded-[14px] bg-(--paper) px-1 py-2 shadow-[inset_0_0_0_1.5px_#dfe2ee]">
      <span className="flex items-center gap-[5px] whitespace-nowrap text-[13px] font-bold">
        <span aria-hidden className="grid size-[18px] shrink-0 place-items-center rounded-full text-(--ink)" style={{ background: dot }}>
          {active ? <IconSpeaker size={11} /> : <IconPlay size={8} />}
        </span>
        {what}
      </span>
      <span className="ipa max-w-full truncate text-[13px] opacity-75">{sub}</span>
    </button>
  );
}

/** a sound as a chip — /ð/ — with its short Japanese name underneath; pink only for what it was heard as */
function SoundChip({ phone, miss }: { phone: string; miss?: boolean }): ReactNode {
  return (
    <span className="inline-flex flex-col items-center">
      <span
        className="ipa inline-flex h-10 min-w-[52px] items-center justify-center rounded-[10px] px-3 text-[18px]"
        style={miss ? { background: "color-mix(in srgb, var(--miss) 10%, white)", color: "var(--miss)", boxShadow: "inset 0 0 0 2px var(--miss)" } : { background: "#eaf7ff", color: "var(--ink)", boxShadow: "inset 0 0 0 2px var(--guide)" }}
      >
        {chipIpa(phone)}
      </span>
      <span className="mt-1 text-[13px] font-medium leading-none opacity-75">{soundNameJa(phone)}</span>
    </span>
  );
}
