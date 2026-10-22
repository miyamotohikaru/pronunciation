/**
 * The sound card's mouth: a professionally drawn mid-sagittal section (Wright & McCloy, CC0 — see
 * sagittal-data.ts and /credits), cut to the mouth. Only the tongue, jaw and lower lip move: they are
 * the blend of two drawings — the sound it was heard as and お手本's — and the card drags, springs
 * and plays them. Three marks at most: where the tongue must (●) or must not (✕) touch, the way to
 * move (an arrow in お手本's blue), and nothing else; the legend is inside the picture.
 * Colours: blue = お手本, amber = your recording, pink = the "don't".
 */
import { SAGITTAL_STATIC } from "./sagittal-data";
import { TIP, blend, closedPath, differingPath, outline, tipOf, type Pt, type ShapeKey } from "./geometry";

export type SagittalRefs = {
  svg?: { current: SVGSVGElement | null };
  body?: { current: SVGPathElement | null };
  edge?: { current: SVGPathElement | null };
  grip?: { current: SVGGElement | null };
};

export type SagittalProps = {
  /** お手本's sound */
  target: ShapeKey;
  /** what it was heard as (null: お手本 only, nothing to drag) */
  heard: ShapeKey | null;
  /** 0 = お手本 … 1 = what it was heard as: where the amber tongue is */
  pos: number;
  /** a clip plays: the part that moves glows */
  active?: boolean;
  grip?: boolean;
  refs?: SagittalRefs;
  className?: string;
};

const VIEW = { x: 84, y: 100, w: 92, h: 100 };
const GREY = "#eceef4";
const LINE = "#8f95ad";

/** the contact mark for お手本's sound: must touch (●) or must not touch (✕), and where */
function contactFor(target: ShapeKey): { kind: "do" | "dont"; at: Pt; label: string } | null {
  const tip = (k: ShapeKey) => tipOf(outline(k));
  switch (target) {
    case "r":
      return { kind: "dont", at: tip("t"), label: "付けない" };
    case "t":
      return { kind: "do", at: tip("t"), label: "付ける" };
    case "th":
      return { kind: "do", at: tip("th"), label: "歯の間" };
    case "s":
    case "sh":
      return { kind: "dont", at: tip("t"), label: "付けない" };
    case "f":
      return { kind: "do", at: [157.4, 141.6], label: "唇に歯" };
    default:
      return null;
  }
}

/** which way the arrow says to go, in plain words (picture coordinates: y grows downward; front = right) */
function wayJa(from: Pt, to: Pt): string {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "前へ" : "奥へ";
  return dy < 0 ? "上へ" : "下へ";
}

export function sagittalPoints(target: ShapeKey, heard: ShapeKey | null, pos: number): Pt[] {
  const a = outline(target);
  return heard ? blend(a, outline(heard), pos) : a;
}

/** the grip and the arrow sit on the tongue's tip (the same index in every outline) */
export const gripIndex = (): number => TIP;

