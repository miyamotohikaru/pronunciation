"use client";

/**
 * Home: one card for the line to say next, as a karaoke caption — split into syllables with the
 * strong one big (ho·TEL, ・●), its meaning small. On arrival the caption wipes once in the two
 * meaning colours (お手本 cyan, then あなた yellow) to show what practice does; ▶ plays the model
 * with the wipe in time. Numbers once each, labelled (今日 0/5分, このセット 1/8). The route opens
 * only the current unit, as steps with minutes; later units stay folded. The one action sits at
 * the bottom where the thumb is, and says what happens: 「hotel を言ってみる・30秒」.
 * Progress is this device's best score per item (localStorage).
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemData } from "@/data/schema";
import { Player } from "@/engine/audio/player.ts";
import { IconCheck, IconMic, IconPlay, IconSpeaker } from "../icons";
import { allBest, loadSettings, type Best } from "../practice/progress";
import { fieldFor } from "../practice/fields";
import { fetchItem, refFor } from "../practice/content";
import { piecesFor } from "./stress";

export type HomeUnitView = { id: string; titleJa: string; subtitleJa: string; lessons: { id: string; titleJa: string; href: string; items: string[] }[] };

const DAILY_MIN = 5;
const MIN_PER_ITEM = 0.5; // a line takes about 30 s: listen, say, look
const minutes = (items: number) => Math.max(1, Math.round(items * MIN_PER_ITEM));

export default function HomeRoute({ units }: { units: HomeUnitView[] }) {
  const [best, setBest] = useState<Record<string, Best> | null>(null);
  useEffect(() => setBest(allBest()), []);

  const done = (id: string) => !!best?.[id];
  // the lesson to do next, and its first line not done yet
  let cur = { u: 0, l: 0, i: 0 };
  outer: for (let u = 0; u < units.length; u++)
    for (let l = 0; l < units[u].lessons.length; l++) {
      const i = units[u].lessons[l].items.findIndex((id) => !done(id));
      if (i >= 0) {
        cur = { u, l, i };
        break outer;
      }
    }
  const unit = units[cur.u];
  const lesson = unit.lessons[cur.l];
  const itemId = lesson.items[cur.i];
  const today = new Date().toDateString();
  const todayMin = best ? Math.floor(Object.values(best).filter((b) => new Date(b.at).toDateString() === today).length * MIN_PER_ITEM) : 0;
  const href = `${lesson.href}?i=${cur.i}`;

  const [item, setItem] = useState<ItemData | null>(null);
  useEffect(() => {
    let ok = true;
    fetchItem(itemId)
      .then((it) => ok && setItem(it))
      .catch(() => undefined); // also warms the practice screen
    return () => {
      ok = false;
    };
  }, [itemId]);
  const single = item ? item.words.length === 1 : false;

  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <header className="mx-auto flex h-14 w-full max-w-[720px] items-center justify-between px-4 md:h-16">
        <span className="text-[20px] font-black leading-none md:text-[24px]">発音カラオケ</span>
        <span className="text-[13px] font-medium" aria-label={`今日 ${todayMin}分 / ${DAILY_MIN}分`}>
          今日 <span className="num text-[15px] font-bold">{Math.min(todayMin, DAILY_MIN)}</span>
          <span className="num">/{DAILY_MIN}分</span>
        </span>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8">
        <NowCard unitId={unit.id} unitTitle={unit.titleJa} lessonTitle={lesson.titleJa} item={item} index={cur.i} count={lesson.items.length} />

        <h2 className="mt-8 text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_70%,transparent)]">ルート</h2>
        <ol className="mt-2 flex flex-col">
          {units.map((u, ui) => {
            const items = u.lessons.flatMap((l) => l.items);
            const left = items.filter((id) => !done(id)).length;
            const state = ui < cur.u ? "done" : ui === cur.u ? "now" : "next";
            if (state !== "now")
              return (
                <li key={u.id} className="border-t border-[#e3e5ef]">
                  <Link href={u.lessons[0].href} className="flex min-h-14 items-center gap-4 py-2">
                    <Marker state={state === "done" ? "done" : "next"} n={ui + 1} />
                    <span className={`min-w-0 flex-1 text-[15px] font-bold leading-tight ${state === "next" ? "text-[color-mix(in_srgb,var(--ink)_72%,transparent)]" : ""}`}>{u.titleJa}</span>
                    <span className="num shrink-0 text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_65%,transparent)]">{state === "done" ? "できた" : `${minutes(items.length)}分`}</span>
                  </Link>
                </li>
              );
            return (
              <li key={u.id} className="border-t border-[#e3e5ef] pb-2">
                <div className="flex min-h-14 items-center gap-4 py-2" aria-current="step">
                  <Marker state="now" n={ui + 1} />
                  <span className="min-w-0 flex-1 text-[16px] font-black leading-tight">{u.titleJa}</span>
                  <span className="num shrink-0 text-[13px] font-medium">のこり {minutes(left)}分</span>
                </div>
                <ol className="ml-[18px] border-l-2 border-[#d6d9e8] pl-[22px]">
                  {u.lessons.map((l, li) => {
                    const st = li < cur.l ? "done" : li === cur.l ? "now" : "next";
                    return (
                      <li key={l.id}>
                        <Link
                          href={st === "now" ? href : l.href}
                          className={`-ml-[33px] flex min-h-12 items-center gap-4 rounded-[12px] pr-2 ${st === "now" ? "bg-(--paper)" : ""}`}
                          aria-current={st === "now" ? "step" : undefined}
                        >
                          <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full" style={st === "done" ? { background: "var(--ink)", color: "var(--paper)" } : st === "now" ? { background: "var(--ink)", boxShadow: "0 0 0 4px #ffffff, 0 0 0 6px var(--ink)" } : { background: "#f4f5fa", boxShadow: "inset 0 0 0 2px #c3c7da" }}>
                            {st === "done" ? <IconCheck size={11} /> : null}
                          </span>
                          <span className={`min-w-0 flex-1 text-[15px] leading-tight ${st === "now" ? "font-bold" : "font-medium"}`}>{l.titleJa}</span>
                          <span className="num shrink-0 text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_65%,transparent)]">{st === "done" ? "できた" : `${minutes(l.items.length)}分`}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>
      </main>

      {/* the one action: at the bottom, where the thumb is */}
      <div className="sticky bottom-0 z-10 px-4 pt-6 [padding-bottom:max(16px,calc(env(safe-area-inset-bottom)+8px))]" style={{ background: "linear-gradient(to bottom, rgba(244,245,250,0), #f4f5fa 40%)" }}>
        <Link href={href} className="press press-ink mx-auto flex h-14 w-full max-w-[560px] text-[17px]">
          <IconMic size={20} />
          <span>
            {item ? (single ? <span className="en font-bold">{item.text}</span> : "この文") : "次の文"}
            <span> を言ってみる</span>
            <span className="num font-medium opacity-80">・30秒</span>
          </span>
        </Link>
      </div>
    </div>
  );
}

