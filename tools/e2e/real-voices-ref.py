"""
Reference pitch tracks for real human recordings (for tools/e2e/real-voices.mjs).

    .venv/bin/python -I tools/e2e/real-voices-ref.py [per_dataset=50]

Reads a deterministic, evenly spaced sample of utterances from the (read-only) Hugging Face
parquet dumps under .work/distill/raw/, writes each as 16-bit mono WAV at its native rate to
.work/e2e/real/<dataset>/<id>.wav, and runs Praat's autocorrelation pitch (parselmouth,
time step 10 ms, 65-500 Hz, Praat's default voicing/silence/octave costs) as the reference:
.work/e2e/real/index.json lists every file with its Praat frame times and f0 (0 = unvoiced).
"""
import glob
import io
import json
import os
import sys

import numpy as np
import parselmouth
import pyarrow.parquet as pq
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
RAW = os.path.join(ROOT, ".work", "distill", "raw")
OUT = os.path.join(ROOT, ".work", "e2e", "real")
PER = int(sys.argv[1]) if len(sys.argv) > 1 else 50

DATASETS = {
    # read speech, audiobook microphones
    "librispeech-clean": ("openslr__librispeech_asr/all/test.clean/*.parquet", "id"),
    "librispeech-other": ("openslr__librispeech_asr/all/test.other/*.parquet", "id"),
    # Mandarin-L1 learners of English (adults and children) on phone microphones
    "speechocean762": ("mispeech__speechocean762/data/test-*.parquet", None),
    # Common Voice user microphones, many accents
    "globe": ("MushanW__GLOBE/data/test-*.parquet", None),
}


def rows_evenly(paths, n):
    files = [pq.ParquetFile(p) for p in paths]
    total = sum(f.metadata.num_rows for f in files)
    want = sorted(set(int(i * total / n) for i in range(n)))
    base = 0
    for f in files:
        for g in range(f.num_row_groups):
            rows = f.metadata.row_group(g).num_rows
            hit = [w - base for w in want if base <= w < base + rows]
            if hit:
                t = f.read_row_group(g)
                for h in hit:
                    yield {c: t.column(c)[h].as_py() for c in t.column_names}
            base += rows


def main():
    index = []
    for name, (pattern, id_col) in DATASETS.items():
        paths = sorted(glob.glob(os.path.join(RAW, pattern)))
        if not paths:
            print(f"{name}: no parquet found, skipped")
            continue
        os.makedirs(os.path.join(OUT, name), exist_ok=True)
        count = 0
        for k, row in enumerate(rows_evenly(paths, PER)):
            audio = row["audio"]
            data, sr = sf.read(io.BytesIO(audio["bytes"]), dtype="float64", always_2d=True)
            x = data.mean(axis=1)
            if len(x) < sr * 0.5:
                continue
            uid = str(row[id_col]) if id_col else f"{k:04d}"
            wav = os.path.join(OUT, name, f"{uid}.wav")
            sf.write(wav, x, sr, subtype="PCM_16")
            snd = parselmouth.Sound(x, sampling_frequency=sr)
            pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=65.0, pitch_ceiling=500.0)
            f0 = pitch.selected_array["frequency"]
            index.append(
                {
                    "dataset": name,
                    "id": uid,
                    "wav": os.path.relpath(wav, ROOT),
                    "sampleRate": sr,
                    "duration": len(x) / sr,
                    "meta": {k2: row.get(k2) for k2 in ("gender", "age", "accent", "speaker", "speaker_id") if k2 in row},
                    "praat": {"t": [round(float(t), 6) for t in pitch.xs()], "f0": [round(float(v), 3) for v in f0]},
                }
            )
            count += 1
        print(f"{name}: {count} files")
    with open(os.path.join(OUT, "index.json"), "w") as fh:
        json.dump(index, fh)
    print(f"{len(index)} files, {sum(e['duration'] for e in index) / 60:.1f} min -> {os.path.relpath(OUT, ROOT)}/index.json")


if __name__ == "__main__":
    main()
