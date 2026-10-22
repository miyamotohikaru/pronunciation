/**
 * Mid-sagittal section of the front of the mouth — from the lips and front teeth to just before
 * the throat, drawn large in one line weight. Two tongues: お手本 (cyan) and あなた (yellow, the
 * AI's estimate, or wherever the scrubber is). A mark on the ridge behind the upper teeth says
 * whether the tip touches it (●) or not (×).
 *
 * `mine` / `scrub`: 0 = the target sound's tongue … 1 = the sound it was heard as. For r vs l.
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
const RIDGE: [number, number] = [64, 68];

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

/** the yellow tongue at a position (for imperative updates while scrubbing) */
export function tongueD(target: Sound, pos: number): string {
  const a = target === "r" ? R : L;
  const b = target === "r" ? L : R;
  return smooth(lerp(a, b, Math.min(1, Math.max(0, pos))));
}

export type MouthSectionProps = {
  target: Sound;
  /** where your tongue probably was (0 = target … 1 = the other sound); null = not shown */
  mine: number | null;
  /** live scrubber position; overrides `mine` for the yellow tongue while dragging */
  scrub?: number | null;
  className?: string;
  /** refs to the yellow tongue's two paths (casing, line), updated directly while scrubbing */
  yoursRefs?: { casing: { current: SVGPathElement | null }; line: { current: SVGPathElement | null } };
};

export default function MouthSection({ target, mine, scrub, className, yoursRefs }: MouthSectionProps) {
  const a = target === "r" ? R : L;
  const b = target === "r" ? L : R;
  const pos = scrub ?? mine;
  const yours = pos === null ? null : lerp(a, b, Math.min(1, Math.max(0, pos)));
  const touch = (p: [number, number][]) => Math.hypot(p[5][0] - RIDGE[0], p[5][1] - RIDGE[1]) < 10 || Math.hypot(p[4][0] - RIDGE[0], p[4][1] - RIDGE[1]) < 12;
  const shown = yours ?? a;
  const ink = "var(--ink)";
  return (
    <svg viewBox="0 0 320 214" className={className} role="img" aria-label={`口の断面。お手本の舌${touch(a) ? "は歯ぐきに付く" : "はどこにも付かない"}${yours ? `。あなたの舌${touch(yours) ? "は歯ぐきに付いている" : "は付いていない"}（AI の推定）` : ""}`}>
      {/* the inside of the mouth */}
      <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40 L320,206 C280,208 230,208 180,204 C120,198 80,184 62,170 Z" fill="#f1f3fa" />
      {/* roof: ridge behind the teeth, hard palate */}
      <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      {/* floor of the mouth */}
      <path d="M62,170 C80,184 120,198 180,204 C230,208 280,208 320,206" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" opacity=".55" />
      {/* lips: filled to the edge of the picture, outlined only where they are lips (no cut edge) */}
      <path d="M0,50 C18,46 34,50 44,60 C49,64 49,73 45,78 C34,85 16,83 0,82 Z" fill="#ffffff" />
      <path d="M0,50 C18,46 34,50 44,60 C49,64 49,73 45,78 C34,85 16,83 0,82" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0,158 C16,154 34,150 44,141 C49,137 49,128 45,123 C34,117 16,119 0,122 Z" fill="#ffffff" />
      <path d="M0,158 C16,154 34,150 44,141 C49,137 49,128 45,123 C34,117 16,119 0,122" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* front teeth */}
      <path d="M47,63 C53,61 60,63 62,70 L60,108 C58,115 51,116 48,111 L44,74 C44,69 44,65 47,63 Z" fill="#ffffff" stroke={ink} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M48,168 C53,170 59,169 61,164 L63,126 C61,119 54,117 50,121 L46,160 C46,164 46,167 48,168 Z" fill="#ffffff" stroke={ink} strokeWidth="2.4" strokeLinejoin="round" />

      {/* お手本 (cyan), then yours (yellow) on top; each with a thin navy casing so it reads on white */}
      <path d={smooth(a)} fill="none" stroke={ink} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
      <path d={smooth(a)} fill="none" stroke="var(--guide)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      {yours ? (
        <>
          <path ref={yoursRefs?.casing} d={smooth(yours)} fill="none" stroke={ink} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
          <path ref={yoursRefs?.line} d={smooth(yours)} fill="none" stroke="var(--voice)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}

      {/* does the tip touch the ridge? */}
      {touch(shown) ? (
        <circle cx={RIDGE[0]} cy={RIDGE[1] - 1} r="6" fill={ink} stroke="#fff" strokeWidth="2" />
      ) : (
        <g stroke={ink} strokeWidth="3" strokeLinecap="round">
          <path d={`M${RIDGE[0] - 5},${RIDGE[1] - 6} L${RIDGE[0] + 5},${RIDGE[1] + 4}`} />
          <path d={`M${RIDGE[0] + 5},${RIDGE[1] - 6} L${RIDGE[0] - 5},${RIDGE[1] + 4}`} />
        </g>
      )}
    </svg>
  );
}
