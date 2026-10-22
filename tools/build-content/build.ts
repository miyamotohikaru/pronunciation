/**
 * Content build: content/ (curriculum.json + challenge / phonemes / alphabet.json, see
 * sources.ts) + the Kokoro reference takes (.work/tts/<voice>/)
 * -> public/content/items/<id>.json (src/data/schema.ts ItemData) + src/data/catalog.json.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/build-content/build.ts [--only <id-prefix>] [--runtime node|web]
 *        [--curriculum <file>] [--content <dir>] [--model-dir <dir>] [--out <items dir>] [--plan] [--partial]
 *   --plan: build nothing, only write the lines that still need TTS (.work/content-tts-needed.json,
 *           tools/tts/synth.py input: synth.py .work/content-tts-needed.json)
 *
 * Per item: target words (misaki of both voices + CMUdict + weak forms + variants learned
 * from the four reference takes), then per voice and speed: the scorer's alignment and
 * self-score, pitch (src/engine/audio/pitch.ts), syllables (src/engine/prosody), Kokoro's
 * word timings. rhythm / intonation of a voice = the other voice compared with it.
 * Dictionary-style IPA (src/engine/scoring/ipa.ts) per word and per line, from what the
 * reference voice was asked to say (misaki).
 * A line whose takes are missing or were recorded for another text is skipped; those lines are
 * listed for tools/tts/synth.py in .work/content-tts-needed.json, and the app's catalog is then
 * left as it is (--partial writes one with the built lines only).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readWav } from "./wav.ts";
import { loadCmudict } from "./cmudict.ts";
import { loadSources, type CFocus, type SourceLine } from "./sources.ts";
import { analyzePitch } from "../../src/engine/audio/pitch.ts";
import { compareProsody, speakerMedianHz, syllabify, syllableStats, toRegions, type PhoneSpan, type PitchFrame } from "../../src/engine/prosody/index.ts";
import { addConnectedSpeech } from "../../src/engine/scoring/connected.ts";
import { deriveVariants, type LearnedVariant } from "../../src/engine/scoring/reference.ts";
import { baseOf } from "../../src/engine/scoring/phones.ts";
import { ipaLine, ipaWord } from "../../src/engine/scoring/ipa.ts";
import type { Scorer } from "../../src/engine/scoring/engine.ts";
import type { ScoreResult, TargetWord } from "../../src/engine/scoring/types.ts";
import type { Catalog, CatalogItem, FocusPoint, ItemData, ItemWord, RefSyllable, RefTiming, RefVoice } from "../../src/data/schema.ts";
import { cmuVariants, targetsFromKokoro, tokenize, type KokoroClip } from "../lib/targets.ts";
import { makeNodeScorer, ROOT } from "../lib/scorer-node.ts";

const VOICES = ["af_heart", "am_michael"];
const TTS = join(ROOT, ".work/tts");
const OUT_ITEMS_DEFAULT = join(ROOT, "public/content/items");
const OUT_CATALOG = join(ROOT, "src/data/catalog.json");
const LOG = join(ROOT, ".work/build-content.json");
const NEEDED = join(ROOT, ".work/content-tts-needed.json");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const runtime = (args.includes("--runtime") ? args[args.indexOf("--runtime") + 1] : "auto") as "auto" | "node" | "web";
/** --model-dir / --out: build with another model into another folder (its catalog.json and log go next to it) */
const modelDir = args.includes("--model-dir") ? args[args.indexOf("--model-dir") + 1] : undefined;
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
/** --curriculum: another curriculum file (e.g. an older version whose takes are on disk) */
const curriculumPath = args.includes("--curriculum") ? args[args.indexOf("--curriculum") + 1] : undefined;
/** --plan: only check the takes and write the lines that need TTS (.work/content-tts-needed.json) */
const plan = args.includes("--plan");
/** --partial: write the app's catalog even though some lines had no takes (it then lists only the built ones) */
const partial = args.includes("--partial");
/** --content: another content folder (tests) */
const contentDir = args.includes("--content") ? args[args.indexOf("--content") + 1] : join(ROOT, "content");

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** "[for](/fəɹ/) a minute" -> "for a minute" */
const stripMarkup = (s: string) => s.replace(/\[([^\]]+)\]\(\/[^)]*\/\)/g, "$1");
const norm = (s: string) => tokenize(s).join(" ");

