"use client";

/**
 * Side view of the head (facing left) for r vs l. The tongue morphs between the two
 * when `sound` changes, so the difference is a movement, not two pictures to compare.
 *   l: the tongue tip touches the ridge behind the upper teeth (dot)
 *   r: the tip is pulled back and touches nothing (gap); lips a little rounded
 * `ghost` draws the other tongue as a dashed outline ("what yours probably did").
 */
import { useEffect, useRef, useState } from "react";

type Sound = "r" | "l";

// Same command structure for both (M + 5 cubic segments), so every number can be interpolated.
const TONGUE: Record<Sound, number[]> = {
  l: [172, 206, 176, 172, 178, 142, 166, 124, 150, 106, 120, 116, 96, 118, 80, 119, 66, 113, 58, 103, 53, 110, 57, 121, 66, 129, 84, 143, 104, 160, 122, 206],
  r: [172, 206, 176, 170, 177, 138, 165, 120, 150, 98, 126, 96, 108, 101, 95, 105, 87, 111, 80, 109, 74, 114, 74, 124, 81, 130, 95, 143, 108, 160, 122, 206],
};
// lips push forward a little for r
const LIPS: Record<Sound, number> = { l: 0, r: -5 };
const TIP = 18; // index of the tip's x in TONGUE

const toPath = (n: number[]) =>
  `M${n[0]},${n[1]} ` +
  Array.from({ length: 5 }, (_, i) => {
    const k = 2 + i * 6;
    return `C${n[k]},${n[k + 1]} ${n[k + 2]},${n[k + 3]} ${n[k + 4]},${n[k + 5]}`;
  }).join(" ") +
  " Z";

const lerp = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
const ease = (k: number) => 1 - Math.pow(1 - k, 3);

export type MouthDiagramProps = {
  sound: Sound;
  ghost?: Sound | null;
  labels?: boolean;
  className?: string;
  title?: string;
};

const RIDGE = { x: 57, y: 101 };

export default function MouthDiagram({ sound, ghost, labels = true, className, title }: MouthDiagramProps) {
  const [pts, setPts] = useState(TONGUE[sound]);
  const [lip, setLip] = useState(LIPS[sound]);
  const from = useRef({ pts: TONGUE[sound], lip: LIPS[sound] });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    const target = { pts: TONGUE[sound], lip: LIPS[sound] };
    if (reduce) {
      setPts(target.pts);
      setLip(target.lip);
      from.current = target;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const k = ease(Math.min(1, (now - t0) / 440));
      const p = lerp(start.pts, target.pts, k);
      const l = start.lip + (target.lip - start.lip) * k;
      setPts(p);
      setLip(l);
      from.current = { pts: p, lip: l };
      if (k < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sound]);

  const tip = { x: pts[TIP], y: pts[TIP + 1] };
  const ink = "var(--ink)";
  return (
    <svg
      viewBox="0 0 232 206"
      className={className}
      role="img"
      aria-label={title ?? (sound === "r" ? "r の舌：舌先はどこにも付けない" : "l の舌：舌先を上の歯の裏に付ける")}
    >
      {/* head, facing left: forehead, nose, lips, chin, neck */}
      <path
        d="M96,0 C80,10 66,24 58,40 C52,52 40,62 26,72 C22,76 26,82 34,83 L44,85 C46,90 45,94 44,96
           L44,126 C46,130 47,134 46,138 C44,150 42,162 50,174 C60,186 80,192 104,194 L140,206 L232,206 L232,0 Z"
        fill="#f1f3ff"
      />
      <path
        d="M96,0 C80,10 66,24 58,40 C52,52 40,62 26,72 C22,76 26,82 34,83 L44,85"
        fill="none"
        stroke={ink}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M46,138 C44,150 42,162 50,174 C60,186 80,192 104,194 L140,206"
        fill="none"
        stroke={ink}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* lips */}
      <g transform={`translate(${lip},0)`}>
        <path d="M44,85 C40,88 36,92 34,98 C33,102 38,105 46,105 L54,104 L52,92 Z" fill="#ffb3c9" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
        <path d="M46,112 C38,112 34,116 35,121 C37,128 42,134 46,138 L56,132 L54,113 Z" fill="#ffb3c9" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
      </g>

      {/* teeth */}
      <path d="M52,94 C55,93 58,94 59,97 L58,110 C56,113 53,113 51,110 Z" fill="#fff" stroke={ink} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M52,130 C55,131 58,130 59,127 L58,116 C56,113 53,113 51,116 Z" fill="#fff" stroke={ink} strokeWidth="2.6" strokeLinejoin="round" />

      {/* roof of the mouth: ridge, hard palate, soft palate; back wall of the throat */}
      <path
        d="M59,97 C60,92 64,90 68,91 C88,80 118,74 146,80 C164,84 176,92 182,104 C184,110 182,116 178,118"
        fill="none"
        stroke={ink}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M196,92 C198,120 198,160 196,206" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
      {/* floor behind the lower teeth */}
      <path d="M59,127 C66,140 82,154 100,166 C110,174 116,188 120,206" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" opacity=".5" />

      {ghost && ghost !== sound ? (
        <path d={toPath(TONGUE[ghost])} fill="none" stroke={ink} strokeWidth="2.6" strokeDasharray="4 5" opacity=".6" />
      ) : null}
      <path d={toPath(pts)} fill="#ff6fae" stroke={ink} strokeWidth="3.5" strokeLinejoin="round" />

      {labels ? (
        sound === "l" ? (
          <g>
            <circle cx={RIDGE.x} cy={RIDGE.y} r="6.5" fill="var(--voice)" stroke={ink} strokeWidth="3" />
            <path d="M64,96 C76,74 92,62 108,56" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
            <text x="112" y="58" fontSize="17" fontWeight="900" fill={ink}>
              付ける
            </text>
          </g>
        ) : (
          <g>
            <path d={`M${RIDGE.x + 3},${RIDGE.y + 2} L${tip.x - 4},${tip.y}`} stroke={ink} strokeWidth="2.6" strokeDasharray="2 4" strokeLinecap="round" />
            <path d="M74,100 C84,78 96,64 108,56" fill="none" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
            <text x="112" y="58" fontSize="17" fontWeight="900" fill={ink}>
              付けない
            </text>
          </g>
        )
      ) : null}
    </svg>
  );
}
