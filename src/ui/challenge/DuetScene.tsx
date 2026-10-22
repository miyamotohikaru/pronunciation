"use client";

/**
 * /challenge/dialogue/[id] — a scene as a duet. The script first (who says what, which voice),
 * then turn by turn on one stage: the other person's line plays in the other voice with its
 * caption and melody (PartnerTurn), your line is the karaoke practice screen (Practice); then
 * the next line of theirs, and so on. At the end the whole exchange with your scores.
 * ?t=N in the URL resumes at turn N.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import { audioCore } from "@/engine/audio/context.ts";
import Practice from "../practice/Practice";
import type { FieldClass } from "../practice/fields";
import type { PairRef } from "../practice/catalog.server";
import { VOICES, fetchItem, guideFor, type VoiceId } from "../practice/content";
import TelopText from "../TelopText";
import { IconNext, IconRetry } from "../icons";
import { BestMark, PageHeader, PlayGlyph, br, flow } from "./common/bits";
import { loadClip, myVoice, otherVoice, play, useNowPlaying } from "./common/listen";
import { useBest } from "./common/useBest";
import { NotReady } from "./common/PracticeChain";
import PartnerTurn from "./PartnerTurn";
import RoleChip from "./RoleChip";

export type DuetTurn = { id: string; text: string; ja: string; ready: boolean; role: "partner" | "you" };
export type DuetSceneProps = {
  field: FieldClass;
  scene: { id: string; titleJa: string; situationJa: string; turns: DuetTurn[] };
  next: { href: string; titleJa: string } | null;
  pairs?: Record<string, PairRef>;
};

const BACK = "/challenge#dialogue";
const voiceLabel = (v: VoiceId) => VOICES.find((x) => x.id === v)?.label ?? "";

export default function DuetScene({ field, scene, next, pairs }: DuetSceneProps) {
  const sp = useSearchParams();
  const turns = scene.turns;
  const resume = (() => {
    const raw = sp.get("t");
    return raw !== null && /^\d+$/.test(raw) ? Math.min(Number(raw), turns.length - 1) : null;
  })();
  const [step, setStep] = useState<"intro" | "turn" | "summary">(resume === null ? "intro" : "turn");
  const [k, setK] = useState(resume ?? 0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [combo, setCombo] = useState(0);
  // the first line of theirs plays by itself only after a tap here unlocked the audio
  const unlocked = useRef(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (step === "turn") url.searchParams.set("t", String(k));
    else url.searchParams.delete("t");
    window.history.replaceState(window.history.state, "", url);
  }, [step, k]);

  const advance = () => {
    unlocked.current = true; // every way here is a tap (次へ, あなたの番) or follows one
    if (k + 1 < turns.length) setK(k + 1);
    else setStep("summary");
  };

  if (step === "intro")
    return (
      <SceneIntro
        field={field}
        scene={scene}
        onStart={() => {
          void audioCore.unlock(); // inside the tap (iOS); their first line can then play by itself
          unlocked.current = true;
          setK(0);
          setStep("turn");
        }}
      />
    );

  if (step === "summary")
    return (
      <SceneSummary
        field={field}
        scene={scene}
        scores={scores}
        next={next}
        onAgain={() => {
          void audioCore.unlock();
          unlocked.current = true;
          setScores({});
          setCombo(0);
          setK(0);
          setStep("turn");
        }}
      />
    );

  const t = turns[k];
  if (t.role === "partner")
    return <PartnerTurn key={t.id} field={field} turn={t} index={k} total={turns.length} backHref={BACK} last={k + 1 === turns.length} autoplay={unlocked.current} reply={turns[k + 1]?.role === "you" ? turns[k + 1].text : null} onNext={advance} />;

  if (!t.ready) return <NotReady key={t.id} field={field} index={k} total={turns.length} backHref={BACK} item={t} onNext={advance} />;

  const nextYou = turns.slice(k + 1).find((x) => x.role === "you" && x.ready)?.id ?? null;
  return (
    <Practice
      key={t.id}
      itemId={t.id}
      nextItemId={nextYou}
      field={field}
      index={k}
      total={turns.length}
      combo={combo}
      backHref={BACK}
      pairs={pairs}
      onResult={(id, s) => {
        setScores((m) => ({ ...m, [id]: Math.max(m[id] ?? 0, s) }));
        setCombo((c) => (s >= 75 ? c + 1 : 0));
      }}
      onNext={advance}
    />
  );
}

/** the script of the scene before it starts: who says what, in which voice */
function SceneIntro({ field, scene, onStart }: { field: FieldClass; scene: DuetSceneProps["scene"]; onStart: () => void }) {
  const [voice, setVoice] = useState<VoiceId | null>(null);
  useEffect(() => setVoice(myVoice()), []);
  // their first line, decoded ahead so it starts the moment the scene does
  useEffect(() => {
    const first = scene.turns.find((x) => x.role === "partner" && x.ready);
    if (!first || !voice) return;
    let ok = true;
    fetchItem(first.id)
      .then((it) => {
        if (ok) void loadClip(guideFor(it, otherVoice(voice), "native").audio).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      ok = false;
    };
  }, [scene.turns, voice]);
  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <PageHeader backHref={BACK} backLabel="チャレンジにもどる" title="会話" />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4">
        <h2 className="jp mt-1 text-[28px] font-black leading-tight md:text-[36px]">{scene.titleJa}</h2>
        <p className="jp mt-2 text-[15px] font-medium leading-relaxed">
          <BreakText text={flow(scene.situationJa)} />
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] font-bold">
          <span className="inline-flex items-center gap-2">
            <RoleChip role="partner" size="md" />
            {voice ? `${voiceLabel(otherVoice(voice))}の声` : "　"}
          </span>
          <span className="inline-flex items-center gap-2">
            <RoleChip role="you" size="md" />
            {voice ? `お手本は${voiceLabel(voice)}の声` : "　"}
          </span>
        </p>

        {/* the exchange, in order: theirs to listen to, yours to say */}
        <ol aria-label="この場面のせりふ" className="mt-5 flex flex-col gap-2 pb-6">
          {scene.turns.map((t) => (
            <li key={t.id} className={`flex ${t.role === "you" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] rounded-[20px] px-4 py-3 text-(--ink) ${t.role === "you" ? "rounded-br-[6px] bg-(--paper)" : "rounded-bl-[6px] bg-[color-mix(in_srgb,var(--paper)_86%,var(--guide))]"}`}>
                <span className="flex items-center gap-2">
                  <RoleChip role={t.role} />
                </span>
                <p className="en mt-2 text-[17px] font-bold leading-snug">{t.text}</p>
                <p className="jp mt-1 text-[13px] font-medium leading-snug opacity-75">{t.ja.replace(/\n/g, "")}</p>
              </div>
            </li>
          ))}
        </ol>
      </main>
      <div className="sticky bottom-0 z-10 bg-(--field) px-4 pt-3 shadow-[0_-1px_0_color-mix(in_srgb,var(--field-ink)_22%,transparent)] [padding-bottom:max(16px,calc(env(safe-area-inset-bottom)+10px))]">
        <div className="mx-auto max-w-[720px]">
          <button type="button" onClick={onStart} className="press h-14 w-full text-[17px]">
            {scene.turns[0]?.role === "partner" ? "相手のせりふから始める" : "あなたのせりふから始める"}
            <IconNext size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** the whole exchange again: theirs to replay, yours with this time's score */
function SceneSummary({ field, scene, scores, next, onAgain }: { field: FieldClass; scene: DuetSceneProps["scene"]; scores: Record<string, number>; next: DuetSceneProps["next"]; onAgain: () => void }) {
  const best = useBest();
  const router = useRouter();
  const now = useNowPlaying();
  const [voice, setVoice] = useState<VoiceId | null>(null);
  useEffect(() => setVoice(myVoice()), []);
  const mine = scene.turns.filter((t) => t.role === "you");
  const done = mine.filter((t) => scores[t.id] !== undefined);
  const avg = done.length ? done.reduce((a, t) => a + scores[t.id], 0) / done.length : null;

  const replay = (t: DuetTurn) => {
    const v = voice ?? myVoice();
    const key = `sum-${t.id}`;
    // the URL comes from the item; start the unlock inside the tap, the clip follows
    void audioCore.unlock();
    fetchItem(t.id)
      .then((it) => play([guideFor(it, t.role === "partner" ? otherVoice(v) : v, "native").audio], { key }))
      .catch(() => undefined);
  };

  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pt-8">
        <p className="text-[15px] font-bold">場面おわり</p>
        <h1 className="jp mt-2 text-[30px] font-black leading-tight md:text-[40px]">{scene.titleJa}</h1>
        {avg !== null ? (
          <p className="num mt-5 flex items-baseline gap-2 leading-none">
            <span className="text-[14px] font-bold">あなたのせりふの平均</span>
            <TelopText text={String(Math.round(avg))} className="text-[52px]" />
            <span className="text-[16px] font-bold">点</span>
          </p>
        ) : null}
        <ol className="mt-6 flex flex-col overflow-hidden rounded-[22px] bg-(--paper) text-(--ink)">
          {scene.turns.map((t) => {
            const s = scores[t.id] ?? best?.[t.id];
            const key = `sum-${t.id}`;
            return (
              <li key={t.id} className="flex min-h-[64px] items-center gap-3 border-b border-[#e6e8f1] px-3 py-3 last:border-b-0">
                <button
                  type="button"
                  onClick={() => replay(t)}
                  disabled={!t.ready}
                  aria-label={`${t.role === "partner" ? "相手" : "お手本"}の声で聞く：${t.text}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-40"
                  style={t.role === "partner" ? { background: "color-mix(in srgb, var(--guide) 26%, white)", boxShadow: "inset 0 0 0 2px var(--guide)" } : { background: "#eef0f8" }}
                >
                  <PlayGlyph playing={now.key === key} size={13} />
                </button>
                <span className="min-w-0 flex-1">
                  <span className="mb-1 flex">
                    <RoleChip role={t.role} />
                  </span>
                  <span className="en block text-[16px] font-bold leading-snug">{t.text}</span>
                </span>
                {t.role === "you" ? <BestMark score={s} /> : null}
              </li>
            );
          })}
        </ol>
        <div className="sticky bottom-0 mt-auto grid gap-3 bg-(--field) pt-6 [padding-bottom:max(18px,calc(env(safe-area-inset-bottom)+10px))]">
          {next ? (
            <Link href={next.href} className="press h-14 w-full text-[17px]">
              次の場面：{next.titleJa}
              <IconNext size={20} />
            </Link>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={onAgain} className="press press-ghost h-14 text-[16px]">
              <IconRetry size={18} />
              もう一度
            </button>
            <button type="button" onClick={() => router.push(BACK)} className={`press ${next ? "press-ghost" : ""} h-14 text-[16px]`}>
              ほかの場面
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
