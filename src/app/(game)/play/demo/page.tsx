import type { Metadata } from "next";
import PracticeScreen, { type PracticeState } from "@/ui/PracticeScreen";
import { demoItem, demoProgress, demoTakes } from "@/ui/mock";

export const metadata: Metadata = { title: "練習｜発音カラオケ" };

const STATES: PracticeState[] = ["listen", "recording", "thinking", "result", "detail"];

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | string[] | undefined) => {
  const n = Number(one(v));
  return one(v) !== undefined && Number.isFinite(n) ? n : null;
};

/**
 * /play/demo — the practice screen with mock data.
 * Review any state with ?state=listen|recording|thinking|result|detail
 *   &take=1|2|3   which attempt (2 shows the ghost + delta)
 *   &t=0.7        freeze the playhead (listen) or the live take (recording) at t seconds
 *   &word=3       which word the detail card opens on
 */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = one(sp.state) as PracticeState | undefined;
  const state = s && STATES.includes(s) ? s : undefined;
  const take = num(sp.take);
  return (
    <PracticeScreen
      key={[state, take, one(sp.t), one(sp.word)].join("|")}
      item={demoItem}
      takes={demoTakes}
      progress={{ index: demoProgress.index, total: demoProgress.total, combo: demoProgress.combo }}
      backHref="/home"
      nextHref="/home"
      initial={{
        state,
        take: take && take >= 1 && take <= demoTakes.length ? take : undefined,
        t: num(sp.t),
        word: num(sp.word),
      }}
    />
  );
}
