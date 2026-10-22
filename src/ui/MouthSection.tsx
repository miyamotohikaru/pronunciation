/**
 * Mid-sagittal section of the front of the mouth, cut close and drawn large: lips, front teeth,
 * the ridge behind the upper teeth, the front of the palate, the tip and blade of the tongue.
 * Two tongues, filled: お手本 light (cyan), あなた dense (amber) — the dense one is the one that
 * moves when the sound card's slider is dragged. Where the tip meets the ridge: a red callout and
 * an arrow saying which way to go. ① ② mark the places the tip text talks about.
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

/** the tongue's outline (stroke) and its filled body (closed along the floor), at a position */
export function tongueD(target: Sound, pos: number): { line: string; body: string } {
  const p = contour(target, pos);
  const line = smooth(p);
  return { line, body: `${line} L320,214 L${p[0][0].toFixed(1)},214 Z` };
}

/** does the tip touch the ridge at this position? */
export function touches(target: Sound, pos: number): boolean {
  const p = contour(target, pos);
  return Math.hypot(p[5][0] - RIDGE[0], p[5][1] - RIDGE[1]) < 10 || Math.hypot(p[4][0] - RIDGE[0], p[4][1] - RIDGE[1]) < 12;
}

/** the tip's point (for the arrow) */
export function tipAt(target: Sound, pos: number): [number, number] {
  return contour(target, pos)[4];
}

export type MouthRefs = {
  body: { current: SVGPathElement | null };
  line: { current: SVGPathElement | null };
  /** the ● on the ridge (tip touching) */
  dot: { current: SVGCircleElement | null };
  /** the red callout (touching when it should not, or the other way round) */
  callout: { current: SVGGElement | null };
};

export type MouthSectionProps = {
  target: Sound;
  /** where the dense tongue is (0 = target … 1 = the other sound) */
  pos: number;
  className?: string;
  /** the dense tongue's paths and the callout, moved directly while the slider is dragged */
  refs?: MouthRefs;
  /** show ① (tongue) and ② (lips) */
  numbered?: boolean;
};

const INK = "var(--ink)";

export default function MouthSection({ target, pos, className, refs, numbered }: MouthSectionProps) {
  const model = tongueD(target, 0);
  const yours = tongueD(target, pos);
  const touch = touches(target, pos);
  const wrongTouch = target === "r" ? touch : !touch;
  const tip0 = tipAt(target, 0);
  return (
    <svg
      viewBox="0 36 168 132"
      className={className}
      role="img"
      aria-label={`口の断面。お手本の舌${touches(target, 0) ? "は歯ぐきに付く" : "はどこにも付かない"}。あなたの舌${touch ? "は歯ぐきに付いている" : "は付いていない"}（AI の推定）`}
    >
      <defs>
        <clipPath id="mouth-in">
          <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40 L320,214 L40,214 L40,170 C52,176 58,172 62,170 Z" />
        </clipPath>
      </defs>
      {/* the inside of the mouth */}
      <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40 L320,206 C280,208 230,208 180,204 C120,198 80,184 62,170 Z" fill="#f1f3fa" />

      {/* the tongues, clipped to the mouth: お手本 light, yours dense on top */}
      <g clipPath="url(#mouth-in)">
        <path d={model.body} fill="color-mix(in srgb, var(--guide) 30%, white)" />
        <path ref={refs?.body} d={yours.body} fill="var(--voice-fill)" opacity="0.9" />
        <path d={model.line} fill="none" stroke="var(--guide-ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
        <path ref={refs?.line} d={yours.line} fill="none" stroke="var(--voice-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* roof: the ridge behind the teeth, the hard palate */}
      <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      {/* floor of the mouth */}
      <path d="M62,170 C80,184 120,198 180,204" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" opacity=".5" />
      {/* lips: filled to the edge of the picture, outlined only where they are lips */}
      <path d="M0,50 C18,46 34,50 44,60 C49,64 49,73 45,78 C34,85 16,83 0,82 Z" fill="#ffffff" />
      <path d="M0,50 C18,46 34,50 44,60 C49,64 49,73 45,78 C34,85 16,83 0,82" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0,158 C16,154 34,150 44,141 C49,137 49,128 45,123 C34,117 16,119 0,122 Z" fill="#ffffff" />
      <path d="M0,158 C16,154 34,150 44,141 C49,137 49,128 45,123 C34,117 16,119 0,122" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* front teeth */}
      <path d="M47,63 C53,61 60,63 62,70 L60,108 C58,115 51,116 48,111 L44,74 C44,69 44,65 47,63 Z" fill="#ffffff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M48,168 C53,170 59,169 61,164 L63,126 C61,119 54,117 50,121 L46,160 C46,164 46,167 48,168 Z" fill="#ffffff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />

      {/* the ridge: touched (●) or not */}
      <circle ref={refs?.dot} cx={RIDGE[0]} cy={RIDGE[1] - 1} r="3.2" fill={INK} style={{ opacity: touch ? 1 : 0 }} />

      {/* where it goes wrong: a red callout on the ridge, and which way to move */}
      <g ref={refs?.callout} style={{ opacity: wrongTouch ? 1 : 0, transition: "opacity 120ms" }}>
        <Callout target={target} />
      </g>

      {numbered ? (
        <>
          <Num n="1" x={tip0[0] + 18} y={tip0[1] - 12} />
          <Num n="2" x={20} y={102} />
        </>
      ) : null}
    </svg>
  );
}

/** the red callout at the ridge and the arrow: r → 「奥へ引く」 (back, away from it), l → 「歯ぐきへ」 (up to it) */
function Callout({ target }: { target: Sound }) {
  const miss = "var(--miss)";
  const [x, y] = [RIDGE[0], RIDGE[1] - 1];
  if (target === "r")
    return (
      <>
        <circle cx={x} cy={y} r="7.5" fill="none" stroke={miss} strokeWidth="1.6" />
        <path d={`M${x + 10},${y + 12} L${x + 40},${y + 12}`} stroke={miss} strokeWidth="1.8" strokeLinecap="round" />
        <path d={`M${x + 35},${y + 8} L${x + 41},${y + 12} L${x + 35},${y + 16}`} fill="none" stroke={miss} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <rect x={x + 10} y={y + 17} width="34" height="12" rx="6" fill={miss} />
        <text x={x + 27} y={y + 25.6} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff">
          奥へ引く
        </text>
      </>
    );
  return (
    <>
      <circle cx={x} cy={y} r="7.5" fill="none" stroke={miss} strokeWidth="1.6" />
      <path d={`M${x + 22},${y + 26} L${x + 8},${y + 8}`} stroke={miss} strokeWidth="1.8" strokeLinecap="round" />
      <path d={`M${x + 8},${y + 15} L${x + 7},${y + 7} L${x + 15},${y + 8}`} fill="none" stroke={miss} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x={x + 14} y={y + 27} width="34" height="12" rx="6" fill={miss} />
      <text x={x + 31} y={y + 35.6} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff">
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
