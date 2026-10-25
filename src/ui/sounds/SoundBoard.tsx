"use client";

/**
 * /sounds — 発音一覧: the 42 sounds on one screen. Pressing a sound never leaves the page: the viewer
 * (fixed at the top, half the phone at most; the right column on a wide screen) changes in place —
 *   - the symbol and its name; the mouth (お手本's tongue moves from the last sound to this one)
 *   - how to say it in one line (くわしく opens the rest right here)
 *   - its words to hear (ゆっくり: slower) and its minimal pairs in one small row (while a pair's
 *     other word plays, the tongue goes to that sound and back; a diphthong's words show its glide)
 *   - a mic: say the chosen word; the practice's own scorer judges this sound in it — ○ heard as
 *     itself / ✕ heard as another (then your tongue over お手本's, ① the way to go, and one switch
 *     お手本 ⇄ あなた to hear both)
 * The list under it: 母音 / 二重母音 / 子音 (by how they are made), ✓ on the ones you passed.
 * Light: the scorer (24 MB) is fetched after you pick a sound (when idle) or touch the mic, never on
 * open; a word's audio when pressed. The mouth moves from refs (no React render per frame).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import BreakText from "@/components/BreakText";
import type { ItemData } from "@/data/schema";
import type { MicRecorder, Take } from "@/engine/audio";
import { heardLabel } from "@/engine/scoring/heard-labels.ts";
import { audioCore } from "@/engine/audio/context.ts";
import { IconBack, Marked, br } from "../challenge/common/bits";
import { clipUrl, myVoice, play, stopListening, useNowPlaying } from "../challenge/common/listen";
import { newWordRecorder, onScoringStatus, playableTake, scoringStatus, startScoring, warmRecorder } from "../practice/audio";
import { fetchItem, type VoiceId } from "../practice/content";
import Sagittal, { SAG_VIEW, type SagittalApi } from "../mouth/Sagittal";
import { shapeFor, type ShapeKey } from "../mouth/geometry";
import { marksFor } from "../SoundCoach";
import { soundNameJa } from "../ipa";
import { mark } from "../score";
import type { PhoneScore } from "../types";
import { IconCheck, IconMic, IconPlay, IconSpeaker, IconStop } from "../icons";
import type { BoardSound } from "./data.server";
import { loadPassed, savePassed } from "./passed";

type Check =
  | { state: "idle" }
  | { state: "recording" }
  | { state: "scoring" }
  | { state: "done"; ok: boolean; text: string; sub: string | null; heard: ShapeKey | null; heardPhone: string | null; take: Take }
  | { state: "error"; text: string };

type ScoredPhone = { phone: string; score: number; heardAs?: string; issue?: string };

/** the phone of this sound in the word (ə is AH with stress 0, ʌ any other AH; the flap is a t/d) */
function isThisSound(phone: string, s: BoardSound): boolean {
  const base = phone.replace(/[0-2]$/, "");
  const stress = phone.match(/([0-2])$/)?.[1];
  if (s.id === "DX") return base === "T" || base === "D" || base === "DX";
  if (s.id === "AH0" || s.id === "ER0") return base === s.arpabet && stress === "0";
  if (s.id === "AH" || s.id === "ER") return base === s.arpabet && stress !== "0";
  return base === s.arpabet;
}

type IdleWindow = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };

