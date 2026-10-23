/**
 * Any short text in the karaoke-telop style (white fill, thick navy outline, slight drop).
 * `cells` lays digits in fixed-width cells so a counting score never jitters.
 */
import type { CSSProperties } from "react";

export type TelopTextProps = {
  text: string;
  /** fill colour (CSS value); white by default */
  fill?: string;
  cells?: boolean;
  className?: string;
  style?: CSSProperties;
  /** outline thickness, em */
  stroke?: number;
};

export default function TelopText({ text, fill, cells, className, style, stroke }: TelopTextProps) {
  const content = cells ? [...text].map((c, i) => <Cell key={i} c={c} />) : text;
  const s = stroke ?? 0.25;
  return (
    <span className={`telop relative inline-block ${className ?? ""}`} style={style} aria-hidden>
      <span
        className="tl-a whitespace-pre"
        style={{ ["--tl-fill" as string]: fill ?? "var(--paper)", ["--telop-stroke" as string]: `${s}em` }}
      >
        {content}
      </span>
    </span>
  );
}

function Cell({ c }: { c: string }) {
  const narrow = c === "." || c === ",";
  const sign = c === "+" || c === "-" || c === "−";
  return (
    <span className="inline-block text-center" style={{ width: narrow ? "0.32em" : sign ? "0.62em" : "0.64em" }}>
      {c}
    </span>
  );
}
