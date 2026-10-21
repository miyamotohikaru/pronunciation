"""Python reference for the TS engine's parity test (tools/scoring-tests/parity.ts).

  .venv/bin/python tools/model/export/reference_scores.py REQUEST.json RESPONSE.json

REQUEST: {"modelDir": "public/models/whisper-phoneme", "onnxPath": ".../model.int8w.onnx",
          "useTsLogProbs": false,
          "items": [{"wav": path, "nPad": int, "phones": ["R", "AY1", "DX", ...],
                     "tsMel": path of the TS mel (.f32, [80, L]),
                     "tsLogProbs": path of the TS log-probs (.f32, [T, V])}]}
useTsLogProbs=true scores the TS engine's own log-probs (isolates the TS alignment / GOP /
regressor code from ONNX Runtime differences); false runs ONNX Runtime (python) on the
torch mel (end to end).
For each item this recomputes, with the reference libraries, what the TS engine does
after it has chosen the variants: whisper log-mel (torch), ONNX Runtime (python),
stress-merged units (+ T|D for DX/Q), torchaudio forced_align + merge_tokens, GOP
features, sklearn's HistGradientBoostingRegressor. RESPONSE holds spans, features and raw
scores per phone, plus the mel / log-prob differences against the TS inputs.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
import torchaudio
import whisper

sys.path.insert(0, str(Path(__file__).parent))
from wp_common import load_regressor  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
ALIASES = {"DX": ["T", "D"], "Q": ["T", "D"]}
ALIAS_CLASS = {"DX": "T", "Q": "T"}


def base(p):
    return re.sub(r"[0-2]$", "", p)


def main():
    req = json.loads(Path(sys.argv[1]).read_text())
    mdir = ROOT / req["modelDir"]
    meta = json.loads((mdir / "meta.json").read_text())
    reg = load_regressor(ROOT / ".work/models/whisper-phoneme")
    sess = ort.InferenceSession(str(req["onnxPath"]), providers=["CPUExecutionProvider"])
    fe = meta["frontEnd"]
    out = []
    for it in req["items"]:
        audio, sr = sf.read(it["wav"], dtype="float32")
        assert sr == 16000
        n = len(audio)
        need = max((it["nPad"] + 5) * 320, n + int(round(fe["tailPadSeconds"] * 16000)), int(round(fe["minSeconds"] * 16000)), n)
        padded = np.concatenate([audio, np.zeros(need - n, dtype=np.float32)]) if need > n else audio
        mel = whisper.log_mel_spectrogram(torch.from_numpy(padded), n_mels=80)
        rec = {"wav": it["wav"]}
        if it.get("tsMel"):
            ts = np.fromfile(it["tsMel"], dtype=np.float32).reshape(80, -1)
            rec["melShape"] = [list(mel.shape), list(ts.shape)]
            rec["melMaxAbsDiff"] = float(np.abs(ts - mel.numpy()).max()) if ts.shape == tuple(mel.shape) else None
        lp_all = sess.run(None, {"mel": mel.unsqueeze(0).numpy()})[0][0]
        if it.get("tsLogProbs"):
            ts_lp = np.fromfile(it["tsLogProbs"], dtype=np.float32).reshape(-1, lp_all.shape[1])
            rec["logProbMaxAbsDiff"] = float(np.abs(ts_lp - lp_all).max()) if ts_lp.shape == lp_all.shape else None
            # what matters downstream: the probable entries (log p > -10)
            m = lp_all > -10
            rec["logProbMaxAbsDiffAbove-10"] = float(np.abs(ts_lp - lp_all)[m].max()) if ts_lp.shape == lp_all.shape else None
        if req.get("useTsLogProbs"):
            lp_all = np.fromfile(it["tsLogProbs"], dtype=np.float32).reshape(-1, lp_all.shape[1])
        lp = torch.from_numpy(lp_all)
        phones = it["phones"]
        frames = min(max(int(n / 16000 * 50), len(phones) + 5), meta["onnx"]["maxFrames"], lp.shape[0])
        # unit columns: blank, meta units, alias columns on demand (same order as the TS)
        names = ["<blank>"] + list(meta["units"])
        groups = [[meta["blank"]]] + [meta["units"][u] for u in meta["units"]]
        n_phone_cols = len(names) - 1

        def col(sym):
            if sym in meta["units"]:
                return names.index(sym)
            b = base(sym)
            if b in meta["units"]:
                return names.index(b)
            al = "|".join(ALIASES[b])
            if al not in names:
                names.append(al)
                ids = []
                for a in ALIASES[b]:
                    ids += [i for i in meta["units"][a] if i not in ids]
                groups.append(ids)
            return names.index(al)

        targets = [col(p) for p in phones]
        em = torch.stack([torch.logsumexp(lp[:frames][:, g], dim=-1) for g in groups], dim=-1)
        tok, fs = torchaudio.functional.forced_align(
            em.unsqueeze(0).contiguous(), torch.tensor([targets], dtype=torch.int32),
            torch.tensor([frames], dtype=torch.int32), torch.tensor([len(targets)], dtype=torch.int32), blank=0)
        spans = torchaudio.functional.merge_tokens(tok[0], fs[0], blank=0)
        assert len(spans) == len(phones), (len(spans), len(phones))
        rows = []
        X = []
        for p, s in zip(phones, spans):
            tgt_ids = set(groups[s.token])
            comps = [c for c in range(1, 1 + n_phone_cols) if c != s.token and not (set(groups[c]) & tgt_ids)]
            seg = em[s.start:s.end]
            best = seg[:, comps].max(dim=-1).values
            tv = seg[:, s.token]
            f = [float((tv - best).mean()), float(tv.mean()), float(best.mean()), float(tv.min()), s.end - s.start]
            co = meta["regressor"]["classOf"]
            cls = co.get(p, co.get(base(p), co.get(ALIAS_CLASS.get(base(p), ""), None)))
            x = np.zeros(len(f) + meta["regressor"]["oneHotSize"], dtype=np.float32)
            x[: len(f)] = f
            x[len(f) + cls] = 1
            X.append(x)
            rows.append({"phone": p, "start": s.start, "end": s.end, "features": [float(np.float32(v)) for v in f]})
        raw = reg.predict(np.stack(X))
        for r, v in zip(rows, raw):
            r["raw"] = float(v)
        rec["frames"] = frames
        rec["phones"] = rows
        out.append(rec)
    Path(sys.argv[2]).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