export default function SoundBoard({ sounds }: { sounds: BoardSound[] }) {
  const [at, setAt] = useState(0);
  const s = sounds[at];
  const [ex, setEx] = useState(0);
  const [slow, setSlow] = useState(false);
  const [more, setMore] = useState(false);
  const [voice, setVoice] = useState<VoiceId>("af_heart");
  const [passed, setPassed] = useState<Set<string>>(() => new Set());
  const [item, setItem] = useState<{ id: string; data: ItemData | null } | null>(null);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [scorer, setScorer] = useState(() => ({ ...scoringStatus() }));
  const [side, setSide] = useState<"model" | "you">("you");
  const nowPlaying = useNowPlaying();
  const api = useRef<SagittalApi | null>(null);
  const recRef = useRef<MicRecorder | null>(null);
  const level = useRef(0);
  const ring = useRef<HTMLSpanElement>(null);
  const onOther = useRef(false);
  const asked = useRef(false);
  const [askedScorer, setAskedScorer] = useState(false);
  const alive = useRef(true);

  // the device's voice and passes; ?s=IY opens that sound
  useEffect(() => {
    alive.current = true;
    setVoice(myVoice());
    setPassed(loadPassed());
    const q = new URLSearchParams(window.location.search).get("s")?.toLowerCase();
    if (q) {
      const k = sounds.findIndex((x) => x.id.toLowerCase() === q || x.slug === q);
      if (k >= 0) setAt(k);
    }
    const off = onScoringStatus(() => setScorer({ ...scoringStatus() }));
    // the audio context (suspended until a tap) is made while idle: the first word starts without a hitch
    const g = window as unknown as IdleWindow;
    const make = () => {
      try {
        audioCore.ensure();
      } catch {
        /* no Web Audio: the words just will not play */
      }
    };
    if (g.requestIdleCallback) g.requestIdleCallback(make, { timeout: 3000 });
    else setTimeout(make, 1200);
    return () => {
      alive.current = false;
      off();
      recRef.current?.cancel();
    };
  }, [sounds]);

  // the scorer, only once you are using the page: when idle after a pick, or at once from the mic
  const wantScorer = useCallback((now = false) => {
    if (asked.current) return;
    asked.current = true;
    const go = () => {
      startScoring();
      warmRecorder();
      setAskedScorer(true);
    };
    const g = window as unknown as IdleWindow;
    if (now) go();
    else if (g.requestIdleCallback) g.requestIdleCallback(go, { timeout: 2500 });
    else setTimeout(go, 600);
  }, []);

  // the chosen word's item (what the mic scores): small, fetched when the word is chosen
  const word = s.examples[ex] ?? null;
  useEffect(() => {
    const clip = word?.clip ?? null;
    if (!clip) {
      setItem({ id: "", data: null });
      return;
    }
    let ok = true;
    setItem((it) => (it?.id === clip ? it : null));
    fetchItem(clip)
      .then((d) => ok && setItem({ id: clip, data: d }))
      .catch(() => ok && setItem({ id: clip, data: null }));
    return () => {
      ok = false;
    };
  }, [word?.clip]);

  const pick = (k: number) => {
    if (k === at) return;
    stopListening();
    recRef.current?.cancel();
    setAt(k);
    setEx(0);
    setMore(false);
    setCheck({ state: "idle" });
    window.history.replaceState(null, "", `?s=${encodeURIComponent(sounds[k].id)}`);
    wantScorer();
  };

  const url = (clip: string) => clipUrl(clip, voice, slow ? ".slower" : "");
  const glideTo = s.mouth?.glideTo ?? null;

  const playWord = (k: number) => {
    const e = s.examples[k];
    if (k !== ex) {
      setEx(k);
      setCheck({ state: "idle" });
    }
    wantScorer();
    if (!e?.clip) return;
    void play([url(e.clip)], {
      key: `ex-${s.slug}-${k}`,
      onPlayhead: glideTo
        ? () => {
            if (onOther.current) return;
            onOther.current = true;
            api.current?.morph(glideTo, 420);
          }
        : undefined,
      onEnd: () => {
        if (!onOther.current) return;
        onOther.current = false;
        setTimeout(() => api.current?.morph(null, 320), 260);
      },
    });
  };

  const playPair = (k: number) => {
    const p = s.pairs[k];
    if (!p.aClip || !p.bClip) return;
    wantScorer();
    const other = p.other?.shape && s.mouth && p.other.shape !== s.mouth.target ? p.other.shape : null;
    void play([url(p.aClip), url(p.bClip)], {
      key: `pair-${s.slug}-${k}`,
      gap: 0.5,
      onPlayhead: (e) => {
        if (e.item === 1 && other && !onOther.current) {
          onOther.current = true;
          api.current?.morph(other, 300);
        }
      },
      // the other word's tongue stays a moment, then back to this sound
      onEnd: () => {
        if (!onOther.current) return;
        onOther.current = false;
        setTimeout(() => api.current?.morph(null, 320), 500);
      },
    });
  };

  // ---- say the word: the practice's recorder (stops by itself) and scorer
  const ready = scorer.ready;
  const itemReady = !!item?.data;
  const doCheck = () => {
    if (check.state === "recording") {
      recRef.current?.stop();
      return;
    }
    if (!ready) {
      wantScorer(true);
      return;
    }
    if (!item?.data || check.state === "scoring") return;
    stopListening();
    const it = item.data;
    const target = s;
    const rec = newWordRecorder({ onLevel: (e) => (level.current = Math.min(1, Math.max(0, (e.db + 60) / 45))) });
    recRef.current = rec;
    const pending = rec.record(); // synchronous inside the tap (iOS)
    setCheck({ state: "recording" });
    pending
      .then(async (take) => {
        level.current = 0;
        if (!alive.current) return;
        if (!take.speech) {
          setCheck({ state: "error", text: "声が聞こえませんでした。◇もう一度どうぞ。" });
          return;
        }
        setCheck({ state: "scoring" });
        const scored = await startScoring().score(take.pcm16k, it.words, { ...it.scoring });
        if (!alive.current) return;
        const phones = (scored.words[0]?.phones ?? []) as ScoredPhone[];
        const ph = phones.find((p) => isThisSound(p.phone, target)) ?? null;
        const sym = `/${target.ipa}/`;
        if (!ph) {
          setCheck({ state: "done", ok: false, text: `${sym} が聞こえませんでした`, sub: null, heard: null, heardPhone: null, take });
          return;
        }
        const m = mark({ phone: ph.phone, score: ph.score, heardAs: ph.heardAs, issue: ph.issue } as PhoneScore);
        if (m !== "miss") {
          setCheck({ state: "done", ok: true, text: `${sym} に聞こえました`, sub: null, heard: null, heardPhone: null, take });
          setPassed((old) => {
            if (old.has(target.slug)) return old;
            const n = new Set(old).add(target.slug);
            savePassed(n);
            return n;
          });
          return;
        }
        const heard = ph.heardAs ?? null;
        const shape = heard ? shapeFor(heard) : null;
        const tShape = target.mouth?.target ?? null;
        const name = heard && /^[A-Z]{1,2}$/.test(heard) ? soundNameJa(heard) : null;
        setSide("you");
        setCheck({
          state: "done",
          ok: false,
          text: heard ? `${heardLabel(heard)} に聞こえました` : ph.issue === "deletion" ? `${sym} が聞こえませんでした` : `${sym} が少しあいまいでした`,
          sub: name && name !== heard ? name : null,
          heard: shape && tShape && shape !== tShape ? shape : null,
          heardPhone: heard,
          take,
        });
      })
      .catch((e: unknown) => {
        level.current = 0;
        if (!alive.current) return;
        const n = (e as DOMException)?.name;
        setCheck(n === "AbortError" ? { state: "idle" } : { state: "error", text: "マイクが使えません。◇もう一度、押してください。" });
      });
  };
  // the mic's ring follows your voice while it listens
  useEffect(() => {
    if (check.state !== "recording") return;
    let raf = 0;
    const loop = () => {
      if (ring.current) ring.current.style.transform = `scale(${1 + level.current * 0.25})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [check.state]);

  // test hook (tools/e2e/sounds.e2e.mjs)
  useEffect(() => {
    (window as unknown as { __sounds?: unknown }).__sounds = {
      sel: s.id,
      word: word?.word ?? null,
      item: item ? (item.data ? "ready" : "missing") : "loading",
      scorer: { ready: scorer.ready, progress: scorer.progress },
      check: check.state === "done" ? { state: "done", ok: check.ok, heard: check.heardPhone, text: check.text } : { state: check.state },
    };
  });

  const done = check.state === "done" ? check : null;
  const overlay = done && !done.ok && done.heard && s.mouth ? done.heard : null;
  const target = s.mouth?.target ?? "neutral";
  const pct = Math.round((scorer.progress ?? 0) * 100);
  const micLabel =
    check.state === "recording"
      ? "聞いています"
      : check.state === "scoring"
        ? "くらべています"
        : !itemReady && item
          ? "この語は準備中"
          : askedScorer && !ready
            ? `準備中 ${pct}%`
            : word
              ? `${word.word} と言ってみる`
              : "言ってみる";

  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      {/* the page's header, as wide as the page (the list and the viewer side by side on a wide screen) */}
      <header className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-1 px-2 md:h-16">
        <Link href="/home" aria-label="ホームにもどる" className="grid size-11 shrink-0 place-items-center rounded-full">
          <IconBack />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-black leading-none md:text-[20px]">発音一覧</h1>
        <Link href="/sounds/symbols" className="inline-flex min-h-11 items-center px-2 text-[13px] font-bold underline decoration-[1.5px] underline-offset-4">
          記号の読み方
        </Link>
      </header>
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-10 min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] min-[900px]:items-start min-[900px]:gap-6">
        {/* ---------------- the viewer: what to do with the tongue, how it sounds, try it */}
        <section
          aria-label={`/${s.ipa}/ ${s.name.text}`}
          className="sticky top-0 z-10 -mx-4 max-h-[50dvh] overflow-y-auto bg-(--field) px-4 pb-3 pt-1 shadow-[0_8px_12px_-12px_rgba(12,15,51,.35)] min-[900px]:top-4 min-[900px]:order-2 min-[900px]:mx-0 min-[900px]:max-h-[calc(100dvh-2rem)] min-[900px]:px-0 min-[900px]:shadow-none"
        >
          <div className="rounded-[22px] bg-(--paper) p-3 text-(--ink) min-[900px]:p-5">
            <div className="flex gap-3">
              {/* the mouth (a picture of what the line beside it says) */}
              <div aria-hidden className="relative w-[44%] max-w-[230px] shrink-0 overflow-hidden rounded-[16px] bg-[#f3f4f9] min-[900px]:w-[52%]" style={{ aspectRatio: `${SAG_VIEW.w} / ${SAG_VIEW.h}` }}>
                <Sagittal
                  target={target}
                  heard={overlay}
                  pos={1}
                  api={api}
                  marks={overlay ? marksFor(s.arpabet) : undefined}
                  active={!!nowPlaying.key && nowPlaying.key.startsWith("model-")}
                  className="absolute inset-0 block size-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2">
                  <span className="ipa text-[40px] leading-none min-[900px]:text-[56px]">{s.ipa}</span>
                </p>
                <p className="mt-1 text-[14px] font-bold leading-snug">
                  {s.name.text}
                  {s.name.symbol ? <span className="ipa ml-1">{s.name.symbol}</span> : null}
                </p>
                <p className="jp mt-1 text-[13px] font-medium leading-snug opacity-90">
                  <BreakText text={br(s.tipJa.trim())} />
                </p>
                <p className="flex flex-wrap items-center gap-x-4 text-[13px] font-bold">
                  <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="inline-flex min-h-11 items-center underline decoration-[1.5px] underline-offset-4">
                    {more ? "とじる" : "くわしく"}
                  </button>
                  {s.practice.count ? (
                    <Link href={`/sounds/${s.slug}`} className="inline-flex min-h-11 items-center underline decoration-[1.5px] underline-offset-4">
                      文で練習（{s.practice.count}文）
                    </Link>
                  ) : null}
                </p>
              </div>
            </div>
            {more ? (
              <p className="jp mt-1 rounded-[14px] bg-[#f3f4f9] px-3 py-2 text-[13px] font-medium leading-relaxed">
                <BreakText text={br(s.howJa.trim())} />
              </p>
            ) : null}

            {/* its words: press to hear (and to choose the one to say) */}
            <div role="group" aria-label="例の語" className="mt-2 flex flex-wrap gap-[6px]">
              {s.examples.map((e, k) => {
                const on = k === ex;
                const sounding = nowPlaying.key === `ex-${s.slug}-${k}`;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => playWord(k)}
                    disabled={!e.clip}
                    aria-pressed={on}
                    aria-label={`${e.word} を聞く`}
                    className="en inline-flex h-11 items-center gap-[4px] rounded-full px-[11px] text-[15px] font-medium disabled:opacity-40"
                    style={on ? { background: "var(--ink)", color: "var(--paper)" } : { background: "#eef0f8" }}
                  >
                    {sounding ? <IconSpeaker size={12} /> : null}
                    <span>
                      <Marked marked={e.marked} word={e.word} />
                    </span>
                  </button>
                );
              })}
            </div>

            {/* the pairs, one small row: the other word moves the tongue to its sound */}
            {s.pairs.length && !(done && !done.ok) ? (
              <div role="group" aria-label="最小対" className="-mx-1 mt-2 flex gap-[6px] overflow-x-auto px-1 pb-1">
                {s.pairs.map((p, k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => playPair(k)}
                    disabled={!p.aClip || !p.bClip}
                    aria-label={`${p.a} と ${p.b} を聞きくらべる`}
                    className="en inline-flex h-11 shrink-0 items-center gap-[5px] rounded-full px-3 text-[14px] font-medium shadow-[inset_0_0_0_1.5px_#dfe2ee] disabled:opacity-40"
                    style={nowPlaying.key === `pair-${s.slug}-${k}` ? { background: "#e8f5fd" } : undefined}
                  >
                    {p.a}
                    <span aria-hidden className="opacity-60">
                      ⇄
                    </span>
                    {p.b}
                  </button>
                ))}
              </div>
            ) : null}

            {/* say it: the chosen word, judged on this sound */}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onPointerDown={() => wantScorer(true)}
                onClick={doCheck}
                disabled={!!item && !itemReady}
                aria-label={check.state === "recording" ? "録音を止める" : micLabel}
                className={`press ${check.state === "recording" ? "press-line" : "press-ink"} h-12 min-w-0 flex-1 text-[15px]`}
                style={check.state === "recording" ? { boxShadow: "inset 0 0 0 3px var(--ink)", background: "color-mix(in srgb, var(--guide) 14%, white)" } : undefined}
              >
                <span ref={ring} aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full will-change-transform ${check.state === "recording" ? "bg-(--ink) text-(--paper)" : "bg-(--paper) text-(--ink)"}`}>
                  {check.state === "recording" ? <IconStop size={12} /> : <IconMic size={16} />}
                </span>
                <span className="en truncate">{micLabel}</span>
              </button>
              <button type="button" onClick={() => setSlow((v) => !v)} aria-pressed={slow} className="inline-flex h-12 shrink-0 items-center rounded-full px-3 text-[13px] font-bold" style={slow ? { background: "var(--ink)", color: "var(--paper)" } : { background: "#eef0f8" }}>
                ゆっくり
              </button>
            </div>

            {/* the verdict, in place */}
            <div aria-live="polite">
              {done ? (
                <Verdict done={done} />
              ) : check.state === "error" ? (
                <p className="jp mt-2 text-[13px] font-bold">
                  <BreakText text={check.text} />
                </p>
              ) : null}
              {done && !done.ok ? (
                // one switch: お手本 ⇄ あなた
                <div role="group" aria-label="聞きくらべ" className="mt-2 grid h-11 grid-cols-2 rounded-[14px] bg-[#eef0f7] p-1">
                  <Side
                    on={side === "model"}
                    playing={nowPlaying.key === "model-word"}
                    dot="var(--guide)"
                    label="お手本"
                    onClick={() => {
                      setSide("model");
                      if (word?.clip) void play([url(word.clip)], { key: "model-word" });
                    }}
                  />
                  <Side
                    on={side === "you"}
                    playing={nowPlaying.key === "you-word"}
                    dot="var(--voice-fill)"
                    label="あなた"
                    onClick={() => {
                      setSide("you");
                      void play([playableTake(done.take)], { key: "you-word" });
                    }}
                  />
                </div>
              ) : null}
            </div>

          </div>
        </section>

        {/* ---------------- the 42 */}
        <nav aria-label="42の音" className="mt-4 min-[900px]:order-1 min-[900px]:mt-0">
          {GROUPS.map((g) => {
            const list = sounds.map((x, k) => ({ x, k })).filter(({ x }) => x.group === g.id);
            if (!list.length) return null;
            const manners = g.id === "consonant" ? [...new Set(list.map(({ x }) => x.manner))] : [null];
            return (
              <section key={g.id} aria-label={g.titleJa} className="mt-5 first:mt-0">
                <h2 className="text-[16px] font-black">{g.titleJa}</h2>
                {manners.map((m) => (
                  <div key={m ?? "all"}>
                    {m ? <h3 className="mt-3 text-[13px] font-bold opacity-80">{m}</h3> : null}
                    <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                      {list
                        .filter(({ x }) => !m || x.manner === m)
                        .map(({ x, k }) => (
                          <li key={x.slug}>
                            <Tile s={x} on={k === at} passed={passed.has(x.slug)} onPick={() => pick(k)} />
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

const GROUPS = [
  { id: "vowel", titleJa: "母音" },
  { id: "diphthong", titleJa: "二重母音" },
  { id: "consonant", titleJa: "子音" },
] as const;

function Tile({ s, on, passed, onPick }: { s: BoardSound; on: boolean; passed: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      aria-label={`/${s.ipa}/ ${s.name.text}${s.examples[0] ? `。例：${s.examples[0].word}` : ""}${passed ? "。言えました" : ""}`}
      className="relative flex min-h-[60px] w-full flex-col items-center justify-center gap-[1px] rounded-[14px] px-1 py-2"
      style={on ? { background: "var(--ink)", color: "var(--paper)" } : { background: "var(--paper)", color: "var(--ink)" }}
    >
      <span className="ipa text-[24px] leading-none">{s.ipa}</span>
      {/* line-height above 1: truncate clips to the line box, and g / y / p hang below it */}
      <span className="en max-w-full truncate text-[11px] font-medium leading-[1.35] opacity-75">{s.examples[0]?.word ?? ""}</span>
      {passed ? (
        <span aria-hidden className="absolute right-1 top-1 grid size-[16px] place-items-center rounded-full bg-(--guide-ink) text-white">
          <IconCheck size={10} />
        </span>
      ) : null}
    </button>
  );
}

function Verdict({ done }: { done: Extract<Check, { state: "done" }> }) {
  return (
    <p className="mt-2 flex items-baseline gap-2 text-[16px] font-black leading-snug" style={{ color: done.ok ? "var(--guide-ink)" : "var(--miss)" }}>
      <span aria-hidden className="text-[20px]">
        {done.ok ? "○" : "✕"}
      </span>
      <span className="min-w-0">
        <IpaText text={done.text} />
        {done.sub ? <span className="ml-1 text-[13px] font-bold opacity-80">（{done.sub}）</span> : null}
      </span>
    </p>
  );
}

/** "/iː/ に聞こえました" with the symbol in the IPA face */
function IpaText({ text }: { text: string }): ReactNode {
  return text.split(/(\/[^/]+\/)/).map((part, i) =>
    part.startsWith("/") ? (
      <span key={i} className="ipa">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function Side({ on, playing, dot, label, onClick }: { on: boolean; playing: boolean; dot: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${label}を聞く`}
      className="flex items-center justify-center gap-2 rounded-[11px] text-[14px] font-bold"
      style={on ? { background: "var(--paper)", boxShadow: "0 1px 3px rgba(12,15,51,.16)" } : undefined}
    >
      <span aria-hidden className="grid size-[18px] place-items-center rounded-full text-(--ink)" style={{ background: dot }}>
        {playing ? <IconSpeaker size={11} /> : <IconPlay size={8} />}
      </span>
      {label}
    </button>
  );
}
