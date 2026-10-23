import type { Metadata } from "next";
import LearnDemo from "@/ui/learn/LearnDemo";
import { lesson } from "@/ui/mock";

export const metadata: Metadata = { title: "レッスン｜発音カラオケ" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /learn/demo — lesson start with mock data.
 *   ?step=ear            jump to the ear-training question
 *   &answer=A|B          show the feedback for that answer
 *   &q=0..3              which question
 */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const step = one(sp.step) === "ear" ? "ear" : "intro";
  const a = one(sp.answer);
  const answer = a === "A" || a === "B" ? a : null;
  const q = Number(one(sp.q) ?? 0);
  return (
    <LearnDemo
      key={[step, answer, q].join("|")}
      lesson={lesson}
      backHref="/home"
      nextHref="/play/demo"
      initial={{ step, answer, q: Number.isFinite(q) ? q : 0 }}
    />
  );
}
