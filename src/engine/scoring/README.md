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
| `worker.ts` | ready-made module worker (loads ORT from a URL, caches the model) |
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

### Browser (Web Worker)

```ts
const worker = new Worker(new URL("../engine/scoring/worker.ts", import.meta.url), { type: "module" });
worker.postMessage({ type: "init", modelUrl: "/models/whisper-phoneme/", ortUrl: "/models/ort/" });
// -> { type: "ready", backend: "wasm" | "webgpu", loadMs }
worker.postMessage({ type: "score", id: 1, audio, words }, [audio.buffer]); // audio: Float32Array, 16 kHz mono
// -> { type: "result", id: 1, result: ScoreResult }
```

The worker imports `ort.wasm.bundle.min.mjs` (or `ort.webgpu.bundle.min.mjs` when WebGPU
is requested) from `ortUrl`; the `.wasm` next to it must be served from the same folder
(self-hosted — the app is cross-origin isolated). `node tools/scoring-tests/copy-ort-web.mjs`
copies the pinned onnxruntime-web build into `public/models/ort/`. WASM threads need
`crossOriginIsolated` (the app sets COOP/COEP); without it the worker runs single-threaded.

### Node

```ts
import * as ort from "onnxruntime-node";
import { createScorer, createOrtBackend } from "../../src/engine/scoring/index.ts";
const backend = await createOrtBackend(ort, "public/models/whisper-phoneme/model.int8.onnx",
  { inputName: meta.onnx.input, outputName: meta.onnx.output, nMels: 80, executionProviders: ["cpu"] });
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
  per word, the variant with the best word score (diagnosis included for words with a
  finding). `WordResult.variant` says which one; `PhoneResult.index` is the position in it.

**Build the variants once per item, at content build time (Node):**

```ts
let words = targets;                       // CMUdict variants + misakiToArpabet(native phonemes)
words = addConnectedSpeech(words);         // weak forms (do -> D AH0 ...), unreleased final T/D
const { words: shipped, learned } = await deriveVariants(scorer, words, [
  { name: "af_heart", audio: ref }, { name: "af_heart slow", audio: refSlow }, ...]);
```

`deriveVariants` scores the native reference with a sensitive network (any vowel may become
any vowel, a few native consonant changes, vowels and T/D/K/P/G/HH/DH/M/N may be silent) and
adds what it finds as variants (at most 2 changes per word, never two neighbouring
consonants, never an insertion; R/L, TH/S, V/B … are never learned). This is what makes the
native references land ≥ 90 although the recognizer hears, for example, Kokoro's "check" as
"CH K" and its "gonna" as "G OW N …". Ship `shipped` with the item; `learned` is the log.

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
* Scores: phone = calibrated regressor (substitution ≤ 35, deletion ≤ 30); word =
  harmonic mean of its phones plus one 30-point pseudo-phone per inserted vowel, never
  more than its worst phone + 20; sounds = the same harmonic mean over the take.

## Model folder (`public/models/whisper-phoneme/`)

| file | size | |
|---|---|---|
| `model.int8.onnx` | 29.1 MB | encoder + CTC head, log-softmax inside, dynamic time axis |
| `meta.json` | 5 KB | vocabulary, units, front end, regressor classes, calibration, diagnosis |
| `regressor.json` | 165 KB | the GOP regressor (64 trees) |
| `mel_filters_80.json` | 10 KB | whisper's Slaney filters, sparse, exact float32 |

The fp32 export (95.4 MB) stays in `.work/onnx/` (not shipped).

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
   * `calibration.knots` and `diagnosis` thresholds (below).
3. Re-tune: `node tools/scoring-tests/tune.mts` prints, per clip, how much each
   confusion / deletion / insertion would improve the path (log-prob). Penalties must sit
   above the native margins and below the error margins. Then re-check
   `npm test` in `tools/scoring-tests` and re-derive the shipped variants (they depend on
   the model).
4. Point the app at the new folder (`modelUrl`).

## Export variants and accuracy (speechocean762 test, 2 500 utterances, 47 369 phones)

Pooled phone-level PCC against the human scores (upstream baseline 0.606):

PCC_TABLE

## Tests and benchmarks (`tools/scoring-tests`, own `package.json`)

```
npm install            # onnxruntime-node / -web 1.30.0, puppeteer-core (not the app's deps)
npm test               # fuzz + parity + behaviour (node --test)
npm run wavs           # every test clip with what the engine found
npm run parity         # TS vs Python reference table
npm run bench          # Node latency (3 s / 8 s)
npm run serve & npm run bench:web   # Chrome (puppeteer) latency, WASM and WebGPU
```

Python side (`.venv`): `tools/model/export/` — `export_onnx.py`, `quantize_weights.py`,
`export_assets.py`, `eval_speechocean.py`, `eval_padding.py`, `reference_scores.py`,
`align_cases.py`, `regressor_cases.py`.

RESULTS

## Known limitations

LIMITS
