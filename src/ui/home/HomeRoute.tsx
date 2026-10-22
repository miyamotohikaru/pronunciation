"use client";

/**
 * Home: one card for the line to say next — its syllables as blocks, the strong ones big (ho·TEL,
 * ・●), outlined as one shape; its sounds dictionary-style; its meaning small. One main button
 * runs the whole loop on the card: お手本 plays and paints the blocks (cyan), then it listens and
 * your voice paints them again, in yellow, over the top; then it takes you into the lesson.
 * The route opens only the current unit, as steps with minutes; later units stay folded.
 * Progress is this device's best score per item (localStorage).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemData } from "@/data/schema";
import type { MicRecorder } from "@/engine/audio/mic-recorder.ts";
import { Player } from "@/engine/audio/player.ts";
import { audioCore } from "@/engine/audio/context.ts";
import { IconCheck, IconMic, IconNext, IconPlay, IconStar } from "../icons";
import { allBest, loadSettings, type Best } from "../practice/progress";
import { fieldFor } from "../practice/fields";
import { fetchItem, refFor } from "../practice/content";
import { lineIpa } from "../ipa";
import { piecesFor } from "./stress";

export type HomeUnitView = { id: string; titleJa: string; subtitleJa: string; lessons: { id: string; titleJa: string; href: string; items: string[]; boss?: boolean }[] };

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

  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <header className="mx-auto flex h-14 w-full max-w-[720px] items-center justify-between px-4 md:h-16">
        <span className="text-[20px] font-black leading-none md:text-[24px]">発音カラオケ</span>
        <span className="flex items-center gap-2 text-[13px] font-medium" aria-label={`今日の目標 ${todayMin}分 / ${DAILY_MIN}分`}>
          <GoalRing k={Math.min(1, todayMin / DAILY_MIN)} />
          今日 <span className="num -ml-1 text-[15px] font-bold">{Math.min(todayMin, DAILY_MIN)}</span>
          <span className="num -ml-2">/{DAILY_MIN}分</span>
        </span>
      </header>

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-8">
        <NowCard unitId={unit.id} lessonTitle={lesson.titleJa} item={item} index={cur.i} count={lesson.items.length} href={href} lessonMin={minutes(lesson.items.length - cur.i)} />

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
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[15px] font-bold leading-tight ${state === "next" ? "text-[color-mix(in_srgb,var(--ink)_78%,transparent)]" : ""}`}>{u.titleJa}</span>
                      <UnitBar k={(items.length - left) / Math.max(1, items.length)} />
                    </span>
                    <span className="num shrink-0 text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_72%,transparent)]">{left === 0 ? "できた" : `のこり ${minutes(left)}分`}</span>
                  </Link>
                </li>
              );
            return (
              <li key={u.id} className="border-t border-[#e3e5ef] pb-2">
                <div className="flex min-h-14 items-center gap-4 py-2" aria-current="step">
                  <Marker state="now" n={ui + 1} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-black leading-tight">{u.titleJa}</span>
                    <UnitBar k={(items.length - left) / Math.max(1, items.length)} />
                  </span>
                  <span className="num shrink-0 text-[13px] font-medium">のこり {minutes(left)}分</span>
                </div>
                <ol className="ml-[8px]">
                  {u.lessons.map((l, li) => {
                    const st = li < cur.l ? "done" : li === cur.l ? "now" : "next";
                    const last = li === u.lessons.length - 1;
                    return (
                      <li key={l.id} className="relative">
                        {/* the line runs from this step to the next one, and stops at the last */}
                        {last ? null : <span aria-hidden className="absolute left-[19px] top-6 h-12 w-[2px] bg-[#a9aec8]" />}
                        <Link href={st === "now" ? href : l.href} className={`relative flex min-h-12 items-center gap-4 rounded-[12px] pl-[10px] pr-2 ${st === "now" ? "bg-(--paper)" : ""}`} aria-current={st === "now" ? "step" : undefined}>
                          <Step state={st} boss={l.boss} />
                          <span className={`min-w-0 flex-1 text-[15px] leading-tight ${st === "now" || l.boss ? "font-bold" : "font-medium"}`}>
                            {l.boss ? <span className="mr-2 rounded-full bg-(--ink) px-2 py-[2px] align-[2px] text-[12px] font-bold text-(--paper)">まとめ</span> : null}
                            {l.titleJa}
                          </span>
                          <span className="num shrink-0 text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_72%,transparent)]">{st === "done" ? "できた" : `のこり ${minutes(st === "now" ? l.items.length - cur.i : l.items.length)}分`}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>

        {/* the other corners */}
        <h2 className="mt-8 text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_70%,transparent)]">ほかの練習</h2>
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {CORNERS.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="flex min-h-16 items-center gap-3 rounded-[16px] bg-(--paper) px-4 py-3">
                <span aria-hidden className="ipa grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#eef0f8] text-[17px] font-bold">
                  {c.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold leading-tight">{c.title}</span>
                  <span className="mt-1 block text-[13px] font-medium leading-tight text-[color-mix(in_srgb,var(--ink)_72%,transparent)]">{c.sub}</span>
                </span>
                <IconNext size={16} />
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

const CORNERS = [
  { href: "/challenge", mark: "Go", title: "チャレンジ", sub: "長い文・自己紹介・会話" },
  { href: "/sounds", mark: "/ð/", title: "発音記号", sub: "42の音を1つずつ" },
  { href: "/abc", mark: "Aa", title: "アルファベット", sub: "26文字と、つづりの伝え方" },
];

/** today's goal, as a ring that fills */
function GoalRing({ k }: { k: number }) {
  const r = 8;
  const len = 2 * Math.PI * r;
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5 -rotate-90">
      <circle cx="10" cy="10" r={r} fill="none" stroke="#d6d9e8" strokeWidth="3" />
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - k)} />
    </svg>
  );
}

