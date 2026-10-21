"""How much zero padding does the encoder need? PCC on speechocean762 test vs padding.

  .venv/bin/python -I tools/model/export/eval_padding.py PARQUET [MODEL_DIR] [ONNX_DIR] [OUT_DIR]

Padding policies (zeros appended to the audio before the mel):
  tail:X  -> X seconds of silence after the clip
  min:X   -> pad the clip to at least X seconds
  pad30   -> upstream (30 s)
Scored with ONNX Runtime (MODEL env: int8 or fp32), merged stress units, stress-0 one-hot
(the engine's default) and the upstream token scoring.
"""
import io
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
import soundfile as sf
import torch
import whisper

sys.path.insert(0, str(Path(__file__).parent))
from wp_common import UnitTable, load_regressor, needed_samples, pcc, score_logprobs  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
PARQUET = Path(sys.argv[1])
MODEL_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / ".work/models/whisper-phoneme"
ONNX_DIR = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / ".work/onnx"
OUT_DIR = Path(sys.argv[4]) if len(sys.argv) > 4 else ROOT / ".work/eval"
KIND = os.environ.get("MODEL", "int8")
POLICIES = os.environ.get("POLICIES", "tail:0,tail:0.5,tail:1,tail:2,tail:3,tail:5,min:5,min:10,pad30").split(",")
STEP = int(os.environ.get("STEP", "1"))


def padded(audio, policy, n_phones):
    a = audio
    need = needed_samples(len(a), n_phones)
    if policy == "pad30":
        need = max(need, 480000)
    else:
        kind, x = policy.split(":")
        x = float(x)
        need = max(need, len(a) + int(round(x * 16000)) if kind == "tail" else int(round(x * 16000)))
    if need > len(a):
        a = np.concatenate([a, np.zeros(need - len(a), dtype=np.float32)])
    return a[:480000]


def main():
    cfg = json.loads((MODEL_DIR / "config.json").read_text())
    vocab = cfg["vocab"]
    vidx = {p: i for i, p in enumerate(vocab)}
    reg = load_regressor(MODEL_DIR)
    tables = {"tok": UnitTable(vocab, cfg["output_dim"]), "merged": UnitTable(vocab, cfg["output_dim"], merged=True)}
    modes = [("merged", "stress0"), ("tok", "label")]
    so = ort.SessionOptions()
    so.intra_op_num_threads = 8
    sess = ort.InferenceSession(str(ONNX_DIR / f"model.{KIND}.onnx"), so, providers=["CPUExecutionProvider"])
    table = pq.read_table(PARQUET)
    preds = {(p, m): [] for p in POLICIES for m in modes}
    frames_used = {p: 0 for p in POLICIES}
    human = []
    t0 = time.time()
    for i in range(0, table.num_rows, STEP):
        row = table.slice(i, 1).to_pylist()[0]
        audio, sr = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
        pairs = [(p, s) for w in row["words"] for p, s in zip(w["phones"], w["phones-accuracy"])]
        phones, scores = map(list, zip(*pairs))
        out = {}
        for pol in POLICIES:
            a = padded(audio, pol, len(phones))
            mel = whisper.log_mel_spectrogram(torch.from_numpy(a), n_mels=80).unsqueeze(0).numpy()
            lp = torch.from_numpy(sess.run(None, {"mel": mel})[0][0])
            frames_used[pol] += lp.shape[0]
            for t, o in modes:
                _, sc = score_logprobs(lp, phones, len(audio), tables[t], reg, o, vidx)
                out[(pol, (t, o))] = sc
        for k, sc in out.items():
            preds[k].extend(sc.tolist())
        human.extend(scores)
        if (i // STEP + 1) % 250 == 0:
            print(f"[{i + 1}] {time.time() - t0:.0f}s", flush=True)
    n_utt = len(range(0, table.num_rows, STEP))
    print(f"\n{KIND}: {len(human)} phones, {n_utt} utterances")
    print(f"{'policy':10s} {'avg frames':>10s} " + " ".join(f"{t + '/' + o:>15s}" for t, o in modes))
    res = {}
    for pol in POLICIES:
        r = [pcc(preds[(pol, m)], human) for m in modes]
        res[pol] = r
        print(f"{pol:10s} {frames_used[pol] / n_utt:10.1f} " + " ".join(f"{x:15.4f}" for x in r))
    (OUT_DIR / f"padding_{KIND}.json").write_text(json.dumps({"policies": res, "frames": frames_used, "n": n_utt}))


if __name__ == "__main__":
    main()