/** "" = normal, ".slow" (0.8), ".slower" (0.65) — the TTS file suffixes */
type Speed = "" | ".slow" | ".slower";
const SPEEDS: Speed[] = ["", ".slow", ".slower"];

type Take = { audio: Float32Array; clip: KokoroClip; pitch: PitchFrame[]; speed: Speed };

function loadTake(voice: string, id: string, speed: Speed): Take {
  const base = join(TTS, voice, id + speed);
  const { sampleRate, samples } = readWav(`${base}.16k.wav`);
  if (sampleRate !== 16000) throw new Error(`${base}.16k.wav is ${sampleRate} Hz`);
  const clip = JSON.parse(readFileSync(`${base}.json`, "utf8")) as KokoroClip;
  return { audio: samples, clip, pitch: analyzePitch(samples), speed };
}

/**
 * Are all six takes of `id` on disk and recorded for this text? Ids are kept when content is
 * rewritten (v2 turned "hotel" into "I have an idea."), so an old take must not be reused.
 */
function takeStatus(id: string, text: string, tts: string): "ok" | "missing" | "changed" {
  for (const v of VOICES)
    for (const sp of SPEEDS) {
      const base = join(TTS, v, id + sp);
      if (!existsSync(`${base}.16k.wav`) || !existsSync(`${base}.json`)) return "missing";
      const clip = JSON.parse(readFileSync(`${base}.json`, "utf8")) as KokoroClip;
      if (norm(clip.text) !== norm(text) || norm(stripMarkup(clip.tts_text ?? clip.text)) !== norm(tts)) return "changed";
    }
  return "ok";
}