/** a unit's progress, a thin bar under its name */
function UnitBar({ k }: { k: number }) {
  return (
    <span aria-hidden className="mt-[6px] block h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-[#dfe2ee]">
      <span className="block h-full origin-left rounded-full bg-(--ink)" style={{ transform: `scaleX(${k})` }} />
    </span>
  );
}

function Marker({ state, n }: { state: "done" | "now" | "next"; n: number }) {
  return (
    <span
      aria-hidden
      className="num grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-bold"
      style={state === "next" ? { color: "color-mix(in srgb, var(--ink) 70%, transparent)", boxShadow: "inset 0 0 0 2px #c9cde0" } : { background: "var(--ink)", color: "var(--paper)" }}
    >
      {state === "done" ? <IconCheck size={16} /> : n}
    </span>
  );
}

/** a lesson step: ✓ done, ▶ the one you are on (not a radio button), a small dot for later, ★ the unit's まとめ */
function Step({ state, boss }: { state: "done" | "now" | "next"; boss?: boolean }) {
  if (boss && state === "next")
    return (
      <span aria-hidden className="relative z-[1] grid size-5 shrink-0 place-items-center text-(--ink)">
        <IconStar size={16} />
      </span>
    );
  if (state === "done")
    return (
      <span aria-hidden className="relative z-[1] grid size-5 shrink-0 place-items-center rounded-full bg-(--ink) text-(--paper)">
        <IconCheck size={11} />
      </span>
    );
  if (state === "now")
    return (
      <span aria-hidden className="relative z-[1] grid size-5 shrink-0 place-items-center rounded-[6px] bg-(--ink) pl-[1px] text-(--paper)">
        <IconPlay size={9} />
      </span>
    );
  return (
    <span aria-hidden className="relative z-[1] grid size-5 shrink-0 place-items-center">
      <span className="size-[10px] rounded-full bg-[#8f95b3]" />
    </span>
  );
}

type Flow = "idle" | "model" | "turn" | "done";

/**
 * The line to say next, and the one button that runs it: お手本 paints the blocks in cyan, then
 * your voice paints them in yellow over the top (the yellow moves only while you are actually
 * speaking), then the button takes you into the lesson.
 */
