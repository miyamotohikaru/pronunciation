"""speechocean762 parquet -> 16 kHz WAVs + labels JSON, for the TS feature extraction.

  .venv/bin/python -I tools/model/export/dump_speechocean.py SPLIT PARQUET OUT_DIR
Writes OUT_DIR/<split>/NNNN.wav and OUT_DIR/<split>.json ([{i, text, words: [{text, phones, scores}]}]).
"""
import io
import json
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf

split, parquet, out = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
(out / split).mkdir(parents=True, exist_ok=True)
t = pq.read_table(parquet)
labels = []
for i in range(t.num_rows):
    row = t.slice(i, 1).to_pylist()[0]
    audio, sr = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
    assert sr == 16000
    if audio.ndim > 1:
        audio = audio.mean(-1)
    sf.write(out / split / f"{i:04d}.wav", np.clip(audio, -1, 1), 16000, subtype="PCM_16")
    labels.append({"i": i, "text": row["text"], "words": [
        {"text": w["text"], "phones": w["phones"], "scores": w["phones-accuracy"]} for w in row["words"]]})
(out / f"{split}.json").write_text(json.dumps(labels))
print(split, len(labels))
