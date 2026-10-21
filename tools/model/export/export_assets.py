"""Write the browser assets of a model: meta.json, regressor.json, mel_filters_80.json (+ ONNX).

  .venv/bin/python tools/model/export/export_assets.py [MODEL_DIR] [ONNX_DIR] [OUT_DIR]

OUT_DIR defaults to public/models/whisper-phoneme. Calibration knots and diagnosis
thresholds live in CALIBRATION / DIAGNOSIS below (tuned with tune_diagnosis.py / the
Node tests) - edit them here and re-run, never by hand in meta.json.
"""
import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import sklearn
import whisper

sys.path.insert(0, str(Path(__file__).parent))
from wp_common import base_symbol, load_regressor  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
MODEL_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".work/models/whisper-phoneme"
ONNX_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / ".work/onnx"
OUT_DIR = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "public/models/whisper-phoneme"
# ONNX variants copied next to meta.json; the first is the default. int8w = weight-only int8
# (quantize_weights.py): smallest file, fp32 compute (same numbers on every runtime, fast on
# WebGPU). fp32 and the dynamic int8 stay in ONNX_DIR.
SHIP = ["int8w"]
SESSION_CONFIG = {"int8w": {"session.disable_quant_qdq": "1"}}  # fold DequantizeLinear at load

# Padding policy chosen with eval_padding.py (see README).
TAIL_PAD_SECONDS = 0.5
MIN_SECONDS = 0.0

# 0..2 regressor output -> 0..100
CALIBRATION = [[0.0, 0.0], [0.6, 20.0], [1.0, 40.0], [1.4, 70.0], [1.7, 90.0], [1.85, 97.0], [1.95, 100.0]]

DIAGNOSIS = {
    "confusions": {
        "R": ["L", "D", "W"], "L": ["R"], "TH": ["S", "T", "F"], "DH": ["Z", "D"], "V": ["B", "F", "W"],
        "F": ["HH", "P"], "S": ["SH", "TH"], "SH": ["S"], "Z": ["JH", "S"], "ZH": ["JH", "SH"],
        "W": ["UW"], "HH": ["F"], "N": ["NG"], "NG": ["N"],
        "AE": ["AH", "EH", "AA"], "AH": ["AA", "AE"], "AA": ["AH", "AO", "OW"], "AO": ["OW"],
        "IH": ["IY"], "IY": ["IH"], "UH": ["UW"], "UW": ["UH"], "ER": ["AA", "AH"], "EY": ["EH"], "OW": ["AO"],
    },
    "epentheticVowels": ["UW", "UH", "OW", "AO", "IH", "IY", "AH"],
    "substitutionPenalty": 2.0,
    "pairPenalty": {"N>NG": 4.5, "NG>N": 4.5},
    "insertionPenalty": 0.5,
    "deletionPenalty": 6.0,
    "minInsertionFrames": 1,
    "distortionBelow": 60,
    "substitutionCap": 35,
    "deletionCap": 30,
    "insertionScore": 35,
    "worstPhoneMargin": 20,
}


def f32(x):
    """Exact float32 value as a Python float (json writes the shortest round-trip repr)."""
    return float(np.float32(x))


def export_filters(path):
    with np.load(Path(whisper.__file__).parent / "assets" / "mel_filters.npz", allow_pickle=False) as f:
        fb = f["mel_80"].astype(np.float32)
    filters = []
    for row in fb:
        nz = np.nonzero(row)[0]
        s, e = int(nz[0]), int(nz[-1]) + 1
        filters.append({"start": s, "weights": [f32(v) for v in row[s:e]]})
    path.write_text(json.dumps({"nFft": 400, "nMels": 80, "dtype": "float32", "filters": filters}, separators=(",", ":")))
    return fb


def export_regressor(reg, path):
    trees = []
    for it in reg._predictors:
        assert len(it) == 1
        nodes = it[0].nodes
        assert not nodes["is_categorical"].any()
        trees.append({
            "feature": nodes["feature_idx"].astype(int).tolist(),
            "threshold": [None if np.isinf(v) else float(v) for v in nodes["num_threshold"]],
            "left": nodes["left"].astype(int).tolist(),
            "right": nodes["right"].astype(int).tolist(),
            "leaf": nodes["is_leaf"].astype(int).tolist(),
            "value": nodes["value"].astype(float).tolist(),
            "missingLeft": nodes["missing_go_to_left"].astype(int).tolist(),
        })
    assert reg._loss.__class__.__name__ == "HalfSquaredError"
    assert reg._baseline_prediction.shape == (1, 1)
    out = {"type": "sklearn.HistGradientBoostingRegressor", "sklearn": sklearn.__version__,
           "nFeatures": int(reg.n_features_in_), "baseline": float(reg._baseline_prediction[0, 0]), "trees": trees}
    path.write_text(json.dumps(out, separators=(",", ":")))


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((MODEL_DIR / "config.json").read_text())
    vocab = cfg["vocab"]
    vidx = {p: i for i, p in enumerate(vocab)}
    units = {}
    for i, p in enumerate(vocab):
        if i == cfg["blank_id"] or p.startswith("<"):
            continue
        units.setdefault(base_symbol(p), []).append(i)
    # one-hot class: consonant -> its token, vowel -> its stress-0 token (see eval: merged/stress0)
    class_of = {b: vidx.get(b + "0", vidx.get(b)) for b in units}
    export_filters(OUT_DIR / "mel_filters_80.json")
    export_regressor(load_regressor(MODEL_DIR), OUT_DIR / "regressor.json")
    files = {k: f"model.{k}.onnx" for k in SHIP}
    hashes = {}
    for k in SHIP:
        shutil.copyfile(ONNX_DIR / f"model.{k}.onnx", OUT_DIR / f"model.{k}.onnx")
        hashes[k] = hashlib.sha256((OUT_DIR / f"model.{k}.onnx").read_bytes()).hexdigest()[:16]
    meta = {
        "schema": 1,
        "id": "whisper-base-en-phoneme-ctc",
        "source": "vb223/whisper-base-en-phoneme-ctc (Whisper base.en encoder by OpenAI + CTC head + GOP regressor), "
                  "trained on speechocean762 (Zhang et al., CC BY 4.0)",
        "license": "MIT",
        "files": {"onnx": files, "defaultOnnx": SHIP[0], "hash": hashes,
                  "sessionConfig": {k: v for k, v in SESSION_CONFIG.items() if k in SHIP},
                  "regressor": "regressor.json", "melFilters": "mel_filters_80.json"},
        "frontEnd": {"type": "whisper-log-mel", "sampleRate": 16000, "nFft": 400, "hop": 160, "nMels": 80,
                     "tailPadSeconds": TAIL_PAD_SECONDS, "minSeconds": MIN_SECONDS},
        "onnx": {"input": "mel", "output": "log_probs", "logSoftmax": True, "frameRate": 50, "samplesPerFrame": 320,
                 "maxFrames": cfg["n_audio_ctx"]},
        "vocab": vocab,
        "vocabSize": cfg["output_dim"],
        "blank": cfg["blank_id"],
        "units": units,
        "regressor": {"features": ["gop", "logp_target", "logp_competitor", "logp_target_min", "n_frames"],
                      "oneHotSize": cfg["output_dim"], "classOf": class_of, "range": [0, 2]},
        "calibration": {"knots": CALIBRATION},
        "diagnosis": DIAGNOSIS,
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    for p in sorted(OUT_DIR.iterdir()):
        print(f"{p.name:24s} {p.stat().st_size / 1e6:8.3f} MB")


if __name__ == "__main__":
    main()
