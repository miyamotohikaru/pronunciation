/**
 * Content build: content/curriculum.json + the Kokoro reference takes (.work/tts/<voice>/)
 * -> public/content/items/<id>.json (src/data/schema.ts ItemData) + src/data/catalog.json.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/build-content/build.ts [--only <id-prefix>] [--runtime node|web]
 *
 * Per item: target words (misaki of both voices + CMUdict + weak forms + variants learned
 * from the four reference takes), then per voice and speed: the scorer's alignment and
 * self-score, pitch (src/engine/audio/pitch.ts), syllables (src/engine/prosody), Kokoro's
 * word timings. rhythm / intonation of a voice = the other voice compared with it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readWav } from "./wav.ts";
import { loadCmudict } from "./cmudict.ts";
import { analyzePitch } from "../../src/engine/audio/pitch.ts";
import { compareProsody, speakerMedianHz, syllabify, syllableStats, toRegions, type PhoneSpan, type PitchFrame } from "../../src/engine/prosody/index.ts";
import { addConnectedSpeech } from "../../src/engine/scoring/connected.ts";
import { deriveVariants, type LearnedVariant } from "../../src/engine/scoring/reference.ts";
import { baseOf } from "../../src/engine/scoring/phones.ts";
import type { Scorer } from "../../src/engine/scoring/engine.ts";
import type { ScoreResult, TargetWord } from "../../src/engine/scoring/types.ts";
import type { Catalog, CatalogItem, FocusPoint, ItemData, ItemType, ItemWord, RefSyllable, RefTiming, RefVoice } from "../../src/data/schema.ts";
import { targetsFromKokoro, tokenize, type KokoroClip } from "../lib/targets.ts";
import { makeNodeScorer, ROOT } from "../lib/scorer-node.ts";

const VOICES = ["af_heart", "am_michael"];
const TTS = join(ROOT, ".work/tts");
const OUT_ITEMS = join(ROOT, "public/content/items");
const OUT_CATALOG = join(ROOT, "src/data/catalog.json");
const LOG = join(ROOT, ".work/build-content.json");

// ------------------------------------------------------------------ curriculum types
type CFocus = { word: string; phone: string; watch_for: string[]; tip_ja?: string; tag?: string };
type CItem = { id: string; type: ItemType; text: string; ja: string; pair?: string; tts_text?: string; focus: CFocus[]; difficulty: number };
type CLesson = { id: string; title_ja: string; goal_ja: string; feature: string; items: CItem[] };
type CUnit = { id: string; title_ja: string; subtitle_ja: string; feature: string; why_ja: string; how_ja: string; lessons: CLesson[] };
type CPlacement = { id: string; text: string; ja: string; tts_text?: string; diagnoses: string[]; focus: CFocus[] };
type Curriculum = { version: number; placement: CPlacement[]; units: CUnit[] };

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const runtime = (args.includes("--runtime") ? args[args.indexOf("--runtime") + 1] : "auto") as "auto" | "node" | "web";

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** "[for](/fəɹ/) a minute" -> "for a minute" */
const stripMarkup = (s: string) => s.replace(/\[([^\]]+)\]\(\/[^)]*\/\)/g, "$1");
const norm = (s: string) => tokenize(s).join(" ");

type Take = { audio: Float32Array; clip: KokoroClip; pitch: PitchFrame[] };

function loadTake(voice: string, id: string, slow: boolean): Take {
  const base = join(TTS, voice, id + (slow ? ".slow" : ""));
  const { sampleRate, samples } = readWav(`${base}.16k.wav`);
  if (sampleRate !== 16000) throw new Error(`${base}.16k.wav is ${sampleRate} Hz`);
  const clip = JSON.parse(readFileSync(`${base}.json`, "utf8")) as KokoroClip;
  return { audio: samples, clip, pitch: analyzePitch(samples) };
}

const speechOf = (t: Take): [number, number] => [t.clip.words[0].start, t.clip.words[t.clip.words.length - 1].end];
const wordTexts = (t: Take) => t.clip.words.map((w) => w.text.toLowerCase());

