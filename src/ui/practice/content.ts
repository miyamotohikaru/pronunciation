/**
 * Practice content on the client: fetch one item JSON (and prefetch only the next), pick the
 * model's take for the chosen voice and speed, and derive what the guide draws.
 * The catalog itself never ships to the client — server components pass slices of it.
 */
import type { ItemData, ItemWord, RefSyllable, RefTiming, RefVoice } from "@/data/schema";
import { buildGuideWave, type GuideWave } from "@/engine/karaoke/judge.ts";
import type { PitchFrame } from "@/engine/audio/types.ts";

export type Speed = "native" | "slow" | "slower";
export type VoiceId = "af_heart" | "am_michael";

export const SPEEDS: { id: Speed; label: string; rate: string }[] = [
  { id: "native", label: "ネイティブ", rate: "1.0" },
  { id: "slow", label: "ゆっくり", rate: "0.8" },
  { id: "slower", label: "もっとゆっくり", rate: "0.65" },
];
export const VOICES: { id: VoiceId; label: string }[] = [
  { id: "af_heart", label: "女性" },
  { id: "am_michael", label: "男性" },
];

// ---------------------------------------------------------------- fetch (current + next only)

const cache = new Map<string, Promise<ItemData>>();

export function fetchItem(id: string): Promise<ItemData> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/content/items/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`item ${id}: HTTP ${r.status}`);
      return r.json() as Promise<ItemData>;
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** keep only these ids in memory (the current item and the next one) */
export function keepItems(ids: string[]) {
  for (const k of [...cache.keys()]) if (!ids.includes(k)) cache.delete(k);
}

// ---------------------------------------------------------------- the model's take for voice × speed

/** What one practice run uses: the audio, its timings, and the guide derived from them. */
export type GuideTake = {
  voice: VoiceId;
  speed: Speed;
  audio: string;
  duration: number;
  words: { text: string; start: number; end: number }[];
  phones: RefTiming["phones"];
  speech: [number, number];
  pitch: PitchFrame[];
  syllables: RefSyllable[];
  wave: GuideWave;
};

type RefWithSlower = RefVoice & { slower?: RefTiming; slowerAudio?: string };

export function refFor(item: Pick<ItemData, "refs">, voice: VoiceId): RefWithSlower {
  return (item.refs.find((r) => r.voice === voice) ?? item.refs[0]) as RefWithSlower;
}

export function speedsFor(item: Pick<ItemData, "refs">, voice: VoiceId): Speed[] {
  const r = refFor(item, voice);
  const out: Speed[] = ["native"];
  if (r.slow && r.slowAudio) out.push("slow");
  if (r.slower && r.slowerAudio) out.push("slower");
  return out;
}

const unpack = (p: [number, number, number][]): PitchFrame[] => p.map(([t, f0, rms]) => ({ t, f0: f0 > 0 ? f0 : null, rms: rms / 1000 }));

const guideCache = new WeakMap<object, Map<string, GuideTake>>();

export function guideFor(item: Pick<ItemData, "refs" | "words">, voice: VoiceId, speed: Speed, words: ItemWord[] = item.words): GuideTake {
  const ref = refFor(item, voice);
  const avail = speedsFor(item, voice);
  const sp = avail.includes(speed) ? speed : "native";
  let per = guideCache.get(item);
  if (!per) guideCache.set(item, (per = new Map()));
  const key = `${ref.voice}|${sp}`;
  const hit = per.get(key);
  if (hit) return hit;
  const timing: RefTiming =
    sp === "slow" ? ref.slow : sp === "slower" && ref.slower ? ref.slower : { duration: ref.duration, words: ref.words, phones: ref.phones, speech: ref.speech, pitch: ref.pitch, syllables: ref.syllables, selfScore: ref.selfScore };
  const audio = sp === "slow" ? ref.slowAudio : sp === "slower" && ref.slowerAudio ? ref.slowerAudio : ref.audio;
  const take: GuideTake = {
    voice: ref.voice as VoiceId,
    speed: sp,
    audio,
    duration: timing.duration,
    words: timing.words.map((w, i) => ({ text: words[i]?.text ?? "", start: w.start, end: w.end })),
    phones: timing.phones,
    speech: timing.speech,
    pitch: unpack(timing.pitch),
    syllables: timing.syllables,
    wave: buildGuideWave(timing.pitch),
  };
  per.set(key, take);
  return take;
}
