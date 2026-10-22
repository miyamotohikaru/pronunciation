/**
 * A practice line with the letters said by their names drawn as small key caps — "Is that [B] as
 * in boy, or [V] as in very?", "the [P][D][F]". A single capital is a letter name only when the
 * line says so (`spell`: not the I of "I got", not the A of "A ..."); capitals run together
 * (BBC, ASAP, G.P.S.) always are.
 */
import type { ReactNode } from "react";

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

export function SpellText({ text, spell }: { text: string; spell: string[] }) {
  const set = new Set(spell.map((s) => s.toUpperCase()));
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
