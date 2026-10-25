"use client";

/**
 * This device's best score per line (the practice screen saves them; localStorage). null until
 * mounted, so the server HTML and the first client render agree. Re-read when the page comes back.
 */
import { useEffect, useState } from "react";
import { allBest } from "../../practice/progress";

export function useBest(): Record<string, number> | null {
  const [best, setBest] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    const read = () => setBest(Object.fromEntries(Object.entries(allBest()).map(([k, v]) => [k, v.score])));
    read();
    const onVis = () => document.visibilityState === "visible" && read();
    window.addEventListener("pageshow", read);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("pageshow", read);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", read);
    };
  }, []);
  return best;
}

/** average of the scores that exist (null when none) */
export function averageOf(ids: string[], best: Record<string, number> | null): number | null {
  if (!best) return null;
  const s = ids.map((id) => best[id]).filter((x): x is number => x !== undefined);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}
