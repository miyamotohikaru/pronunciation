/**
 * Whisper-compatible log-mel spectrogram (openai-whisper audio.log_mel_spectrogram):
 *   torch.stft(n_fft=400, hop=160, periodic Hann, center=True, reflect padding),
 *   drop the last frame, |X|^2, 80 Slaney mel filters (whisper/assets/mel_filters.npz),
 *   log10(max(x, 1e-10)), clamp to (global max - 8), (x + 4) / 4.
 * Output is row-major [nMels, nFrames] float32, ready for the ONNX input [1, nMels, nFrames].
 */
import type { MelFilterBank } from "./types.ts";
import { fft, makeFftPlan, type FftPlan } from "./fft.ts";

export type LogMel = { data: Float32Array; nMels: number; nFrames: number };

type MelContext = {
  plan: FftPlan;
  window: Float64Array;
  bank: MelFilterBank;
  re: Float64Array;
  im: Float64Array;
  outRe: Float64Array;
  outIm: Float64Array;
  power: Float64Array;
};

const contexts = new WeakMap<MelFilterBank, MelContext>();

function contextFor(bank: MelFilterBank): MelContext {
  let c = contexts.get(bank);
  if (c) return c;
  const n = bank.nFft;
  const window = new Float64Array(n);
  // torch.hann_window(n) is periodic: 0.5 - 0.5 cos(2 pi k / n)
  for (let k = 0; k < n; k++) window[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / n);
  c = {
    plan: makeFftPlan(n),
    window,
    bank,
    re: new Float64Array(n),
    im: new Float64Array(n),
    outRe: new Float64Array(n),
    outIm: new Float64Array(n),
    power: new Float64Array((n >> 1) + 1),
  };
  contexts.set(bank, c);
  return c;
}

/** Reflect padding index (numpy/torch "reflect": the edge sample is not repeated). */
function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * (n - 1);
  let j = i % period;
  if (j < 0) j += period;
  return j < n ? j : period - j;
}

export function whisperLogMel(audio: Float32Array, bank: MelFilterBank, hop = 160): LogMel {
  const c = contextFor(bank);
  const nFft = bank.nFft;
  const half = nFft >> 1;
  const nBins = half + 1;
  const n = audio.length;
  if (n <= half) throw new Error(`audio too short for the STFT (${n} samples)`);
  const nFrames = Math.floor(n / hop); // 1 + n/hop frames, minus the dropped last one
  const nMels = bank.nMels;
  const mel = new Float64Array(nMels * nFrames);
  const { re, im, outRe, outIm, power, window, plan } = c;
  for (let t = 0; t < nFrames; t++) {
    const s0 = t * hop - half; // first sample of this frame in unpadded coordinates
    if (s0 >= 0 && s0 + nFft <= n) {
      for (let k = 0; k < nFft; k++) re[k] = audio[s0 + k] * window[k];
    } else {
      for (let k = 0; k < nFft; k++) re[k] = audio[reflect(s0 + k, n)] * window[k];
    }
    im.fill(0);
    fft(plan, re, im, outRe, outIm);
    for (let k = 0; k < nBins; k++) power[k] = outRe[k] * outRe[k] + outIm[k] * outIm[k];
    for (let m = 0; m < nMels; m++) {
      const f = bank.filters[m];
      let acc = 0;
      const w = f.weights;
      for (let j = 0; j < w.length; j++) acc += w[j] * power[f.start + j];
      mel[m * nFrames + t] = acc;
    }
  }
  let max = -Infinity;
  for (let i = 0; i < mel.length; i++) {
    const v = Math.log10(mel[i] > 1e-10 ? mel[i] : 1e-10);
    mel[i] = v;
    if (v > max) max = v;
  }
  const floor = max - 8;
  const out = new Float32Array(mel.length);
  for (let i = 0; i < mel.length; i++) out[i] = ((mel[i] > floor ? mel[i] : floor) + 4) / 4;
  return { data: out, nMels, nFrames };
}

/**
 * The audio the model sees: zero padding for very short clips (CTC needs nPhones + 5
 * frames) plus the model's tail padding (meta.frontEnd.tailPadSeconds).
 */
export function padForModel(
  audio: Float32Array,
  sampleRate: number,
  samplesPerFrame: number,
  nPhones: number,
  tailPadSeconds: number,
  minSeconds: number,
): Float32Array {
  const need = Math.max(
    (nPhones + 5) * samplesPerFrame,
    audio.length + Math.round(tailPadSeconds * sampleRate),
    Math.round(minSeconds * sampleRate),
    audio.length,
  );
  if (need === audio.length) return audio;
  const out = new Float32Array(need);
  out.set(audio);
  return out;
}
