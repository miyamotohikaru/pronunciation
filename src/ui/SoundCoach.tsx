"use client";

/**
 * One sound, coached. The heading is the diagnosis on one line — 「right の /r/ が /l/ に聞こえました」 —
 * and its two sounds are buttons: /r/ plays お手本, /l/ plays what it was heard as. Then the mouth: a
 * professionally drawn mid-sagittal section (Wright & McCloy, CC0) cut close round the mouth, where
 * only the tongue, jaw and lower lip move — the blend of the sound it was heard as (your tongue, the
 * only yellow) and お手本's (blue dashed). ① the arrow from your tongue to お手本's, ② the lips: the
 * same numbers as the two steps under it, so the instruction is said once. One switch お手本 ⇄ あなた
 * plays and shows each; dragging the tongue blends the two sounds and the two shapes.
 * On the result the card moves between the line's mistakes (the page's chips; swipe; ✓ once fixed).
 * Dragging updates the SVG, the gains and the spring directly (no React state per move).
 */
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import BreakText from "@/components/BreakText";
import type { WordScore } from "./types";
import { mark } from "./score";
import { stepsFor } from "./copy";
import { chipIpa, soundNameJa, wordIpa } from "./ipa";
import Sagittal, { GRIP, SAG_VIEW, arrowPath, keyIndex, sagittalPoints, tongueLine, tonguePath, tongueRange } from "./mouth/Sagittal";
import { closedPath, outline, shapeFor, tipOf, type Pt, type ShapeKey } from "./mouth/geometry";
import { Crossfader, type Clip } from "./practice/crossfade";
import { buzz } from "./sfx";
import { IconMic, IconPlay, IconSpeaker } from "./icons";
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
};

