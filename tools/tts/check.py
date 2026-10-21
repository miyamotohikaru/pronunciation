#!/usr/bin/env python3
"""Sanity report for synth.py output (no listening needed).

    .venv-tts/bin/python tools/tts/check.py [--work .work/tts] [--out public/audio] [--words]

Per render: duration, RTF, MP3 header (rate/channels/bitrate), size, peak, clipping,
16k/24k length match, loudness (LUFS / true peak / limiter), word-timing alignment
(onset error, speech coverage - also recomputed WITHOUT the trim shift to show the shift
is what lines them up), and the words misaki sent to the espeak fallback (OOV).
Flags: coverage < 0.9, |onset| > 60 ms, OOV words. Since pipeline v5 the first/last word
edges are snapped to the detected speech, so onset is ~0 by construction and the snap
sizes (edge_snap_ms) show how far Kokoro's own edges were off.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import synth  # noqa: E402

MP3_KBPS = {1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],     # MPEG-1 L3
            2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]}        # MPEG-2/2.5 L3
MP3_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}
COVERAGE_MIN, ONSET_MAX_MS = 0.9, 60


def mp3_header(data: bytes) -> dict:
    for i in range(len(data) - 4):
        b1, b2, b3 = data[i + 1], data[i + 2], data[i + 3]
        if data[i] == 0xFF and b1 & 0xE0 == 0xE0 and (b1 >> 1) & 3 == 1:  # sync + layer III
            ver = (b1 >> 3) & 3
            return {'rate': MP3_RATES[ver][(b2 >> 2) & 3], 'kbps': MP3_KBPS[1 if ver == 3 else 2][b2 >> 4],
                    'mono': (b3 >> 6) == 3, 'xing_tag': any(t in data[:400] for t in (b'Xing', b'Info'))}
    return {}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', type=Path, default=synth.ROOT / '.work' / 'tts')
    ap.add_argument('--out', type=Path, default=synth.ROOT / 'public' / 'audio')
    ap.add_argument('--words', action='store_true', help='print phonemes + word timings per render')
    ap.add_argument('--max-list', type=int, default=40, help='max entries printed per flag list')
    args = ap.parse_args(argv)

    per_voice = defaultdict(list)
    problems, flags = [], defaultdict(list)
    for jp in sorted(args.work.glob('*/*.json')):
        m = json.loads(jp.read_text(encoding='utf-8'))
        if 'source_hash' not in m:
            continue
        stem, name = jp.name[:-5], f'{m["voice"]}/{jp.name[:-5]}'
        wav, sr = sf.read(jp.with_name(stem + '.wav'), dtype='float32')
        wav16, sr16 = sf.read(jp.with_name(stem + '.16k.wav'), dtype='float32')
        comp = args.out / m['audio']['file']
        hdr = mp3_header(comp.read_bytes()) if comp.suffix == '.mp3' else {}
        qa = synth.alignment_qa(wav, m['words'])
        qa_raw = synth.alignment_qa(wav, m['words'], shift=m['trim']['offset'])  # timings NOT shifted
        ld = m.get('loudness', {})
        r = {'dur': m['duration'], 'rtf': m['timing']['rtf'], 'kb': comp.stat().st_size / 1024,
             'kbps_eff': comp.stat().st_size * 8 / 1000 / m['duration'], 'peak': m['audio']['peak_dbfs'],
             'clip': m['audio']['clipped_samples'], 'lead_ms': synth.active_span(wav)[0] / sr * 1000,
             'onset': qa.get('onset_ms', 1e9), 'cov': qa.get('coverage', 0.0),
             'cov_raw': qa_raw.get('coverage', 0.0), 'lufs': ld.get('lufs', np.nan),
             'tp': ld.get('true_peak_dbtp', np.nan), 'gr': ld.get('limiter_gr_db', 0.0),
             'plr': ld.get('true_peak_raw_dbtp', np.nan) - ld.get('lufs_raw', np.nan),
             'slow': m.get('variant') == 'slow', 'snap': (m['qa'].get('edge_snap_ms') or {})}
        per_voice[m['voice']].append(r)
        if r['cov'] < COVERAGE_MIN:
            flags['coverage < 0.9'].append(f'{name}({r["cov"]:.2f})')
        if abs(r['onset']) > ONSET_MAX_MS:
            flags['|onset| > 60 ms'].append(f'{name}({r["onset"]:+.0f})')
        for w in m.get('oov', []):
            flags['OOV (espeak fallback)'].append(f'{name}:{w}')
        if sr != synth.SR or sr16 != synth.SR_ANALYSIS or wav.ndim != 1 or wav16.ndim != 1:
            problems.append(f'{name}: wav format {sr}/{sr16}')
        if abs(len(wav16) / sr16 - len(wav) / sr) > 1.5 / sr16:
            problems.append(f'{name}: 16k length mismatch')
        if hdr and (hdr['rate'] != synth.SR or not hdr['mono']):
            problems.append(f'{name}: mp3 header {hdr}')
        if r['clip']:
            problems.append(f'{name}: {r["clip"]} clipped samples')
        if any(w['start'] is None or w['end'] is None or w['end'] < w['start'] for w in m['words']):
            problems.append(f'{name}: missing/inverted word timestamps')
        if args.words:
            print(f'{name}: {m["phonemes"]}')
            print('   ' + '  '.join(f'{w["text"]}[{w["start"]:.2f}-{w["end"]:.2f}]' for w in m['words']))

    print(f'{"voice":<11}{"n":>5}{"audio s":>8}{"RTF":>6}{"MB":>6}{"kbps":>5}{"LUFS min/max":>14}{"TP max":>7}'
          f'{"GR>0":>5}{"GR>3":>5}{"GRmax":>6}{"lead":>5}{"|onset|":>8}{"cov":>5}{"cov_unshifted":>14}')
    for v, rs in per_voice.items():
        col = lambda k: np.array([r[k] for r in rs], dtype=float)  # noqa: E731
        gr = col('gr')
        print(f'{v:<11}{len(rs):>5}{col("dur").sum():>8.0f}{col("rtf").mean():>6.2f}{col("kb").sum() / 1024:>6.1f}'
              f'{col("kbps_eff").mean():>5.0f}{np.nanmin(col("lufs")):>8.1f}/{np.nanmax(col("lufs")):<5.1f}'
              f'{np.nanmax(col("tp")):>7.1f}{(gr > 0.05).sum():>5}{(gr > 3).sum():>5}{gr.max():>6.1f}'
              f'{col("lead_ms").mean():>5.0f}{np.abs(col("onset")).mean():>8.0f}{col("cov").mean():>5.2f}'
              f'{col("cov_raw").mean():>14.2f}')
    plr = np.array([r['plr'] for rs in per_voice.values() for r in rs], dtype=float)
    plr = plr[~np.isnan(plr)]
    if len(plr):
        need = lambda t: np.maximum(0, plr - (synth.DEFAULT_CEILING_DBTP - t))  # noqa: E731
        print('limiter need if target were: ' + '  '.join(
            f'{t} LUFS -> {(need(t) > 0.05).sum()} clips, >3 dB {(need(t) > 3).sum()}, max {need(t).max():.1f} dB'
            for t in (-18, -19, -20)))
    allr = [r for rs in per_voice.values() for r in rs if r['snap']]
    if allr:
        med = lambda k, slow: np.median([r['snap'][k] for r in allr if r['slow'] == slow] or [np.nan])  # noqa: E731
        print(f'edge snap median ms (+ = later than Kokoro): start normal {med("start", False):+.0f} / '
              f'slow {med("start", True):+.0f}, end normal {med("end", False):+.0f} / slow {med("end", True):+.0f}')
    any_mp3 = next(iter(sorted(args.out.glob('*/*.mp3'))), None)
    if any_mp3:
        print('mp3 header sample:', any_mp3.name, mp3_header(any_mp3.read_bytes()))
    for k in ('coverage < 0.9', '|onset| > 60 ms', 'OOV (espeak fallback)'):
        lst = flags.get(k, [])
        more = f' ... +{len(lst) - args.max_list}' if len(lst) > args.max_list else ''
        print(f'{k}: {len(lst)}' + (': ' + ' '.join(lst[:args.max_list]) + more if lst else ''))
    print('problems:', problems or 'none')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
