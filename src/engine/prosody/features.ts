import type { ContourPoint, PhoneSpan, PitchFrame, Syllable, SyllableStats } from "./types.ts";
import { mean, median, semitones, toDb, zscores } from "./stats.ts";

export type Region = { start: number; end: number };

/**
 * CTC の強制アラインメントの区間はスパイク状（1〜数フレーム）なので、
 * 隣り合う音素の区間のあいだの真ん中を境界にして、すき間のない区間に直す。
 * 先頭と末尾は発話区間 [speechStart, speechEnd] で押さえる。
 */
export function toRegions(spans: PhoneSpan[], speechStart: number, speechEnd: number): Region[] {
  const n = spans.length;
  if (n === 0) return [];
  const cuts: number[] = [];
  for (let i = 0; i + 1 < n; i++) cuts.push((spans[i].end + spans[i + 1].start) / 2);
  const first = Math.max(Math.min(speechStart, spans[0].start), spans[0].start - 0.12);
  const last = Math.min(Math.max(speechEnd, spans[n - 1].end), spans[n - 1].end + 0.2);
  return spans.map((_, i) => ({ start: i === 0 ? first : cuts[i - 1], end: i === n - 1 ? last : cuts[i] }));
}

/** 声の出ていたフレームの f0 の中央値（話者の基準の高さ）。 */
export function speakerMedianHz(pitch: PitchFrame[], from = -Infinity, to = Infinity): number {
  const v = pitch.filter((f) => f.f0 !== null && f.t >= from && f.t <= to).map((f) => f.f0 as number);
  return v.length ? median(v) : 0;
}

/** 区間内のフレーム（t が [a, b)） */
function framesIn(pitch: PitchFrame[], a: number, b: number): PitchFrame[] {
  return pitch.filter((f) => f.t >= a && f.t < b);
}

/** 半音にして、話者の基準から ±12 半音を超える点（オクターブ誤りなど）は捨てる。 */
function stOf(f: PitchFrame, refHz: number): number | null {
  if (f.f0 === null || refHz <= 0) return null;
  const st = semitones(f.f0, refHz);
  return Math.abs(st) > 12 ? null : st;
}

export function syllableStats(syllables: Syllable[], regions: Region[], pitch: PitchFrame[], refHz: number): SyllableStats[] {
  const raw = syllables.map((s) => {
    const start = regions[s.phones[0]].start;
    const end = regions[s.phones[1] - 1].end;
    const nuc = regions[s.nucleus];
    const nucFrames = framesIn(pitch, nuc.start, nuc.end);
    const sylFrames = framesIn(pitch, start, end);
    const voiced = (nucFrames.length ? nucFrames : sylFrames).map((f) => stOf(f, refHz)).filter((x): x is number => x !== null);
    const fallback = voiced.length ? voiced : sylFrames.map((f) => stOf(f, refHz)).filter((x): x is number => x !== null);
    const rmsFrames = nucFrames.length ? nucFrames : sylFrames;
    return {
      start,
      end,
      nucleusStart: nuc.start,
      nucleusEnd: nuc.end,
      dur: Math.max(end - start, 0.01),
      pitchSt: fallback.length ? median(fallback) : null,
      db: rmsFrames.length ? toDb(mean(rmsFrames.map((f) => f.rms))) : -90,
      prominence: 0,
    };
  });

  // 目立ち具合 = 長さ・大きさ・高さを発話の中で z 化して足したもの（高さが取れない音節は高さ抜き）
  const zd = zscores(raw.map((r) => Math.log(r.dur)));
  const zl = zscores(raw.map((r) => r.db));
  const pv = raw.map((r) => r.pitchSt);
  const pz = zscores(pv.filter((x): x is number => x !== null));
  let k = 0;
  const zp = pv.map((x) => (x === null ? 0 : pz[k++]));
  return raw.map((r, i) => ({ ...r, prominence: zd[i] + zl[i] + 0.8 * zp[i] }));
}

/** 音程の点列（話者の基準からの半音）。 */
export function contour(pitch: PitchFrame[], refHz: number, from: number, to: number): ContourPoint[] {
  return pitch.filter((f) => f.t >= from && f.t <= to).map((f) => ({ t: f.t, st: stOf(f, refHz) }));
}

/**
 * 自分の音程を、お手本の時間軸へ区分線形に写す。
 * 両方とも同じ目標音素列に合わせてあるので、音素の境界どうしが1対1に対応する。
 */
export function warpToRef(points: ContourPoint[], userRegions: Region[], refRegions: Region[]): ContourPoint[] {
  const n = Math.min(userRegions.length, refRegions.length);
  if (n === 0) return [];
  const u: number[] = [userRegions[0].start, ...userRegions.slice(0, n).map((r) => r.end)];
  const r: number[] = [refRegions[0].start, ...refRegions.slice(0, n).map((x) => x.end)];
  const out: ContourPoint[] = [];
  let k = 0;
  for (const p of points) {
    if (p.t < u[0] || p.t > u[u.length - 1]) continue;
    while (k + 1 < u.length - 1 && p.t > u[k + 1]) k++;
    const span = u[k + 1] - u[k];
    const a = span > 1e-6 ? (p.t - u[k]) / span : 0;
    out.push({ t: r[k] + a * (r[k + 1] - r[k]), st: p.st });
  }
  return out;
}

/**
 * 自分の音程を、対応点（自分の時刻 → お手本の時刻）の区分線形でお手本の時間軸へ写す。
 * 対応点は時刻順でなくてもよい（並べ直し、逆行する点は捨てる）。
 */
export function warpByKnots(points: ContourPoint[], knots: [number, number][]): ContourPoint[] {
  const k = [...knots].sort((a, b) => a[0] - b[0]).filter((p, i, a) => i === 0 || (p[0] > a[i - 1][0] && p[1] >= a[i - 1][1]));
  if (k.length < 2) return [];
  const out: ContourPoint[] = [];
  let j = 0;
  for (const p of points) {
    if (p.t < k[0][0] || p.t > k[k.length - 1][0]) continue;
    while (j + 1 < k.length - 1 && p.t > k[j + 1][0]) j++;
    const [u0, r0] = k[j];
    const [u1, r1] = k[j + 1];
    const a = u1 > u0 ? (p.t - u0) / (u1 - u0) : 0;
    out.push({ t: r0 + a * (r1 - r0), st: p.st });
  }
  return out;
}
