"""Export whisper-phoneme (encoder + CTC head) to ONNX with a dynamic time axis.

  .venv/bin/python tools/model/export/export_onnx.py [MODEL_DIR] [OUT_DIR]

Writes OUT_DIR/model.fp32.onnx and OUT_DIR/model.int8.onnx (dynamic quantization of
the MatMul weights) and checks both against PyTorch on real and random mels. Run
quantize_weights.py afterwards for model.int8w.onnx (weight-only int8, the shipped one).

Graph: mel [1, 80, L] (float32) -> log_probs [1, ceil(L/2), V] (log-softmax inside).
The positional embedding is sliced to the real frame count, so no 30-s padding.
"""
import sys
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import soundfile as sf
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from whisper.model import disable_sdpa

sys.path.insert(0, str(Path(__file__).parent))
from wp_common import DynamicLogProbs, load_net, log_mel  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
MODEL_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".work/models/whisper-phoneme"
OUT_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / ".work/onnx"
OUT_DIR.mkdir(parents=True, exist_ok=True)
FP32 = OUT_DIR / "model.fp32.onnx"
INT8 = OUT_DIR / "model.int8.onnx"


def export():
    net, cfg = load_net(MODEL_DIR)
    wrapper = DynamicLogProbs(net).eval()
    dummy = torch.randn(1, cfg["n_mels"], 400)
    with torch.no_grad(), disable_sdpa():
        torch.onnx.export(
            wrapper, (dummy,), str(FP32), input_names=["mel"], output_names=["log_probs"],
            dynamic_axes={"mel": {2: "mel_frames"}, "log_probs": {1: "frames"}},
            opset_version=17, do_constant_folding=True, dynamo=False)
    m = onnx.load(str(FP32))
    onnx.checker.check_model(m)
    m.doc_string = "whisper-base-en-phoneme-ctc (vb223, MIT): mel[1,80,L] -> log_probs[1,ceil(L/2),V]"
    onnx.save(m, str(FP32))
    quantize_dynamic(str(FP32), str(INT8), weight_type=QuantType.QInt8,
                     op_types_to_quantize=["MatMul"], per_channel=False, reduce_range=False)
    return net, wrapper


def verify(wrapper):
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = {k: ort.InferenceSession(str(p), so, providers=["CPUExecutionProvider"])
            for k, p in (("fp32", FP32), ("int8", INT8))}
    wavs = sorted((ROOT / ".work/audio").glob("*.wav"))
    rng = np.random.default_rng(0)
    cases = []
    for w in wavs[:6]:
        a, sr = sf.read(w, dtype="float32")
        cases.append((w.name, log_mel(a, pad30=False).unsqueeze(0)))
    for L in (100, 301, 800, 3000):
        cases.append((f"rand{L}", torch.from_numpy(rng.standard_normal((1, 80, L)).astype(np.float32) * 0.5)))
    print(f"{'case':24s} {'T':>5s} {'fp32 max|d|':>12s} {'int8 max|d|':>12s} {'int8 argmax agree':>18s}")
    for name, mel in cases:
        with torch.no_grad(), disable_sdpa():
            ref = wrapper(mel)[0].numpy()
        out = {k: s.run(None, {"mel": mel.numpy()})[0][0] for k, s in sess.items()}
        d32 = np.abs(out["fp32"] - ref).max()
        d8 = np.abs(out["int8"] - ref).max()
        agree = (out["int8"].argmax(-1) == ref.argmax(-1)).mean()
        print(f"{name:24s} {ref.shape[0]:5d} {d32:12.2e} {d8:12.2e} {agree:18.3f}")
    # timing (CPU, this machine)
    for k, s in sess.items():
        for secs in (3, 8):
            mel = np.zeros((1, 80, secs * 100), dtype=np.float32)
            s.run(None, {"mel": mel})
            t0 = time.perf_counter()
            for _ in range(5):
                s.run(None, {"mel": mel})
            print(f"ort-python {k} {secs}s: {(time.perf_counter() - t0) / 5 * 1000:.1f} ms")
    for p in (FP32, INT8):
        print(f"{p.name}: {p.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    _, w = export()
    verify(w)
