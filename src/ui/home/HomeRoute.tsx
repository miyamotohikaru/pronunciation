"use client";

/**
 * Home: one card for the line to say next — its syllables as blocks, the strong ones big (ho·TEL,
 * ○●); its sounds dictionary-style; its meaning small. お手本を聞く plays it with a light running
 * over the syllables; タップして話す listens and your voice paints them; then into the lesson.
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
import { IconCheck, IconFlame, IconMic, IconNext, IconPlay, IconSpeaker, IconStar, IconStop } from "../icons";
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
  // days in a row with something practised (today, or up to yesterday)
  const streak = (() => {
    if (!best) return 0;
    const days = new Set(Object.values(best).map((b) => new Date(b.at).toDateString()));
    const d = new Date();
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(d.toDateString())) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  })();

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
        <span className="flex items-center gap-3 text-[13px] font-medium">
          {streak > 0 ? (
            <span className="flex items-center gap-1" aria-label={`${streak}日続いています`}>
              <IconFlame size={16} />
              <span className="num text-[15px] font-bold">{streak}</span>日
            </span>
          ) : null}
          <span className="flex items-center gap-2" aria-label={`今日の目標 ${todayMin}分 / ${DAILY_MIN}分`}>
            <GoalRing k={Math.min(1, todayMin / DAILY_MIN)} />
            今日 <span className="num -ml-1 text-[15px] font-bold">{Math.min(todayMin, DAILY_MIN)}</span>
            <span className="num -ml-2">/{DAILY_MIN}分</span>
          </span>
        </span>
      </header>
      {streak === 0 && todayMin === 0 ? (
        // nothing yet: something to look forward to, not an empty ring
        <p className="mx-auto -mt-1 w-full max-w-[720px] px-4 text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_78%,transparent)]">最初の1文で、連続記録がはじまります。</p>
      ) : null}

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
                      <LessonDots lessons={u.lessons.map((l) => ({ done: l.items.every((id) => done(id)), boss: !!l.boss }))} />
                    </span>
                    <span className="num w-14 shrink-0 text-right text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_72%,transparent)]">{left === 0 ? "できた" : `${minutes(left)}分`}</span>
                  </Link>
                </li>
              );
            return (
              <li key={u.id} className="border-t border-[#e3e5ef] pb-2">
                <div className="flex min-h-14 items-center gap-4 py-2" aria-current="step">
                  <Marker state="now" n={ui + 1} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-black leading-tight">{u.titleJa}</span>
                    <LessonDots lessons={u.lessons.map((l, li) => ({ done: li < cur.l, boss: !!l.boss }))} />
                  </span>
                  <span className="num w-20 shrink-0 text-right text-[13px] font-medium">のこり {minutes(left)}分</span>
                </div>
                <ol>
                  {u.lessons.map((l, li) => {
                    const st = li < cur.l ? "done" : li === cur.l ? "now" : "next";
                    const last = li === u.lessons.length - 1;
                    return (
                      <li key={l.id} className="relative">
                        {/* the line runs from this step to the next one, and stops at the last */}
                        {/* one axis: the line, the steps and the star are centred under the unit's number */}
                        {last ? null : <span aria-hidden className="absolute left-[17px] top-6 h-12 w-[2px] bg-[#8f95b3]" />}
                        <Link href={st === "now" ? href : l.href} className={`relative flex min-h-12 items-center gap-4 rounded-[12px] pl-[8px] ${st === "now" ? "bg-(--paper)" : ""}`} aria-current={st === "now" ? "step" : undefined}>
                          <Step state={st} boss={l.boss} />
                          <span className={`min-w-0 flex-1 text-[15px] leading-tight ${st === "now" || l.boss ? "font-bold" : "font-medium"}`}>
                            {l.boss ? <span className="mr-2 rounded-full bg-(--ink) px-2 py-[2px] align-[2px] text-[12px] font-bold text-(--paper)">まとめ</span> : null}
                            {l.titleJa}
                          </span>
                          {st === "now" ? (
                            <span className={`${fieldFor(u.id)} shrink-0 rounded-full bg-(--field) px-2 py-[2px] text-[12px] font-bold text-(--field-ink)`}>いまここ</span>
                          ) : null}
                          <span className="num w-14 shrink-0 text-right text-[13px] font-medium text-[color-mix(in_srgb,var(--ink)_72%,transparent)]">{st === "done" ? "できた" : `${minutes(st === "now" ? l.items.length - cur.i : l.items.length)}分`}</span>
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
        <p className="mt-10 text-center text-[13px] font-medium">
          <Link href="/credits" className="underline underline-offset-2">
            クレジット（使わせてもらっている声・図・データ）
          </Link>
        </p>
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
    <svg aria-hidden viewBox="0 0 20 20" className="size-6 -rotate-90">
      {/* a coloured base, so an empty day still shows the ring to fill */}
      <circle cx="10" cy="10" r={r} fill="#e3f1fb" stroke="#a9d3ef" strokeWidth="3" />
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - k)} />
    </svg>
  );
}

