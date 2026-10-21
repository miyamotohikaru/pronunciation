# src/engine/scoring — sound (segmental) scoring

Framework-free TypeScript that turns a 16 kHz take plus the target words into per-phone
scores, "heard as" findings, inserted vowels, word scores and one *sounds* score
(0–100). The same code runs in a browser Web Worker (onnxruntime-web, WebGPU → WASM)
and in Node (onnxruntime-node) — the content build uses it in Node, the app in the
worker. Relative imports carry `.ts`; only erasable TypeScript is used, so Node 25 runs
the files directly.

```
audio ─► mel.ts (whisper log-mel) ─► ONNX acoustic model ─► per-frame log-probs
      ─► phones.ts   units: stress variants merged (logsumexp), DX/Q = T|D
      ─► variants.ts + engine.ts   which pronunciation of each word was said
      ─► ctc.ts      forced alignment (= torchaudio forced_align + merge_tokens)
      ─► gop.ts + hgbr.ts   GOP features -> HistGradientBoosting (0..2)
      ─► diagnose.ts  confusions ("heard as"), deletions, inserted vowels
      ─► calibrate.ts 0..100, words, take
```

## Files

| file | what |
|---|---|
| `types.ts` | every public type: model metadata, request, result |
| `engine.ts` | `createScorer(assets, backend)` → `score({audio, words}, options?)` |
| `backend-ort.ts` | ONNX Runtime wrapper; the ORT module is passed in (no import of either package) |
| `client.ts` | main-thread wrapper: `createScoringClient()` → `load(onProgress)`, `score(pcm16k, words, options)` |
| `worker.ts` | the module worker behind it (ORT from our own origin, model in Cache Storage, warm-up) |
| `assets.ts` | `loadAssets(url)`, `loadModelBytes(url, meta)` (Cache Storage) |
| `mel.ts`, `fft.ts` | whisper log-mel: n_fft 400, hop 160, periodic Hann, 80 Slaney filters, log10, max−8, (x+4)/4 |
| `phones.ts` | phone notation, units, emission matrix |
| `ctc.ts` | `forcedAlign` (line-by-line port of torchaudio's CPU kernel), `mergeTokens`, `greedyDecode` |
| `graph.ts` | Viterbi over a CTC token graph (variants, diagnosis network) |
| `variants.ts` | Viterbi over the union of all variants |
| `gop.ts`, `hgbr.ts` | GOP features, sklearn HistGradientBoostingRegressor from JSON |
| `diagnose.ts` | extended recognition network: confusions, deletions, epenthesis |
| `calibrate.ts` | 0–2 → 0–100, word / take aggregation |
| `misaki.ts` | misaki (Kokoro G2P) phonemes → ARPAbet variant |
| `connected.ts` | build-time: weak forms of function words, unreleased final T/D |
| `reference.ts` | build-time: learn extra variants from the native reference audio |

## Use

### Browser

```ts
import { createScoringClient } from "@/engine/scoring/client.ts";
const scoring = createScoringClient();                    // worker: new Worker(new URL("./worker.ts", import.meta.url))
await scoring.load((p) => show(p.phase, p.loaded, p.total)); // assets -> model (cached after the first visit) -> runtime -> session
const ref = item.refs[0];                                 // public/content/items/<id>.json (src/data/schema.ts)
const result = await scoring.score(take.pcm16k, item.words, { ...item.scoring, alignTo: ref.phones });
const prosody = compareProsody(                           // src/engine/prosody: both takes on the same phones
  { phones: ref.phones, pitch: unpack(ref.pitch), speech: ref.speech },
  { phones: result.alignedTo!, pitch: take.pitch, speech: [take.speech.start, take.speech.end] },
  item.words.map((w) => w.text.toLowerCase()));
```

`src/app/lab/score/` is a working example (record or score the item's own reference audio).
`pcm16k` is copied before it is transferred to the worker. Providers default to `["webgpu", "wasm"]` when `navigator.gpu` exists, else `["wasm"]`; a
provider counts only after a warm-up run succeeds, so a broken WebGPU falls back to WASM.
The worker imports `ort.wasm.bundle.min.mjs` (or `ort.webgpu.bundle.min.mjs` when WebGPU
is requested) from `ortUrl`; the `.wasm` next to it must be served from the same folder
(self-hosted — the app is cross-origin isolated). `tools/lib/copy-ort-web.mjs` copies them from
the app's `onnxruntime-web` dependency into `public/models/ort/` (gitignored) on `predev` /
`prebuild`. WASM threads need `crossOriginIsolated` (the app sets COOP/COEP); without it the
worker runs single-threaded. The worker falls back to the WASM bundle if the WebGPU one fails.

### Node

```ts
import * as ort from "onnxruntime-node";
import { createScorer, createOrtBackend } from "../../src/engine/scoring/index.ts";
const key = meta.files.defaultOnnx;                                     // "int8w"
const backend = await createOrtBackend(ort, `public/models/whisper-phoneme/${meta.files.onnx[key]}`, {
  inputName: meta.onnx.input, outputName: meta.onnx.output, nMels: meta.frontEnd.nMels,
  executionProviders: ["cpu"], sessionOptions: { extra: meta.files.sessionConfig?.[key] } });
const scorer = createScorer({ meta, regressor, melFilters }, backend);   // JSON files of the model folder
const result = await scorer.score({ audio, words });
```

`tools/scoring-tests/lib.mts` (`makeScorer`) does exactly this.

### Targets: words with pronunciation variants

```ts
{ text: "really", variants: ["R IY1 AH0? L IY0", "R IH1 L IY0", "R IY1 L IY0"] }
```

* ARPAbet, stress digits optional (the model merges AA/AA0/AA1/AA2, stress only shows up in
  the output). `X?` = optional phone (reduced vowels). `DX` = flap (accepts T or D),
  `Q` = glottal T (T, D or nothing).
* `misakiToArpabet("ɹˈiᵊli")` → `R IY1 AH0? L IY0` (ᵊ optional, T/ɾ → DX, ʔ → Q).
* A "word" can be a linked chunk ("check it out") with one phone string.
* Per take the engine runs one Viterbi pass over the union of all variants, then keeps,
  per word, the variant with the best final word score (scored in that word's frame window,
  diagnosis included). `WordResult.variant` says which one; `PhoneResult.index` is the
  position in it. `options.variantChoice: "likelihood"` skips the second step.

**Build the variants once per item, at content build time (Node):**

```ts
let words = targets;                       // CMUdict variants + misakiToArpabet(native phonemes)
words = addConnectedSpeech(words);         // weak forms (do -> D AH0 ...), unreleased final T/D
const { words: shipped, learned } = await deriveVariants(scorer, words, [
  { name: "af_heart", audio: ref }, { name: "af_heart slow", audio: refSlow }, ...]);
```

`tools/build-content/build.ts` does all of this for the curriculum (plus pitch, syllables and
per-item scoring settings, below). `deriveVariants` scores the native reference with a sensitive network (any vowel may become
any vowel, a few native consonant changes, vowels and T/D/K/P/G/HH/DH/M/N may be silent) and
adds what it finds as variants (at most 2 changes per word, never two neighbouring
consonants, never an insertion; R/L, TH/S, V/B … are never learned). This is what makes the
native references land ≥ 90 although the recognizer hears, for example, Kokoro's "check" as
"CH K" and its "gonna" as "G OW N …". Ship `shipped` with the item; `learned` is the log.
`protect` (the item's focus phones and their watch-for partners) is never learned away, so
"wing" never accepts "W IH N".

**Per-item scoring settings** (`item.scoring`, made by the content build from the four
reference takes, passed back as `ScoreOptions`):
* `diagnosis.pairPenalty` / `deletionPenaltyFor` / `insertionPenaltyAfter` — where a reference
  itself shows evidence for a confusion, a deletion or an inserted vowel, that penalty is set
  to the native's margin + 1 nat (then raised until no reference take is flagged);
* `baseline` — per phone (`"<word>:<base>:<n>"`) the lowest raw score a reference take got
  when below 1.9; a take gets the same handicap (raw + 1.9 − baseline).
Together they make every reference word score ≥ 98 while `say` errors are caught as often
as with the model defaults (`tools/build-content/check-items.ts`).

Other options: `alignTo` (force-align the take to a given phone sequence — the reference's —
for prosody, returned as `alignedTo`), `measureMargins` (build time), `variantChoice`.

### Result

```ts
{
  words: [{ text, score, start, end, variant,
            phones: [{ phone, index, score, raw, heardAs?, issue?, start, end }] }],
  insertions: [{ wordIndex, afterPhoneIndex, vowel, start, end }],
  sounds,                    // 0..100 for the take
  spans,                     // [{ phone, word, start, end }] — one per realized phone, for src/engine/prosody
  heard,                     // free (greedy) decode, debugging only
  timing: { mel, model, align, total }, backend,
}
```

* `issue`: `substitution` (a confusable phone won, `heardAs` set), `deletion` (skipping it
  explained the audio better), `distortion` (score < 60, nothing specific; `heardAs` is
  set when the strongest competitor is in the confusion set).
* Phone times are CTC spans: short spikes, not phone boundaries. Word `start`/`end` are
  widened to the middle of the gaps between words (±60 ms at the ends) for playback.
* Scores: phone = calibrated regressor (substitution ≤ 35, deletion ≤ 30); word = mean of
  its phones plus one 35-point pseudo-phone per inserted vowel, never more than the lowest
  of them + 20 (one substitution, deletion or inserted vowel puts any word below 60); sounds =
  word scores weighted by their number of sounds.

## Model folder (`public/models/whisper-phoneme/`)

| file | size | |
|---|---|---|
| `model.int8w.onnx` | 24.2 MB (20.7 MB gzip) | encoder + CTC head, log-softmax inside, dynamic time axis; weight-only int8 |
| `meta.json` | 5 KB | vocabulary, units, front end, regressor classes, calibration, diagnosis |
| `regressor.json` | 165 KB | the GOP regressor (64 trees) |
| `mel_filters_80.json` | 10 KB | whisper's Slaney filters, sparse, exact float32 |

`meta.files.sessionConfig.int8w` sets `session.disable_quant_qdq=1`, which makes ONNX Runtime
fold the DequantizeLinear nodes into fp32 weights once at load: the download is int8, the
compute fp32 (identical numbers on every runtime, full speed on WebGPU). The fp32 (95.4 MB)
and dynamic-int8 (29.1 MB) exports stay in `.work/onnx/`.

`public/models/ort/` (gitignored, copied on `predev` / `prebuild`) holds onnxruntime-web 1.30.0:
`ort.wasm.bundle.min.mjs` + `ort-wasm-simd-threaded.{mjs,wasm}` (14.2 MB, 3.7 MB gzip) for
browsers without WebGPU, `ort.webgpu.bundle.min.mjs` + `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`
(26.8 MB, 6.7 MB gzip) otherwise. Serve `.wasm` as `application/wasm`.

## Swapping the model

Everything model-specific is in `meta.json`; nothing in the code knows the vocabulary.

1. Export the network to ONNX with input `mel [1, nMels, L]` → output `[1, T, V]`
   (dynamic `L`), ideally with log-softmax inside (`onnx.logSoftmax: false` makes the
   engine apply it). `tools/model/export/export_onnx.py` is the template
   (`DynamicLogProbs` slices the positional embedding to the real length).
2. Write `meta.json` like `tools/model/export/export_assets.py` does:
   * `vocab`, `vocabSize`, `blank`, `onnx.frameRate`, `onnx.samplesPerFrame`, `onnx.maxFrames`
   * `units`: **every ARPAbet base symbol → the model's token ids** (several ids are
     merged with logsumexp — that is how stress variants, or IPA allophones such as
     ɝ/ɚ for ER, map onto one phone). Diphthongs must be single tokens (or map AY to the
     token the model uses for it).
   * `frontEnd`: whisper log-mel parameters and the padding policy (`tailPadSeconds`).
   * `regressor`: feature order, one-hot size and `classOf` (phone → one-hot index), plus
     `regressor.json` (any sklearn `HistGradientBoostingRegressor`; export with
     `export_regressor()` and the whitelist loader `safe_load_regressor.py`).
   * `files.onnx` / `defaultOnnx` / `sessionConfig` (ORT session config entries per file).
   * `calibration.knots` and `diagnosis` thresholds (below).
3. Re-tune: `node tools/scoring-tests/tune.mts` prints, per clip, how much each
   confusion / deletion / insertion would improve the path (log-prob). Penalties must sit
   above the native margins and below the error margins. Then re-check
   `npm test` in `tools/scoring-tests` and re-derive the shipped variants (they depend on
   the model).
4. Point the app at the new folder (`modelUrl`).

## Export variants and accuracy (speechocean762 test, 2 500 utterances, 47 369 phones)

Pooled phone-level PCC against the human scores (upstream baseline 0.606):

| log-probs | encoder frames (mean) | upstream token scoring | merged stress units |
|---|---|---|---|
| 30-s padding, PyTorch fp32 (upstream) | 1500 | **0.6062** | 0.6132 |
| 30-s padding, dynamic int8 | 1500 | 0.6067 | 0.6137 |
| trimmed, fp32 | 194 | 0.5799 | 0.5830 |
| trimmed, dynamic int8 | 194 | 0.5787 | 0.5816 |
| **+0.5 s zeros, weight-only int8 (shipped)** | 219 | 0.5811 | **0.5861** |
| +0.5 s zeros, dynamic int8 | 219 | 0.5849 | 0.5874 |
| +0.5 s zeros, fp32 | 219 | 0.5830 | 0.5864 |
| +1 s / +2 s / +5 s zeros, dynamic int8 | 244 / 294 / 444 | 0.5829 / 0.5884 / 0.5917 | 0.5877 / 0.5919 / 0.5964 |
| padded to ≥ 5 s / ≥ 10 s, dynamic int8 | 261 / 500 | 0.5842 / 0.5937 | 0.5887 / 0.5977 |

* (a) trimming instead of 30-s padding costs 0.026–0.030 (the encoder was fine-tuned on
  zero-padded 30-s windows). Appending zeros recovers part of it: +0.003–0.006 for 0.5 s
  (+25 frames, +13 % compute on a 3-s take), +0.015 for 5 s.
* (b) quantization is free: dynamic int8 ±0.001, weight-only int8 −0.0003 vs fp32.
* (c) merging stress variants (logsumexp over AA/AA0/AA1/AA2 …, one-hot of the stress-0
  token) *improves* PCC (+0.007 padded, +0.003 trimmed) and removes the dependency on
  speechocean762's stress convention.
* Chosen: 0.5 s tail padding + weight-only int8 + merged units = 0.586 (−0.020 vs 0.606):
  the cheapest variant within ~0.02. Weight-only beats dynamic int8 for shipping: smaller
  (24.2 vs 29.1 MB), the same numbers on every runtime (dynamic int8 differs by up to ~1
  log-prob between onnxruntime builds and between WASM and WebGPU, which flipped the
  sam_sink finding), and 6× faster on WebGPU (dynamic int8's MatMulInteger falls back to
  the CPU there).
* Calibration (0..2 → 0..100, knots in `export_assets.py`): speechocean762 phones scored 2
  by humans land ≥ 90 in 90 % of cases (median 100), phones scored 0 land < 60 in 70 %
  (median 29). The model is lenient on heavy accents (human 1.x: median 96).

## Tests and benchmarks (`tools/scoring-tests`, own `package.json`)

```
npm install            # onnxruntime-node / -web 1.30.0, puppeteer-core (not the app's deps)
npm test               # fuzz + parity + behaviour (node --test)
npm run wavs           # every test clip with what the engine found
npm run parity         # TS vs Python reference table
npm run bench          # Node latency (3 s / 8 s)
npm run serve & npm run bench:web   # Chrome (puppeteer) latency, WASM and WebGPU
node lab-score.mts [--base http://localhost:3016] [--providers wasm]   # /lab/score inside the app
```

Content: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/build-content/build.ts`
(~1.5 min with onnxruntime-node from tools/scoring-tests, else onnxruntime-web WASM in Node)
and `tools/build-content/check-items.ts` (errors on built items).

Python side (`.venv`): `tools/model/export/` — `export_onnx.py`, `quantize_weights.py`,
`export_assets.py`, `eval_speechocean.py`, `eval_padding.py`, `reference_scores.py`,
`align_cases.py`, `regressor_cases.py`.

### Current results (M4 Pro; `say` / Kokoro clips in `.work/`)

* **Parity**: `forcedAlign` = torchaudio on 600 random cases (ties, repeats, tight T);
  `hgbr.ts` = sklearn bit for bit on 3 000 inputs; on 63 test clips the TS mel differs from
  `whisper.log_mel_spectrogram` by ≤ 3e-5, the alignment is identical and the raw scores
  agree within 5e-5 (TS log-probs scored by Python, fp32 end to end, and the shipped model
  end to end, onnxruntime-node 1.30 vs onnxruntime 1.23 python). Dynamic int8 end to end:
  alignment identical on only 20/34 clips, raw scores up to 0.27 apart.
* **Latency** (whole `score()`, warm): Node (onnxruntime-node CPU) 3 s take 16–24 ms,
  8 s take 35–57 ms. Chrome 155 (headless, cross-origin isolated, 4 WASM threads):
  WASM 73 ms / 145 ms, WebGPU (Metal) 12 ms / 29 ms; first call after load 143 / 303 ms
  (WASM), 42 / 31 ms (WebGPU); load ≈ 1.2–1.8 s from a local server. For comparison
  dynamic int8: WASM 56 / 200 ms, WebGPU 87 / 194 ms; fp32: WASM 65 / 177 ms, WebGPU 13 / 34 ms.
  Not measured on phones yet.
* **Behaviour** (`npm run wavs`): all 52 Kokoro reference takes (af_heart, am_michael,
  normal + slow) ≥ 90 per word with nothing flagged (lowest word 91, lowest take 96.9);
  Samantha reading the same sentences: ≥ 90. Found: R→L (sam_lice), TH→S (sam_sink,
  "sank you", Kyoko), R→D, L→R, AE→AA ("black cut"), IY→IH ("ship"), V→B ("boice"),
  DH→D, inserted vowels in "sutoreeto", "desuku", "miruku", "beddo", "raiku"; every
  Kyoko (katakana) clip except "very" and "street".

## Known limitations

* The model is canonical-biased: it hears V in "berry", DH in "zis", and Kyoko's "very" /
  "street" pass. TH→S in sam_sink wins by only ~2.3 nats (penalty 2.0). The distilled
  model is expected to help; re-tune with `tune.mts` when it lands.
* Natives are only safe on items whose targets were built with `deriveVariants` from the
  native reference: on CMUdict-only targets Samantha's "on", "milk", "white sheep" (heard
  as "W AY T R IY D") and "your" score 41–88. Held-out Kokoro voices (bella, nicole, fenrir,
  puck) pass 29/32 (fast "do" in "What do you", puck's "Could").
* Thresholds were tuned on synthetic speech only (`say`, Kokoro). The insertion penalty
  (0.5 nats) is low; real phone-mic takes with breath / noise need checking.
* Deletion detection is deliberately weak (penalty 6) — native reductions look the same.
* CTC phone times are spikes; word ranges are padded for playback, prosody rebuilds
  boundaries itself.
* Input must be 16 kHz mono (`src/engine/audio` resamples); takes over 30 s are cut.
* The worker has not been bundled by Next/Turbopack yet (`new Worker(new URL(...))` and the
  `webpackIgnore`/`turbopackIgnore` dynamic import of the ORT bundle).
