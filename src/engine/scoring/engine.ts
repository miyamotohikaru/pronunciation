/**
 * The scorer: audio + target words (with pronunciation variants) -> per-phone scores,
 * "heard as", inserted vowels, word scores and the take's sounds score.
 *
 *   1. log-mel (whisper)               mel.ts
 *   2. acoustic model (ONNX)           AcousticBackend (backend-ort.ts)
 *   3. unit emissions (stress merged)  phones.ts
 *   4. variant choice                  variants.ts: Viterbi over the union of all variants,
 *                                      then per word the variant with the best word score
 *   5. forced alignment (torchaudio)   ctc.ts
 *   6. GOP features -> regressor       gop.ts, hgbr.ts
 *   7. diagnosis network               diagnose.ts
 *   8. 0..100 calibration, words, take calibrate.ts
 */
import type {
  AcousticBackend,
  AlignedPhoneSpan,
  DiagnosisConfig,
  Insertion,
  LogProbs,
  ModelMeta,
  PhoneResult,
  ScoreOptions,
  ScoreRequest,
  ScoreResult,
  ScorerAssets,
  WordResult,
} from "./types.ts";
import { padForModel, whisperLogMel } from "./mel.ts";
import { forcedAlign, greedyDecode, mergeTokens, type TokenSpan } from "./ctc.ts";
import { buildEmissions, columnFor, isVowel, makeUnitSpace, parseVariant, regressorClass, type PhoneToken, type UnitSpace } from "./phones.ts";
import { gopFeatures, type GopFeatures } from "./gop.ts";
import { loadRegressor, type Regressor } from "./hgbr.ts";
import { chooseVariants, type VariantChoice, type VariantPhone } from "./variants.ts";
import { diagnose, measureMargins, type DiagPhone } from "./diagnose.ts";
import { calibrate, round1, takeScore, wordScore } from "./calibrate.ts";

export type Scorer = {
  readonly meta: ModelMeta;
  readonly backend: AcousticBackend;
  score(req: ScoreRequest, opts?: ScoreOptions): Promise<ScoreResult>;
  /** Lower-level: everything up to the model output, for tests and the lab page. */
  logProbs(audio: Float32Array, nPhones: number): Promise<{ lp: LogProbs; samples: number }>;
  dispose(): Promise<void>;
};

/** Realized target phone (after the variant choice). */
type Realized = { word: number; variant: number; index: number; at: number; tok: PhoneToken; column: number };