/** a unit's progress as its lessons, one dot each (● done, ○ not yet, ☆ the まとめ) — never an empty bar */
function LessonDots({ lessons }: { lessons: { done: boolean; boss: boolean }[] }) {
  return (
    <span aria-hidden className="mt-[7px] flex items-center gap-[6px]">
      {lessons.map((l, i) =>
        l.boss ? (
          <span key={i} className="grid size-[11px] place-items-center text-(--ink)">
            <IconStar size={11} filled={l.done} />
          </span>
        ) : (
          <span key={i} className="size-[8px] rounded-full" style={l.done ? { background: "var(--ink)" } : { boxShadow: "inset 0 0 0 1.5px #9aa0bb" }} />
        ),
      )}
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
 * The line to say next. Two buttons: お手本を聞く plays it and a light runs over its syllables in
 * their own time; タップして話す listens, and your voice paints the syllables (the same one colour)
 * only while you are actually speaking; then the button takes you into the lesson. When the card
 * opens, the light runs over the syllables once by itself (no sound), so the rhythm shows first.
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
  // g: お手本's clock (playing), sweep: the silent light on open (start time), fade: the light going out
  const clock = useRef<{ g: number | null; v: number | null; sweep: number | null; fade: number | null }>({ g: null, v: null, sweep: null, fade: null });
  const level = useRef(0);
  const ringRef = useRef<HTMLSpanElement>(null);
  const player = useRef<Player | null>(null);
  const buffer = useRef<Promise<AudioBuffer> | null>(null);
  const rec = useRef<MicRecorder | null>(null);
  const [flow, setFlow] = useState<Flow>("idle");
  // when the card's button has scrolled off the screen, the same button waits at the bottom
  const mainBtn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = mainBtn.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAway(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const flowRef = useRef<Flow>("idle");
  flowRef.current = flow;

  // the light: --p (how far painted) and --o (how bright) per syllable block, from the clocks
  useEffect(() => {
    if (!flat.length) return;
    let raf = 0;
    let last = "";
    const loop = (now: number) => {
      const c = clock.current;
      const p = (t: number | null, s: (typeof flat)[number]) => (t === null ? 0 : Math.min(1, Math.max(0, (t - s.start) / Math.max(0.01, s.end - s.start))));
      let pg: number[];
      let og: number[];
      if (c.sweep !== null && now >= c.sweep) {
        // on open: each syllable lights up as the light reaches it, then dims again
        const t = span.a + (now - c.sweep) / 1000;
        pg = flat.map((s) => (t >= s.start ? 1 : 0));
        og = flat.map((s) => (t < s.start ? 0 : t <= s.end ? 1 : Math.max(0, 1 - (t - s.end) / 0.35)));
        if (t > span.b + 0.4) c.sweep = null;
      } else {
        pg = flat.map((s) => p(c.g, s));
        const k = c.fade === null ? 1 : Math.max(0, 1 - (now - c.fade) / 450);
        og = flat.map(() => k);
        if (c.fade !== null && k === 0) {
          c.fade = null;
          c.g = null;
        }
      }
      const pv = flat.map((s) => p(c.v, s));
      const sig = `${pg.map((x) => x.toFixed(3)).join(",")}|${og.map((x) => x.toFixed(2)).join(",")}|${pv.map((x) => x.toFixed(3)).join(",")}`;
      if (sig !== last) {
        last = sig;
        pg.forEach((x, i) => {
          const el = guideRefs.current[i];
          if (!el) return;
          el.style.setProperty("--p", String(x));
          el.style.setProperty("--o", og[i].toFixed(2));
        });
        pv.forEach((x, i) => voiceRefs.current[i]?.style.setProperty("--p", String(x)));
      }
      if (ringRef.current) ringRef.current.style.transform = `scale(${1 + (flowRef.current === "turn" ? level.current * 0.3 : 0)})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [flat]); // eslint-disable-line react-hooks/exhaustive-deps

  // once, when the card opens: the light runs over the syllables by itself (no sound)
  const swept = useRef(false);
  useEffect(() => {
    if (!flat.length || swept.current) return;
    swept.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    clock.current.sweep = performance.now() + 450;
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

  // your turn: listen, and move the paint only while you are speaking (at the model's pace)
  const speak = async () => {
    if (!item) return;
    if (flow === "done") return router.push(href);
    if (flow === "turn") return rec.current?.stop();
    player.current?.stop();
    void audioCore.unlock(); // inside the tap (iOS)
    const c = clock.current;
    c.sweep = null;
    c.fade = performance.now(); // お手本's light goes out
    c.v = null;
    setFlow("turn");
    const { MicRecorder } = await import("@/engine/audio/mic-recorder.ts");
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
      /* no mic, or stopped: the paint stays where it got to */
    }
    cancelAnimationFrame(raf);
    level.current = 0;
    setFlow("done");
  };

  // お手本を聞く: plays it; the light runs with it and goes out at the end
  const listen = async () => {
    if (!item || flow === "turn") return;
    const p = (player.current ??= new Player());
    if (flow === "model") {
      p.stop();
      return;
    }
    void audioCore.unlock(); // inside the tap, before anything is awaited (iOS)
    const c = clock.current;
    c.sweep = null;
    c.fade = null;
    c.g = null;
    const buf = await (buffer.current ?? (buffer.current = p.load(refFor(item, voice).audio)));
    p.events = {
      onPlayhead: (e) => {
        c.g = e.t;
      },
      onEnd: () => {
        c.g = span.b;
        c.fade = performance.now() + 500;
        setFlow((f) => (f === "model" ? (c.v !== null ? "done" : "idle") : f));
      },
    };
    void p.play(buf);
    setFlow("model");
  };

  // fit the line to the card: the blocks' weighted length decides the size (cqw of the card)
  const weight = flat.reduce((a, s) => a + s.text.length * (s.strong ? 1 : 0.7), 0) + flat.filter((s) => s.dot).length * 0.15 + Math.max(0, (pieces?.length ?? 1) - 1) * 0.36;
  // a short line big; a long one shrinks to fit (it wraps between words, never inside one)
  const fit = weight <= 14 ? `min(84px, calc(100cqw / ${(Math.max(4, weight) * 0.64).toFixed(2)}))` : `max(20px, min(44px, calc(100cqw / ${(weight * 0.35).toFixed(2)})))`;

  // the main button says what it does; while you speak it looks different (not a filled button)
  const talking = flow === "turn";
  const label = talking ? "話しています" : flow === "done" ? "練習を続ける" : "タップして話す";
  const note = talking ? "言い終わると、自動で止まります（タップでも止まります）" : flow === "done" ? `このレッスンの のこり ${lessonMin}分` : "お手本を聞いてから話しても、すぐ話しても";

  return (
    <section
      ref={card}
      aria-label="次に言う文"
      className={`${field} hero-card relative mt-2 overflow-hidden rounded-[24px] bg-(--paper) px-6 pb-6 pt-5 text-(--ink) [container-type:inline-size]`}
    >
      {/* a clean band at the top, clear of the rounded corners (so it never tapers into a crescent) */}
      <span aria-hidden className="absolute inset-x-6 top-0 h-[5px] rounded-b-[4px] bg-(--ink)" />
      <p className="flex items-center justify-between gap-4 text-[13px] font-medium">
        {/* the same lesson as the route's 「いまここ」 row (orange is for 「いまここ」 only) */}
        <span className="min-w-0 truncate rounded-full bg-[#eef0f8] px-3 py-[3px] font-bold">{lessonTitle}</span>
        <span className="shrink-0">
          このセット <span className="num ml-1 text-[15px] font-bold">{index + 1}</span>
          <span className="num">/{count}</span>
        </span>
      </p>

      {/* the syllable blocks: the ink line, then the one colour painting over it (light / your voice) */}
      <div className="mt-4">
        {pieces && item ? (
          <p className="hero en relative grid leading-[1.15]" style={{ fontSize: fit }}>
            <span className="sr-only">{`${item.text}。強く読むところ：${flat.filter((s) => s.strong).map((s) => s.text.toLowerCase()).join("、")}`}</span>
            {(["fill", "guide", "voice"] as const).map((layer) => {
              let k = 0;
              return (
                // syllables of a word close together, words well apart (the gap between words is 2× and more)
                <span key={layer} aria-hidden className={`hero-layer hero-${layer} flex flex-wrap items-baseline gap-x-[0.36em] gap-y-[0.34em] pb-[0.36em]`} style={{ gridArea: "1 / 1" }}>
                  {pieces.map((w, wi) => (
                    <span key={wi} className="inline-flex items-baseline">
                      {w.map((s) => {
                        const i = k++;
                        return (
                          // each block keeps the line's own strut: big and small blocks share a baseline
                          <span key={i} className="relative inline-block" style={s.dot ? { marginRight: "0.02em" } : undefined}>
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
                              style={{ fontSize: s.strong ? "1em" : "0.7em", fontWeight: s.strong ? 700 : 600 }}
                            >
                              {s.text}
                            </span>
                            {layer === "fill" ? (
                              // the stress pattern under its block, one colour: ● strong (2.5× and filled), ○ weak
                              <span
                                className="absolute left-1/2 top-full -translate-x-1/2 rounded-full"
                                style={
                                  s.strong
                                    ? { width: "0.24em", height: "0.24em", marginTop: "0.02em", background: "var(--ink)" }
                                    : { width: "0.096em", height: "0.096em", marginTop: "0.09em", boxShadow: "inset 0 0 0 max(1.5px, 0.022em) var(--ink)" }
                                }
                              />
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
          <p className="ipa mt-2 text-[16px] leading-snug" style={{ color: "color-mix(in srgb, var(--ink) 85%, transparent)" }}>
            {lineIpa(item)}
          </p>
          <p className="jp mt-1 min-h-5 text-[13px] font-medium" style={{ color: "color-mix(in srgb, var(--ink) 80%, transparent)" }}>
            {item.ja.replace(/\n/g, "")}
          </p>
        </>
      ) : null}

      {/* listen (quiet) and speak (the main one) */}
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={listen} disabled={!item || talking} aria-pressed={flow === "model"} className="press press-line h-14 shrink-0 px-4 text-[15px]">
          {flow === "model" ? <IconSpeaker size={18} /> : <IconPlay size={13} />}
          お手本を聞く
        </button>
        <button
          ref={mainBtn}
          type="button"
          onClick={speak}
          disabled={!item}
          aria-live="polite"
          className={`press ${talking ? "press-line" : "press-ink"} h-14 min-w-0 flex-1 text-[16px]`}
          style={talking ? { boxShadow: "inset 0 0 0 3px var(--ink)", background: "color-mix(in srgb, var(--guide) 14%, white)" } : undefined}
        >
          <span ref={ringRef} aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full will-change-transform ${talking ? "bg-(--ink) text-(--paper)" : "bg-(--paper) text-(--ink)"}`}>
            {flow === "done" ? <IconNext size={15} /> : talking ? <IconStop size={13} /> : <IconMic size={16} />}
          </span>
          <span className="truncate text-[16px]">{label}</span>
        </button>
      </div>
      <p className="mt-2 min-h-4 text-center text-[12px] font-medium" style={{ color: "color-mix(in srgb, var(--ink) 78%, transparent)" }}>
        {note}
      </p>
      {flow === "done" ? (
        <button
          type="button"
          onClick={() => {
            setFlow("idle");
            clock.current = { g: null, v: null, sweep: null, fade: null };
          }}
          className="mt-1 h-11 w-full text-[14px] font-bold"
        >
          もう一度話す
        </button>
      ) : null}
      {away ? (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-[#f4f5fa] px-4 pt-3 shadow-[0_-1px_0_#dfe2ee] [padding-bottom:max(16px,calc(env(safe-area-inset-bottom)+10px))]">
          <button
            type="button"
            onClick={() => {
              card.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              void speak();
            }}
            className="press press-ink mx-auto flex h-14 w-full max-w-[560px] text-[16px]"
          >
            <IconMic size={18} />
            {flow === "done" ? "練習を続ける" : "タップして話す"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