/** which of the two steps the picture can show, and with which mark */
export function marksFor(phone: string): { tongue?: 1 | 2; lips?: 1 | 2 } {
  const b = phone.replace(/[0-2]$/, "");
  if (b === "R" || b === "ER") return { tongue: 1, lips: 2 };
  if (b === "SH" || b === "ZH" || b === "CH" || b === "JH") return { lips: 1 };
  if (["L", "T", "D", "N", "DX", "TH", "DH", "S", "Z", "F", "V"].includes(b)) return { tongue: 1 };
  return {};
}

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
  const heard: ShapeKey | null = target && heardShape && heardShape !== target ? heardShape : null;
  // your tongue: the sound it was heard as (once it is fixed, お手本's)
  const you = heard && !ok ? 1 : 0;
  const better = p.before !== null && word.score > p.before;
  const ipaModel = `/${wordIpa(phones, p.ipa)}/`;
  const clean = token.replace(/[.,!?]/g, "");
  const others = flagged.filter(({ i }) => i !== sel);
  const marks = ok ? {} : marksFor(phone.phone);

  // ---- the tool (imperative while dragging / playing)
  const svg = useRef<SVGSVGElement | null>(null);
  const body = useRef<SVGPathElement | null>(null);
  const bodyLine = useRef<SVGPathElement | null>(null);
  const edge = useRef<SVGPathElement | null>(null);
  const grip = useRef<SVGGElement | null>(null);
  const arrow = useRef<SVGPathElement | null>(null);
  const fader = useRef<Crossfader | null>(null);
  const dragging = useRef<{ x0: number; q0: Pt } | null>(null);
  const range = target ? tongueRange(target, heard) : ([0, 0] as [number, number]);
  const ki = target ? keyIndex(target) : 0;
  const ridge = target === "r" || target === "t" || target === "s" || target === "sh" ? tipOf(outline("t")) : null;
  // the drag follows the part that moves most between the two drawings
  const handle = (() => {
    if (!target || !heard) return { i: ki, v: [0, 0] as Pt };
    const A = outline(target);
    const B = outline(heard);
    let best = ki;
    let d = -1;
    for (let i = range[0]; i <= range[1]; i++) {
      const dd = Math.hypot(B[i][0] - A[i][0], B[i][1] - A[i][1]);
      if (dd > d) {
        d = dd;
        best = i;
      }
    }
    return { i: best, v: [B[best][0] - A[best][0], B[best][1] - A[best][1]] as Pt };
  })();
  const touching = (x: number) => {
    if (!target || !heard || !ridge) return false;
    const q = sagittalPoints(target, heard, x)[ki];
    return Math.hypot(q[0] - ridge[0], q[1] - ridge[1]) < 2.4;
  };
  const spring = useRef({ x: you, v: 0, to: you, raf: 0, touch: touching(you) });
  const ring = useRef<HTMLSpanElement>(null);
  const tween = useRef(0);
  // which side of the switch the picture shows
  const [side, setSide] = useState<"model" | "you">(heard && !ok ? "you" : "model");

  const drawTongue = (x: number) => {
    if (!target) return;
    const pts = sagittalPoints(target, heard, x);
    body.current?.setAttribute("d", tonguePath(pts, range));
    bodyLine.current?.setAttribute("d", tongueLine(pts, range));
    edge.current?.setAttribute("d", closedPath(pts));
    grip.current?.setAttribute("transform", `translate(${pts[GRIP][0].toFixed(2)},${pts[GRIP][1].toFixed(2)})`);
    if (arrow.current) {
      const a = outline(target)[ki];
      const far = Math.hypot(a[0] - pts[ki][0], a[1] - pts[ki][1]);
      arrow.current.setAttribute("d", far >= 1.5 ? arrowPath(pts[ki], a) : "");
    }
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
  useEffect(() => {
    place(you, true);
    setSide(you ? "you" : "model");
  }, [you, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      fader.current?.stop();
      cancelAnimationFrame(spring.current.raf);
      cancelAnimationFrame(tween.current);
    },
    [],
  );

  // while お手本 plays, your tongue moves to お手本's in time with it; your recording: back to yours
  useEffect(() => {
    cancelAnimationFrame(tween.current);
    if (!target || !heard || !p.playing) return;
    if (p.playing === "heard") return place(you);
    const clip = p.playing === "model" ? p.clips.model() : p.clips.mine();
    const dur = clip ? Math.max(0.25, clip.t1 - clip.t0) * 1000 : 600;
    const from = spring.current.x;
    const to = p.playing === "model" ? 0 : you;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      place(from + (to - from) * (k * k * (3 - 2 * k)));
      if (k < 1) tween.current = requestAnimationFrame(step);
    };
    tween.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.playing]);

  // drag anywhere on the picture: the finger's movement along the way the tongue moves between the two
  const toSvg = (e: RPointerEvent): Pt | null => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return null;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [q.x, q.y];
  };
  const posFrom = (q: Pt) => {
    const d = dragging.current;
    if (!d) return spring.current.to;
    const [vx, vy] = handle.v;
    const len2 = Math.max(1e-6, vx * vx + vy * vy);
    return d.x0 + ((q[0] - d.q0[0]) * vx + (q[1] - d.q0[1]) * vy) / len2;
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!target || !heard) return;
    const q = toSvg(e);
    if (!q) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { x0: spring.current.to, q0: q };
    const a = p.clips.model();
    const b = p.clips.other() ?? p.clips.mine();
    if (a && b) {
      fader.current ??= new Crossfader();
      fader.current.start(a, b, spring.current.to);
    }
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const q = toSvg(e);
    if (q) place(posFrom(q));
  };
  const up = () => {
    if (!dragging.current) return;
    dragging.current = null;
    fader.current?.stop();
    // it settles on the nearer of お手本 / あなた
    const x = spring.current.to;
    const near = Math.abs(x - 0) <= Math.abs(x - you) ? 0 : you;
    place(near);
    setSide(near === 0 ? "model" : "you");
  };
  const key = (e: RKeyboardEvent) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? 0.1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? -0.1 : 0;
    if (!step || !heard) return;
    e.preventDefault();
    place(spring.current.to + step);
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

  const show = (s: "model" | "you") => {
    setSide(s);
    if (heard) place(s === "model" ? 0 : you);
    (s === "model" ? p.onPlayModel : p.onPlayMine)();
  };
  const playHeard = () => {
    setSide("you");
    if (heard) place(you);
    (p.heardClip ? p.onPlayHeard : p.onPlayMine)();
  };

  // the diagnosis on one line: its size comes from its own length (cqi of the card)
  const ja = ok ? "のは、お手本に近い音になりました" : phone.heardAs ? "のがに聞こえました" : phone.inserted ? "ののあとにが入りました" : phone.issue === "deletion" ? "のが聞こえませんでした" : "のが少しあいまいでした";
  const chips = phone.heardAs || phone.inserted ? 2 : 1;
  const em = clean.length * 0.56 + ja.length + chips * 2.9 + 1.4;
  const headSize = `min(18px, ${(100 / em).toFixed(2)}cqi)`;

  return (
    <div className="text-(--ink) [container-type:inline-size]">
      {/* the heading: the diagnosis, about the failed sound itself — one line; the sounds play */}
      <h3 className="flex items-center gap-x-[0.3em] whitespace-nowrap font-bold leading-none" style={{ fontSize: headSize }} id="coach-diag">
        <span className="en">{clean}</span>
        <span>の</span>
        {ok ? (
          <>
            <SoundChip phone={phone.phone} onPlay={() => show("model")} playing={p.playing === "model"} />
            <span>は、お手本に近い音になりました</span>
          </>
        ) : phone.heardAs ? (
          <>
            <SoundChip phone={phone.phone} onPlay={() => show("model")} playing={p.playing === "model"} />
            <span>が</span>
            <SoundChip phone={phone.heardAs} miss onPlay={playHeard} playing={p.playing === "heard"} />
            <span>に聞こえました</span>
          </>
        ) : phone.inserted ? (
          <>
            <SoundChip phone={phone.phone} onPlay={() => show("model")} playing={p.playing === "model"} />
            <span>のあとに</span>
            <SoundChip phone={phone.inserted} miss onPlay={() => show("you")} playing={p.playing === "you"} />
            <span>が入りました</span>
          </>
        ) : (
          <>
            <SoundChip phone={phone.phone} onPlay={() => show("model")} playing={p.playing === "model"} />
            <span>{phone.issue === "deletion" ? "が聞こえませんでした" : "が少しあいまいでした"}</span>
          </>
        )}
      </h3>

      {/* the mouth, in a rounded window: drag the tongue anywhere on it */}
      {target ? (
        <div className="mt-3">
          <div
            role={heard ? "slider" : undefined}
            tabIndex={heard ? 0 : undefined}
            aria-label={heard ? "あなたの舌。指で動かすと、音と舌の形が お手本 との間で変わります" : undefined}
            aria-valuemin={heard ? 0 : undefined}
            aria-valuemax={heard ? 100 : undefined}
            aria-valuenow={heard ? Math.round(you * 100) : undefined}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={key}
            className={`relative select-none overflow-hidden rounded-[18px] bg-[#f3f4f9] ${heard ? "cursor-grab touch-none" : ""}`}
            style={{ aspectRatio: `${SAG_VIEW.w} / ${SAG_VIEW.h}` }}
          >
            <Sagittal
              target={target}
              heard={heard}
              pos={you}
              grip={!!heard && !ok}
              active={!!p.playing && p.playing !== "heard"}
              marks={marks}
              refs={{ svg, body, bodyLine, edge, grip, arrow }}
              className="absolute inset-0 block size-full"
            />
            {better ? (
              <span key={word.score} className="anim-pop absolute right-3 top-3 rounded-full bg-(--ink) px-3 py-1 text-[13px] font-bold text-(--paper)">
                よくなりました
              </span>
            ) : null}
          </div>
          {/* the legend, under the picture (never on the drawing) */}
          <p className="mt-2 flex items-center gap-4 text-[12px] font-medium leading-none">
            <span className="inline-flex items-center gap-[6px]">
              <svg aria-hidden width="20" height="6" viewBox="0 0 20 6">
                <path d="M1 3h18" stroke="var(--guide-ink)" strokeWidth="2.4" strokeDasharray="5 3" strokeLinecap="round" />
              </svg>
              お手本
            </span>
            {heard ? (
              <span className="inline-flex items-center gap-[6px]">
                <span aria-hidden className="inline-block h-[10px] w-[16px] rounded-[3px] bg-(--voice-fill)" />
                あなた
              </span>
            ) : null}
            {heard && !ok ? <span className="ml-auto opacity-70">舌は指で動かせます</span> : null}
          </p>
        </div>
      ) : null}

      {/* one switch: お手本 ⇄ あなた (plays it and shows it) */}
      <div role="group" aria-label="聞きくらべ" className="mt-3 grid h-12 grid-cols-2 rounded-[14px] bg-[#eef0f7] p-1">
        <SideButton active={side === "model"} playing={p.playing === "model"} onClick={() => show("model")} dot="var(--guide)" label="お手本" sub={ipaModel} />
        <SideButton active={side === "you"} playing={p.playing === "you"} onClick={() => show("you")} dot="var(--voice-fill)" label="あなた" />
      </div>

      {steps.length && !ok ? (
        <ol className="jp mt-4 flex flex-col gap-[6px] text-[15px] font-medium leading-snug">
          {steps.map((l, k) => (
            <li key={k} className="flex gap-2">
              <span aria-hidden className="mt-[1px] grid size-[21px] shrink-0 place-items-center rounded-full bg-(--ink) text-[13px] font-bold text-(--paper)">
                {k + 1}
              </span>
              <span>{boldVerbs(l)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {others.length ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] font-medium">
          この語のもう1つの音
          {others.map(({ ph, i }) => (
            <button key={i} type="button" onClick={() => setSel(i)} className="ipa inline-flex h-11 items-center rounded-full bg-[#eef0f8] px-3 text-[15px]">
              {chipIpa(ph.phone)}
            </button>
          ))}
        </p>
      ) : null}

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

/** one half of the お手本 ⇄ あなた switch: the shown side is the raised one */
function SideButton({ active, playing, onClick, dot, label, sub }: { active: boolean; playing: boolean; onClick: () => void; dot: string; label: string; sub?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}を聞く`}
      className="flex min-w-0 items-center justify-center gap-2 rounded-[11px] px-2 text-[14px] font-bold transition-[background,box-shadow] duration-150"
      style={active ? { background: "var(--paper)", boxShadow: "0 1px 3px rgba(12,15,51,.16)" } : undefined}
    >
      <span aria-hidden className="grid size-[18px] shrink-0 place-items-center rounded-full text-(--ink)" style={{ background: dot }}>
        {playing ? <IconSpeaker size={11} /> : <IconPlay size={8} />}
      </span>
      {label}
      {sub ? <span className="ipa min-w-0 truncate text-[13px] opacity-70">{sub}</span> : null}
    </button>
  );
}

/** a sound as a chip — /r/ — that plays it; pink only for what it was heard as */
function SoundChip({ phone, miss, onPlay, playing }: { phone: string; miss?: boolean; onPlay: () => void; playing: boolean }): ReactNode {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`${chipIpa(phone)}（${soundNameJa(phone)}）を聞く`}
      aria-pressed={playing}
      className="ipa relative inline-flex h-[1.95em] items-center gap-[0.18em] rounded-[0.5em] px-[0.36em] text-[1.05em] leading-none before:absolute before:-inset-x-1 before:-inset-y-[10px] before:content-['']"
      style={miss ? { background: "color-mix(in srgb, var(--miss) 10%, white)", color: "var(--miss)", boxShadow: "inset 0 0 0 2px var(--miss)" } : { background: "#eaf7ff", color: "var(--ink)", boxShadow: "inset 0 0 0 2px var(--guide)" }}
    >
      {chipIpa(phone)}
      <IconSpeaker size={11} aria-hidden style={{ opacity: playing ? 1 : 0.55 }} />
    </button>
  );
}
