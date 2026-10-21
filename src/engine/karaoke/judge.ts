/**
 * カラオケの「当たり判定」。話している最中に、目印の棒（お手本の音節）ごとに
 * 高さ・タイミング・強さが合っているかを決めて、棒を塗っていく。
 *
 * 音の正しさ（R と L など）はここでは見ない。話し終わった直後に src/engine/scoring が出す。
 * ブラウザにも Node にも依存しない。時間はすべて「目印の時間軸」（秒。カウントの後が 0）。
 *
 *   const judge = new KaraokeJudge(item.refs[0].syllables);
 *   recorder.onPitch = (f) => judge.push({ ...f, t: f.t - guideStart });
 *   requestAnimationFrame(() => judge.advance(nowOnGuide)); judge.bars[i].fill / .grade
 */

/** 目印の棒（RefSyllable と同じ形。必要な所だけ） */
export type GuideBar = {
  word: number;
  start: number;
  end: number;
  nucleusStart: number;
  nucleusEnd: number;
  /** お手本の話者の中央値からの半音差。声が取れなければ null */
  pitchSt: number | null;
  prominence: number;
};

export type LiveFrame = { t: number; f0: number | null; rms: number };

export type BarGrade = "perfect" | "great" | "good" | "miss";

export type BarLive = {
  /** 0..1 いま塗れている割合（高さが合っていた声のフレーム / 核の長さ） */
  fill: number;
  /** 判定が確定したら入る */
  grade: BarGrade | null;
  /** 高さのずれ（判定が確定したら） */
  pitch: "low" | "on" | "high" | null;
  timing: "early" | "on" | "late" | null;
  /** 強く読むべき棒を強く、弱い棒を弱く読めたか */
  strength: "weak" | "ok" | "strong" | null;
};

export type JudgeOptions = {
  /** 1フレームの長さ（秒）。PitchTracker の既定は 10ms */
  frameSec: number;
  /** 核の区間の前後に認めるずれ（秒） */
  early: number;
  late: number;
  /** この半音差までなら「高さが合っている」 */
  pitchTolSt: number;
  /** この半音差までなら perfect に数える */
  pitchPerfectSt: number;
  /** 話者の高さの基準。わかっていれば渡す（前回までの録音から） */
  userMedianHz: number | null;
  /** 強い棒とみなす prominence の下限 */
  strongProminence: number;
};

const DEFAULTS: JudgeOptions = {
  frameSec: 0.01,
  early: 0.15,
  late: 0.3,
  pitchTolSt: 2.5,
  pitchPerfectSt: 1.5,
  userMedianHz: null,
  strongProminence: 0.6,
};

type Acc = {
  expected: number;
  voiced: number;
  onPitch: number;
  perfectPitch: number;
  firstVoiced: number | null;
  /** 窓の中の声のフレームの時刻の合計（重心を出す） */
  tSum: number;
  diffs: number[];
  dbs: number[];
};

const st = (f0: number, ref: number) => 12 * Math.log2(f0 / ref);
const db = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-6));

