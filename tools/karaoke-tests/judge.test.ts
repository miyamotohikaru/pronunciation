// 当たり判定を本物のお手本データで確かめる。女性の声の目印に、男性の声をなぞらせる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { KaraokeJudge, type LiveFrame } from "../../src/engine/karaoke/judge.ts";
import { compareProsody } from "../../src/engine/prosody/index.ts";

type Syl = { start: number; end: number; nucleusStart: number; nucleusEnd: number; pitchSt: number | null; prominence: number; word: number };
type Ref = { voice: string; syllables: Syl[]; pitch: [number, number, number][] };
const DIR = new URL("../../public/content/items/", import.meta.url).pathname;

/** 男性の声の音程を、音節の区切りどうしで女性の声の時間軸へ写す（目印どおりに話した人の代わり） */
function follow(guide: Syl[], other: Ref, shift = 0): LiveFrame[] {
  const s = other.syllables;
  const knots: [number, number][] = [];
  for (let i = 0; i < Math.min(s.length, guide.length); i++) {
    knots.push([s[i].start, guide[i].start], [s[i].nucleusStart, guide[i].nucleusStart], [s[i].nucleusEnd, guide[i].nucleusEnd], [s[i].end, guide[i].end]);
  }
  const map = (t: number) => {
    for (let k = 0; k + 1 < knots.length; k++) {
      const [a0, b0] = knots[k];
      const [a1, b1] = knots[k + 1];
      if (t >= a0 && t <= a1) return a1 > a0 ? b0 + ((t - a0) / (a1 - a0)) * (b1 - b0) : b0;
    }
    return null;
  };
  const out: LiveFrame[] = [];
  for (const [t, f0, r] of other.pitch) {
    const m = map(t);
    if (m !== null) out.push({ t: m + shift, f0: f0 > 0 ? f0 : null, rms: r / 1000 });
  }
  return out.sort((a, b) => a.t - b.t);
}

const items = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(DIR + f, "utf8")));
const sentences = items.filter((it) => it.type === "sentence" && it.refs.length === 2 && it.refs[0].syllables.length >= 5 && it.refs[0].syllables.length === it.refs[1].syllables.length);

function run(frames: LiveFrame[], guide: Syl[]) {
  const j = new KaraokeJudge(guide);
  for (const f of frames) j.push(f);
  return j.finish();
}

test(`男性の声が目印どおりに話すと、ほとんど当たる（${sentences.length} 文）`, () => {
  const rates = sentences.map((it) => run(follow(it.refs[0].syllables, it.refs[1]), it.refs[0].syllables).hitRate);
  const med = [...rates].sort((a, b) => a - b)[rates.length >> 1];
  console.log("native-follow hitRate median", med.toFixed(2), "min", Math.min(...rates).toFixed(2));
  assert.ok(med >= 0.75, `median ${med}`);
});

// 話している最中の色は励まし寄り（棒読みでも声が出ていれば中くらいの色）。
// 抑揚の厳しい判定は話し終わった後の compareProsody が受け持つので、そちらで棒読みをはっきり下げる。
test("棒読み: 話している最中の当たりは減り、話し終わった後の抑揚の点ははっきり下がる", () => {
  let worse = 0;
  let prosodyWorse = 0;
  for (const it of sentences) {
    const fr = follow(it.refs[0].syllables, it.refs[1]);
    const v = fr.filter((f) => f.f0 !== null).map((f) => f.f0 as number).sort((a, b) => a - b);
    const mid = v[v.length >> 1];
    const flat = fr.map((f) => ({ ...f, f0: f.f0 === null ? null : mid }));
    const a = run(fr, it.refs[0].syllables);
    const b = run(flat, it.refs[0].syllables);
    if (b.hitRate < a.hitRate) worse++;
    const take = (r: typeof it.refs[0], flatten: boolean) => ({
      phones: r.phones,
      speech: r.speech as [number, number],
      pitch: r.pitch.map(([t, f0, q]: number[]) => ({ t, f0: f0 > 0 ? (flatten ? mid : f0) : null, rms: q / 1000 })),
    });
    const words = it.words.map((w: { text: string }) => w.text);
    const nat = compareProsody(take(it.refs[0], false), take(it.refs[1], false), words).intonation;
    const flatInto = compareProsody(take(it.refs[0], false), take(it.refs[1], true), words).intonation;
    if (flatInto < nat - 10) prosodyWorse++;
  }
  console.log("monotone: live worse in", worse, "/", sentences.length, "| after-take intonation clearly lower in", prosodyWorse);
  assert.ok(worse / sentences.length >= 0.6, `${worse}/${sentences.length}`);
  assert.ok(prosodyWorse / sentences.length >= 0.85, `${prosodyWorse}/${sentences.length}`);
});

