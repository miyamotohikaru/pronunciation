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
import { IconCheck, IconMic, IconNext, IconPlay } from "../icons";
import { allBest, loadSettings, type Best } from "../practice/progress";
import { fieldFor } from "../practice/fields";
import { fetchItem, refFor } from "../practice/content";
import { lineIpa } from "../ipa";
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
        <NowCard unitId={unit.id} item={item} index={cur.i} count={lesson.items.length} href={href} lessonMin={minutes(lesson.items.length - cur.i)} />

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
                <ol className="ml-[8px]">
                  {u.lessons.map((l, li) => {
                    const st = li < cur.l ? "done" : li === cur.l ? "now" : "next";
                    const last = li === u.lessons.length - 1;
                    return (
                      <li key={l.id} className="relative">
                        {/* the line runs from this step to the next one, and stops at the last */}
                        {last ? null : <span aria-hidden className="absolute left-[19px] top-6 h-12 w-[2px] bg-[#d6d9e8]" />}
                        <Link href={st === "now" ? href : l.href} className={`relative flex min-h-12 items-center gap-4 rounded-[12px] pl-[10px] pr-2 ${st === "now" ? "bg-(--paper)" : ""}`} aria-current={st === "now" ? "step" : undefined}>
                          <Step state={st} />
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
    </div>
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

/** a lesson step: ✓ done, ▶ the one you are on (not a radio button), a small dot for later */
function Step({ state }: { state: "done" | "now" | "next" }) {
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
      <span className="size-2 rounded-full bg-[#c3c7da]" />
    </span>
  );
}

type Flow = "idle" | "model" | "turn" | "done";

/**
 * The line to say next, and the one button that runs it: お手本 paints the blocks in cyan, then
 * your voice paints them in yellow over the top (the yellow moves only while you are actually
 * speaking), then the button takes you into the lesson.
 */
function NowCard({ unitId, item, index, count, href, lessonMin }: { unitId: string; item: ItemData | null; index: number; count: number; href: string; lessonMin: number }) {
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

  const single = item ? item.words.length === 1 : false;
  // fit the line to the card: the blocks' weighted length decides the size (cqw of the card)
  const weight = flat.reduce((a, s) => a + s.text.length * (s.strong ? 1 : 0.7), 0) + flat.filter((s) => s.dot).length * 0.4 + Math.max(0, (pieces?.length ?? 1) - 1) * 0.3;
  const fit = weight <= 14 ? `min(84px, calc(100cqw / ${(Math.max(4, weight) * 0.66).toFixed(2)}))` : "clamp(30px, 8.4cqw, 44px)";

  const label =
    flow === "model" ? "お手本を聞いています" : flow === "turn" ? "どうぞ（自動で止まります）" : flow === "done" ? "このまま練習する" : single && item ? `聞いて、${item.text} と言ってみる` : "聞いて、言ってみる";

  return (
    <section aria-label="次に言う文" className={`${field} mt-2 rounded-[24px] bg-(--field) px-6 pb-6 pt-4 text-(--field-ink) [container-type:inline-size]`}>
      <p className="flex items-center justify-end text-[13px] font-medium">
        このセット <span className="num ml-1 text-[15px] font-bold">{index + 1}</span>
        <span className="num">/{count}</span>
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
                          <span key={i} className="relative inline-block">
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
                              {s.dot ? <span className="hero-dot">·</span> : null}
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
          <span>
            {label}
            <span className="num ml-1 text-[13px] font-medium opacity-70">{flow === "done" ? `・${lessonMin}分` : flow === "idle" ? "・10秒" : ""}</span>
          </span>
        </button>
        {flow === "done" ? (
          <button type="button" onClick={() => (setFlow("idle"), (clock.current = { g: null, v: null }))} className="mt-2 h-11 w-full text-[14px] font-bold">
            もう一度、聞いて言う
          </button>
        ) : null}
      </div>
    </section>
  );
}
