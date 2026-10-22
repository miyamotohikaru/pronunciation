"use client";

/**
 * 会話: the other person's line, on the same stage as yours — the caption, its sounds and meaning,
 * the melody in the monitor with the cursor running — in the other voice (not your お手本's).
 * It plays by itself; when it ends, your turn comes after a short ring (any tap here stops the
 * ring). One main action: あなたの番.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import type { ItemData } from "@/data/schema";
import type { FieldClass } from "../practice/fields";
import { fetchItem, guideFor, type GuideTake } from "../practice/content";
import { Guide, freshLive, type GuideLive } from "../guide";
import { lineIpa } from "../ipa";
import Telop from "../Telop";
import TopBar from "../TopBar";
import RoundButton from "../RoundButton";
import { IconNext, IconRetry, IconSpeaker, IconTurtle } from "../icons";
import { otherVoice, play, stopListening, myVoice } from "./common/listen";
import { captionSize } from "./common/bits";
import RoleChip from "./RoleChip";

const RING_MS = 1800; // after the line ends, your turn comes by itself

export type PartnerTurnProps = {
  field: FieldClass;
  turn: { id: string; text: string; ja: string; ready: boolean };
  index: number;
  total: number;
  backHref: string;
  /** what the button says: あなたの番 / おわり */
  last: boolean;
  /** start playing as soon as the line is loaded (the audio was unlocked by an earlier tap) */
  autoplay: boolean;
  /** your line that answers this one (shown small, like the next line of a duet) */
  reply?: string | null;
  onNext: () => void;
};