export default function Sagittal({ target, heard, pos, active, grip, refs, className }: SagittalProps) {
  const a = outline(target);
  const b = heard ? outline(heard) : null;
  const now = sagittalPoints(target, heard, pos);
  const gi = gripIndex();
  const contact = contactFor(target);
  const from = b ? b[gi] : null;
  const to = a[gi];
  const far = from ? Math.hypot(to[0] - from[0], to[1] - from[1]) : 0;
  const goal = b ? differingPath(a, b) : "";
  return (
    <svg
      ref={refs?.svg}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      className={className}
      role="img"
      aria-label={`口の断面図。黄色があなたの録音の舌、青の点線がお手本の舌${contact ? `。${contact.kind === "do" ? "ここに付ける" : "ここには付けない"}` : ""}`}
    >
      <defs>
        {/* your tongue in amber, fading out below so the chin and neck stay plain */}
        <linearGradient id="sag-you" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.5" stopColor="#fff" />
          <stop offset="0.72" stopColor="#000" />
        </linearGradient>
        <mask id="sag-you-mask" maskUnits="userSpaceOnUse" x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h}>
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill="url(#sag-you)" />
        </mask>
        <filter id="sag-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      {/* the parts that never move */}
      <path d={SAGITTAL_STATIC.path9} fill={GREY} stroke={LINE} strokeWidth="0.35" />
      <path d={SAGITTAL_STATIC.path7} fill={GREY} stroke={LINE} strokeWidth="0.35" />
      <path d={SAGITTAL_STATIC.path13} fill={GREY} stroke={LINE} strokeWidth="0.35" />

      {/* tongue, jaw and lower lip: the anatomy in grey, your tongue in amber over it */}
      <path ref={refs?.edge} d={closedPath(now)} fill={GREY} stroke={LINE} strokeWidth="0.35" />
      <path ref={refs?.body} d={closedPath(now)} fill="var(--voice-fill)" fillOpacity="0.92" mask="url(#sag-you-mask)" />
      {/* お手本's tongue where it differs: blue, dashed; it glows while a clip plays */}
      {goal ? (
        <>
          <path d={goal} fill="none" stroke="var(--guide)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" filter="url(#sag-glow)" style={{ opacity: active ? 0.9 : 0, transition: "opacity 160ms" }} />
          <path d={goal} fill="none" stroke="var(--guide-ink)" strokeWidth="0.9" strokeDasharray="2 1.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}

      {/* mark 1: must / must not touch */}
      {contact ? (
        <g data-mark="contact" className={active && contact.kind === "dont" ? "kara-blink" : undefined}>
          {contact.kind === "do" ? (
            <circle cx={contact.at[0]} cy={contact.at[1]} r="1.8" fill="var(--guide-ink)" stroke="#fff" strokeWidth="0.6" />
          ) : (
            <g stroke="var(--miss)" strokeWidth="1.1" strokeLinecap="round">
              <path d={`M${contact.at[0] - 1.8},${contact.at[1] - 1.8} L${contact.at[0] + 1.8},${contact.at[1] + 1.8} M${contact.at[0] + 1.8},${contact.at[1] - 1.8} L${contact.at[0] - 1.8},${contact.at[1] + 1.8}`} />
            </g>
          )}
          {/* the label up and to the left of the spot, clear of the grip; a white halo keeps it legible on the tongue */}
          <text x={contact.at[0] - 5.5} y={contact.at[1] - 7} fontSize="3.6" fontWeight="700" textAnchor="end" fill={contact.kind === "do" ? "var(--guide-ink)" : "var(--miss)"} stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" paintOrder="stroke">
            {contact.label}
          </text>
        </g>
      ) : null}

      {/* mark 2: the way to go, from your tongue to お手本's (blue) */}
      {from && far > 2 ? (
        <g stroke="var(--guide-ink)" strokeWidth="0.8" strokeLinecap="round" fill="none">
          <path d={`M${from[0].toFixed(1)},${from[1].toFixed(1)} L${to[0].toFixed(1)},${to[1].toFixed(1)}`} />
          <ArrowHead from={from} to={to} />
          <title>{wayJa(from, to)}</title>
        </g>
      ) : null}

      {/* the grip on the part that moves (44 pt to touch) */}
      {grip && heard ? (
        <g ref={refs?.grip} data-grip transform={`translate(${now[gi][0].toFixed(2)},${now[gi][1].toFixed(2)})`} style={{ cursor: "grab" }}>
          <circle r="6.5" fill="transparent" />
          <circle r="2.6" fill="#fff" stroke="var(--ink)" strokeWidth="0.7" />
          <path d="M-1.1,-0.7 L-1.8,0 L-1.1,0.7 M1.1,-0.7 L1.8,0 L1.1,0.7" fill="none" stroke="var(--ink)" strokeWidth="0.45" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null}

      {/* the legend, inside the picture */}
      <g fontSize="3.6" fontWeight="600" fill="var(--ink)">
        <path d={`M${VIEW.x + 3},${VIEW.y + VIEW.h - 9} l6,0`} stroke="var(--guide-ink)" strokeWidth="0.9" strokeDasharray="2 1.4" />
        <text x={VIEW.x + 11} y={VIEW.y + VIEW.h - 7.8}>
          お手本
        </text>
        <rect x={VIEW.x + 3} y={VIEW.y + VIEW.h - 5.6} width="6" height="3" rx="0.8" fill="var(--voice-fill)" />
        <text x={VIEW.x + 11} y={VIEW.y + VIEW.h - 3.0}>
          あなたの録音
        </text>
      </g>
    </svg>
  );
}

function ArrowHead({ from, to }: { from: Pt; to: Pt }) {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const l = 2.2;
  const p1: Pt = [to[0] - l * Math.cos(ang - 0.5), to[1] - l * Math.sin(ang - 0.5)];
  const p2: Pt = [to[0] - l * Math.cos(ang + 0.5), to[1] - l * Math.sin(ang + 0.5)];
  return <path d={`M${p1[0].toFixed(2)},${p1[1].toFixed(2)} L${to[0].toFixed(2)},${to[1].toFixed(2)} L${p2[0].toFixed(2)},${p2[1].toFixed(2)}`} />;
}