function NowCard({ unitId, lessonTitle, item, index, count, href, lessonMin }: { unitId: string; lessonTitle: string; item: ItemData | null; index: number; count: number; href: string; lessonMin: number }) {
  const router = useRouter();
  const field = fieldFor(unitId);
  const voice = useMemo(() => loadSettings().voice, []);
  const pieces = useMemo(() => (item ? piecesFor(item, voice) : null), [item, voice]);
  const flat = useMemo(() => (pieces ? pieces.flat() : []), [pieces]);
  const span = flat.length ? { a: flat[0].start, b: flat[flat.length - 1].end } : { a: 0, b: 1 };
  const guideRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const voiceRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const clock = useRef<{ g: number | null; v: number | null }>({ g: null, v: null });
  const level = useRef(0);
  const ringRef = useRef<HTMLSpanElement>(null);
  const player = useRef<Player | null>(null);
  const buffer = useRef<Promise<AudioBuffer> | null>(null);
  const rec = useRef<MicRecorder | null>(null);
  const [flow, setFlow] = useState<Flow>("idle");
  const flowRef = useRef<Flow>("idle");
  flowRef.current = flow;

  // the wipes: --p per syllable block from the two clocks (no React state per frame)
  useEffect(() => {
    if (!flat.length) return;
    let raf = 0;
    let last = "";
    const loop = () => {
      const { g, v } = clock.current;
      const p = (t: number | null, s: (typeof flat)[number]) => (t === null ? 0 : Math.min(1, Math.max(0, (t - s.start) / Math.max(0.01, s.end - s.start))));
      const pg = flat.map((s) => p(g, s));
      const pv = flat.map((s) => p(v, s));
      const sig = `${pg.map((x) => x.toFixed(3)).join(",")}|${pv.map((x) => x.toFixed(3)).join(",")}`;
      if (sig !== last) {
        last = sig;
        pg.forEach((x, i) => guideRefs.current[i]?.style.setProperty("--p", String(x)));
        pv.forEach((x, i) => voiceRefs.current[i]?.style.setProperty("--p", String(x)));
      }
      if (ringRef.current) ringRef.current.style.transform = `scale(${1 + (flowRef.current === "turn" ? level.current * 0.25 : 0)})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [flat]);

  // the model's audio, decoded ahead so the button starts it inside the tap
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
      rec.current?.cancel();
    };
  }, [item, voice]);

  // your turn: listen, and move the yellow only while you are speaking (at the model's pace)
  const listen = async () => {
    setFlow("turn");
    const { MicRecorder } = await import("@/engine/audio/mic-recorder.ts");
    const c = clock.current;
    let loudUntil = 0;
    let lastNow = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = (now - lastNow) / 1000;
      lastNow = now;
      if (now < loudUntil) c.v = Math.min(span.b, (c.v ?? span.a) + dt);
      raf = requestAnimationFrame(step);
    };
    const r = new MicRecorder(
      { workletUrl: "/worklets/mic-capture.js", vad: { maxDurationMs: 5000 }, playback: false },
      {
        onLevel: (e) => {
          level.current = Math.min(1, Math.max(0, (e.db + 60) / 45));
          if (e.db > e.floorDb + 9) loudUntil = performance.now() + 120;
        },
      },
    );
    rec.current = r;
    raf = requestAnimationFrame(step);
    try {
      await r.record();
    } catch {
      /* no mic, or stopped: the yellow stays where it got to */
    }
    cancelAnimationFrame(raf);
    level.current = 0;
    setFlow("done");
  };

  const press = async () => {
    if (!item) return;
    if (flow === "done") return router.push(href);
    if (flow === "turn") return rec.current?.stop();
    if (flow === "model") return;
    void audioCore.unlock(); // inside the tap, before anything is awaited (iOS)
    const p = (player.current ??= new Player());
    const c = clock.current;
    c.g = null;
    c.v = null;
    const buf = await (buffer.current ?? (buffer.current = p.load(refFor(item, voice).audio)));
    p.events = {
      onPlayhead: (e) => {
        c.g = e.t;
      },
      onEnd: (completed) => {
        c.g = span.b; // the blocks stay painted in お手本's colour
        if (completed) void listen();
        else setFlow("idle");
      },
    };
    void p.play(buf);
    setFlow("model");
  };

  // fit the line to the card: the blocks' weighted length decides the size (cqw of the card)
  const weight = flat.reduce((a, s) => a + s.text.length * (s.strong ? 1 : 0.7), 0) + flat.filter((s) => s.dot).length * 0.4 + Math.max(0, (pieces?.length ?? 1) - 1) * 0.3;
  const fit = weight <= 14 ? `min(84px, calc(100cqw / ${(Math.max(4, weight) * 0.66).toFixed(2)}))` : "clamp(30px, 8.4cqw, 44px)";

  // the button says what it does (a verb); how it works goes small underneath
  const label = flow === "model" ? "お手本を聞いています" : flow === "turn" ? "話してください" : flow === "done" ? "練習を続ける" : "話す";
  const note = flow === "idle" ? "お手本のあとに話します・自動で止まります" : flow === "turn" ? "言い終わると、自動で止まります" : flow === "done" ? `このレッスンの のこり ${lessonMin}分` : " ";


  return (
    <section
      aria-label="次に言う文"
      onClick={(e) => {
        // the whole card presses the button (except the button itself, which handles its own tap)
        if ((e.target as HTMLElement).closest("button, a")) return;
        void press();
      }}
      className={`${field} mt-2 cursor-pointer rounded-[24px] bg-(--field) px-6 pb-6 pt-4 text-(--field-ink) [container-type:inline-size]`}
    >
      <p className="flex items-center justify-between gap-4 text-[13px] font-medium">
        <span className="min-w-0 truncate font-bold">{lessonTitle}</span>
        <span className="shrink-0">
          このセット <span className="num ml-1 text-[15px] font-bold">{index + 1}</span>
          <span className="num">/{count}</span>
        </span>
      </p>

      {/* the syllable blocks: an outline layer under one fill, then the two colours wiping over it */}
      <div className="mt-4">
        {pieces && item ? (
          <p className="hero en relative grid leading-[1.15]" style={{ fontSize: fit }}>
            <span className="sr-only">{`${item.text}。強く読むところ：${flat.filter((s) => s.strong).map((s) => s.text.toLowerCase()).join("、")}`}</span>
            {(["outline", "fill", "guide", "voice"] as const).map((layer) => {
              let k = 0;
              return (
                <span key={layer} aria-hidden className={`hero-layer hero-${layer} flex flex-wrap items-baseline gap-x-[0.28em] gap-y-[0.3em] pb-[0.32em]`} style={{ gridArea: "1 / 1" }}>
                  {pieces.map((w, wi) => (
                    <span key={wi} className="inline-flex items-baseline">
                      {w.map((s) => {
                        const i = k++;
                        return (
                          // each block keeps the line's own strut: big and small blocks share a baseline
                          <span key={i} className="relative inline-block" style={s.dot ? { marginRight: "0.14em" } : undefined}>
                            <span
                              ref={
                                layer === "guide"
                                  ? (el) => {
                                      guideRefs.current[i] = el;
                                    }
                                  : layer === "voice"
                                    ? (el) => {
                                        voiceRefs.current[i] = el;
                                      }
                                    : undefined
                              }
                              className="hero-block"
                              style={{ fontSize: s.strong ? "1em" : "0.7em", fontWeight: s.strong ? 800 : 700 }}
                            >
                              {s.text}
                            </span>
                            {layer === "fill" ? (
                              // the stress pattern under its own block: ・ weak, ● strong
                              <span className="absolute left-1/2 top-full -translate-x-1/2 rounded-full bg-(--field-ink)" style={s.strong ? { width: "0.2em", height: "0.2em", marginTop: "0.02em" } : { width: "0.1em", height: "0.1em", marginTop: "0.07em" }} />
                            ) : null}
                          </span>
                        );
                      })}
                    </span>
                  ))}
                </span>
              );
            })}
          </p>
        ) : (
          <span aria-hidden className="block h-[96px]" />
        )}
      </div>
      {item ? (
        <>
          <p className="ipa mt-2 text-[16px] leading-snug" style={{ color: "color-mix(in srgb, var(--field-ink) 92%, transparent)" }}>
            {lineIpa(item)}
          </p>
          <p className="jp mt-1 min-h-5 text-[13px] font-medium" style={{ color: "color-mix(in srgb, var(--field-ink) 85%, transparent)" }}>
            {item.ja.replace(/\n/g, "")}
          </p>
        </>
      ) : null}

      {/* the one button, for the whole loop */}
      <div className="mt-6">
        <button type="button" onClick={press} disabled={!item} aria-live="polite" className={`press ${flow === "turn" ? "press-ink" : ""} h-14 w-full text-[16px]`}>
          <span ref={ringRef} aria-hidden className={`grid size-8 place-items-center rounded-full will-change-transform ${flow === "turn" ? "bg-(--paper) text-(--ink)" : "bg-(--ink) text-(--paper)"}`}>
            {flow === "done" ? <IconNext size={15} /> : flow === "idle" || flow === "model" ? <IconPlay size={13} /> : <IconMic size={16} />}
          </span>
          <span className="text-[17px]">{label}</span>
        </button>
        <p className="mt-2 min-h-4 text-center text-[13px] font-medium" style={{ color: "color-mix(in srgb, var(--field-ink) 88%, transparent)" }}>
          {note}
        </p>
        {flow === "done" ? (
          <button type="button" onClick={() => (setFlow("idle"), (clock.current = { g: null, v: null }))} className="mt-1 h-11 w-full text-[14px] font-bold">
            もう一度、聞いて話す
          </button>
        ) : null}
      </div>
    </section>
  );
}