export default function PartnerTurn({ field, turn, index, total, backHref, last, autoplay, reply, onNext }: PartnerTurnProps) {
  const [item, setItem] = useState<ItemData | null>(null);
  const [failed, setFailed] = useState(!turn.ready);
  const [speed, setSpeed] = useState<"native" | "slow">("native");
  const [playing, setPlaying] = useState(false);
  const [ring, setRing] = useState(false);
  const [plays, setPlays] = useState(0);
  const voice = useMemo(() => otherVoice(myVoice()), []);
  const live = useRef<GuideLive>(freshLive());
  const clock = useMemo(
    () => ({
      get current() {
        return live.current.follow ? live.current.t : null;
      },
    }),
    [],
  );
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!turn.ready) return;
    let ok = true;
    fetchItem(turn.id)
      .then((it) => ok && setItem(it))
      .catch(() => ok && setFailed(true));
    return () => {
      ok = false;
    };
  }, [turn.id, turn.ready]);

  const guide: GuideTake | null = useMemo(() => (item ? guideFor(item, voice, speed) : null), [item, voice, speed]);

  const cancelRing = () => {
    if (ringTimer.current) clearTimeout(ringTimer.current);
    ringTimer.current = null;
    setRing(false);
  };

  const start = (g: GuideTake) => {
    cancelRing();
    const l = live.current;
    l.t = 0;
    l.follow = true;
    l.tone = "guide";
    l.version++;
    setPlaying(true);
    setPlays((n) => n + 1);
    void play([g.audio], {
      key: `partner-${turn.id}-${g.speed}`,
      onPlayhead: (e) => {
        live.current.t = e.t;
      },
      onEnd: (completed) => {
        const lv = live.current;
        lv.t = null;
        lv.follow = false;
        lv.version++;
        setPlaying(false);
        if (!completed) return;
        // your turn comes by itself after a short ring
        setRing(true);
        ringTimer.current = setTimeout(() => {
          ringTimer.current = null;
          onNext();
        }, RING_MS);
      },
    });
  };

  // play once by itself as soon as the line is here
  useEffect(() => {
    if (!guide || started.current || !autoplay) return;
    started.current = true;
    start(guide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide, autoplay]);

  useEffect(
    () => () => {
      if (ringTimer.current) clearTimeout(ringTimer.current);
      stopListening();
    },
    [],
  );

  const again = (sp: "native" | "slow") => {
    if (!item) return;
    if (playing) {
      stopListening();
      return;
    }
    setSpeed(sp);
    start(guideFor(item, voice, sp));
  };

  const len = turn.text.length;
  const size = captionSize(len);
  const label = `${turn.text} 相手の声の高さの波`;

  return (
    <div className={`kara ${field} flex min-h-dvh flex-col`}>
      <TopBar backHref={backHref} index={index + 1} total={total} />
      <main className="flex flex-1 flex-col">
        <section aria-label="相手のせりふ" className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col justify-center px-4 py-2 md:px-8">
          <div className="mx-auto w-full max-w-[1040px] px-1">
            <p className="flex items-center gap-2 pb-2 text-[14px] font-bold">
              <RoleChip role="partner" size="md" />
              <span className="opacity-90">{playing ? "話しています" : plays ? "相手のせりふ" : autoplay ? "これから話します" : "「聞く」で再生"}</span>
            </p>
            <div style={{ fontSize: size }}>
              {guide ? <Telop text={turn.text} words={guide.words} mode="karaoke" clock={clock} /> : <p className="en font-bold leading-[1.14]">{turn.text}</p>}
            </div>
            {/* the same order as your turn: the sentence, its sounds right under it, the meaning */}
            {item ? <p className="ipa mt-1 text-[15px] leading-snug opacity-90 md:text-[17px]">{lineIpa(item)}</p> : null}
            <p className="jp mt-2 text-[15px] font-medium leading-snug md:mt-3 md:text-[18px]">
              <BreakText text={turn.ja.replace(/\n/g, "◆")} />
            </p>
            {reply ? (
              <p className="mt-3 flex items-center gap-2 text-[14px] font-medium">
                <RoleChip role="you" />
                <span className="en line-clamp-1 min-w-0 flex-1 opacity-80">{reply}</span>
              </p>
            ) : null}
          </div>

          <div className="monitor relative mx-auto mt-5 flex max-h-[420px] min-h-[200px] w-full max-w-[960px] flex-1 flex-col overflow-hidden rounded-(--radius-monitor) bg-(--monitor) text-(--monitor-ink) [contain:layout_paint] md:mt-7 md:max-h-none md:flex-none">
            <div className="relative min-h-[200px] flex-1 md:h-[300px] md:flex-none lg:h-[330px]">
              {guide ? <Guide className="absolute inset-0" wave={guide.wave} syllables={guide.syllables} words={guide.words} live={live} overlay={null} progressive={false} focusWord={null} tolSt={2.5} label={label} /> : null}
              {failed ? (
                <p className="jp absolute inset-0 grid place-items-center px-6 text-center text-[14px] font-bold text-(--monitor-muted)">
                  <BreakText text="このせりふの音声は、◆いま録音しています。◇読んでから、◆次へ進んでください。" />
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <div className="mx-auto w-full max-w-[560px] px-4 pt-4 [padding-bottom:max(18px,calc(env(safe-area-inset-bottom)+10px))] md:pb-10">
          <div className="flex items-start justify-center gap-5 md:gap-10">
            <RoundButton icon={plays ? <IconRetry size={26} /> : <IconSpeaker size={28} />} label={plays ? "もう一度" : "聞く"} ariaLabel={playing && speed === "native" ? "止める" : plays ? "相手のせりふをもう一度聞く" : "相手のせりふを聞く"} onPress={() => again("native")} playingMs={playing && speed === "native" && guide ? guide.duration * 1000 : null} disabled={!item} />
            <NextButton label={last ? "おわり" : "あなたの番"} ring={ring} onPress={() => (cancelRing(), stopListening(), onNext())} />
            <RoundButton icon={<IconTurtle size={28} />} label="ゆっくり" ariaLabel="ゆっくり聞く" onPress={() => again("slow")} playingMs={playing && speed === "slow" && guide ? guide.duration * 1000 : null} disabled={!item} />
          </div>
        </div>
      </main>
    </div>
  );
}

/** the big middle button (the mic's place on your turn); a ring runs before your turn comes by itself */
function NextButton({ label, ring, onPress }: { label: string; ring: boolean; onPress: () => void }) {
  return (
    <div className="flex w-[112px] flex-col items-center md:w-[128px]">
      <div className="relative grid size-[96px] place-items-center md:size-[112px]">
        {ring ? (
          <svg aria-hidden viewBox="0 0 120 120" className="pointer-events-none absolute -inset-[14px] size-[calc(100%+28px)] -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="color-mix(in srgb, var(--field-ink) 28%, transparent)" strokeWidth="4" />
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--paper)" strokeWidth="4" strokeLinecap="round" pathLength={100} strokeDasharray="100" style={{ animation: `kara-ring ${RING_MS}ms linear both` }} />
          </svg>
        ) : null}
        <button type="button" onClick={onPress} aria-label={label} className="press relative size-full rounded-full">
          <IconNext size={38} />
        </button>
      </div>
      <p className="mt-4 whitespace-nowrap text-[15px] font-extrabold leading-none">{label}</p>
      <p className="mt-2 h-3 whitespace-nowrap text-[12px] font-bold leading-none" style={{ visibility: ring ? "visible" : "hidden" }}>
        もうすぐ自動で
      </p>
    </div>
  );
}
