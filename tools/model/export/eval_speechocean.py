"""Phone-level PCC on the speechocean762 test split for the export variants.

  .venv/bin/python -I tools/model/export/eval_speechocean.py PARQUET [MODEL_DIR] [ONNX_DIR] [OUT_DIR]

Variants of the log-probs:
  pad30_torch : upstream (30-s zero padding, PyTorch fp32)           -> baseline 0.606
  trim_torch  : real audio only, positional embedding sliced (PyTorch fp32)
  trim_fp32   : same through ONNX Runtime fp32
  trim_int8   : same through ONNX Runtime int8 (dynamic quantization)
and of the scoring on top of each:
  tok   : upstream - align and read GOP over the 87 model tokens, one-hot of the label
  merged: logsumexp over stress variants (AA|AA0|AA1|AA2) -> 40 units; one-hot of the label
  merged_s0: merged, one-hot of the base symbol's stress-0 token (no stress info needed)

Writes OUT_DIR/so762_scores.npz (per-phone predictions for every combination, human
scores, phone labels), so762_meta.json (per-utterance phones, scores, annotated
mispronunciations) and caches the trim_int8 / trim_fp32 log-probs (float16, concatenated
with offsets) for the calibration and diagnosis tuning scripts.
"""
import io
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pyarrow.parquet as pq
import soundfile as sf
import torch

sys.path.insert(0, str(Path(__file__).parent))
from wp_common import (DynamicLogProbs, UnitTable, load_net, load_regressor, log_mel, pcc,  # noqa: E402
                       score_logprobs)

ROOT = Path(__file__).resolve().parents[3]
PARQUET = Path(sys.argv[1])
MODEL_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / ".work/models/whisper-phoneme"
ONNX_DIR = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / ".work/onnx"
OUT_DIR = Path(sys.argv[4]) if len(sys.argv) > 4 else ROOT / ".work/eval"
OUT_DIR.mkdir(parents=True, exist_ok=True)
LIMIT = int(__import__("os").environ.get("LIMIT", "0"))


def main():
    torch.set_num_threads(8)
    net, cfg = load_net(MODEL_DIR)
    dyn = DynamicLogProbs(net).eval()
    reg = load_regressor(MODEL_DIR)
    vocab = cfg["vocab"]
    vidx = {p: i for i, p in enumerate(vocab)}
    tables = {"tok": UnitTable(vocab, cfg["output_dim"]),
              "merged": UnitTable(vocab, cfg["output_dim"], merged=True)}
    so = ort.SessionOptions()
    so.intra_op_num_threads = 8
    sess = {k: ort.InferenceSession(str(ONNX_DIR / f"model.{k}.onnx"), so, providers=["CPUExecutionProvider"])
            for k in ("fp32", "int8")}

    table = pq.read_table(PARQUET)
    n = table.num_rows if not LIMIT else min(LIMIT, table.num_rows)
    lp_variants = ["pad30_torch", "trim_torch", "trim_fp32", "trim_int8"]
    score_modes = [("tok", "label"), ("merged", "label"), ("merged", "stress0")]
    preds = {(v, t, o): [] for v in lp_variants for t, o in score_modes}
    human, labels, utt_index, skipped = [], [], [], 0
    cache = {"trim_int8": [], "trim_fp32": []}
    cache_meta = []
    t_start = time.time()
    for i in range(n):
        row = table.slice(i, 1).to_pylist()[0]
        audio, sr = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
        assert sr == 16000, sr
        if audio.ndim > 1:
            audio = audio.mean(-1)
        pairs = [(p, s) for w in row["words"] for p, s in zip(w["phones"], w["phones-accuracy"])]
        word_of = [wi for wi, w in enumerate(row["words"]) for _ in w["phones"]]
        if not pairs:
            continue
        phones, scores = map(list, zip(*pairs))
        if any(p not in vidx for p in phones):
            skipped += 1
            continue
        lps = {}
        with torch.no_grad():
            mel30 = log_mel(audio, pad30=True).unsqueeze(0)
            lps["pad30_torch"] = torch.log_softmax(net(mel30), -1)[0]
            melt = log_mel(audio, pad30=False, n_phones=len(phones)).unsqueeze(0)
            lps["trim_torch"] = dyn(melt)[0]
        for k, s in sess.items():
            lps[f"trim_{k}"] = torch.from_numpy(s.run(None, {"mel": melt.numpy()})[0][0])
        try:
            out = {}
            for v in lp_variants:
                for t, o in score_modes:
                    _, sc = score_logprobs(lps[v], phones, len(audio), tables[t], reg, o, vidx)
                    out[(v, t, o)] = sc
        except ValueError:
            skipped += 1
            continue
        for k, sc in out.items():
            preds[k].extend(sc.tolist())
        human.extend(scores)
        labels.extend(phones)
        utt_index.extend([i] * len(phones))
        for k in cache:
            cache[k].append(lps[k].numpy().astype(np.float16))
        cache_meta.append({"i": i, "phones": phones, "scores": scores, "word_of": word_of,
                           "n_samples": len(audio), "text": row["text"],
                           "mis": [[(m["index"], m["canonical-phone"], m["pronounced-phone"])
                                    for m in w["mispronunciations"]] for w in row["words"]]})
        if (i + 1) % 100 == 0:
            el = time.time() - t_start
            msg = " ".join(f"{v}/{t}/{o}={pcc(preds[(v, t, o)], human):.4f}"
                           for v in lp_variants for t, o in score_modes[:1])
            print(f"[{i + 1}/{n}] {el:.0f}s  {msg}", flush=True)

    print(f"\nspeechocean762 test: {len(human)} phones, {skipped} utterances skipped")
    print(f"{'log-probs':14s} " + " ".join(f"{t + '/' + o:>16s}" for t, o in score_modes))
    for v in lp_variants:
        print(f"{v:14s} " + " ".join(f"{pcc(preds[(v, t, o)], human):16.4f}" for t, o in score_modes))
    np.savez_compressed(OUT_DIR / "so762_scores.npz", human=np.array(human, dtype=np.float32),
                        labels=np.array(labels), utt=np.array(utt_index),
                        **{"/".join(k): np.array(vv, dtype=np.float32) for k, vv in preds.items()})
    (OUT_DIR / "so762_meta.json").write_text(json.dumps(cache_meta))
    for k, arrs in cache.items():
        offsets = np.cumsum([0] + [a.shape[0] for a in arrs])
        np.savez(OUT_DIR / f"so762_logprobs_{k}.npz", lp=np.concatenate(arrs), offsets=offsets)
    print("saved", OUT_DIR)


if __name__ == "__main__":
    main()
