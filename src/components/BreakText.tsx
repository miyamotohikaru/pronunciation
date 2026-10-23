import { Fragment } from "react";
import MobileBreak from "./MobileBreak";

/**
 * 地の文に埋め込んだ改行の記号を、実際の改行に開く（kosukuma 系の共通の作り）。
 *
 *   ◆ … 携帯のときだけ改行する
 *   ◇ … 携帯でもパソコンでも改行する
 *
 * この2記号は、このサイトの文言（values.json / lineages.ts）に出てこないことを確認して選んだ。
 * 長い本文には使わない（本文は行を埋めて端をそろえる）。
 */
export default function BreakText({ text }: { text: string }) {
  const parts = text.split(/([◆◇])/);
  return (
    <>
      {parts.map((s, i) => {
        if (s === "◆") return <MobileBreak key={i} />;
        if (s === "◇") return <br key={i} />;
        return <Fragment key={i}>{s}</Fragment>;
      })}
    </>
  );
}
