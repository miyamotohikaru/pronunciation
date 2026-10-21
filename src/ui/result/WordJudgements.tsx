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
  /** karaoke judgement of the syllables while you spoke (KaraokeJudge counts); replaces the word counts */
  counts?: Record<"perfect" | "great" | "good" | "miss", number>;
};

const BAR_LABEL = { perfect: "PERFECT", great: "GREAT", good: "GOOD", miss: "MISS" } as const;
const BAR_VAR = { perfect: "var(--j-perfect)", great: "var(--j-great)", good: "var(--j-good)", miss: "#b9bde6" } as const;

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

export default function WordJudgements({ words, notes = [], onOpen, counts }: WordJudgementsProps) {
  const texts = words.map((w) => w.text);
  const tiles = counts
    ? (["perfect", "great", "good", "miss"] as const).map((k) => ({ key: k, label: BAR_LABEL[k], bg: BAR_VAR[k], n: counts[k] }))
    : ORDER.map((j) => ({ key: j, label: JUDGEMENT_LABEL[j], bg: JUDGEMENT_VAR[j], n: words.filter((w) => judge(w.score) === j).length }));
  return (
    <section aria-label="判定" className="w-full">
      {counts ? <h3 className="mb-2 text-[13px] font-black leading-none">話している間の判定（音節ごと）</h3> : null}
      <ul className="grid grid-cols-4 gap-2" aria-label="判定の数">
        {tiles.map((t) => (
          <li key={t.key} className="flex flex-col items-center gap-2 rounded-[16px] bg-(--field-deep) px-1 pb-3 pt-[10px]">
            <span
              className="inline-flex h-[26px] items-center justify-center rounded-full border-[3px] border-(--ink) px-2 text-[11px] font-black leading-none text-(--ink)"
              style={{ background: t.bg }}
            >
              {t.label}
            </span>
            <span className="num text-[24px] font-black leading-none text-(--field-ink)">{t.n}</span>
          </li>
        ))}
      </ul>
      {counts ? <h3 className="mb-1 mt-6 text-[13px] font-black leading-none">単語ごとの音</h3> : null}
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