/** Edit-distance alignment of two phone lists (bases); DX / Q match T or D for free. map[i] = j or -1. */
function alignPhones(a: string[], b: string[]): { cost: number; map: number[] } {
  const same = (x: string, y: string) => x === y || ((x === "DX" || x === "Q") && (y === "T" || y === "D"));
  const D = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      D[i][j] = Math.min(D[i - 1][j - 1] + (same(a[i - 1], b[j - 1]) ? 0 : 1), D[i - 1][j] + 1, D[i][j - 1] + 1);
  const map = new Array<number>(a.length).fill(-1);
  for (let i = a.length, j = b.length; i > 0 && j > 0; ) {
    if (D[i][j] === D[i - 1][j - 1] + (same(a[i - 1], b[j - 1]) ? 0 : 1)) map[--i] = --j;
    else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  return { cost: D[a.length][b.length], map };
}

/**
 * The phones a dictionary writes for a word: the flap / glottal T (DX, Q) back to the T or D it
 * stands for — from the closest CMUdict pronunciation, else the spelling. flap = a t became a flap.
 */
function dictionaryPhones(text: string, phones: string[]): { phones: string[]; flap: boolean } {
  const at = phones.flatMap((p, i) => (p === "DX" || p === "Q" ? [i] : []));
  if (!at.length) return { phones, flap: false };
  const a = phones.map(baseOf);
  let best: { b: string[]; map: number[]; cost: number } | null = null;
  for (const pr of cmuVariants(text, cmu)) {
    const b = pr.map(baseOf);
    const r = alignPhones(a, b);
    if (!best || r.cost < best.cost) best = { b, ...r };
  }
  const spelled = /t/i.test(text) || !/d/i.test(text) ? "T" : "D";
  const out = phones.slice();
  let flap = false;
  for (const i of at) {
    const j = best ? best.map[i] : -1;
    const u = best && j >= 0 && (best.b[j] === "T" || best.b[j] === "D") ? best.b[j] : spelled;
    if (phones[i] === "DX" && u === "T") flap = true;
    out[i] = u;
  }
  return { phones: out, flap };
}

/**
 * Voiced span of a take from its own audio (10 ms frames within 30 dB of the loudest one),
 * not from Kokoro's word timestamps (they drift, badly at 0.65).
 */
function speechOf(t: Take): [number, number] {
  let peak = 0;
  for (const f of t.pitch) if (f.rms > peak) peak = f.rms;
  const thr = Math.max(peak * 0.0316, 1e-4);
  const on = t.pitch.filter((f) => f.rms >= thr);
  if (!on.length) return [t.clip.words[0].start, t.clip.words[t.clip.words.length - 1].end];
  const dur = t.audio.length / 16000;
  return [r3(Math.max(0, on[0].t - 0.01)), r3(Math.min(dur, on[on.length - 1].t + 0.01))];
}
const wordTexts = (t: Take) => t.clip.words.map((w) => w.text.toLowerCase());

/** |Kokoro's word boundary - the alignment's|, seconds, per speed (starts and ends pooled) */
const drift: Record<Speed, number[]> = { "": [], ".slow": [], ".slower": [] };
/** reference word scores with the model defaults (shipped variants, no item calibration) */
const uncalibrated: Record<Speed, number[]> = { "": [], ".slow": [], ".slower": [] };

/** One take of a reference voice: alignment, self-score, pitch, syllables. */
async function analyze(scorer: Scorer, take: Take, words: TargetWord[], scoring: ItemScoring): Promise<{ r: ScoreResult; timing: RefTiming }> {
  const r = await scorer.score({ audio: take.audio, words }, scoring);
  const phones = r.spans.map((s) => ({ phone: s.phone, word: s.word, start: r3(s.start), end: r3(s.end) }));
  const speech = speechOf(take);
  const syl = syllabify(phones as PhoneSpan[], wordTexts(take));
  const regions = toRegions(phones as PhoneSpan[], speech[0], speech[1]);
  // word spans for the lyric wipe: first phone region start -> last phone region end; the
  // first word starts with the voice and the last one ends with it
  const last = take.clip.words.length - 1;
  const wordSpans = take.clip.words.map((kw, wi) => {
    const idx = phones.map((p, i) => (p.word === wi ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return { start: r3(kw.start), end: r3(kw.end) };
    let start = regions[idx[0]].start;
    let end = regions[idx[idx.length - 1]].end;
    if (wi === 0) start = Math.min(start, speech[0]);
    if (wi === last) end = Math.max(end, speech[1]);
    const span = { start: r3(start), end: r3(end) };
    drift[take.speed].push(Math.abs(kw.start - span.start), Math.abs(kw.end - span.end));
    return span;
  });
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
    words: wordSpans,
    phones,
    speech,
    pitch: take.pitch.map((f) => [r2(f.t), f.f0 === null ? 0 : Math.round(f.f0), Math.round(f.rms * 1000)] as [number, number, number]),
    syllables,
    selfScore: { sounds: r.sounds, minWord: Math.min(...r.words.map((w) => w.score)) },
  };
  return { r, timing };
}

type WordLog = { item: string; voice: string; speed: Speed; word: string; score: number; variant: string };

/** Targets + both voices (normal, slow, slower) of one recorded id. */
/**
 * listenOnly (a dialogue's partner lines): the takes are aligned for the lyric wipe, the pitch lane
 * and the IPA, but nothing is learned or calibrated for scoring (no `scoring`, plain targets) and
 * their words stay out of the reference report.
 */
async function buildRefs(scorer: Scorer, id: string, protect: string[], log: WordLog[], learnedLog: { id: string; learned: LearnedVariant[] }[], listenOnly = false) {
  const takes = VOICES.map((v) => ({ voice: v, normal: loadTake(v, id, ""), slow: loadTake(v, id, ".slow"), slower: loadTake(v, id, ".slower") }));
  const all = takes.flatMap((t) => [t.normal, t.slow, t.slower]);
  const wordList = takes[0].normal.clip.words.map((w) => w.text).join(" ");
  const base = targetsFromKokoro(
    all.map((t) => t.clip).filter((c) => c.words.map((w) => w.text).join(" ") === wordList),
    cmu,
  );
  const derived = listenOnly
    ? { words: addConnectedSpeech(base), learned: [] }
    : await deriveVariants(
        scorer,
        addConnectedSpeech(base),
        takes.flatMap((t) => [t.normal, t.slow, t.slower].map((x) => ({ name: `${t.voice}/${id}${x.speed}`, audio: x.audio }))),
        { protect },
      );
  const words = derived.words;
  if (derived.learned.length) learnedLog.push({ id, learned: derived.learned });
  // before the per-item calibration: what the model defaults make of the references
  if (!listenOnly)
    for (const t of all) {
      const r0 = await scorer.score({ audio: t.audio, words });
      for (const w of r0.words) uncalibrated[t.speed].push(w.score);
    }
  const scoring: ItemScoring = listenOnly
    ? { diagnosis: { pairPenalty: {}, deletionPenaltyFor: {}, insertionPenaltyAfter: {} }, baseline: {} }
    : await calibrateScoring(scorer, words, all);
  const analyzed = [];
  for (const t of takes) {
    const normal = await analyze(scorer, t.normal, words, scoring);
    const slow = await analyze(scorer, t.slow, words, scoring);
    const slower = await analyze(scorer, t.slower, words, scoring);
    if (!listenOnly)
      for (const [r, speed] of [[normal.r, ""], [slow.r, ".slow"], [slower.r, ".slower"]] as const)
        for (const w of r.words) log.push({ item: id, voice: t.voice, speed, word: w.text, score: w.score, variant: String(words[r.words.indexOf(w)].variants[w.variant]) });
    analyzed.push({ t, normal, slow, slower });
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
      slowerAudio: `/audio/${a.t.voice}/${id}.slower.mp3`,
      duration: n.duration,
      slowDuration: a.slow.timing.duration,
      slowerDuration: a.slower.timing.duration,
      words: n.words,
      phones: n.phones,
      speech: n.speech,
      pitch: n.pitch,
      syllables: n.syllables,
      selfScore: { sounds: n.selfScore.sounds, minWord: n.selfScore.minWord, rhythm, intonation },
      slow: a.slow.timing,
      slower: a.slower.timing,
    });
    for (const p of [refs[refs.length - 1].audio, refs[refs.length - 1].slowAudio, refs[refs.length - 1].slowerAudio])
      if (!existsSync(join(ROOT, "public", p))) console.warn(`  missing audio ${p}`);
  }
  // phones: the first voice's misaki spelling (what it was asked to say; the recognizer's
  // reading of the take is in refs[].phones); variants: everything the scorer accepts;
  // ipa: those phones as a dictionary writes them (flap t written t, flap: true)
  const dict: string[][] = [];
  const itemWords: ItemWord[] = words.map((w) => {
    const variants = w.variants.map((v) => (typeof v === "string" ? v : v.join(" ")));
    const phones = variants[0].split(/\s+/).map((p) => p.replace(/\?$/, ""));
    const d = dictionaryPhones(w.text, phones);
    dict.push(d.phones);
    return { text: w.text, phones, ipa: ipaWord(d.phones), ...(d.flap ? { flap: true as const } : {}), variants };
  });
  return { words: itemWords, ipa: ipaLine(dict), refs, clip: takes[0].normal.clip, scoring: compactScoring(scoring) };
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
  // a letter or word inside a chunk the voice said as one ("F.B.I.", focus "B") -> that chunk
  const find = (ws: ItemWord[], w: string) => {
    const i = ws.findIndex((x) => norm(x.text) === norm(w));
    return i >= 0 ? i : ws.findIndex((x) => tokenize(x.text).length > 1 && tokenize(x.text).includes(norm(w)));
  };
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
const { curriculum: cur, lines, sets } = loadSources(contentDir, curriculumPath);
const cmu = loadCmudict(join(ROOT, ".work/cmudict.dict"));
const OUT_ITEMS = outDir ?? OUT_ITEMS_DEFAULT;
const { scorer, runtime: rt } = await makeNodeScorer({ runtime, dir: modelDir });
console.log(`scorer: ${rt}`);
mkdirSync(OUT_ITEMS, { recursive: true });

const wordLog: WordLog[] = [];
const learnedLog: { id: string; learned: LearnedVariant[] }[] = [];
const display = new Map<string, { text: string; note?: string }>();
/** ids built in this run (the catalog lists only these) */
const built = new Set<string>();
/** lines without usable takes, as tools/tts/synth.py input */
const needed: { id: string; text: string; tts_text?: string; why: "missing" | "changed" }[] = [];
const t0 = performance.now();
let bytes = 0;
let n = 0;
for (const it of lines) {
  const tts = it.tts_text ? stripMarkup(it.tts_text) : it.text;
  const respelled = norm(tts) !== norm(it.text);
  const shown = respelled ? { text: tts, note: it.text } : { text: it.text };
  display.set(it.id, shown);
  if (only && !it.id.startsWith(only)) continue;
  const status = takeStatus(it.id, it.text, tts);
  // a pair recording only for v1 "pair" items (v2 keeps `pair` as metadata of a sentence)
  const pairStatus = it.type === "pair" && it.pair ? takeStatus(`${it.id}-pair`, it.pair, it.pair) : "ok";
  if (status !== "ok" || pairStatus !== "ok") {
    if (status !== "ok") needed.push({ id: it.id, text: it.text, ...(it.tts_text ? { tts_text: it.tts_text } : {}), why: status });
    if (pairStatus !== "ok" && it.pair) needed.push({ id: `${it.id}-pair`, text: it.pair, why: pairStatus });
    continue;
  }
  if (plan) continue;
  // the contrast this item trains is never learned away (win / wing: N, NG)
  const protect = [...new Set(it.focus.flatMap((f) => [f.phone, ...f.watch_for]).filter((p) => p !== "EPEN").map(baseOf))];
  const main = await buildRefs(scorer, it.id, protect, wordLog, learnedLog, it.role === "partner");
  const pair = it.type === "pair" && it.pair ? await buildRefs(scorer, `${it.id}-pair`, protect, wordLog, learnedLog) : undefined;
  const data: ItemData = {
    id: it.id,
    unit: it.unit,
    lesson: it.lesson,
    type: it.type,
    text: shown.text,
    ja: it.ja,
    ipa: main.ipa,
    ...(it.role ? { role: it.role } : {}),
    ...(it.swap ? { swap: it.swap.map((x) => ({ word: x.word, noteJa: x.note_ja })) } : {}),
    ...(it.spell ? { spell: it.spell } : {}),
    ...(it.pair ? { pair: it.pair } : {}),
    ...(shown.note ? { note: shown.note } : {}),
    ...(it.diagnoses ? { diagnoses: it.diagnoses } : {}),
    words: main.words,
    ...(main.scoring ? { scoring: main.scoring } : {}),
    focus: focusPoints(it.focus, main.words, pair?.words, it.id),
    difficulty: it.difficulty,
    refs: main.refs,
    ...(pair
      ? {
          pairItem: {
            id: `${it.id}-pair`,
            text: it.pair ?? pair.clip.text,
            ipa: pair.ipa,
            words: pair.words,
            ...(pair.scoring ? { scoring: pair.scoring } : {}),
            refs: pair.refs,
          },
        }
      : {}),
  };
  const body = JSON.stringify(data);
  writeFileSync(join(OUT_ITEMS, `${it.id}.json`), body);
  built.add(it.id);
  bytes += body.length;
  n++;
  if (n % 25 === 0) console.log(`  ${n}/${lines.length} ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
if (needed.length || plan) {
  writeFileSync(NEEDED, JSON.stringify(needed, null, 1) + "\n");
  console.warn(`\n${needed.length} lines skipped (no takes for this text: ${needed.filter((x) => x.why === "missing").length} missing, ${needed.filter((x) => x.why === "changed").length} recorded for an older text) -> ${NEEDED}`);
}

// ------------------------------------------------------------------ catalog
const byId = new Map(lines.map((l) => [l.id, l]));
const catalogItem = (it: SourceLine): CatalogItem => ({
  id: it.id,
  type: it.type,
  text: display.get(it.id)?.text ?? it.text,
  ja: it.ja,
  difficulty: it.difficulty,
  focus: [...new Set(it.focus.map((f) => baseOf(f.phone)))],
  ...(it.pair ? { pair: it.pair } : {}),
  ...(display.get(it.id)?.note ? { note: display.get(it.id)?.note } : {}),
  ...(it.role ? { role: it.role } : {}),
});
const units = cur.units
  .map((u) => ({
    id: u.id,
    titleJa: u.title_ja,
    subtitleJa: u.subtitle_ja,
    feature: u.feature,
    whyJa: u.why_ja,
    howJa: u.how_ja,
    lessons: u.lessons
      .map((l) => ({
        id: l.id,
        titleJa: l.title_ja,
        goalJa: l.goal_ja,
        feature: l.feature,
        ...(l.boss ? { boss: true as const } : {}),
        items: l.items.filter((x) => built.has(x.id)).map((x) => catalogItem(byId.get(x.id)!)),
      }))
      .filter((l) => l.items.length),
  }))
  .filter((u) => u.lessons.length);
const catalogSets = sets
  .map((s) => ({ ...s, items: s.ids.filter((id) => built.has(id)).map((id) => catalogItem(byId.get(id)!)) }))
  .filter((s) => s.items.length)
  .map(({ ids: _ids, ...s }) => s);
const catalog: Catalog = {
  version: cur.version,
  placement: cur.placement
    .filter((p) => built.has(p.id))
    .map((p) => ({
      id: p.id,
      text: display.get(p.id)?.text ?? p.text,
      ja: p.ja,
      diagnoses: p.diagnoses,
      focus: p.focus.map((f) => ({ word: f.word, phone: baseOf(f.phone), watchFor: f.watch_for, tag: f.tag ?? "" })),
    })),
  units,
  ...(catalogSets.length ? { sets: catalogSets } : {}),
};
// with --out the catalog goes next to that folder, the app's stays as it is; the app's catalog is
// not replaced by one that silently drops lessons whose takes are not recorded yet
if (!only && !plan) {
  if (outDir) writeFileSync(join(outDir, "..", "catalog.json"), JSON.stringify(catalog, null, 1) + "\n");
  else if (needed.length && !partial) console.warn(`src/data/catalog.json NOT written: ${needed.length} lines have no takes yet (record them, or pass --partial)`);
  else writeFileSync(OUT_CATALOG, JSON.stringify(catalog, null, 1) + "\n");
}

// ------------------------------------------------------------------ report
const secs = (performance.now() - t0) / 1000;
const below = wordLog.filter((w) => w.score < 90);
const sounds = wordLog.length ? [...new Set(wordLog.map((w) => `${w.item}|${w.voice}|${w.speed}`))].length : 0;
const scores = wordLog.map((w) => w.score).sort((a, b) => a - b);
const pct = (q: number) => scores[Math.min(scores.length - 1, Math.floor(q * scores.length))];
console.log(`\n${n} items in ${secs.toFixed(0)} s, ${(bytes / 1e6).toFixed(2)} MB of item JSON (${(bytes / Math.max(1, n) / 1e3).toFixed(1)} KB/item)`);
console.log(`reference words: ${wordLog.length} over ${sounds} takes; min ${scores[0]}, p1 ${pct(0.01)}, p5 ${pct(0.05)}, median ${pct(0.5)}; below 90: ${below.length}`);
for (const w of below) console.log(`  ${w.item} ${w.voice}${w.speed} "${w.word}" ${w.score} [${w.variant}]`);
for (const sp of SPEEDS) {
  const ws = wordLog.filter((w) => w.speed === sp).map((w) => w.score);
  const d = drift[sp].slice().sort((a, b) => a - b);
  const q = (x: number) => (d.length ? Math.round(d[Math.min(d.length - 1, Math.floor(x * d.length))] * 1000) : 0);
  const u = uncalibrated[sp];
  const uBelow = u.filter((x) => x < 90).length;
  console.log(`speed ${sp || "normal"}: min word ${Math.min(...ws)}; before item calibration ${uBelow}/${u.length} words < 90 (${((100 * uBelow) / Math.max(1, u.length)).toFixed(1)} %); Kokoro word boundary vs alignment |d| median ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${q(1)} ms (${d.length} boundaries)`);
}
console.log(`learned variants: ${learnedLog.reduce((a, x) => a + x.learned.length, 0)} on ${learnedLog.length} recordings`);
if (!plan) writeFileSync(outDir ? join(outDir, "..", "build-content.json") : LOG, JSON.stringify({ runtime: rt, items: n, seconds: secs, bytes, below, learned: learnedLog, drift }, null, 1));
await scorer.dispose();
