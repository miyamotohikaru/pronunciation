import type { Metadata } from "next";
import ScoreLab from "./ScoreLab";

export const metadata: Metadata = {
  title: "score lab",
  robots: { index: false, follow: false },
};

/** Engineering test bench for src/engine/scoring inside the app (noindex, not linked). */
export default function ScoreLabPage() {
  return <ScoreLab />;
}
