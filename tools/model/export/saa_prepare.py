"""Speech Accent Archive (local copy from tools/model/distill, eval only, CC BY-NC-SA) ->
two 16 kHz chunks per speaker for the TS engine (the paragraph is up to 40 s; the engine
takes 30 s). The split point is found by force-aligning the whole paragraph with vb223
(windowed emissions) and cutting between "Bob." and "We".

  .venv/bin/python -I tools/model/export/saa_prepare.py [N_ENGLISH=30]
Writes .work/eval/saa/<id>_a.wav, <id>_b.wav and .work/eval/saa/saa.json.
"""
import io
import json
import re
import sys
from math import gcd
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
import soundfile as sf
import torch
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).parent))
from wp_common import UnitTable, forced_align, load_cmudict, log_mel  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / ".work/distill/raw/changelinglab__speechaccentarchive-pr/data"
OUT = ROOT / ".work/eval/saa"
N_EN = int(sys.argv[1]) if len(sys.argv) > 1 else 30
PARA = ("Please call Stella. Ask her to bring these things with her from the store: Six spoons of fresh snow peas, "
        "five thick slabs of blue cheese, and maybe a snack for her brother Bob. We also need a small plastic snake "
        "and a big toy frog for the kids. She can scoop these things into three red bags, and we will go meet her "
        "Wednesday at the train station.")
WORDS = re.findall(r"[A-Za-z']+", PARA)
SPLIT_AT = WORDS.index("We")  # first word of the second chunk


def natural(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    idx = json.loads((ROOT / ".work/distill/meta/saa_index.json").read_text())
    kind = lambda x: re.sub(r"\d+$", "", x["id"])  # noqa: E731
    sel = sorted([x for x in idx if kind(x) == "japanese"], key=lambda x: natural(x["id"]))
    sel += sorted([x for x in idx if kind(x) == "english"], key=lambda x: natural(x["id"]))[:N_EN]
    cfg = json.loads((ROOT / ".work/models/whisper-phoneme/config.json").read_text())
    units = UnitTable(cfg["vocab"], cfg["output_dim"], merged=True)
    so = ort.SessionOptions()
    so.add_session_config_entry("session.disable_quant_qdq", "1")
    sess = ort.InferenceSession(str(ROOT / "public/models/whisper-phoneme/model.int8w.onnx"), so, providers=["CPUExecutionProvider"])
    cmu = load_cmudict(ROOT / ".work/cmudict.dict")
    phones, word_of = [], []
    for wi, w in enumerate(WORDS):
        for p in cmu[w.lower()]:
            phones.append(p)
            word_of.append(wi)
    targets = [units.unit_of(p) for p in phones]
    tables = {}
    out = []
    for x in sel:
        f = RAW / f"test-{x['shard']:05d}-of-00007.parquet"
        if f not in tables:
            tables[f] = pq.read_table(f, columns=["id", "audio"])
        row = tables[f].slice(x["row"], 1).to_pylist()[0]
        assert row["id"] == x["id"]
        a, sr = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
        if a.ndim > 1:
            a = a.mean(-1)
        g = gcd(sr, 16000)
        a = resample_poly(a, 16000 // g, sr // g).astype(np.float32)
        a /= max(1e-6, float(np.abs(a).max())) / 0.9
        # windowed emissions (20 s windows, keep the centre of overlapping ones)
        win, hop = 20 * 16000, 18 * 16000
        frames_total = int(np.ceil(len(a) / 320))
        lp = np.full((frames_total, cfg["output_dim"]), -1e4, dtype=np.float32)
        start = 0
        while True:
            seg = a[start:start + win]
            mel = log_mel(seg, pad30=False).unsqueeze(0).numpy()
            out_lp = sess.run(None, {"mel": mel})[0][0]
            f0 = start // 320
            keep_from = 0 if start == 0 else 25  # drop the first 0.5 s of later windows
            n = min(len(out_lp), frames_total - f0)
            lp[f0 + keep_from:f0 + n] = out_lp[keep_from:n]
            if start + win >= len(a):
                break
            start += hop
        ulp = units.apply(torch.from_numpy(lp))
        _, spans = forced_align(ulp, targets, units.blank)
        last_a = max(i for i, w in enumerate(word_of) if w == SPLIT_AT - 1)
        first_b = min(i for i, w in enumerate(word_of) if w == SPLIT_AT)
        cut = int((spans[last_a].end + spans[first_b].start) / 2 * 320)
        sf.write(OUT / f"{x['id']}_a.wav", a[:cut], 16000, subtype="PCM_16")
        sf.write(OUT / f"{x['id']}_b.wav", a[cut:], 16000, subtype="PCM_16")
        out.append({"id": x["id"], "l1": kind(x), "seconds": round(len(a) / 16000, 1), "cut": round(cut / 16000, 2),
                    "a": WORDS[:SPLIT_AT], "b": WORDS[SPLIT_AT:]})
        print(x["id"], out[-1]["seconds"], "cut", out[-1]["cut"])
    (OUT / "saa.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
