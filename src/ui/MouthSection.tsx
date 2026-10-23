/**
 * Mid-sagittal section of the front of the mouth, cut close and drawn large: a faint profile
 * (nose, chin) so "front" and "back" read at a glance, lips, front teeth, the ridge behind the
 * upper teeth, the front of the palate, the tip and blade of the tongue. The cut edges fade out.
 *
 * Two tongues, filled: お手本 light (cyan outline, dashed), あなた dense (amber). The dense one is
 * the control: it has a grip on its tip, and the sound card drags it, springs it and plays it.
 * Colour roles: cyan = お手本 and the way to move (the arrow), amber = あなた, ink = the "don't"
 * mark on the ridge (✕ 付けない), pink is never used here.
 *
 * `pos`: 0 = the target sound's tongue … 1 = the sound it was heard as. For r vs l.
 */
type Sound = "r" | "l";

// one contour each, from the floor of the mouth up the underside, round the tip, along the top
// to the back edge — the same number of points, so any position in between can be drawn
const L: [number, number][] = [
  [120, 200], [98, 162], [80, 128], [68, 98], [64, 78], [70, 70], [92, 84], [124, 100], [170, 103], [232, 95], [320, 99],
];
const R: [number, number][] = [
  [128, 200], [112, 168], [104, 138], [100, 114], [100, 94], [110, 83], [132, 77], [168, 69], [214, 65], [264, 71], [320, 85],
];
export const RIDGE: [number, number] = [64, 68];

const lerp = (a: [number, number][], b: [number, number][], k: number) => a.map(([x, y], i) => [x + (b[i][0] - x) * k, y + (b[i][1] - y) * k] as [number, number]);

