"use client";

/**
 * 会話, your turn: the line you are answering stays above your caption (Practice's `context`), with
 * a small button to hear it again in the other voice.
 */
import { audioCore } from "@/engine/audio/context.ts";
import { fetchItem, guideFor } from "../practice/content";
import { PlayGlyph } from "./common/bits";
import { myVoice, otherVoice, play, useNowPlaying } from "./common/listen";
import RoleChip from "./RoleChip";

export default function PartnerEcho({ turn }: { turn: { id: string; text: string; ready: boolean } }) {
  const now = useNowPlaying();
  const key = `echo-${turn.id}`;
  const again = () => {
    void audioCore.unlock(); // inside the tap (iOS); the clip follows
    fetchItem(turn.id)
      .then((it) => play([guideFor(it, otherVoice(myVoice()), "native").audio], { key }))
      .catch(() => undefined);
  };
  return (
    <div className="flex items-center gap-2">
      <RoleChip role="partner" />
      <p className="en line-clamp-2 min-w-0 flex-1 text-[15px] font-bold leading-snug opacity-90">{turn.text}</p>
      {turn.ready ? (
        <button
          type="button"
          onClick={again}
          aria-label={`相手のせりふをもう一度聞く：${turn.text}`}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--paper)_18%,transparent)]"
        >
          <PlayGlyph playing={now.key === key} size={12} />
        </button>
      ) : null}
    </div>
  );
}