/** One take of a reference voice: alignment, self-score, pitch, syllables. */
async function analyze(scorer: Scorer, take: Take, words: TargetWord[], scoring: ItemScoring): Promise<{ r: ScoreResult; timing: RefTiming }> {
  const r = await scorer.score({ audio: take.audio, words }, scoring);
  const phones = r.spans.map((s) => ({ phone: s.phone, word: s.word, start: r3(s.start), end: r3(s.end) }));
  const speech = speechOf(take);
  const syl = syllabify(phones as PhoneSpan[], wordTexts(take));
  const regions = toRegions(phones as PhoneSpan[], speech[0], speech[1]);
  const refHz = speakerMedianHz(take.pitch, speech[0], speech[1]);
  const stats = syllableStats(syl, regions, take.pitch, refHz);
  const syllables: RefSyllable[] = stats.map((st, i) => ({
    word: syl[i].word,
    start: r3(st.start),
    end: r3(st.end),
    nucleusStart: r3(st.nucleusStart),
    nucleusEnd: r3(st.nucleusEnd),
    pitchSt: st.pitchSt === null ? null : r2(st.pitchSt),
    prominence: r3(st.prominence),
    stress: syl[i].lexicalStress,
  }));
  const timing: RefTiming = {
    duration: take.clip.duration,
    words: take.clip.words.map((w) => ({ start: r3(w.start), end: r3(w.end) })),
    phones,
    speech,
    pitch: take.pitch.map((f) => [r2(f.t), f.f0 === null ? 0 : Math.round(f.f0), Math.round(f.rms * 1000)] as [number, number, number]),
    syllables,
    selfScore: { sounds: r.sounds, minWord: Math.min(...r.words.map((w) => w.score)) },
  };
  return { r, timing };
}

type WordLog = { item: string; voice: string; slow: boolean; word: string; score: number; variant: string };

/** Targets + both voices (normal and slow) of one recorded id. */
async function buildRefs(scorer: Scorer, id: string, protect: string[], log: WordLog[], learnedLog: { id: string; learned: LearnedVariant[] }[]) {
  const takes = VOICES.map((v) => ({ voice: v, normal: loadTake(v, id, false), slow: loadTake(v, id, true) }));
  const clips = takes.flatMap((t) => [t.normal.clip, t.slow.clip]).filter((c) => c.words.map((w) => w.text).join(" ") === takes[0].normal.clip.words.map((w) => w.text).join(" "));
  const base = targetsFromKokoro(clips, cmu);
  const derived = await deriveVariants(
    scorer,
    addConnectedSpeech(base),
    takes.flatMap((t) => [
      { name: `${t.voice}/${id}`, audio: t.normal.audio },
      { name: `${t.voice}/${id}.slow`, audio: t.slow.audio },
    ]),
    { protect },
  );
  const words = derived.words;
  if (derived.learned.length) learnedLog.push({ id, learned: derived.learned });
  const scoring = await calibrateScoring(scorer, words, takes.flatMap((t) => [t.normal, t.slow]));
  const analyzed = [];
  for (const t of takes) {
    const normal = await analyze(scorer, t.normal, words, scoring);
    const slow = await analyze(scorer, t.slow, words, scoring);
    for (const [r, isSlow] of [[normal.r, false], [slow.r, true]] as const)
      for (const w of r.words) log.push({ item: id, voice: t.voice, slow: isSlow, word: w.text, score: w.score, variant: String(words[r.words.indexOf(w)].variants[w.variant]) });
    analyzed.push({ t, normal, slow });
  }
  const refs: RefVoice[] = [];
  for (const [i, a] of analyzed.entries()) {
    // rhythm / intonation: the other voice, aligned to this voice's phones, compared with it
    const other = analyzed[(i + 1) % analyzed.length];
    const ro = await scorer.score({ audio: other.t.normal.audio, words }, { ...scoring, alignTo: a.normal.timing.phones });
    let rhythm = 0;
    let intonation = 0;
    if (ro.alignedTo) {
      const pr = compareProsody(
        { phones: a.normal.timing.phones as PhoneSpan[], pitch: a.t.normal.pitch, speech: a.normal.timing.speech },
        { phones: ro.alignedTo, pitch: other.t.normal.pitch, speech: speechOf(other.t.normal) },
        wordTexts(a.t.normal),
      );
      rhythm = Math.round(pr.rhythm);
      intonation = Math.round(pr.intonation);
    }
    const n = a.normal.timing;
    refs.push({
      voice: a.t.voice,
      audio: `/audio/${a.t.voice}/${id}.mp3`,
      slowAudio: `/audio/${a.t.voice}/${id}.slow.mp3`,
      duration: n.duration,
      slowDuration: a.slow.timing.duration,
      words: n.words,
      phones: n.phones,
      speech: n.speech,
      pitch: n.pitch,
      syllables: n.syllables,
      selfScore: { sounds: n.selfScore.sounds, minWord: n.selfScore.minWord, rhythm, intonation },
      slow: a.slow.timing,
    });
    for (const p of [refs[refs.length - 1].audio, refs[refs.length - 1].slowAudio])
      if (!existsSync(join(ROOT, "public", p))) console.warn(`  missing audio ${p}`);
  }
  // phones: the first voice's misaki spelling (what it was asked to say; the recognizer's
  // reading of the take is in refs[].phones); variants: everything the scorer accepts
  const itemWords: ItemWord[] = words.map((w) => {
    const variants = w.variants.map((v) => (typeof v === "string" ? v : v.join(" ")));
    return { text: w.text, phones: variants[0].split(/\s+/).map((p) => p.replace(/\?$/, "")), variants };
  });
  return { words: itemWords, refs, clip: takes[0].normal.clip, scoring: compactScoring(scoring) };
}