/** Catmull-Rom through the points, as cubic Béziers */
function smooth(p: [number, number][]): string {
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i + 1 < p.length; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

const contour = (target: Sound, pos: number) => {
  const a = target === "r" ? R : L;
  const b = target === "r" ? L : R;
  return lerp(a, b, Math.min(1, Math.max(0, pos)));
};

/** the tongue's outline (stroke), its filled body (closed along the floor) and its blade (what moves), at a position */
export function tongueD(target: Sound, pos: number): { line: string; body: string; blade: string } {
  const p = contour(target, pos);
  const line = smooth(p);
  return { line, body: `${line} L320,214 L${p[0][0].toFixed(1)},214 Z`, blade: smooth(p.slice(2, 8)) };
}

/** does the tip touch the ridge at this position? */
export function touches(target: Sound, pos: number): boolean {
  const p = contour(target, pos);
  return Math.hypot(p[5][0] - RIDGE[0], p[5][1] - RIDGE[1]) < 10 || Math.hypot(p[4][0] - RIDGE[0], p[4][1] - RIDGE[1]) < 12;
}

/** the tip's point (where the grip sits) */
export function tipAt(target: Sound, pos: number): [number, number] {
  return contour(target, pos)[4];
}

/** the tip's x at the two ends: the drag maps x to a position */
export function tipRange(target: Sound): { x0: number; x1: number } {
  return { x0: tipAt(target, 0)[0], x1: tipAt(target, 1)[0] };
}

export type MouthRefs = {
  svg?: { current: SVGSVGElement | null };
  body: { current: SVGPathElement | null };
  line: { current: SVGPathElement | null };
  blade?: { current: SVGPathElement | null };
  grip?: { current: SVGGElement | null };
  /** the ● on the ridge (tip touching) */
  dot: { current: SVGCircleElement | null };
  /** the way to move and the "don't" mark (shown when the tongue is wrong, or while a clip plays) */
  callout: { current: SVGGElement | null };
};

export type MouthSectionProps = {
  target: Sound;
  /** where the dense tongue is (0 = target … 1 = the other sound) */
  pos: number;
  className?: string;
  refs?: MouthRefs;
  /** show ① (tongue) and ② (lips) */
  numbered?: boolean;
  /** a clip is playing: the blade glows and the ✕ blinks */
  active?: boolean;
  /** show the grip on the dense tongue's tip */
  grip?: boolean;
};

const INK = "var(--ink)";

export default function MouthSection({ target, pos, className, refs, numbered, active, grip }: MouthSectionProps) {
  const model = tongueD(target, 0);
  const yours = tongueD(target, pos);
  const touch = touches(target, pos);
  const wrong = target === "r" ? touch : !touch;
  const tip0 = tipAt(target, 0);
  const tip = tipAt(target, pos);
  const [a, b] = target === "r" ? ["R", "L"] : ["L", "R"];
  return (
    <svg
      ref={refs?.svg}
      viewBox="-26 30 196 140"
      className={className}
      role="img"
      aria-label={`口の断面。お手本の舌${touches(target, 0) ? "は歯ぐきに付く" : "はどこにも付かない"}。あなたの舌${touch ? "は歯ぐきに付いている" : "は付いていない"}（AI の推定）`}
    >
      <defs>
        <clipPath id="mouth-in">
          <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40 L320,214 L40,214 L40,170 C52,176 58,172 62,170 Z" />
        </clipPath>
        {/* the cut edges (right, bottom) fade out instead of ending on a line */}
        <linearGradient id="mouth-fade-x" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0.82" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <linearGradient id="mouth-fade-y" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0.84" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id="mouth-fade" maskUnits="userSpaceOnUse" x="-26" y="30" width="196" height="140">
          <rect x="-26" y="30" width="196" height="140" fill="url(#mouth-fade-x)" />
        </mask>
        <mask id="mouth-fade-b" maskUnits="userSpaceOnUse" x="-26" y="30" width="196" height="140">
          <rect x="-26" y="30" width="196" height="140" fill="url(#mouth-fade-y)" />
        </mask>
        <filter id="blade-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      <g mask="url(#mouth-fade)">
        <g mask="url(#mouth-fade-b)">
          {/* the inside of the mouth */}
          <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40 L320,206 C280,208 230,208 180,204 C120,198 80,184 62,170 Z" fill="#f1f3fa" />

          {/* the tongues, clipped to the mouth: お手本 light, yours dense on top */}
          <g clipPath="url(#mouth-in)">
            <path d={model.body} fill="color-mix(in srgb, var(--guide) 26%, white)" />
            <path ref={refs?.body} d={yours.body} fill="var(--voice-fill)" opacity="0.92" />
            {/* what has to move, glowing while a clip plays */}
            <path ref={refs?.blade} d={yours.blade} fill="none" stroke="var(--guide)" strokeWidth="7" strokeLinecap="round" filter="url(#blade-glow)" style={{ opacity: active ? 0.9 : 0, transition: "opacity 160ms" }} />
            <path d={model.line} fill="none" stroke="var(--guide-ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
            <path ref={refs?.line} d={yours.line} fill="none" stroke="var(--voice-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </g>

          {/* roof: the ridge behind the teeth, the hard palate */}
          <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
          {/* floor of the mouth */}
          <path d="M62,170 C80,184 120,198 180,204" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" opacity=".5" />
        </g>
      </g>

      {/* a faint profile: the nose above, the chin below — the front is to the left */}
      <path d="M2,50 C-2,44 -8,42 -12,40 C-17,38 -20,33 -18,30" fill="none" stroke={INK} strokeWidth="1.1" strokeLinecap="round" opacity=".28" />
      <path d="M2,158 C-2,164 -4,170 -10,170" fill="none" stroke={INK} strokeWidth="1.1" strokeLinecap="round" opacity=".28" />
      {/* lips */}
      <path d="M0,50 C18,46 34,50 44,60 C49,64 49,73 45,78 C34,85 16,83 0,82 Z" fill="#ffffff" />
      <path d="M0,50 C18,46 34,50 44,60 C49,64 49,73 45,78 C34,85 16,83 0,82" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0,158 C16,154 34,150 44,141 C49,137 49,128 45,123 C34,117 16,119 0,122 Z" fill="#ffffff" />
      <path d="M0,158 C16,154 34,150 44,141 C49,137 49,128 45,123 C34,117 16,119 0,122" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* front teeth */}
      <path d="M47,63 C53,61 60,63 62,70 L60,108 C58,115 51,116 48,111 L44,74 C44,69 44,65 47,63 Z" fill="#ffffff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M48,168 C53,170 59,169 61,164 L63,126 C61,119 54,117 50,121 L46,160 C46,164 46,167 48,168 Z" fill="#ffffff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />

      {/* the ridge: touched (●) or not */}
      <circle ref={refs?.dot} cx={RIDGE[0]} cy={RIDGE[1] - 1} r="3.2" fill={INK} style={{ opacity: touch ? 1 : 0 }} />

      {/* the "don't" mark (ink) and the way to move (cyan, お手本's colour) */}
      <g ref={refs?.callout} style={{ opacity: wrong || active ? 1 : 0, transition: "opacity 120ms" }}>
        <Callout target={target} blink={!!active} />
      </g>

      {/* the two ends the grip runs between */}
      <text x={tip0[0] + (target === "r" ? 8 : -10)} y={tip0[1] + 20} fontSize="8" fontWeight="700" fill="var(--guide-ink)" textAnchor="middle">
        {a}
      </text>
      <text x={tipAt(target, 1)[0] + (target === "r" ? -10 : 8)} y={tipAt(target, 1)[1] + 20} fontSize="8" fontWeight="700" fill={INK} opacity=".6" textAnchor="middle">
        {b}
      </text>

      {numbered ? (
        <>
          <Num n="1" x={tip0[0] + 20} y={tip0[1] - 14} />
          <Num n="2" x={14} y={102} />
          {/* ② round the lips: two small arrows pushing them forward */}
          <path d="M-6,64 C-12,70 -12,76 -8,82" fill="none" stroke="var(--guide-ink)" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M-11,79 L-8,83 L-4,80" fill="none" stroke="var(--guide-ink)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M-6,142 C-12,136 -12,130 -8,124" fill="none" stroke="var(--guide-ink)" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M-11,127 L-8,123 L-4,126" fill="none" stroke="var(--guide-ink)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}

      {/* the grip on your tongue's tip (44 pt to touch) */}
      {grip ? (
        <g ref={refs?.grip} transform={`translate(${tip[0].toFixed(1)},${tip[1].toFixed(1)})`} style={{ cursor: "grab" }}>
          <circle r="13" fill="transparent" />
          <circle r="6.5" fill="#ffffff" stroke={INK} strokeWidth="1.8" />
          <path d="M-2.6,-1.6 L-4.2,0 L-2.6,1.6 M2.6,-1.6 L4.2,0 L2.6,1.6" fill="none" stroke={INK} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null}

      <text x="-22" y="166" fontSize="7" fill={INK} opacity=".45">
        ← 前
      </text>
      <text x="166" y="166" fontSize="7" fill={INK} opacity=".45" textAnchor="end">
        奥 →
      </text>
    </svg>
  );
}

/** r: ✕ 付けない on the ridge and a cyan 「奥へ引く」 arrow; l: a cyan arrow up to the ridge 「歯ぐきへ」 */
function Callout({ target, blink }: { target: Sound; blink: boolean }) {
  const [x, y] = [RIDGE[0], RIDGE[1] - 1];
  const cyan = "var(--guide-ink)";
  if (target === "r")
    return (
      <>
        <g className={blink ? "kara-blink" : undefined}>
          <circle cx={x} cy={y} r="7.5" fill="none" stroke={INK} strokeWidth="1.5" />
          <path d={`M${x - 3},${y - 3} L${x + 3},${y + 3} M${x + 3},${y - 3} L${x - 3},${y + 3}`} stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        </g>
        <text x={x - 2} y={y - 12} fontSize="7.5" fontWeight="700" fill={INK} textAnchor="middle">
          ✕ 付けない
        </text>
        <path d={`M${x + 10},${y + 13} L${x + 40},${y + 13}`} stroke={cyan} strokeWidth="1.8" strokeLinecap="round" />
        <path d={`M${x + 35},${y + 9} L${x + 41},${y + 13} L${x + 35},${y + 17}`} fill="none" stroke={cyan} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <text x={x + 26} y={y + 25} fontSize="7.5" fontWeight="700" fill={cyan} textAnchor="middle">
          奥へ引く
        </text>
      </>
    );
  return (
    <>
      <circle cx={x} cy={y} r="7.5" fill="none" stroke={cyan} strokeWidth="1.5" className={blink ? "kara-blink" : undefined} />
      <path d={`M${x + 22},${y + 26} L${x + 8},${y + 8}`} stroke={cyan} strokeWidth="1.8" strokeLinecap="round" />
      <path d={`M${x + 8},${y + 15} L${x + 7},${y + 7} L${x + 15},${y + 8}`} fill="none" stroke={cyan} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x={x + 30} y={y + 36} fontSize="7.5" fontWeight="700" fill={cyan} textAnchor="middle">
        歯ぐきへ
      </text>
    </>
  );
}

function Num({ n, x, y }: { n: string; x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="6" fill="var(--ink)" />
      <text x={x} y={y + 2.6} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff">
        {n}
      </text>
    </g>
  );
}