function Marker({ state, n }: { state: "done" | "now" | "next"; n: number }) {
  return (
    <span
      aria-hidden
      className="num grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-bold"
      style={state === "done" ? { background: "var(--ink)", color: "var(--paper)" } : state === "now" ? { background: "var(--ink)", color: "var(--paper)" } : { color: "color-mix(in srgb, var(--ink) 70%, transparent)", boxShadow: "inset 0 0 0 2px #c9cde0" }}
    >
      {state === "done" ? <IconCheck size={16} /> : n}
    </span>
  );
}

type Tone = "guide" | "voice" | null;

/** the line to say next, as a karaoke caption that shows what practice does */
function NowCard({ unitId, unitTitle, lessonTitle, item, index, count }: { unitId: string; unitTitle: string; lessonTitle: string; item: ItemData | null; index: number; count: number }) {
  const field = fieldFor(unitId);
  const voice = useMemo(() => loadSettings().voice, []);
  const pieces = useMemo(() => (item ? piecesFor(item, voice) : null), [item, voice]);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const legend = useRef<HTMLDivElement>(null);
  const clock = useRef<{ t: number | null; tone: Tone }>({ t: null, tone: null });
  const player = useRef<Player | null>(null);
  const buffer = useRef<Promise<AudioBuffer> | null>(null);
  const demo = useRef(0);
  const [playing, setPlaying] = useState(false);
  const flat = useMemo(() => (pieces ? pieces.flat() : []), [pieces]);
  const span = flat.length ? { a: flat[0].start, b: flat[flat.length - 1].end } : { a: 0, b: 1 };

  // the wipe: --p per syllable from the clock, the tone on the box (no React state per frame)
  useEffect(() => {
    if (!flat.length) return;
    let raf = 0;
    let last = "";
    const loop = () => {
      const { t, tone } = clock.current;
      const ps = flat.map((p) => (t === null ? 0 : Math.min(1, Math.max(0, (t - p.start) / Math.max(0.01, p.end - p.start)))));
      const sig = `${tone}|${ps.map((p) => p.toFixed(3)).join(",")}`;
      if (sig !== last) {
        last = sig;
        ps.forEach((p, i) => refs.current[i]?.style.setProperty("--p", String(p)));
        if (box.current) box.current.dataset.tone = tone ?? "";
        if (legend.current) legend.current.dataset.tone = tone ?? "";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [flat]);

  // once on arrival: お手本's wipe, then yours — slowed down so it can be read
  useEffect(() => {
    if (!flat.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const slow = 1.8;
    const len = (span.b - span.a) * slow;
    const t0 = performance.now() + 350;
    const id = ++demo.current;
    let raf = 0;
    const step = (now: number) => {
      if (id !== demo.current) return;
      const s = (now - t0) / 1000;
      const c = clock.current;
      if (s < 0) c.t = null;
      else if (s < len + 0.5) {
        c.tone = "guide";
        c.t = span.a + Math.min(len, s) / slow;
      } else if (s < 2 * len + 1.4) {
        c.tone = "voice";
        c.t = span.a + Math.min(len, s - len - 0.5) / slow;
      } else {
        c.t = null;
        c.tone = null;
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [flat, span.a, span.b]);

  // the model's audio, decoded ahead so ▶ starts inside the tap
  useEffect(() => {
    if (!item) return;
    const run = () => {
      player.current ??= new Player();
      buffer.current = player.current.load(refFor(item, voice).audio);
      buffer.current.catch(() => (buffer.current = null));
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const h = ric ? ric(run, { timeout: 2000 }) : window.setTimeout(run, 800);
    return () => {
      if (!ric) clearTimeout(h);
      player.current?.stop();
    };
  }, [item, voice]);

  const play = async () => {
    const p = (player.current ??= new Player());
    if (playing) {
      p.stop();
      return;
    }
    demo.current++; // the arrival wipe stops
    const c = clock.current;
    c.t = null;
    c.tone = "guide";
    const buf = await (buffer.current ?? (buffer.current = p.load(refFor(item!, voice).audio)));
    p.events = {
      onPlayhead: (e) => {
        c.t = e.t;
        c.tone = "guide";
      },
      onEnd: () => {
        c.t = null;
        c.tone = null;
        setPlaying(false);
      },
    };
    void p.play(buf);
    setPlaying(true);
  };

  const size = !item ? "text-[64px]" : item.text.length > 18 ? "text-[36px]" : item.text.length > 10 ? "text-[46px]" : "text-[72px]";

  return (
    <section aria-label="次に言う文" className={`${field} mt-2 rounded-[24px] bg-(--field) px-6 pb-6 pt-4 text-(--field-ink)`}>
      <p className="flex items-center justify-between gap-4 text-[13px] font-medium">
        <span className="min-w-0 truncate">
          {unitTitle} ・ {lessonTitle}
        </span>
        <span className="shrink-0">
          このセット <span className="num text-[15px] font-bold">{index + 1}</span>
          <span className="num">/{count}</span>
        </span>
      </p>

      <div ref={box} className="hero-cap mt-6">
        {pieces && item ? (
          <>
            <p className={`telop en ${size} flex flex-wrap items-baseline gap-x-[0.28em] gap-y-[0.3em] pb-[0.3em] leading-[1.15]`}>
              <span className="sr-only">{`${item.text}。強く読むところ：${flat.filter((p) => p.strong).map((p) => p.text.toLowerCase()).join("、")}`}</span>
              {(() => {
                let k = 0;
                return pieces.map((w, wi) => (
                  <span key={wi} aria-hidden className="inline-flex items-baseline">
                    {w.map((p) => {
                      const i = k++;
                      return (
                        // every syllable box has the line's own strut, so the small ones share the
                        // big ones' height and baseline — and the stress dots sit on one line
                        <span key={i} className="relative inline-block">
                          <span
                            ref={(el) => {
                              refs.current[i] = el;
                            }}
                            className="telop-word"
                            style={{ fontSize: p.strong ? "1em" : "0.7em", fontWeight: p.strong ? 800 : 700, verticalAlign: "baseline" }}
                          >
                            <span className="tl tl-a">
                              {p.text}
                              {p.dot ? <span className="tl-dot">·</span> : null}
                            </span>
                            <span className="tl tl-b">
                              {p.text}
                              {p.dot ? <span className="tl-dot">·</span> : null}
                            </span>
                          </span>
                          {/* the stress pattern under its own syllable: ・ weak, ● strong */}
                          <span
                            aria-hidden
                            className="absolute left-1/2 top-full -translate-x-1/2 rounded-full bg-(--field-ink)"
                            style={p.strong ? { width: "0.2em", height: "0.2em", marginTop: "0.02em" } : { width: "0.1em", height: "0.1em", marginTop: "0.07em" }}
                          />
                        </span>
                      );
                    })}
                  </span>
                ));
              })()}
            </p>
          </>
        ) : (
          <span aria-hidden className={`block ${size} h-[1.5em]`} />
        )}
      </div>
      <p className="jp mt-2 min-h-5 text-[13px] font-medium" style={{ color: "color-mix(in srgb, var(--field-ink) 85%, transparent)" }}>
        {item ? item.ja.replace(/\n/g, "") : ""}
      </p>

      <div className="mt-6 flex items-center justify-between gap-4">
        {/* the two meaning colours, lit in turn by the wipe */}
        <div ref={legend} className="hero-legend flex items-center gap-2 text-[13px] font-bold" aria-hidden>
          <span data-k="guide" className="inline-flex h-8 items-center gap-2 rounded-full px-3">
            <span className="size-2 rounded-full bg-(--guide)" />
            お手本
          </span>
          <span className="opacity-70">→</span>
          <span data-k="voice" className="inline-flex h-8 items-center gap-2 rounded-full px-3">
            <span className="size-2 rounded-full bg-(--voice)" />
            あなた
          </span>
        </div>
        <button type="button" onClick={play} disabled={!item} aria-pressed={playing} aria-label={playing ? "お手本を止める" : "お手本を聞く"} className="press press-guide h-12 shrink-0 px-4 text-[15px]">
          {playing ? <IconSpeaker size={18} /> : <IconPlay size={15} />}
          聞く
        </button>
      </div>
    </section>
  );
}
