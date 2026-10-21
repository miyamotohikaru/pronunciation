#!/usr/bin/env python3
"""Build native reference audio + word timings with Kokoro-82M (hexgrad, Apache-2.0).

    .venv-tts/bin/python tools/tts/synth.py tools/tts/samples.json            # default voices
    .venv-tts/bin/python tools/tts/synth.py items.json --voices af_heart --force

Input: JSON list of {id, text, tts_text?, voice?, speed?, slow_speed?, slower_speed?}
Per item x voice, three renditions: normal (1.0), ".slow" (0.8) and ".slower" (0.65);
[.slow] below stands for "", ".slow" or ".slower":
    public/audio/<voice>/<id>[.slow].mp3     mono 24 kHz ~48 kbps, edge silence trimmed to 80 ms,
                                             -18 LUFS (BS.1770) with a -1 dBTP true-peak ceiling
    .work/tts/<voice>/<id>[.slow].wav        24 kHz master of the mp3 (same trimmed timeline)
    .work/tts/<voice>/<id>[.slow].16k.wav    16 kHz mono for analysis (same timeline)
    .work/tts/<voice>/<id>[.slow].json       text, phonemes, word timings in seconds (same timeline)
See tools/tts/README.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
REPO_ID = 'hexgrad/Kokoro-82M'
WEIGHTS = 'kokoro-v1_0.pth'
SR = 24000
SR_ANALYSIS = 16000
DEFAULT_VOICES = ('af_heart', 'am_michael')
DEFAULT_SLOW_SPEED = 0.8
DEFAULT_SLOWER_SPEED = 0.65
DEFAULT_LUFS = -18.0
DEFAULT_CEILING_DBTP = -1.0
MIN_WORD_S = 0.03  # edge snapping never makes a word shorter than this
PIPELINE_VERSION = 5  # bump to re-render everything after changing the processing below

ID_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]*')
LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]*)\)')               # misaki markdown: [words](feature)
MISAKI_FEATURE_RE = re.compile(r'/.*/|#.*#|[+-]?\d+|[+-]?0\.5')  # features misaki itself understands
EDGE_PUNCT = ' \t.,;:!?"“”()—…'


# ---------------------------------------------------------------- audio helpers

def frame_db(audio: np.ndarray, sr: int = SR, win_s: float = 0.010, hop_s: float = 0.0025):
    """Frame RMS in dBFS. Returns (frame start samples, dB, window length)."""
    win, hop = int(win_s * sr), int(hop_s * sr)
    if len(audio) < win:
        audio = np.pad(audio, (0, win - len(audio)))
    n = 1 + (len(audio) - win) // hop
    c = np.concatenate([[0.0], np.cumsum(np.square(audio, dtype=np.float64))])
    s = np.arange(n) * hop
    rms = np.sqrt(np.maximum(c[s + win] - c[s], 0.0) / win)
    return s, 20 * np.log10(rms + 1e-9), win


def active_span(audio: np.ndarray, sr: int = SR, rel_db: float = -40.0, floor_db: float = -65.0):
    """First/last sample of speech: frames louder than (loudest frame + rel_db)."""
    s, db, win = frame_db(audio, sr)
    thr = max(float(db.max()) + rel_db, floor_db)
    idx = np.flatnonzero(db > thr)
    if len(idx) == 0:
        return 0, len(audio), thr
    return int(s[idx[0]]), int(min(len(audio), s[idx[-1]] + win)), thr


def trim_to_pad(audio: np.ndarray, pad_s: float, sr: int = SR):
    """Cut edge silence so exactly pad_s remains (zero-filled if the model gave less).

    Returns (trimmed audio, offset) where offset = raw sample index of trimmed[0]
    (negative when zeros were prepended). Raw time t maps to t - offset / sr.
    """
    a, b, _ = active_span(audio, sr)
    pad = int(round(pad_s * sr))
    start, end = a - pad, b + pad
    out = np.zeros(end - start, dtype=np.float32)
    src0, src1 = max(0, start), min(len(audio), end)
    out[src0 - start:src1 - start] = audio[src0:src1]
    fade = int(0.005 * sr)  # 5 ms raised-cosine at the outer edges (inside the silent pad)
    ramp = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fade))).astype(np.float32)
    out[:fade] *= ramp
    out[-fade:] *= ramp[::-1]
    return out, start


def resample_24k_to_16k(x: np.ndarray) -> np.ndarray:
    """Zero-phase polyphase resampler (up 2 / down 3), Kaiser-windowed sinc like scipy.resample_poly."""
    up, down, half = 2, 3, 30
    n = np.arange(-half, half + 1)
    cutoff = 1.0 / max(up, down)
    h = cutoff * np.sinc(cutoff * n) * np.kaiser(2 * half + 1, 5.0)
    h *= up / h.sum()
    y = np.zeros(len(x) * up, dtype=np.float64)
    y[::up] = x
    y = np.convolve(y, h)[half:half + len(y)]
    return y[::down].astype(np.float32)


def to_int16(x: np.ndarray) -> np.ndarray:
    return (np.clip(x, -1.0, 1.0) * 32767.0).round().astype('<i2')


# ---------------------------------------------------------------- loudness

def true_peak_db(x: np.ndarray) -> float:
    """BS.1770 true peak (4x oversampled), dBTP."""
    from scipy.signal import resample_poly
    return float(20 * np.log10(np.abs(resample_poly(x, 4, 1)).max() + 1e-12))


def integrated_lufs(x: np.ndarray, sr: int = SR) -> float:
    """ITU-R BS.1770-4 integrated loudness (K-weighting, gated 400 ms blocks) via pyloudnorm."""
    import pyloudnorm as pyln
    block = min(0.4, (len(x) - 1) / sr)  # a clip shorter than one block is measured as one block
    return float(pyln.Meter(sr, block_size=block).integrated_loudness(x.astype(np.float64)))


def peak_limit(x: np.ndarray, ceiling_db: float, sr: int = SR, win_s: float = 0.02):
    """Smooth look-ahead gain reduction keeping the 4x-oversampled peak under ceiling_db.

    gain = (min over a 20 ms window of what the peaks need), Hann-smoothed over the same
    width, so it never exceeds the need at any peak. Returns (audio, max gain reduction dB).
    """
    from scipy.ndimage import minimum_filter1d
    from scipy.signal import resample_poly
    env = np.abs(resample_poly(x, 4, 1))[:len(x) * 4].reshape(-1, 4).max(axis=1)
    need = np.minimum(1.0, 10 ** (ceiling_db / 20) / np.maximum(env, 1e-12))
    if need.min() >= 1.0:
        return x, 0.0
    w = max(3, int(win_s * sr) | 1)
    g = minimum_filter1d(need, size=w, mode='nearest')
    h = np.hanning(w + 2)[1:-1]
    g = np.convolve(np.pad(g, w // 2, mode='edge'), h / h.sum(), mode='valid')
    return (x * g).astype(np.float32), float(-20 * np.log10(g.min()))


def normalize_loudness(x: np.ndarray, target_lufs: float, ceiling_db: float):
    """Gain to target_lufs; peaks above ceiling_db are limited instead of lowering the gain,
    so every clip ends at the same loudness. Returns (audio, report)."""
    lufs_raw, tp_raw = integrated_lufs(x), true_peak_db(x)
    gain, y, gr, lufs = target_lufs - lufs_raw, x, 0.0, lufs_raw
    for _ in range(5):  # limiting lowers loudness a little -> re-measure and top up
        y, gr = peak_limit(x * np.float32(10 ** (gain / 20)), ceiling_db)
        lufs = integrated_lufs(y)
        if abs(lufs - target_lufs) < 0.05:
            break
        gain += target_lufs - lufs
    tp = true_peak_db(y)
    if tp > ceiling_db:  # residual inter-sample overshoot from the gain curve
        y = (y * 10 ** ((ceiling_db - tp) / 20)).astype(np.float32)
        lufs, tp = integrated_lufs(y), true_peak_db(y)
    return y, {'lufs': round(lufs, 2), 'true_peak_dbtp': round(tp, 2), 'gain_db': round(gain, 2),
               'limiter_gr_db': round(gr, 2), 'lufs_raw': round(lufs_raw, 2),
               'true_peak_raw_dbtp': round(tp_raw, 2)}


# lameenc writes no Xing/LAME tag, so players cannot remove LAME's 576-sample encoder delay.
# Feed the encoder from sample 576 (inside the silent pad) so the decoded mp3 lines up with the
# wav/json timeline. Measured: CoreAudio/Safari 0 ms; ffmpeg-based decoders (Chrome/Firefox) may
# still add their 529-sample decoder delay (~22 ms late).
LAME_ENCODER_DELAY = 576


def encode_mp3(audio: np.ndarray, kbps: int) -> bytes:
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(SR)
    enc.set_out_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(2)  # 2 = high quality, slower (still ms per clip)
    return bytes(enc.encode(to_int16(audio[LAME_ENCODER_DELAY:]).tobytes()) + enc.flush())


def write_compressed(audio: np.ndarray, wav_path: Path, mp3_path: Path, kbps: int) -> Path:
    """MP3 via lameenc; fallback AAC .m4a via macOS afconvert."""
    try:
        data = encode_mp3(audio, kbps)
    except ImportError:
        m4a = mp3_path.with_suffix('.m4a')
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(kbps * 1000), '-c', '1',
                        str(wav_path), str(m4a)], check=True)
        return m4a
    mp3_path.write_bytes(data)
    return mp3_path


# ---------------------------------------------------------------- alignment QA

def alignment_qa(audio: np.ndarray, words: list, sr: int = SR, shift: float = 0.0) -> dict:
    """Check word timings against the energy of `audio`.

    onset/offset_ms: first word start / last word end minus detected speech start / end.
    coverage: share of speech frames (louder than the trim threshold) inside some word.
    `shift` is added to the timings first (to measure what un-shifted timings would give).
    """
    s, db, win = frame_db(audio, sr)
    a, b, thr = active_span(audio, sr)
    timed = [(w['start'] + shift, w['end'] + shift) for w in words
             if w.get('start') is not None and w.get('end') is not None]
    if not timed:
        return {'ok': False, 'reason': 'no timestamps'}
    centers = (s + win / 2) / sr
    inside = np.zeros(len(s), dtype=bool)
    for st, en in timed:
        inside |= (centers >= st) & (centers < en)
    speech = db > thr
    gaps = []
    for (w0, (st0, en0)), (w1, (st1, en1)) in zip(zip(words, timed), zip(words[1:], timed[1:])):
        if st1 - en0 >= 0.04:
            m = (centers >= en0) & (centers < st1)
            gaps.append({'after': w0['text'], 'ms': round((st1 - en0) * 1000),
                         'db_re_thr': round(float(db[m].mean() - thr), 1) if m.any() else None})
    return {
        'onset_ms': round((timed[0][0] - a / sr) * 1000, 1),
        'offset_ms': round((timed[-1][1] - b / sr) * 1000, 1),
        'coverage': round(float((speech & inside).sum() / max(1, speech.sum())), 3),
        'gaps': gaps,
    }


# ---------------------------------------------------------------- synthesis

class Synth:
    def __init__(self, model_dir: Path, device: str):
        import torch
        from kokoro import KModel, KPipeline
        warnings.filterwarnings('ignore', category=UserWarning)
        warnings.filterwarnings('ignore', category=FutureWarning)
        self.torch = torch
        self.model_dir = model_dir
        self._fetch('config.json')
        self._fetch(WEIGHTS)
        self.model = KModel(repo_id=REPO_ID, config=str(model_dir / 'config.json'),
                            model=str(model_dir / WEIGHTS)).to(device).eval()
        self.vocab = self.model.vocab
        self.pipe = KPipeline(lang_code='a', repo_id=REPO_ID, model=self.model)
        self.oov = []  # words misaki could not find in its lexicon -> espeak-ng fallback
        fallback = getattr(self.pipe.g2p, 'fallback', None)
        if fallback is None:
            print('WARNING: espeak fallback missing - unknown words would be dropped', file=sys.stderr)
        else:
            def recording_fallback(token, _inner=fallback):
                self.oov.append(token.text)
                return _inner(token)
            self.pipe.g2p.fallback = recording_fallback

    def _fetch(self, rel: str) -> Path:
        p = self.model_dir / rel
        if not p.exists():
            from huggingface_hub import hf_hub_download
            print(f'downloading {REPO_ID}/{rel} ...', flush=True)
            hf_hub_download(REPO_ID, rel, local_dir=str(self.model_dir))
        return p

    def voice_file(self, voice: str) -> str:
        return str(self._fetch(f'voices/{voice}.pt'))

    def expand_aliases(self, text: str) -> str:
        """[display words](respelling) -> [display words](/phonemes of respelling/).

        Lets authors respell connected speech ("[want to](wanna)") while the word
        timings keep the display words. /phonemes/, #flags#, stress numbers pass through.
        """
        def repl(m):
            shown, target = m.group(1), m.group(2).strip()
            if not target or MISAKI_FEATURE_RE.fullmatch(target):
                return m.group(0)
            ps, _ = self.pipe.g2p(target)
            return f'[{shown}](/{ps.strip(EDGE_PUNCT)}/)'
        return LINK_RE.sub(repl, text)

    def __call__(self, text: str, voice: str, speed: float, seed: int):
        self.torch.manual_seed(seed)  # Kokoro's vocoder adds random noise; seed => reproducible
        chunks, tokens, phonemes, t_off = [], [], [], 0.0
        with self.torch.inference_mode():
            for r in self.pipe(text, voice=self.voice_file(voice), speed=speed):
                if r.audio is None:
                    continue
                bad = sorted({c for c in r.phonemes if c not in self.vocab})
                if bad:  # Kokoro silently drops unknown symbols - fail loudly instead
                    raise ValueError(f'phonemes not in Kokoro vocab: {bad} in {r.phonemes!r}')
                audio = r.audio.detach().cpu().numpy().astype(np.float32).reshape(-1)
                for t in r.tokens:
                    tokens.append({'text': t.text, 'phonemes': t.phonemes or '',
                                   'start': None if t.start_ts is None else t.start_ts + t_off,
                                   'end': None if t.end_ts is None else t.end_ts + t_off})
                phonemes.append(r.phonemes)
                chunks.append(audio)
                t_off += len(audio) / SR
        if not chunks:
            raise ValueError(f'no audio for {text!r}')
        return np.concatenate(chunks), tokens, ' '.join(phonemes)


# ---------------------------------------------------------------- build

def load_items(path: Path) -> list:
    items = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(items, list):
        raise SystemExit(f'{path}: expected a JSON list')
    seen = set()
    for it in items:
        if not isinstance(it, dict) or not it.get('id') or not it.get('text'):
            raise SystemExit(f'{path}: every item needs "id" and "text": {it!r}')
        if not ID_RE.fullmatch(it['id']):
            raise SystemExit(f'{path}: id must match [A-Za-z0-9][A-Za-z0-9_-]* (no dots): {it["id"]!r}')
        if it['id'] in seen:
            raise SystemExit(f'{path}: duplicate id {it["id"]!r}')
        seen.add(it['id'])
    return items


def item_voices(item: dict, default: list) -> list:
    v = item.get('voice')
    return default if not v else ([v] if isinstance(v, str) else list(v))


def build_one(syn: Synth, item: dict, voice: str, speed: float, suffix: str, args) -> str:
    stem = item['id'] + suffix
    wdir, odir = args.work / voice, args.out / voice
    paths = {'mp3': odir / f'{stem}.mp3', 'wav': wdir / f'{stem}.wav',
             'wav16': wdir / f'{stem}.16k.wav', 'json': wdir / f'{stem}.json'}
    tts_text = item.get('tts_text') or item['text']
    key = json.dumps({'v': PIPELINE_VERSION, 'text': item['text'], 'tts': tts_text, 'voice': voice,
                      'speed': speed, 'pad_ms': args.pad_ms, 'kbps': args.kbps, 'seed': args.seed,
                      'lufs': args.lufs, 'ceiling': args.ceiling},
                     sort_keys=True, ensure_ascii=False)
    src_hash = hashlib.sha1(key.encode('utf-8')).hexdigest()[:16]
    if not args.force and all(p.exists() for p in paths.values()):
        try:
            if json.loads(paths['json'].read_text(encoding='utf-8')).get('source_hash') == src_hash:
                return f'[{voice}] {stem:<24} skip (up to date)'
        except (OSError, ValueError):
            pass

    t0 = time.perf_counter()
    syn.oov.clear()
    tts_input = syn.expand_aliases(tts_text)
    raw, tokens, phonemes = syn(tts_input, voice, speed, args.seed)
    t_synth = time.perf_counter() - t0

    words = [t for t in tokens if any(ch.isalnum() for ch in t['text'])]
    silent = [w['text'] for w in words if not w['phonemes']]
    if silent:  # misaki gives '' for words it could not pronounce -> they would be skipped
        raise ValueError(f'{stem}: no phonemes for {silent} (spell out / add an override)')
    oov = list(dict.fromkeys(syn.oov))
    audio, offset = trim_to_pad(raw, args.pad_ms / 1000)
    audio, loudness = normalize_loudness(audio, args.lufs, args.ceiling)  # same gain for every file
    shift = offset / SR
    dur = len(audio) / SR
    timed = bool(words) and words[0]['start'] is not None and words[-1]['end'] is not None
    raw_edges = (words[0]['start'] - shift, words[-1]['end'] - shift) if timed else None
    for w in words:
        for k in ('start', 'end'):
            if w[k] is not None:
                w[k] = round(min(max(w[k] - shift, 0.0), dur), 3)
    # Kokoro's edge timestamps are off: the first start is within ~±40 ms at speed 1 but ~90 ms
    # late at speed 0.8; the last end keeps the full predicted length of the final (lengthened)
    # phoneme, or stops before a final release. Snap both edges to the measured speech
    # onset/offset (the detector that placed the 80 ms pads). Inner boundaries stay Kokoro's.
    snap = None
    if timed:
        a, b, _ = active_span(audio)
        first, last = words[0], words[-1]
        limit = (first['end'] if first['end'] is not None else a / SR) - MIN_WORD_S
        first['start'] = round(a / SR if first is last else max(0.0, min(a / SR, limit)), 3)
        last['end'] = round(max(b / SR, last['start'] + MIN_WORD_S), 3)
        snap = {'start': round((first['start'] - raw_edges[0]) * 1000),
                'end': round((last['end'] - raw_edges[1]) * 1000)}

    wdir.mkdir(parents=True, exist_ok=True)
    odir.mkdir(parents=True, exist_ok=True)
    sf.write(paths['wav'], audio, SR, subtype='PCM_16')
    sf.write(paths['wav16'], resample_24k_to_16k(audio), SR_ANALYSIS, subtype='PCM_16')
    compressed = write_compressed(audio, paths['wav'], paths['mp3'], args.kbps)

    peak = float(np.abs(audio).max())
    meta = {
        'id': item['id'], 'variant': suffix.lstrip('.') or 'normal',  # normal | slow | slower
        'text': item['text'], 'tts_text': tts_text, 'tts_input': tts_input,
        'voice': voice, 'speed': speed, 'sample_rate': SR, 'duration': round(dur, 3),
        'phonemes': phonemes,
        'oov': oov,
        'words': [{'text': w['text'], 'start': w['start'], 'end': w['end'], 'phonemes': w['phonemes']}
                  for w in words],
        'audio': {'file': str(compressed.relative_to(args.out)), 'bytes': compressed.stat().st_size,
                  'peak_dbfs': round(20 * np.log10(peak + 1e-9), 1),
                  'clipped_samples': int((np.abs(audio) >= 0.999).sum())},
        'loudness': loudness,
        'trim': {'raw_duration': round(len(raw) / SR, 3), 'offset': round(shift, 4),
                 'pad': args.pad_ms / 1000},
        'qa': {**alignment_qa(audio, words), 'edge_snap_ms': snap},  # snap: + = moved later
        'timing': {'synth_s': round(t_synth, 3), 'rtf': round(t_synth / (len(raw) / SR), 3)},
        'generator': {'model': f'{REPO_ID}/{WEIGHTS}', 'pipeline_version': PIPELINE_VERSION,
                      'seed': args.seed},
        'source_hash': src_hash,
    }
    paths['json'].write_text(json.dumps(meta, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    q = meta['qa']
    return (f'[{voice}] {stem:<24} {dur:5.2f}s  synth {t_synth:5.2f}s  RTF {meta["timing"]["rtf"]:.3f}  '
            f'{compressed.suffix[1:]} {compressed.stat().st_size / 1024:5.1f} KB  '
            f'{loudness["lufs"]:.1f} LUFS TP {loudness["true_peak_dbtp"]:.1f} GR {loudness["limiter_gr_db"]:.1f}  '
            f'onset {q["onset_ms"]:+.0f}ms cov {q["coverage"]:.2f}'
            f'{"  OOV " + ",".join(oov) if oov else ""}  ({time.perf_counter() - t0:.2f}s)')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input', type=Path, help='JSON list of {id, text, tts_text?, voice?, speed?}')
    ap.add_argument('--voices', default=','.join(DEFAULT_VOICES),
                    help='comma list used when an item has no "voice" (default: %(default)s)')
    ap.add_argument('--only', default='', help='comma list of ids to build')
    ap.add_argument('--force', action='store_true', help='re-render even if outputs are up to date')
    ap.add_argument('--no-slow', action='store_true', help='skip the .slow variant')
    ap.add_argument('--slow-speed', type=float, default=DEFAULT_SLOW_SPEED)
    ap.add_argument('--no-slower', action='store_true', help='skip the .slower variant')
    ap.add_argument('--slower-speed', type=float, default=DEFAULT_SLOWER_SPEED)
    ap.add_argument('--out', type=Path, default=ROOT / 'public' / 'audio')
    ap.add_argument('--work', type=Path, default=ROOT / '.work' / 'tts')
    ap.add_argument('--model-dir', type=Path, default=ROOT / '.work' / 'tts' / 'models' / 'Kokoro-82M')
    ap.add_argument('--kbps', type=int, default=48)
    ap.add_argument('--pad-ms', type=float, default=80)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--lufs', type=float, default=DEFAULT_LUFS, help='integrated loudness target')
    ap.add_argument('--ceiling', type=float, default=DEFAULT_CEILING_DBTP, help='true-peak ceiling, dBTP')
    ap.add_argument('--device', default='cpu')
    args = ap.parse_args(argv)
    args.out, args.work = args.out.resolve(), args.work.resolve()

    items = load_items(args.input)
    if args.only:
        wanted = set(args.only.split(','))
        items = [it for it in items if it['id'] in wanted]
    default_voices = [v for v in args.voices.split(',') if v]

    t0 = time.perf_counter()
    syn = Synth(args.model_dir, args.device)
    syn('Hello there.', default_voices[0], 1.0, args.seed)  # warm-up so timings are steady-state
    print(f'model ready in {time.perf_counter() - t0:.1f}s', flush=True)

    done = skipped = failed = 0
    for item in items:
        for voice in item_voices(item, default_voices):
            variants = [('', float(item.get('speed', 1.0)))]
            if not args.no_slow:
                variants.append(('.slow', float(item.get('slow_speed', args.slow_speed))))
            if not args.no_slower:
                variants.append(('.slower', float(item.get('slower_speed', args.slower_speed))))
            for suffix, speed in variants:
                try:
                    line = build_one(syn, item, voice, speed, suffix, args)
                except Exception as e:  # keep building the rest, report at the end
                    failed += 1
                    print(f'[{voice}] {item["id"] + suffix:<24} FAILED: {e}', flush=True)
                    continue
                skipped += line.endswith('(up to date)')
                done += not line.endswith('(up to date)')
                print(line, flush=True)
    print(f'rendered {done}, skipped {skipped}, failed {failed} in {time.perf_counter() - t0:.1f}s')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
