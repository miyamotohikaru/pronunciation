"use client";

/**
 * /abc — the alphabet as a keypad. Press a key: you hear the letter's name (your お手本 voice) and
 * the card above shows how it is said (/éɪ/, エイと動く A …). Then the letters that get mixed up,
 * each set to hear one by one, in turn, or as a quick どっち？ (one plays, you pick it); then the
 * lines that spell or name letters, on the karaoke practice screen.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import BreakText from "@/components/BreakText";
import { BestMark, IconAlternate, IconChevron, PageHeader, PlayGlyph, flow } from "../challenge/common/bits";
import { clipUrl, myVoice, play, useNowPlaying, warmClips } from "../challenge/common/listen";
import { useBest } from "../challenge/common/useBest";
import type { VoiceId } from "../practice/content";
import { IconCheck, IconClose } from "../icons";
import IpaTip from "../sounds/IpaTip";
import type { AbcSet, Confusion, Letter } from "./data.server";
import { SpellText } from "./SpellText";

export default function AbcPage({ letters, confusions, sets }: { letters: Letter[]; confusions: Confusion[]; sets: AbcSet[] }) {
  const best = useBest();
  const now = useNowPlaying();
  const [voice, setVoice] = useState<VoiceId>("af_heart");
  const [sel, setSel] = useState(0);
  useEffect(() => setVoice(myVoice()), []);
  const byLetter = useMemo(() => new Map(letters.map((l) => [l.letter, l])), [letters]);
  const url = (L: string) => {
    const c = byLetter.get(L)?.clip;
    return c ? clipUrl(c, voice) : null;
  };
  // the keypad's 26 names, decoded while the page is idle (a key then sounds at once)
  useEffect(() => warmClips(letters.flatMap((l) => (l.clip ? [clipUrl(l.clip, voice)] : []))), [letters, voice]);

  const say = (i: number) => {
    setSel(i);
    const u = url(letters[i].letter);
    if (u) void play([u], { key: `key-${letters[i].letter}` });
  };
  const L = letters[sel];
  const confOf = (id: string) => confusions.find((c) => c.id === id);

  return (
    <div className="kara field-calm flex min-h-dvh flex-col">
      <PageHeader backHref="/home" backLabel="ホームにもどる" title="アルファベット" />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 [padding-bottom:max(32px,calc(env(safe-area-inset-bottom)+20px))]">
        <p className="jp mt-1 text-[15px] font-medium leading-relaxed text-[color-mix(in_srgb,var(--ink)_80%,transparent)]">
          <BreakText text="文字の名前を、英語の音で。◇キーを押すと聞けます。" />
        </p>

        {/* the letter you pressed, and how its name is said */}
        <section aria-live="polite" aria-label={`${L.letter} の読み方`} className="mt-4 rounded-[24px] bg-(--paper) px-5 pb-4 pt-3">
          <div className="flex items-end gap-4">
            <span className="en text-[88px] font-bold leading-[1]" aria-hidden>
              {L.letter}
            </span>
            <span className="pb-3">
              <IpaTip ipa={L.ipa} of={L.letter} className="ipa-dict text-[28px]" />
            </span>
            <button
              type="button"
              onClick={() => say(sel)}
              aria-label={`${L.letter} をもう一度聞く`}
              className="ml-auto mb-3 grid size-12 shrink-0 place-items-center rounded-full"
              style={{ background: "color-mix(in srgb, var(--guide) 24%, white)", boxShadow: "inset 0 0 0 2px var(--guide)" }}
            >
              <PlayGlyph playing={now.key === `key-${L.letter}`} size={16} />
            </button>
          </div>
          <h2 className="mt-1 text-[17px] font-bold leading-snug">{L.nameJa}</h2>
          <p className="jp mt-1 text-[14px] font-medium leading-relaxed">
            <BreakText text={flow(L.howJa)} />
          </p>
          {L.noteJa ? <p className="jp mt-1 text-[13px] font-medium leading-relaxed opacity-75">{L.noteJa.replace(/\n/g, "")}</p> : null}
          {L.confusions.length ? (
            <p className="mt-3 flex flex-wrap gap-2">
              {L.confusions.map((id) => {
                const c = confOf(id);
                return c ? (
                  <a key={id} href={`#set-${id}`} className="inline-flex h-11 items-center gap-1 rounded-full bg-[#eef0f8] px-4 text-[14px] font-bold">
                    {c.title}
                    <span className="text-[12px] font-medium opacity-70">を聞きくらべ</span>
                  </a>
                ) : null;
              })}
            </p>
          ) : null}
        </section>

        {/* the keypad */}
        <ul className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-7" aria-label="アルファベット">
          {letters.map((l, i) => {
            const playing = now.key === `key-${l.letter}`;
            return (
              <li key={l.letter}>
                <button
                  type="button"
                  onClick={() => say(i)}
                  aria-pressed={i === sel}
                  aria-label={`${l.letter}、${l.ipa}`}
                  disabled={!l.clip}
                  className="flex aspect-square w-full flex-col items-center justify-center rounded-[16px] transition-transform active:scale-[0.96] disabled:opacity-50"
                  style={i === sel ? { background: "var(--ink)", color: "var(--paper)" } : { background: "var(--paper)" }}
                >
                  <span className="en text-[28px] font-bold leading-none">{l.letter}</span>
                  <span className="ipa ipa-dict mt-1 text-[12px] leading-none" style={{ opacity: playing ? 1 : 0.7 }}>
                    {l.ipa}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* the sets that get mixed up */}
        <section aria-labelledby="mix-h" className="mt-10">
          <h2 id="mix-h" className="px-1 text-[20px] font-black">
            まちがえやすい組
          </h2>
          <p className="jp mt-1 px-1 text-[14px] font-medium leading-relaxed opacity-80">
            <BreakText text="1つずつ、交互に、または「どっち？」で。" />
          </p>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {confusions.map((c) => (
              <li key={c.id} id={`set-${c.id}`} className="scroll-mt-4">
                <MixSet c={c} url={url} ipaOf={(x) => byLetter.get(x)?.ipa ?? ""} />
              </li>
            ))}
          </ul>
        </section>

        {/* lines that spell or name letters */}
        <section aria-labelledby="lines-h" className="mt-10">
          <h2 id="lines-h" className="px-1 text-[20px] font-black">
            文で練習
          </h2>
          <p className="jp mt-1 px-1 text-[14px] font-medium leading-relaxed opacity-80">
            <BreakText text="四角の文字は、◆文字の名前で言います。" />
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {sets.map((s) => (
              <section key={s.id} aria-label={s.titleJa} className="rounded-[22px] bg-(--paper) px-4 pb-2 pt-3">
                <Link href={`/abc/${s.id}`} className="flex min-h-11 items-center gap-2">
                  <span className="min-w-0 flex-1 text-[16px] font-bold">{s.titleJa}</span>
                  <span className="num text-[13px] font-medium opacity-75">{s.lines.length}文を続けて</span>
                  <IconChevron />
                </Link>
                <ol>
                  {s.lines.map((l, i) => (
                    <li key={l.id} className="border-t border-[#eceef5]">
                      <Link href={`/abc/${s.id}?i=${i}`} className="flex min-h-[58px] items-center gap-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="en block text-[17px] font-bold leading-snug">
                            <SpellText text={l.text} spell={l.spell} />
                          </span>
                          <span className="jp block text-[13px] font-medium opacity-70">{l.ja.replace(/\n/g, "")}</span>
                        </span>
                        {l.ready ? <BestMark score={best?.[l.id]} /> : <span className="shrink-0 rounded-full bg-[#eef0f6] px-2 py-1 text-[12px] font-bold">準備中</span>}
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

type Quiz = { answer: string; picked: string | null } | null;

/** one set: its letters as keys (each plays), 交互に (all in turn), and どっち？ (one plays; pick it) */
function MixSet({ c, url, ipaOf }: { c: Confusion; url: (L: string) => string | null; ipaOf: (L: string) => string }) {
  const now = useNowPlaying();
  const [quiz, setQuiz] = useState<Quiz>(null);
  const [score, setScore] = useState({ right: 0, asked: 0 });
  const many = c.letters.length > 4;
  const urls = c.letters.map(url);
  const ready = urls.every(Boolean);
  const turnKey = `mix-${c.id}`;

  const sound = (L: string, key: string) => {
    const u = url(L);
    if (u) void play([u], { key });
  };
  // どっち？: a new letter; while unanswered, the same one again
  const ask = () => {
    if (quiz && !quiz.picked) return sound(quiz.answer, `quiz-${c.id}-again`);
    const answer = c.letters[Math.floor(Math.random() * c.letters.length)];
    setQuiz({ answer, picked: null });
    sound(answer, `quiz-${c.id}`);
  };
  // a key: your answer while a question is open, else it just plays
  const press = (L: string) => {
    if (!quiz || quiz.picked) return sound(L, `mix-${c.id}-${L}`);
    setQuiz({ ...quiz, picked: L });
    setScore((s) => ({ right: s.right + (L === quiz.answer ? 1 : 0), asked: s.asked + 1 }));
  };

  const keys = c.letters.map((L, i) => {
    const playing = now.key === `mix-${c.id}-${L}` || (now.key === turnKey && now.index % c.letters.length === i);
    const right = quiz?.picked && L === quiz.answer;
    const wrong = quiz?.picked === L && L !== quiz.answer;
    return (
      <button
        key={L}
        type="button"
        onClick={() => press(L)}
        disabled={!urls[i]}
        aria-label={quiz && !quiz.picked ? `${L} だと思う` : `${L} を聞く`}
        className={`relative flex h-14 ${many ? "" : "flex-1"} min-w-12 flex-col items-center justify-center rounded-[14px] disabled:opacity-40`}
        style={
          right
            ? { background: "var(--ink)", color: "var(--paper)" }
            : wrong
              ? { background: "color-mix(in srgb, var(--miss) 10%, white)", color: "var(--miss)", boxShadow: "inset 0 0 0 2px var(--miss)" }
              : playing
                ? { background: "color-mix(in srgb, var(--guide) 24%, white)", boxShadow: "inset 0 0 0 2.5px var(--guide)" }
                : { background: "#f1f2f8" }
        }
      >
        <span className="en text-[24px] font-bold leading-none">{L}</span>
        {many ? null : <span className="ipa ipa-dict mt-[3px] text-[12px] leading-none opacity-75">{ipaOf(L)}</span>}
        {right || wrong ? (
          <span className="absolute right-[6px] top-[5px]" aria-hidden>
            {right ? <IconCheck size={12} /> : <IconClose size={12} />}
          </span>
        ) : null}
      </button>
    );
  });
  const controls = (
    <>
      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          setQuiz(null);
          const seq = many ? c.letters : [...c.letters, ...c.letters];
          void play(seq.map((L) => url(L)!), { key: turnKey, gap: 0.5 });
        }}
        aria-pressed={now.key === turnKey}
        aria-label={many ? "順に聞く" : "交互に聞く"}
        className="press press-line h-14 w-12 shrink-0 !rounded-[14px] disabled:opacity-40"
      >
        <IconAlternate size={20} />
      </button>
      <button type="button" disabled={!ready} onClick={ask} className="press press-ink h-14 min-w-[92px] shrink-0 !rounded-[14px] px-3 text-[15px] disabled:opacity-40">
        {quiz && quiz.picked ? "もう一問" : quiz ? "もう一度" : "どっち？"}
      </button>
    </>
  );

  return (
    <div className="flex h-full flex-col rounded-[22px] bg-(--paper) px-4 pb-4 pt-3">
      <h3 className="flex items-baseline justify-between gap-2 text-[16px] font-bold">
        {c.title}
        {score.asked ? <span className="num text-[13px] font-medium opacity-75">{`${score.right}/${score.asked} 正解`}</span> : null}
      </h3>
      <p className="jp mt-1 text-[14px] font-medium leading-relaxed">
        <BreakText text={flow(c.tipJa)} />
      </p>
      {/* the letters (each plays, or is your answer), 交互に, どっち？ — one row when it fits */}
      {many ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={quiz && !quiz.picked ? "どれに聞こえましたか" : `${c.title}の文字`}>
            {keys}
          </div>
          <div className="mt-2 flex justify-end gap-2">{controls}</div>
        </>
      ) : (
        <div className="mt-3 flex gap-2">
          <div className="flex min-w-0 flex-1 gap-2" role="group" aria-label={quiz && !quiz.picked ? "どっちに聞こえましたか" : `${c.title}の文字`}>
            {keys}
          </div>
          {controls}
        </div>
      )}
      {quiz ? (
        <p className="jp mt-2 text-[13px] font-bold" aria-live="polite">
          {quiz.picked ? (quiz.picked === quiz.answer ? `正解。${quiz.answer} でした。` : `${quiz.answer} でした。もう一度聞いてみましょう。`) : "聞こえた文字を押してください。"}
        </p>
      ) : null}
    </div>
  );
}