function median(xs: number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export class KaraokeJudge {
  readonly bars: BarLive[];
  readonly line: { t: number; st: number | null }[] = [];
  private readonly guide: GuideBar[];
  private readonly o: JudgeOptions;
  private readonly acc: Acc[];
  private readonly voicedHz: number[] = [];
  private readonly allDb: number[] = [];
  private readonly voicedAt = new Set<number>();
  private medianHz: number | null;
  private next = 0; // 次に確定させる棒
  /** 確定した棒の自分の高さ（中央値の半音）。上がり下がりの比較に使う */
  private readonly userBarSt: (number | null)[] = [];
  private comboNow = 0;
  private comboMax = 0;

  constructor(guide: GuideBar[], opts: Partial<JudgeOptions> = {}) {
    this.guide = guide;
    this.o = { ...DEFAULTS, ...opts };
    this.medianHz = this.o.userMedianHz;
    this.bars = guide.map(() => ({ fill: 0, grade: null, pitch: null, timing: null, strength: null }));
    this.acc = guide.map((g) => ({
      expected: Math.max(1, Math.round((g.nucleusEnd - g.nucleusStart) / this.o.frameSec)),
      voiced: 0,
      onPitch: 0,
      perfectPitch: 0,
      firstVoiced: null,
      tSum: 0,
      diffs: [],
      dbs: [],
    }));
  }

  /** いまの話者の基準の高さ（Hz）。声が十分に取れるまでは渡された値か null */
  get userMedianHz(): number | null {
    return this.medianHz;
  }

  get combo(): number {
    return this.comboNow;
  }

  get maxCombo(): number {
    return this.comboMax;
  }

  get counts(): Record<BarGrade, number> {
    const c: Record<BarGrade, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
    for (const b of this.bars) if (b.grade) c[b.grade]++;
    return c;
  }

  /** 1フレーム入れる（t は目印の時間軸）。 */
  push(f: LiveFrame): void {
    if (f.rms > 0) this.allDb.push(db(f.rms));
    if (f.f0 !== null) {
      this.voicedAt.add(Math.round(f.t / this.o.frameSec));
      this.voicedHz.push(f.f0);
      // 声が 15 フレーム（0.15秒）たまったら、話者の基準を発話の中央値で更新し続ける
      if (this.voicedHz.length >= 15 && this.voicedHz.length % 5 === 0) this.medianHz = median(this.voicedHz);
    }
    const userSt = f.f0 !== null && this.medianHz ? st(f.f0, this.medianHz) : null;
    this.line.push({ t: f.t, st: userSt });

    for (let i = this.next; i < this.guide.length; i++) {
      const g = this.guide[i];
      if (f.t < g.nucleusStart - this.o.early) break; // まだ先の棒
      if (f.t > g.nucleusEnd + this.o.late) continue; // 窓を過ぎた（advance で確定）
      if (this.bars[i].grade) continue;
      const a = this.acc[i];
      if (f.f0 === null) continue;
      a.voiced++;
      a.dbs.push(db(f.rms));
      if (a.firstVoiced === null) a.firstVoiced = f.t;
      a.tSum += f.t;
      if (g.pitchSt === null || userSt === null) {
        // 高さが比べられないときは、声が出ていれば合っているとみなす
        a.onPitch++;
        continue;
      }
      const d = userSt - g.pitchSt;
      a.diffs.push(d);
      if (Math.abs(d) <= this.o.pitchTolSt) a.onPitch++;
      if (Math.abs(d) <= this.o.pitchPerfectSt) a.perfectPitch++;
      this.bars[i].fill = Math.min(1, a.onPitch / a.expected);
    }
    this.advance(f.t);
  }

  /** 目印の時間が t まで進んだ。窓を過ぎた棒の判定を確定させる。 */
  advance(t: number): void {
    while (this.next < this.guide.length && t > this.guide[this.next].nucleusEnd + this.o.late) {
      this.finalize(this.next);
      this.next++;
    }
  }

  /** 録音が終わったら呼ぶ。残りの棒を全部確定させる。 */
  finish(): JudgeSummary {
    this.advance(Infinity);
    const c = this.counts;
    const n = this.guide.length || 1;
    const diffs = this.acc.flatMap((a) => a.diffs);
    return {
      counts: c,
      maxCombo: this.comboMax,
      hitRate: (c.perfect + c.great * 0.85 + c.good * 0.4) / n,
      pitchBiasSt: diffs.length ? median(diffs) : 0,
      timingBiasSec: this.bestLag(),
      userMedianHz: this.medianHz,
    };
  }

  /** 自分の声の有無と、目印の核の区間が一番よく重なる時間のずれ（秒。+ は遅れ） */
  private bestLag(): number {
    const step = this.o.frameSec;
    const voiced = this.line.filter((p) => p.st !== null || false).map((p) => p.t);
    const voicedAll = this.line.length ? this.line : [];
    if (voicedAll.length === 0) return 0;
    const t0 = Math.min(voicedAll[0].t, this.guide[0]?.start ?? 0) - 1;
    const t1 = Math.max(voicedAll[voicedAll.length - 1].t, this.guide[this.guide.length - 1]?.end ?? 0) + 1;
    const n = Math.ceil((t1 - t0) / step) + 1;
    const user = new Uint8Array(n);
    for (const p of voicedAll) if (p.st !== null || this.voicedAt.has(Math.round(p.t / step))) user[Math.round((p.t - t0) / step)] = 1;
    void voiced;
    const mask = new Uint8Array(n);
    for (const g of this.guide) for (let t = g.nucleusStart; t <= g.nucleusEnd; t += step) mask[Math.round((t - t0) / step)] = 1;
    let best = 0;
    let bestScore = -1;
    for (let lag = Math.round(-0.3 / step); lag <= Math.round(0.8 / step); lag++) {
      let sc = 0;
      for (let k = 0; k < n; k++) if (mask[k] && k + lag >= 0 && k + lag < n && user[k + lag]) sc++;
      if (sc > bestScore || (sc === bestScore && Math.abs(lag) < Math.abs(best))) {
        bestScore = sc;
        best = lag;
      }
    }
    return best * step;
  }

  private finalize(i: number): void {
    const g = this.guide[i];
    const a = this.acc[i];
    const b = this.bars[i];
    const hit = a.onPitch / a.expected;
    const voiced = a.voiced / a.expected;
    const perfectShare = a.diffs.length ? a.perfectPitch / a.diffs.length : 1;

    // 高さ: ずれの中央値
    if (a.diffs.length) {
      const d = median(a.diffs);
      b.pitch = d > this.o.pitchTolSt ? "high" : d < -this.o.pitchTolSt ? "low" : "on";
    } else b.pitch = a.voiced ? "on" : null;

    // タイミング: 窓の中の声の重心と、核の真ん中の差
    if (a.voiced >= 3) {
      const off = a.tSum / a.voiced - (g.nucleusStart + g.nucleusEnd) / 2;
      b.timing = off < -0.1 ? "early" : off > 0.12 ? "late" : "on";
    }

    // 強さ: その棒の大きさを発話全体の平均と比べる
    if (a.dbs.length && this.allDb.length > 20) {
      const mean = this.allDb.reduce((s, x) => s + x, 0) / this.allDb.length;
      const mine = a.dbs.reduce((s, x) => s + x, 0) / a.dbs.length;
      const strongBar = g.prominence >= this.o.strongProminence;
      b.strength = strongBar ? (mine >= mean - 1 ? "ok" : "weak") : mine <= mean + 4 ? "ok" : "strong";
    }

    // 上がり下がり: お手本が前の棒から 2 半音以上動く所では、同じ向きに動けたか
    const mine = a.diffs.length && g.pitchSt !== null ? median(a.diffs) + g.pitchSt : null;
    this.userBarSt[i] = mine;
    let movementOk = true;
    const prevG = i > 0 ? this.guide[i - 1] : null;
    const prevMine = i > 0 ? this.userBarSt[i - 1] : null;
    if (prevG && prevG.pitchSt !== null && g.pitchSt !== null && mine !== null && prevMine !== null && prevMine !== undefined) {
      const dRef = g.pitchSt - prevG.pitchSt;
      const dMe = mine - prevMine;
      if (Math.abs(dRef) >= 2) movementOk = Math.sign(dMe) === Math.sign(dRef) && Math.abs(dMe) >= 0.35 * Math.abs(dRef);
    }

    let grade: BarGrade = "miss";
    if (hit >= 0.55 && perfectShare >= 0.6 && movementOk && b.timing === "on" && b.strength !== "weak") grade = "perfect";
    else if (hit >= 0.4) grade = "great";
    else if (hit >= 0.2 || voiced >= 0.35) grade = "good";
    b.grade = grade;
    b.fill = grade === "miss" ? Math.min(b.fill, 0.15) : Math.max(b.fill, grade === "perfect" ? 1 : b.fill);

    if (grade === "perfect" || grade === "great") {
      this.comboNow++;
      this.comboMax = Math.max(this.comboMax, this.comboNow);
    } else this.comboNow = 0;
  }
}

export type JudgeSummary = {
  counts: Record<BarGrade, number>;
  maxCombo: number;
  /** 0..1 */
  hitRate: number;
  /** お手本より高めに話した（+）か低めか（-）。半音 */
  pitchBiasSt: number;
  /** 早め（-）か遅め（+）か。秒 */
  timingBiasSec: number;
  userMedianHz: number | null;
};
