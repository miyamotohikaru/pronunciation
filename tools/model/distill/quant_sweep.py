"""Try int8 dynamic-quantisation variants of the exported fp32 student and compare with fp32 ORT.

    python quant_sweep.py <dir with student.fp32.onnx>

Variants: per-tensor (default), per-channel, and per-channel with the output projection kept in fp32.
Writes the best variant as student.int8.onnx only if asked (--apply <name>).
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ctc_greedy, decode_audio, edit_distance, log_mel  # noqa: E402


def clips(n=40):
    items = json.loads((WORK / "eval" / "say" / "items.json").read_text())
    out = [decode_audio(str(WORK / it["path"])) for it in items[::29][:20]]
    import pyarrow.parquet as pq
    for name in ["so_test2", "globe_test2"]:
        idx = [json.loads(l) for l in open(WORK / "data" / name / "index.jsonl")][:: 50][:10]
        aud = np.memmap(WORK / "data" / name / "audio.bin", dtype=np.int16, mode="r")
        out += [aud[it["a_off"]: it["a_off"] + it["a_len"]].astype(np.float32) / 32767 for it in idx]
    return out[:n]


def run(path, mels, threads=4):
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    s = ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
    return [s.run(None, {"mel": m})[0][0] for m in mels], s


def main():
    d = Path(sys.argv[1])
    fp32 = d / "student.fp32.onnx"
    mels = [log_mel(torch.from_numpy(a))[None].numpy() for a in clips()]
    ref, _ = run(fp32, mels)
    g = onnx.load(str(fp32))
    matmuls = [n.name for n in g.graph.node if n.op_type == "MatMul"]
    last = [n for n in matmuls if "phoneme_head" in n][-1:]
    variants = {
        "per_tensor": dict(per_channel=False),
        "per_channel": dict(per_channel=True),
        "per_channel_keep_out": dict(per_channel=True, nodes_to_exclude=last),
        "per_tensor_keep_out": dict(per_channel=False, nodes_to_exclude=last),
    }
    res = {}
    for name, kw in variants.items():
        out = d / f"q_{name}.onnx"
        quantize_dynamic(str(fp32), str(out), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"],
                         reduce_range=False, **kw)
        got, s = run(out, mels)
        agree = np.mean([(a.argmax(-1) == b.argmax(-1)).mean() for a, b in zip(ref, got)])
        e = n = 0
        for a, b in zip(ref, got):
            r = ctc_greedy(a.argmax(-1).tolist(), 0)
            h = ctc_greedy(b.argmax(-1).tolist(), 0)
            e += edit_distance(r, h)
            n += len(r)
        m8 = log_mel(torch.from_numpy(np.random.default_rng(0).standard_normal(16000 * 8).astype(np.float32) * 0.05))[None].numpy()
        s.run(None, {"mel": m8})
        t0 = time.perf_counter()
        for _ in range(5):
            s.run(None, {"mel": m8})
        res[name] = dict(size_mb=round(out.stat().st_size / 1e6, 2), argmax_agree=round(float(agree), 4),
                         greedy_per_vs_fp32=round(e / max(n, 1), 4), ms_8s_4thr=round((time.perf_counter() - t0) / 5 * 1000, 1))
        print(name, res[name], flush=True)
    (d / "quant_sweep.json").write_text(json.dumps(res, indent=1))
    if "--apply" in sys.argv:
        name = sys.argv[sys.argv.index("--apply") + 1]
        (d / f"q_{name}.onnx").replace(d / "student.int8.onnx")
        print("applied", name)


if __name__ == "__main__":
    main()
