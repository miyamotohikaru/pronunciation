"""Browser assets for the distilled student (reduced-IPA CTC model, tools/model/distill).

  .venv/bin/python tools/model/export/export_student_assets.py [REGRESSOR_JOBLIB_OR_JSON]

Writes public/models/student-ipa/{meta.json, model.int8w.onnx, mel_filters_80.json,
regressor.json}. Without a trained regressor a placeholder (constant 1.9) is written so the
TS feature extraction (tools/scoring-tests/so762-features.mts) can run; train it with
train_student_regressor.py and run this again.

ARPAbet -> student tokens (logsumexp over the listed tokens):
  * stress variants and reduced forms merge (IY = iː|i, AH = ʌ|ə|ɐ, ER = ɜː|ɚ ...);
  * r-coloured vowels are ONE student token (ɑːɹ = AA R ...), so that token belongs to both
    the vowel and R (the engine never lets overlapping units compete in GOP);
  * əl (AH0 L), iə (IY AH), aɪə (AY AH), aɪɚ (AY ER) likewise;
  * Japanese / other L1 sounds (ɾ ɯ ɕ ts ɸ a e o ...) are extra units under their IPA
    names: never targets, but competitors in GOP and possible "heard as" / inserted vowels.
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from export_assets import CALIBRATION, DIAGNOSIS, export_filters, export_regressor  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / ".work/distill/export"
# env overrides, to evaluate another round without touching the shipped folder
ONNX_FILE = SRC / os.environ.get("STUDENT_ONNX", "student.int8w.onnx")
META_FILE = SRC / os.environ.get("STUDENT_META", "metadata.json")
OUT = Path(os.environ.get("STUDENT_OUT", ROOT / "public/models/student-ipa"))
TUNING_FILE = Path(os.environ.get("STUDENT_TUNING", Path(__file__).parent / "student_tuning.json"))

UNITS = {
    # consonants
    "B": ["b"], "CH": ["tʃ"], "D": ["d"], "DH": ["ð"], "F": ["f"], "G": ["ɡ"], "HH": ["h"], "JH": ["dʒ"],
    "K": ["k"], "L": ["l", "əl"], "M": ["m"], "N": ["n"], "NG": ["ŋ"], "P": ["p"],
    "R": ["ɹ", "ɑːɹ", "ɔːɹ", "ɛɹ", "ɪɹ", "ʊɹ", "oːɹ", "aɪɚ"],
    "S": ["s"], "SH": ["ʃ"], "T": ["t"], "TH": ["θ"], "V": ["v"], "W": ["w"], "Y": ["j"], "Z": ["z"], "ZH": ["ʒ"],
    # vowels
    "AA": ["ɑː", "ɑ", "ɒ", "ɑːɹ"], "AE": ["æ", "ɛɹ"], "AH": ["ʌ", "ə", "ɐ", "əl", "iə", "aɪə"],
    "AO": ["ɔː", "ɔ", "ɔːɹ", "oːɹ"], "AW": ["aʊ"], "AY": ["aɪ", "aɪɚ", "aɪə"], "EH": ["ɛ", "ɛɹ"],
    "ER": ["ɜː", "ɚ", "aɪɚ"], "EY": ["eɪ", "ɛɹ"], "IH": ["ɪ", "ᵻ", "ɪɹ"], "IY": ["iː", "i", "ɪɹ", "iə"],
    "OW": ["oʊ", "oːɹ"], "OY": ["ɔɪ"], "UH": ["ʊ", "ʊɹ"], "UW": ["uː", "u", "ʊɹ"],
}
ALIASES = {"DX": ["T", "D", "ɾ"], "Q": ["T", "D", "ʔ"]}
JA_EXTRA = ["ɾ", "r", "ʔ", "ɕ", "tɕ", "dʑ", "ts", "ɸ", "β", "ç", "x", "ɲ", "a", "e", "o", "ɯ", "aː", "eː", "oː", "y"]

# vb223's confusion sets plus the student's L1 sounds
CONFUSIONS = {k: list(v) for k, v in DIAGNOSIS["confusions"].items()}
for k, extra in {
    "R": ["ɾ"], "L": ["ɾ"], "V": ["β"], "F": ["ɸ"], "HH": ["ɸ", "ç"], "S": ["ɕ"], "SH": ["ɕ"], "Z": ["dʑ"],
    "JH": ["dʑ"], "CH": ["tɕ"], "UW": ["ɯ"], "UH": ["ɯ"], "AE": ["a"], "AH": ["a"], "AA": ["a"],
    "AO": ["o"], "OW": ["o"], "ER": ["a"], "EY": ["e"], "EH": ["e"], "T": ["ts"],
}.items():
    CONFUSIONS.setdefault(k, [])
    CONFUSIONS[k] += [x for x in extra if x not in CONFUSIONS[k]]

TAIL_PAD_SECONDS = float(__import__("os").environ.get("STUDENT_TAIL", "0.0"))


def main():
    md = json.loads(META_FILE.read_text())
    vocab = md["vocab"]
    idx = {t: i for i, t in enumerate(vocab)}
    units = {b: [idx[t] for t in toks] for b, toks in UNITS.items()}
    for t in JA_EXTRA:
        units[t] = [idx[t]]
    used = {i for ids in units.values() for i in ids}
    missing = [t for t in vocab[1:] if idx[t] not in used]
    if missing:
        print("tokens in no unit:", missing)
    bases = list(UNITS)
    class_of = {b: i for i, b in enumerate(bases)}
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ONNX_FILE, OUT / "model.int8w.onnx")
    export_filters(OUT / "mel_filters_80.json")
    reg_src = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if reg_src and reg_src.suffix == ".json":
        shutil.copyfile(reg_src, OUT / "regressor.json")
    elif reg_src:
        from safe_load_regressor import safe_load
        export_regressor(safe_load(str(reg_src)), OUT / "regressor.json")
    else:  # placeholder: constant prediction, only for feature extraction
        (OUT / "regressor.json").write_text(json.dumps({
            "type": "sklearn.HistGradientBoostingRegressor", "sklearn": "placeholder", "nFeatures": 5 + len(bases),
            "baseline": 1.9, "trees": []}))
    diag = dict(DIAGNOSIS)
    diag["confusions"] = CONFUSIONS
    diag["epentheticVowels"] = ["UW", "UH", "OW", "AO", "IH", "IY", "AH", "ɯ", "o", "a", "e"]
    tuning = json.loads(TUNING_FILE.read_text()) if TUNING_FILE.exists() else {}
    diag.update(tuning.get("diagnosis", {}))
    calib = tuning.get("calibration", CALIBRATION)
    meta = {
        "schema": 1,
        "id": "pronunciation-student-ipa-v1",
        "source": "distilled student (whisper base.en encoder + MLP CTC head, 79 reduced-IPA classes; teacher "
                  "facebook/wav2vec2-lv-60-espeak-cv-ft, init vb223/whisper-base-en-phoneme-ctc) - tools/model/distill",
        "license": "MIT (vb223 / Whisper) + Apache-2.0 teacher targets; training data CC BY 4.0 / CC0 / Apache-2.0",
        "files": {"onnx": {"int8w": "model.int8w.onnx"}, "defaultOnnx": "int8w",
                  "hash": {"int8w": hashlib.sha256((OUT / "model.int8w.onnx").read_bytes()).hexdigest()[:16]},
                  "sessionConfig": {"int8w": {"session.disable_quant_qdq": "1"}},
                  "regressor": "regressor.json", "melFilters": "mel_filters_80.json"},
        "frontEnd": {"type": "whisper-log-mel", "sampleRate": 16000, "nFft": 400, "hop": 160, "nMels": 80,
                     "tailPadSeconds": TAIL_PAD_SECONDS, "minSeconds": 0.0},
        "onnx": {"input": md["input"]["name"], "output": md["output"]["name"], "logSoftmax": True,
                 "frameRate": md["frame_rate_hz"], "samplesPerFrame": md["frame_hop_samples"], "maxFrames": md["max_frames"]},
        "vocab": vocab,
        "vocabSize": len(vocab),
        "blank": md["blank_id"],
        "units": units,
        "aliases": ALIASES,
        "regressor": {"features": ["gop", "logp_target", "logp_competitor", "logp_target_min", "n_frames"],
                      "oneHotSize": len(bases), "classOf": class_of, "range": [0, 2]},
        "calibration": {"knots": calib},
        "diagnosis": diag,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    for p in sorted(OUT.iterdir()):
        print(f"{p.name:24s} {p.stat().st_size / 1e6:8.3f} MB")


if __name__ == "__main__":
    main()