type Evaluation = {
  realized: Realized[];
  spans: TokenSpan[];
  feats: { f: GopFeatures; raw: number; key: string; score: number }[];
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function logSoftmaxInPlace(lp: LogProbs): void {
  const { data, frames, vocabSize: V } = lp;
  for (let t = 0; t < frames; t++) {
    let m = -Infinity;
    for (let v = 0; v < V; v++) if (data[t * V + v] > m) m = data[t * V + v];
    let s = 0;
    for (let v = 0; v < V; v++) s += Math.exp(data[t * V + v] - m);
    const z = m + Math.log(s);
    for (let v = 0; v < V; v++) data[t * V + v] -= z;
  }
}

export function createScorer(assets: ScorerAssets, backend: AcousticBackend): Scorer {
  const { meta, melFilters } = assets;
  const regressor: Regressor = loadRegressor(assets.regressor);
  const fe = meta.frontEnd;
  const spf = meta.onnx.samplesPerFrame;
  const fps = meta.onnx.frameRate;
  const nFeat = meta.regressor.features.length;
  if (regressor.nFeatures !== nFeat + meta.regressor.oneHotSize) throw new Error("regressor does not match meta");

  // the same take scored again (other targets, the content build's repeated passes) reuses
  // the model output; keyed by the audio array itself, so it dies with it
  const lpCache = new WeakMap<Float32Array, { padded: number; lp: LogProbs }>();

  async function logProbs(audio: Float32Array, nPhones: number) {
    const t0 = now();
    const maxSamples = meta.onnx.maxFrames * spf;
    const clip = audio.length > maxSamples ? audio.subarray(0, maxSamples) : audio;
    let padded = padForModel(clip, fe.sampleRate, spf, nPhones, fe.tailPadSeconds, fe.minSeconds);
    if (padded.length > maxSamples) padded = padded.subarray(0, maxSamples);
    const hit = lpCache.get(audio);
    if (hit && hit.padded === padded.length) return { lp: hit.lp, samples: clip.length, melMs: 0, modelMs: 0 };
    const mel = whisperLogMel(padded, melFilters, fe.hop);
    const t1 = now();
    const lp = await backend.run(mel.data, mel.nMels, mel.nFrames);
    if (!meta.onnx.logSoftmax) logSoftmaxInPlace(lp);
    lpCache.set(audio, { padded: padded.length, lp });
    return { lp, samples: clip.length, melMs: t1 - t0, modelMs: now() - t1 };
  }

  /**
   * Native baseline: if the item's reference itself only got `base` (raw, 0..2) on this
   * phone, a take is credited the same handicap (raw + BASELINE_TARGET - base).
   */
  const BASELINE_TARGET = 1.9;
  const adjuster = (baseline: Record<string, number> | undefined) => {
    if (!baseline) return (_key: string, raw: number) => raw;
    return (key: string, raw: number) => {
      const b = baseline[key];
      return b !== undefined && b < BASELINE_TARGET ? Math.min(2, raw + BASELINE_TARGET - b) : raw;
    };
  };
  /** baseline keys: "<word>:<base phone>:<n-th of that phone in the word>" */
  const keyer = () => {
    const seen = new Map<string, number>();
    return (word: number, base: string) => {
      const k = `${word}:${base}`;
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      return `${k}:${n}`;
    };
  };

  /** Forced alignment + GOP + regressor for one realized phone sequence. */
  function evaluate(
    em: Float32Array,
    C: number,
    space: UnitSpace,
    realFrames: number,
    lpFrames: number,
    realized: Realized[],
    adjust: (key: string, raw: number) => number,
  ): Evaluation {
    const frames = Math.min(Math.max(realFrames, realized.length + 5), meta.onnx.maxFrames, lpFrames);
    if (realized.length >= frames) throw new Error("the clip is too short for the target");
    const emB = em.subarray(0, frames * C);
    const path = forcedAlign(emB, frames, C, realized.map((r) => r.column), 0);
    const spans = mergeTokens(path, 0);
    if (spans.length !== realized.length) throw new Error(`alignment gave ${spans.length} spans for ${realized.length} phones`);
    const x = new Float64Array(nFeat + meta.regressor.oneHotSize);
    const key = keyer();
    const feats = spans.map((sp, i) => {
      const f = gopFeatures(emB, C, sp, space);
      x.fill(0);
      meta.regressor.features.forEach((name, j) => (x[j] = f[name]));
      x[nFeat + regressorClass(meta, realized[i].tok.symbol)] = 1;
      const raw = regressor.predict(x);
      const k = key(realized[i].word, realized[i].tok.base);
      return { f, raw, key: k, score: calibrate(adjust(k, raw), meta.calibration.knots) };
    });
    return { realized, spans, feats };
  }

  async function score(req: ScoreRequest, opts: ScoreOptions = {}): Promise<ScoreResult> {
    const t0 = now();
    // per-call overrides; the per-phone tables merge with the model's instead of replacing them
    const cfg: DiagnosisConfig = {
      ...meta.diagnosis,
      ...opts.diagnosis,
      pairPenalty: { ...meta.diagnosis.pairPenalty, ...opts.diagnosis?.pairPenalty },
      deletionPenaltyFor: { ...meta.diagnosis.deletionPenaltyFor, ...opts.diagnosis?.deletionPenaltyFor },
      insertionPenaltyAfter: { ...meta.diagnosis.insertionPenaltyAfter, ...opts.diagnosis?.insertionPenaltyAfter },
    };
    const adjust = adjuster(opts.baseline);
    if (!req.words.length) throw new Error("no target words");
    const parsed = req.words.map((w) => {
      const vs = w.variants.map(parseVariant).filter((v) => v.length);
      if (!vs.length) throw new Error(`word "${w.text}" has no pronunciation`);
      return vs;
    });
    const space = makeUnitSpace(meta);
    const cols: VariantPhone[][][] = parsed.map((vs) => vs.map((v) => v.map((p) => ({ column: columnFor(space, p.symbol), optional: p.optional }))));
    const nMax = parsed.reduce((a, vs) => a + Math.max(...vs.map((v) => v.length)), 0);

    const { lp, samples, melMs, modelMs } = await logProbs(req.audio, nMax);
    const tModel = now();
    const realFrames = Math.floor(samples / spf);
    const framesA = Math.min(Math.max(realFrames, nMax + 5), meta.onnx.maxFrames, lp.frames);
    const C = space.tokens.length;
    const em = buildEmissions(lp, framesA, space);
    const nW = parsed.length;

    const realize = (ch: VariantChoice): Realized[] => {
      const out: Realized[] = [];
      ch.realized.forEach((idx, w) => {
        const v = ch.variant[w];
        idx.forEach((i, k) => out.push({ word: w, variant: v, index: k, at: i, tok: parsed[w][v][i], column: cols[w][v][i].column }));
      });
      return out;
    };

    // insertion slots: after a consonant before a consonant of its word or at the word end,
    // unless the variant had an optional vowel there that was skipped. A skipped optional
    // consonant counts as present ("street" said S T R IY + vowel with the final T silent)
    const withInsertionFlags = (rs: Realized[]): DiagPhone[] =>
      rs.map((r, i) => {
        const next = rs[i + 1];
        const sameWord = next !== undefined && next.word === r.word;
        const variant = parsed[r.word][r.variant];
        const stop = sameWord ? next.at : variant.length;
        let skippedVowel = false;
        let skippedConsonant = false;
        for (let k = r.at + 1; k < stop; k++) {
          if (isVowel(variant[k].symbol)) skippedVowel = true;
          else skippedConsonant = true;
        }
        const consonantHere = !isVowel(r.tok.symbol) || skippedConsonant;
        const insertionAfter = consonantHere && !skippedVowel && (!sameWord || !isVowel(next.tok.symbol));
        return { symbol: r.tok.symbol, column: r.column, word: r.word, index: r.index, insertionAfter };
      });
    const capped = (score: number, d: { deleted: boolean; heardAs?: string }) =>
      d.deleted ? Math.min(score, cfg.deletionCap) : d.heardAs ? Math.min(score, cfg.substitutionCap) : score;

    // 7. diagnosis over the whole take
    const finalize = (e: Evaluation) => {
      const framesB = framesOf(e);
      const dg = diagnose(em.subarray(0, framesB * C), framesB, C, 0, withInsertionFlags(e.realized), space, cfg);
      const per: number[][] = Array.from({ length: nW }, () => []);
      const flagged = new Array(nW).fill(false);
      e.realized.forEach((r, i) => {
        const d = dg.phones[i];
        if (d.deleted || d.heardAs) flagged[r.word] = true;
        per[r.word].push(capped(e.feats[i].score, d));
      });
      const ins = new Array(nW).fill(0);
      for (const x of dg.insertions) {
        ins[x.word]++;
        flagged[x.word] = true;
      }
      const final = per.map((ps, w) => wordScore(ps, ins[w], cfg.insertionScore, cfg.worstPhoneMargin));
      return { dg, final, flagged, framesB };
    };

    // frames [a, b) around word w in an alignment: from the end of the previous word to the
    // start of the next one (wide: into their edge phones)
    const windowOf = (e: Evaluation, w: number, wide: boolean, framesB: number): [number, number] => {
      let first = -1;
      let last = -1;
      e.realized.forEach((r, i) => {
        if (r.word !== w) return;
        if (first < 0) first = i;
        last = i;
      });
      const a = first > 0 ? (wide ? e.spans[first - 1].start : e.spans[first - 1].end) : 0;
      const b = last + 1 < e.spans.length ? (wide ? e.spans[last + 1].end : e.spans[last + 1].start) : framesB;
      return [a, b];
    };
    // one variant of one word, scored inside a window (cheap; used only to choose variants)
    const localScore = (w: number, v: number, a: number, b: number, withDiagnosis: boolean): { score: number; realized: number[] } | null => {
      const T = b - a;
      if (T < 2) return null;
      const win = em.subarray(a * C, b * C);
      let idx = cols[w][v].map((_, i) => i);
      if (cols[w][v].some((p) => p.optional)) {
        const ch = chooseVariants(win, T, C, 0, [[cols[w][v]]]);
        if (!Number.isFinite(ch.score)) return null;
        idx = ch.realized[0];
      }
      const rs: Realized[] = idx.map((i, k) => ({ word: w, variant: v, index: k, at: i, tok: parsed[w][v][i], column: cols[w][v][i].column }));
      let path: Int32Array;
      try {
        path = forcedAlign(win, T, C, rs.map((r) => r.column), 0);
      } catch {
        return null;
      }
      const spans = mergeTokens(path, 0);
      if (spans.length !== rs.length) return null;
      const x = new Float64Array(nFeat + meta.regressor.oneHotSize);
      const key = keyer();
      let scores = spans.map((sp, i) => {
        const f = gopFeatures(win, C, sp, space);
        x.fill(0);
        meta.regressor.features.forEach((name, j) => (x[j] = f[name]));
        x[nFeat + regressorClass(meta, rs[i].tok.symbol)] = 1;
        return calibrate(adjust(key(w, rs[i].tok.base), regressor.predict(x)), meta.calibration.knots);
      });
      let ins = 0;
      if (withDiagnosis) {
        const dg = diagnose(win, T, C, 0, withInsertionFlags(rs), space, cfg);
        scores = scores.map((sc, i) => capped(sc, dg.phones[i]));
        ins = dg.insertions.length;
      }
      return { score: wordScore(scores, ins, cfg.insertionScore, cfg.worstPhoneMargin), realized: idx };
    };
    // per word, the variant with the best (local) word score; returns true if anything changed
    const pickVariants = (e: Evaluation, framesB: number, words: number[], withDiagnosis: boolean): boolean => {
      let changed = false;
      for (const w of words) {
        let [a, b] = windowOf(e, w, false, framesB);
        let cur = localScore(w, choice.variant[w], a, b, withDiagnosis);
        if (!cur) {
          [a, b] = windowOf(e, w, true, framesB);
          cur = localScore(w, choice.variant[w], a, b, withDiagnosis);
        }
        let best = cur ? cur.score : -Infinity;
        let bestV = -1;
        let bestIdx: number[] = [];
        for (let v = 0; v < parsed[w].length; v++) {
          if (v === choice.variant[w]) continue;
          const c = localScore(w, v, a, b, withDiagnosis);
          if (c && c.score > best + 0.5) {
            best = c.score;
            bestV = v;
            bestIdx = c.realized;
          }
        }
        if (bestV >= 0) {
          choice.variant[w] = bestV;
          choice.realized[w] = bestIdx;
          changed = true;
        }
      }
      return changed;
    };

    // 4. variant choice: Viterbi over the union, then per word the best-scoring variant,
    //    then (diagnosis included) for the words that still have a finding
    const needChoice = parsed.some((vs) => vs.length > 1 || vs.some((v) => v.some((p) => p.optional)));
    const choice: VariantChoice = needChoice
      ? chooseVariants(em, framesA, C, 0, cols)
      : { variant: parsed.map(() => 0), realized: parsed.map((vs) => vs[0].map((_, i) => i)), score: 0 };
    let ev = evaluate(em, C, space, realFrames, lp.frames, realize(choice), adjust);
    const framesOf = (e: Evaluation) => Math.min(Math.max(realFrames, e.realized.length + 5), meta.onnx.maxFrames, lp.frames);
    const multi = parsed.map((vs, w) => (vs.length > 1 ? w : -1)).filter((w) => w >= 0);
    if (opts.variantChoice !== "likelihood" && multi.length && pickVariants(ev, framesOf(ev), multi, true))
      ev = evaluate(em, C, space, realFrames, lp.frames, realize(choice), adjust);
    const fin = finalize(ev);
    const { realized, spans, feats } = ev;
    const dg = fin.dg;
    const tAlign = now();

    // 8. assemble
    const sec = (f: number) => f / fps;
    const words: WordResult[] = req.words.map((w, wi) => ({ text: w.text, score: 0, start: 0, end: 0, variant: choice.variant[wi], phones: [] }));
    realized.forEach((r, i) => {
      const { f, raw } = feats[i];
      let score = feats[i].score;
      const d = dg.phones[i];
      const pr: PhoneResult = { phone: r.tok.symbol, index: r.at, score, raw: Math.round(raw * 1e4) / 1e4, start: sec(spans[i].start), end: sec(spans[i].end) };
      if (opts.features) pr.features = meta.regressor.features.map((name) => f[name]);
      const conf = cfg.confusions[r.tok.base] ?? [];
      if (d.deleted) {
        pr.issue = "deletion";
        score = Math.min(score, cfg.deletionCap);
      } else if (d.heardAs) {
        pr.issue = "substitution";
        pr.heardAs = d.heardAs;
        score = Math.min(score, cfg.substitutionCap);
      } else if (score < cfg.distortionBelow) {
        pr.issue = "distortion";
        const top = f.topCompetitor >= 0 ? space.names[f.topCompetitor] : undefined;
        if (top && conf.includes(top)) pr.heardAs = top;
      }
      pr.score = round1(score);
      words[r.word].phones.push(pr);
    });
    const insertions: Insertion[] = dg.insertions.map((s) => ({ wordIndex: s.word, afterPhoneIndex: s.afterIndex, vowel: s.vowel, start: sec(s.start), end: sec(s.end) }));
    const insCount = words.map(() => 0);
    for (const s of insertions) insCount[s.wordIndex]++;
    words.forEach((w, wi) => {
      w.score = round1(wordScore(w.phones.map((p) => p.score), insCount[wi], cfg.insertionScore, cfg.worstPhoneMargin));
    });
    const sounds = takeScore(words.map((w, wi) => ({ score: w.score, sounds: w.phones.length + insCount[wi] })));
    // word ranges for playback: first to last phone, widened to the middle of the gaps
    // between words (and by up to 60 ms at the ends of the take)
    const dur = samples / fe.sampleRate;
    const core = words.map((w) => [w.phones[0].start, w.phones[w.phones.length - 1].end]);
    words.forEach((w, wi) => {
      const [s0, e0] = core[wi];
      w.start = wi > 0 ? (core[wi - 1][1] + s0) / 2 : Math.max(0, s0 - 0.06);
      w.end = wi + 1 < words.length ? (e0 + core[wi + 1][0]) / 2 : Math.min(Math.max(dur, e0), e0 + 0.06);
    });
    const heard = greedyDecode(em, framesA, C, 0, 1 + space.phoneColumns.length).map((s) => space.names[s.token]);
    const margins = opts.measureMargins ? measureMargins(em.subarray(0, fin.framesB * C), fin.framesB, C, 0, withInsertionFlags(realized), space, cfg) : undefined;
    // the same take aligned to a fixed phone sequence (the reference's), for prosody
    let alignedTo: AlignedPhoneSpan[] | undefined;
    if (opts.alignTo?.length) {
      const seq = opts.alignTo;
      const n = seq.length;
      const frames = Math.min(Math.max(realFrames, n + 5), meta.onnx.maxFrames, lp.frames);
      const emX = frames <= framesA ? em.subarray(0, frames * C) : buildEmissions(lp, frames, space);
      try {
        const sp = mergeTokens(forcedAlign(emX, frames, C, seq.map((x) => columnFor(space, x.phone)), 0), 0);
        if (sp.length === n) alignedTo = seq.map((x, i) => ({ phone: x.phone, word: x.word, start: sec(sp[i].start), end: sec(sp[i].end) }));
      } catch {
        alignedTo = undefined;
      }
    }
    return {
      words,
      insertions,
      sounds: round1(sounds),
      spans: realized.map((r, i) => ({ phone: r.tok.symbol, word: r.word, start: sec(spans[i].start), end: sec(spans[i].end) })),
      heard,
      ...(alignedTo ? { alignedTo } : {}),
      ...(margins ? { margins } : {}),
      timing: { mel: round1(melMs), model: round1(modelMs), align: round1(tAlign - tModel), total: round1(now() - t0) },
      backend: backend.name,
    };
  }

  return {
    meta,
    backend,
    score,
    async logProbs(audio: Float32Array, nPhones: number) {
      const r = await logProbs(audio, nPhones);
      return { lp: r.lp, samples: r.samples };
    },
    dispose: () => backend.dispose(),
  };
}