/** Drops empty tables so items without adjustments carry nothing. */
function compactScoring(s: ItemScoring): ItemData["scoring"] {
  const d = Object.fromEntries(Object.entries(s.diagnosis).filter(([, v]) => Object.keys(v).length));
  const out: NonNullable<ItemData["scoring"]> = {};
  if (Object.keys(d).length) out.diagnosis = d;
  if (Object.keys(s.baseline).length) out.baseline = s.baseline;
  return Object.keys(out).length ? out : undefined;
}

type ItemDiagnosis = { pairPenalty: Record<string, number>; deletionPenaltyFor: Record<string, number>; insertionPenaltyAfter: Record<string, number> };
type ItemScoring = { diagnosis: ItemDiagnosis; baseline: Record<string, number> };

/** baseline keys, as the engine builds them: "<word>:<base phone>:<n-th in the word>" */
function phoneKeys(r: ScoreResult): { key: string; raw: number }[] {
  const out: { key: string; raw: number }[] = [];
  r.words.forEach((w, wi) => {
    const seen = new Map<string, number>();
    for (const p of w.phones) {
      const b = baseOf(p.phone);
      const n = seen.get(b) ?? 0;
      seen.set(b, n + 1);
      out.push({ key: `${wi}:${b}:${n}`, raw: p.raw });
    }
  });
  return out;
}

/**
 * Per-item scoring settings learned from the four reference takes, so that a learner is
 * judged against what the recognizer makes of the native, not against an ideal:
 *  - penalties: where a reference shows evidence for a confusion / deletion / inserted
 *    vowel (the recognizer hears Kokoro's "not" as N AH T), raise that penalty to the
 *    native's margin + 1 nat, then raise whatever the reference is still flagged for;
 *  - baseline: per phone, the lowest raw score a reference take got (when below 1.9).
 * The contrast an item trains is never learned as a variant (protect), so this is what keeps
 * the references at >= 90 on minimal pairs while a clearly worse take is still flagged.
 */
