"use client";

/**
 * 自己紹介 通しで: the best whole-script run per script on this device (localStorage, wrapped:
 * private mode and blocked storage just mean nothing is kept).
 */
import { useEffect, useState } from "react";

const KEY = "kara.v1.run";
export type RunBest = { score: number; at: number };

function readAll(): Record<string, RunBest> {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as Record<string, RunBest>) : {};
  } catch {
    return {};
  }
}

/** returns the previous best (null if none) */
export function saveRunBest(id: string, score: number): RunBest | null {
  const all = readAll();
  const prev = all[id] ?? null;
  if (!prev || score > prev.score) {
    all[id] = { score, at: Date.now() };
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable */
    }
  }
  return prev;
}

export function useRunBest(id: string): RunBest | null {
  const [v, setV] = useState<RunBest | null>(null);
  useEffect(() => {
    const read = () => setV(readAll()[id] ?? null);
    read();
    window.addEventListener("pageshow", read);
    return () => window.removeEventListener("pageshow", read);
  }, [id]);
  return v;
}
