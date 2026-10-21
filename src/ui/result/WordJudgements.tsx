/**
 * Per-word judgement list for a sentence (JOYSOUND phrase list for speech):
 * the counts first, then every word with its grade; tap a word to compare it sound by sound.
 */
import type { Judgement, WordScore } from "../types";
import { JUDGEMENT_LABEL, JUDGEMENT_VAR, judge } from "../score";
import { heardLine, noteLine } from "../copy";
import BreakText from "@/components/BreakText";
import type { ProsodyNote } from "../types";

export type WordJudgementsProps = {
  words: WordScore[];
  notes?: ProsodyNote[];
  onOpen: (i: number) => void;
};

const ORDER: Judgement[] = ["perfect", "great", "good", "almost"];

export function Chip({ j, size = "md" }: { j: Judgement; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-[3px] border-(--ink) font-black leading-none text-(--ink) ${
        size === "sm" ? "h-[26px] px-2 text-[11px]" : "h-[30px] px-3 text-[13px]"
      }`}
      style={{ background: JUDGEMENT_VAR[j] }}
    >
      {JUDGEMENT_LABEL[j]}
    </span>
  );
}

export default function WordJudgements({ words, notes = [], onOpen }: WordJudgementsProps) {
  const counts = ORDER.map((j) => [j, words.filter((w) => judge(w.score) === j).length] as const);
  const texts = words.map((w) => w.text);
  return (
    <section aria-label="単語ごとの判定" className="w-full">
      <ul className="grid grid-cols-4 gap-2" aria-label="判定の数">
        {counts.map(([j, n]) => (
          <li key={j} className="flex flex-col items-center gap-2 rounded-[16px] bg-(--field-deep) px-1 pb-3 pt-[10px]">
            <Chip j={j} size="sm" />
            <span className="num text-[24px] font-black leading-none">{n}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-4 flex flex-col">
        {words.map((w, i) => {
          const j = judge(w.score);
          const worst = [...w.phones].sort((a, b) => a.score - b.score)[0];
          const heard = worst ? heardLine(worst) : null;
          const note = notes.find((n) => n.word === i);
          return (
            <li key={i} className="border-b-2 border-(--field-deep) last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(i)}
                className="flex min-h-[56px] w-full items-center gap-3 py-2 text-left"
              >
                <span className="w-[86px] shrink-0">
                  <Chip j={j} size="sm" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[19px] font-black leading-tight">{w.text}</span>
                  {heard || note ? (
                    <span className="jp mt-[3px] block text-[12px] font-bold leading-snug">
                      <BreakText text={heard ? heard + "。" : noteLine(note!, texts)} />
                    </span>
                  ) : null}
                </span>
                <span className="num shrink-0 text-[15px] font-black">{w.score}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