async function calibrateScoring(scorer: Scorer, words: TargetWord[], takes: Take[]): Promise<ItemScoring> {
  const d = scorer.meta.diagnosis;
  const diag: ItemDiagnosis = { pairPenalty: {}, deletionPenaltyFor: {}, insertionPenaltyAfter: {} };
  const curSub = (k: string) => diag.pairPenalty[k] ?? d.pairPenalty?.[k] ?? d.substitutionPenalty;
  const curDel = (b: string) => diag.deletionPenaltyFor[b] ?? d.deletionPenaltyFor?.[b] ?? d.deletionPenalty;
  const curIns = (b: string) => diag.insertionPenaltyAfter[b] ?? d.insertionPenaltyAfter?.[b] ?? d.insertionPenalty;
  // 1. single-finding margins
  for (const t of takes) {
    const r = await scorer.score({ audio: t.audio, words }, { diagnosis: diag, measureMargins: true });
    for (const m of r.margins ?? []) {
      const b = baseOf(m.phone);
      for (const [q, g] of Object.entries(m.sub)) if (g + 0.5 > curSub(`${b}>${q}`)) diag.pairPenalty[`${b}>${q}`] = r2(g + 1);
      if (m.del + 0.5 > curDel(b)) diag.deletionPenaltyFor[b] = r2(m.del + 1);
      if (m.ins !== undefined && m.ins + 0.5 > curIns(b)) diag.insertionPenaltyAfter[b] = r2(m.ins + 1);
    }
  }
  // 2. whatever the full network still finds on a reference (combined findings)
  for (let round = 0; round < 6; round++) {
    let raised = false;
    for (const t of takes) {
      const r = await scorer.score({ audio: t.audio, words }, { diagnosis: diag });
      for (const w of r.words)
        for (const p of w.phones) {
          const b = baseOf(p.phone);
          if (p.issue === "substitution" && p.heardAs) {
            diag.pairPenalty[`${b}>${p.heardAs}`] = r2(curSub(`${b}>${p.heardAs}`) + 3);
            raised = true;
          } else if (p.issue === "deletion") {
            diag.deletionPenaltyFor[b] = r2(curDel(b) + 3);
            raised = true;
          }
        }
      for (const x of r.insertions) {
        const after = baseOf(r.words[x.wordIndex].phones[x.afterPhoneIndex]?.phone ?? "");
        if (!after) continue;
        diag.insertionPenaltyAfter[after] = r2(curIns(after) + 3);
        raised = true;
      }
    }
    if (!raised) break;
  }
  // 3. native baseline per phone: the lowest any reference take got (every take is native)
  const worst = new Map<string, number>();
  for (const t of takes) {
    const r = await scorer.score({ audio: t.audio, words }, { diagnosis: diag });
    for (const { key, raw } of phoneKeys(r)) worst.set(key, Math.min(worst.get(key) ?? Infinity, raw));
  }
  const baseline: Record<string, number> = {};
  for (const [k, v] of worst) if (v < 1.9) baseline[k] = r2(v);
  return { diagnosis: diag, baseline };
}

function focusPoints(focus: CFocus[], words: ItemWord[], pairWords: ItemWord[] | undefined, id: string): FocusPoint[] {
  const find = (ws: ItemWord[], w: string) => ws.findIndex((x) => norm(x.text) === norm(w));
  return focus.map((f) => {
    let word = find(words, f.word);
    let inPair = false;
    if (word < 0 && pairWords) {
      word = find(pairWords, f.word);
      inPair = word >= 0;
    }
    if (word < 0) console.warn(`  ${id}: focus word "${f.word}" not in the item`);
    return {
      word,
      ...(inPair ? { inPair: true } : {}),
      phone: baseOf(f.phone),
      watchFor: f.watch_for,
      tipJa: f.tip_ja ?? "",
      ...(f.tag ? { tag: f.tag } : {}),
    };
  });
}

// ------------------------------------------------------------------ main
const cur = JSON.parse(readFileSync(join(ROOT, "content/curriculum.json"), "utf8")) as Curriculum;
const cmu = loadCmudict(join(ROOT, ".work/cmudict.dict"));
const { scorer, runtime: rt } = await makeNodeScorer({ runtime });
console.log(`scorer: ${rt}`);
mkdirSync(OUT_ITEMS, { recursive: true });