test("0.4秒遅れて話すと、遅れが出て当たりが減る", () => {
  const it = sentences[0];
  const late = run(follow(it.refs[0].syllables, it.refs[1], 0.4), it.refs[0].syllables);
  const ok = run(follow(it.refs[0].syllables, it.refs[1]), it.refs[0].syllables);
  console.log("late bias", late.timingBiasSec.toFixed(2), "hit", late.hitRate.toFixed(2), "vs", ok.hitRate.toFixed(2));
  assert.ok(late.hitRate < ok.hitRate);
  assert.ok(late.timingBiasSec > 0.15);
});

test("波の目印: 男性の声が目印どおりに話すと波の大半が塗られ、棒読みだと減る", async () => {
  const { buildGuideWave, waveFill } = await import("../../src/engine/karaoke/judge.ts");
  let nat = 0, mono = 0, n = 0;
  for (const it of sentences) {
    const wave = buildGuideWave(it.refs[0].pitch);
    const fr = follow(it.refs[0].syllables, it.refs[1]);
    const v = fr.filter((f) => f.f0 !== null).map((f) => f.f0 as number).sort((a, b) => a - b);
    const mid = v[v.length >> 1];
    const share = (x: LiveFrame[]) => {
      const j = new KaraokeJudge(it.refs[0].syllables);
      for (const f of x) j.push(f);
      j.finish();
      const fill = waveFill(wave, it.refs[0].syllables, j.bars).flat();
      const pts = wave.segments.flat();
      const real = pts.map((p, i) => (p.b ? -1 : fill[i])).filter((x) => x >= 0);
      return real.filter((x) => x >= 3).length / Math.max(1, real.length);
    };
    nat += share(fr);
    mono += share(fr.map((f) => ({ ...f, f0: f.f0 === null ? null : mid })));
    n++;
  }
  console.log("wave great+ share: native", (nat / n).toFixed(2), "monotone", (mono / n).toFixed(2));
  assert.ok(nat / n >= 0.7, `native ${nat / n}`);
  assert.ok(mono / n < nat / n - 0.05, `monotone ${mono / n} vs ${nat / n}`);
});

// 波と比べると見た目と判定が一致する。お手本（Kokoro）の抑揚は穏やかで帯（±2.5半音）に収まりやすいので、
// 棒読みは話している最中にはあまり減らない。棒読みは話し終わった後の抑揚の点（compareProsody）で下げる（上のテスト）。
test("波と比べる判定でも、目印どおりのネイティブはほとんど当たる", async () => {
  const { buildGuideWave } = await import("../../src/engine/karaoke/judge.ts");
  const nat: number[] = [];
  const mono: number[] = [];
  for (const it of sentences) {
    const wave = buildGuideWave(it.refs[0].pitch);
    const fr = follow(it.refs[0].syllables, it.refs[1]);
    const v = fr.filter((f) => f.f0 !== null).map((f) => f.f0 as number).sort((a, b) => a - b);
    const mid = v[v.length >> 1];
    const run = (x: LiveFrame[]) => { const j = new KaraokeJudge(it.refs[0].syllables, { wave }); for (const f of x) j.push(f); return j.finish().hitRate; };
    nat.push(run(fr));
    mono.push(run(fr.map((f) => ({ ...f, f0: f.f0 === null ? null : mid }))));
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  console.log("wave-judged hitRate: native", med(nat).toFixed(2), "monotone", med(mono).toFixed(2));
  assert.ok(med(nat) >= 0.7, `native ${med(nat)}`);
});
