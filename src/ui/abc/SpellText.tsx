/**
 * A practice line with the letters said by their names drawn as small key caps — "Is that [B] as
 * in boy, or [V] as in very?", "the [P][D][F]". A single capital is a letter name only when the
 * line says so (`spell`: not the I of "I got", not the A of "A ..."); capitals run together
 * (BBC, ASAP, G.P.S.) always are.
 */
import { Fragment, useRef, type ReactNode } from "react";
import { MarkedWord, useItemMarks, useLinkWraps } from "../marks/Marked";
import type { LineMarks } from "../marks/lineMarks";

const CAP: React.CSSProperties = {
  display: "inline-block",
  minWidth: "1.05em",
  padding: "0 0.14em",
  marginInline: "0.02em",
  borderRadius: "0.22em",
  boxShadow: "inset 0 0 0 0.075em currentColor",
  textAlign: "center",
  lineHeight: 1.18,
};

/** with `marks`: the app's ● (strong syllable) and ‿ (running on) on the words; not on letters said by name */
export function SpellText({ text, spell, marks }: { text: string; spell: string[]; marks?: LineMarks | null }) {
  const set = new Set(spell.map((s) => s.toUpperCase()));
  const box = useRef<HTMLSpanElement>(null);
  const words = text.split(/\s+/).filter(Boolean);
  const mk = marks && marks.strong.length === words.length ? marks : null;
  useLinkWraps(box, mk);
  if (mk) {
    return (
      <span ref={box} className="mk-lines">
        {words.map((tok, i) => {
          const caps = keycaps(tok, set);
          return (
            <Fragment key={i}>
              <MarkedWord
                token={tok}
                strong={caps ? null : mk.strong[i]}
                link={!!mk.link[i] && i < words.length - 1}
                index={i}
                render={caps ? (slice, from) => caps.slice(from, from + slice.length) : undefined}
              />
              {i < words.length - 1 ? " " : null}
            </Fragment>
          );
        })}
      </span>
    );
  }
  const parts = text.split(/(\s+)/);
  const out: ReactNode[] = [];
  parts.forEach((tok, ti) => {
    if (/^\s+$/.test(tok) || !tok) {
      out.push(tok);
      return;
    }
    // capitals run together (with or without dots): every capital in it is a letter name
    const core = tok.replace(/[^A-Za-z.']/g, "");
    const acronym = /^(?:[A-Z]\.?){2,}(?:'s)?$/.test(core.replace(/\.$/, "")) || /^(?:[A-Z]\.){2,}$/.test(core);
    const single = /^[A-Z](?:'s)?\.?$/.test(core) && set.has(core[0]);
    if (!acronym && !single) {
      out.push(tok);
      return;
    }
    let buf = "";
    const chars = [...tok];
    chars.forEach((c, ci) => {
      if (/[A-Z]/.test(c) && (acronym || ci === chars.findIndex((x) => /[A-Z]/.test(x)))) {
        if (buf) out.push(buf);
        buf = "";
        out.push(
          <span key={`${ti}-${ci}`} style={CAP}>
            {c}
          </span>,
        );
      } else buf += c;
    });
    if (buf) out.push(buf);
  });
  return <>{out}</>;
}

/** a word said letter by letter, as one node per character (keycaps for the capitals); null if not one */
function keycaps(tok: string, set: Set<string>): ReactNode[] | null {
  const core = tok.replace(/[^A-Za-z.']/g, "");
  const acronym = /^(?:[A-Z]\.?){2,}(?:'s)?$/.test(core.replace(/\.$/, "")) || /^(?:[A-Z]\.){2,}$/.test(core);
  const single = /^[A-Z](?:'s)?\.?$/.test(core) && set.has(core[0]);
  if (!acronym && !single) return null;
  const chars = [...tok];
  const firstCap = chars.findIndex((x) => /[A-Z]/.test(x));
  return chars.map((c, ci) =>
    /[A-Z]/.test(c) && (acronym || ci === firstCap) ? (
      <span key={ci} style={CAP}>
        {c}
      </span>
    ) : (
      c
    ),
  );
}

/** a line from a list (id and text only): marked once its item is in */
export function SpellLine({ id, text, spell, ready = true }: { id: string; text: string; spell: string[]; ready?: boolean }) {
  const near = useRef<HTMLSpanElement>(null);
  const marks = useItemMarks(ready ? id : null, near);
  return (
    <span ref={near} className="mk-lines">
      <SpellText text={text} spell={spell} marks={marks} />
    </span>
  );
}
