// 合成データで compareProsody の向きを確かめる（本物の音声での調整は別途）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareProsody, type Take, type PhoneSpan, type PitchFrame } from "../../src/engine/prosody/index.ts";

// "I really like rice"  AY1 | R IH1 L IY0 | L AY1 K | R AY1 S
const PHONES: [string, number][] = [["AY1", 0], ["R", 1], ["IH1", 1], ["L", 1], ["IY0", 1], ["L", 2], ["AY1", 2], ["K", 2], ["R", 3], ["AY1", 3], ["S", 3]];
const WORDS = ["I", "really", "like", "rice"];

/** 音素ごとの長さ（秒）と、母音ごとの音の高さ（Hz）から、1回の発話を作る。 */
function makeTake(durs: number[], vowelHz: number[], opts: { jitter?: number } = {}): Take {
  // 子音の R/L は次の母音の少し下の高さで鳴らす（声の高さに比例させる）
  const vowelIdx = PHONES.map((_, i) => PHONES.slice(0, i + 1).filter(([q]) => /[0-9]$/.test(q)).length);
  const phones: PhoneSpan[] = [];
  const pitch: PitchFrame[] = [];
  let t = 0.3;
  let v = 0;
  PHONES.forEach(([p, w], i) => {
    const d = durs[i];
    // CTC らしく、区間の頭の 40ms だけをスパイクとして返す
    phones.push({ phone: p, word: w, start: t, end: t + Math.min(0.04, d) });
    const isV = /[0-9]$/.test(p);
    const hz = isV ? vowelHz[v++] : null;
    for (let x = t; x < t + d; x += 0.01) {
      pitch.push({ t: x, f0: hz === null ? (p === "R" || p === "L" ? 0.92 * vowelHz[Math.min(vowelIdx[i], vowelHz.length - 1)] : null) : hz * (1 + (opts.jitter ?? 0) * Math.sin(x * 40)), rms: isV ? 0.2 : 0.05 });
    }
    t += d;
  });
  return { phones, pitch, speech: [0.3, t] };
}

// お手本: 強い音節(AY1 of I? / IH1 / AY1 like / AY1 rice)は長く、IY0 は短い。高さは山と下降。
const refDurs = [0.16, 0.06, 0.14, 0.06, 0.07, 0.06, 0.15, 0.07, 0.07, 0.22, 0.12];
const refHz = [200, 260, 190, 230, 180];
const ref = makeTake(refDurs, refHz);

test("お手本どうしは満点に近い", () => {
  const r = compareProsody(ref, makeTake(refDurs, refHz), WORDS);
  assert.ok(r.rhythm >= 95, `rhythm ${r.rhythm}`);
  assert.ok(r.intonation >= 90, `intonation ${r.intonation}`);
  assert.ok(r.fluency >= 95, `fluency ${r.fluency}`);
});

test("男性の声（低く）でも形が同じなら高い", () => {
  const r = compareProsody(ref, makeTake(refDurs.map((d) => d * 1.1), refHz.map((h) => h * 0.55)), WORDS);
  assert.ok(r.intonation >= 85, `intonation ${r.intonation}`);
  assert.ok(r.rhythm >= 85, `rhythm ${r.rhythm}`);
});

test("モーラ拍（全部同じ長さ）・平坦な抑揚は低く、理由が出る", () => {
  const flatDurs = refDurs.map(() => 0.11);
  const r = compareProsody(ref, makeTake(flatDurs, [200, 199, 201, 200, 202]), WORDS);
  assert.ok(r.rhythm < 60, `rhythm ${r.rhythm}`);
  assert.ok(r.intonation < 55, `intonation ${r.intonation}`);
  const kinds = r.issues.map((i) => i.kind);
  assert.ok(kinds.includes("flat-intonation"), kinds.join(","));
  assert.ok(kinds.includes("equal-timing") || kinds.includes("weak-contrast"), kinds.join(","));
});

test("really の強勢を後ろに置くと stress-misplaced", () => {
  const d = [...refDurs];
  d[2] = 0.06; // IH1 を短く
  d[4] = 0.18; // IY0 を長く
  const hz = [...refHz];
  hz[1] = 185;
  hz[2] = 270;
  const r = compareProsody(ref, makeTake(d, hz), WORDS);
  const s = r.stress.find((x) => x.word === 1);
  assert.ok(s && !s.ok, JSON.stringify(r.stress));
});

test("自分の音程がお手本の時間軸に写る", () => {
  const r = compareProsody(ref, makeTake(refDurs.map((d) => d * 1.5), refHz), WORDS);
  const last = r.userOnRefTime[r.userOnRefTime.length - 1];
  const refEnd = ref.speech[1];
  assert.ok(Math.abs(last.t - refEnd) < 0.15, `${last.t} vs ${refEnd}`);
});