type Job = { item: CItem | CPlacement; unit: string; lesson: string; type: ItemType; difficulty: number };
const jobs: Job[] = [
  ...cur.units.flatMap((u) => u.lessons.flatMap((l) => l.items.map((it) => ({ item: it, unit: u.id, lesson: l.id, type: it.type, difficulty: it.difficulty })))),
  ...cur.placement.map((p) => ({ item: p, unit: "placement", lesson: "placement", type: "sentence" as ItemType, difficulty: 0 })),
];
const wordLog: WordLog[] = [];
const learnedLog: { id: string; learned: LearnedVariant[] }[] = [];
const display = new Map<string, { text: string; note?: string }>();
const t0 = performance.now();
let bytes = 0;
let n = 0;
for (const job of jobs) {
  const it = job.item;
  const tts = it.tts_text ? stripMarkup(it.tts_text) : it.text;
  const respelled = norm(tts) !== norm(it.text);
  const shown = respelled ? { text: tts, note: it.text } : { text: it.text };
  display.set(it.id, shown);
  if (only && !it.id.startsWith(only)) continue;
  // the contrast this item trains is never learned away (win / wing: N, NG)
  const protect = [...new Set(it.focus.flatMap((f) => [f.phone, ...f.watch_for]).filter((p) => p !== "EPEN").map(baseOf))];
  const main = await buildRefs(scorer, it.id, protect, wordLog, learnedLog);
  const pair = "pair" in it && it.pair ? await buildRefs(scorer, `${it.id}-pair`, protect, wordLog, learnedLog) : undefined;
  const data: ItemData = {
    id: it.id,
    unit: job.unit,
    lesson: job.lesson,
    type: job.type,
    text: shown.text,
    ja: it.ja,
    ...("pair" in it && it.pair ? { pair: it.pair } : {}),
    ...(shown.note ? { note: shown.note } : {}),
    ...("diagnoses" in it ? { diagnoses: it.diagnoses } : {}),
    words: main.words,
    ...(main.scoring ? { scoring: main.scoring } : {}),
    focus: focusPoints(it.focus, main.words, pair?.words, it.id),
    difficulty: job.difficulty,
    refs: main.refs,
    ...(pair
      ? {
          pairItem: {
            id: `${it.id}-pair`,
            text: "pair" in it && it.pair ? it.pair : pair.clip.text,
            words: pair.words,
            ...(pair.scoring ? { scoring: pair.scoring } : {}),
            refs: pair.refs,
          },
        }
      : {}),
  };
  const body = JSON.stringify(data);
  writeFileSync(join(OUT_ITEMS, `${it.id}.json`), body);
  bytes += body.length;
  n++;
  if (n % 25 === 0) console.log(`  ${n}/${jobs.length} ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

// ------------------------------------------------------------------ catalog
const catalogItem = (it: CItem): CatalogItem => ({
  id: it.id,
  type: it.type,
  text: display.get(it.id)?.text ?? it.text,
  ja: it.ja,
  difficulty: it.difficulty,
  focus: [...new Set(it.focus.map((f) => baseOf(f.phone)))],
  ...(it.pair ? { pair: it.pair } : {}),
  ...(display.get(it.id)?.note ? { note: display.get(it.id)?.note } : {}),
});
const catalog: Catalog = {
  version: cur.version,
  placement: cur.placement.map((p) => ({
    id: p.id,
    text: display.get(p.id)?.text ?? p.text,
    ja: p.ja,
    diagnoses: p.diagnoses,
    focus: p.focus.map((f) => ({ word: f.word, phone: baseOf(f.phone), watchFor: f.watch_for, tag: f.tag ?? "" })),
  })),
  units: cur.units.map((u) => ({
    id: u.id,
    titleJa: u.title_ja,
    subtitleJa: u.subtitle_ja,
    feature: u.feature,
    whyJa: u.why_ja,
    howJa: u.how_ja,
    lessons: u.lessons.map((l) => ({ id: l.id, titleJa: l.title_ja, goalJa: l.goal_ja, feature: l.feature, items: l.items.map(catalogItem) })),
  })),
};
if (!only) writeFileSync(OUT_CATALOG, JSON.stringify(catalog, null, 1) + "\n");

// ------------------------------------------------------------------ report
const secs = (performance.now() - t0) / 1000;
const below = wordLog.filter((w) => w.score < 90);
const sounds = wordLog.length ? [...new Set(wordLog.map((w) => `${w.item}|${w.voice}|${w.slow}`))].length : 0;
const scores = wordLog.map((w) => w.score).sort((a, b) => a - b);
const pct = (q: number) => scores[Math.min(scores.length - 1, Math.floor(q * scores.length))];
console.log(`\n${n} items in ${secs.toFixed(0)} s, ${(bytes / 1e6).toFixed(2)} MB of item JSON (${(bytes / Math.max(1, n) / 1e3).toFixed(1)} KB/item)`);
console.log(`reference words: ${wordLog.length} over ${sounds} takes; min ${scores[0]}, p1 ${pct(0.01)}, p5 ${pct(0.05)}, median ${pct(0.5)}; below 90: ${below.length}`);
for (const w of below) console.log(`  ${w.item} ${w.voice}${w.slow ? " slow" : ""} "${w.word}" ${w.score} [${w.variant}]`);
console.log(`learned variants: ${learnedLog.reduce((a, x) => a + x.learned.length, 0)} on ${learnedLog.length} recordings`);
writeFileSync(LOG, JSON.stringify({ runtime: rt, items: n, seconds: secs, bytes, below, learned: learnedLog }, null, 1));
await scorer.dispose();
