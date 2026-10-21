"""Export the distilled student to ONNX (fp32, int8 dynamic, fp16) and verify against PyTorch.

    .venv/bin/python tools/model/distill/export_onnx.py <ckpt.pt> [out_dir]

Graph contract (same as tools/model/export for vb223):
    mel [1, 80, L] float32 (whisper log-mel of the real audio, no 30-s padding)
      -> log_probs [1, ceil(L/2), V] float32 (log-softmax inside), 50 frames/s,
         frame i centred at audio sample 320*i; blank id 0.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torch.nn as nn

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ctc_greedy, decode_audio, edit_distance, log_mel  # noqa: E402
from model import Student, count_params  # noqa: E402
import phoneset as P  # noqa: E402


class Wrapper(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, mel):
        return torch.log_softmax(self.m(mel), dim=-1)


def export(ckpt, out):
    ck = torch.load(ckpt, map_location="cpu")
    m = Student(len(ck["vocab"]))
    m.load_state_dict(ck["model"])
    m.eval()
    w = Wrapper(m).eval()
    fp32 = out / "student.fp32.onnx"
    with torch.no_grad():
        torch.onnx.export(w, (torch.randn(1, 80, 400),), str(fp32), input_names=["mel"], output_names=["log_probs"],
                          dynamic_axes={"mel": {0: "batch", 2: "mel_frames"}, "log_probs": {0: "batch", 1: "frames"}},
                          opset_version=17, do_constant_folding=True, dynamo=False)
    g = onnx.load(str(fp32))
    onnx.checker.check_model(g)
    g.doc_string = "Phone posteriorgram student (whisper base.en encoder, distilled from wav2vec2-lv-60-espeak-cv-ft)"
    onnx.save(g, str(fp32))
    from onnxruntime.quantization import QuantType, quantize_dynamic
    int8 = out / "student.int8.onnx"
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"],
                     per_channel=False, reduce_range=False)
    from onnxconverter_common import float16
    fp16 = out / "student.fp16.onnx"
    g16 = float16.convert_float_to_float16(onnx.load(str(fp32)), keep_io_types=True)
    onnx.save(g16, str(fp16))
    return w, ck, {"fp32": fp32, "int8": int8, "fp16": fp16}


def verify(w, paths, threads=4):
    rng = np.random.default_rng(0)
    clips = []
    items = json.loads((WORK / "eval" / "say" / "items.json").read_text())
    for it in items[::40][:20]:
        clips.append(decode_audio(str(WORK / it["path"])))
    import pyarrow.parquet as pq
    t = pq.ParquetFile(WORK / "raw/openslr__librispeech_asr/all/test.clean/0000.parquet").read_row_group(0, columns=["audio"]).to_pylist()
    clips += [decode_audio(r["audio"]["bytes"])[:16000 * 12] for r in t[:10]]
    res = {}
    for name, p in paths.items():
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        s = ort.InferenceSession(str(p), so, providers=["CPUExecutionProvider"])
        maxd, agree, errs, toks = 0.0, [], 0, 0
        for a in clips:
            mel = log_mel(torch.from_numpy(a))[None]
            with torch.no_grad():
                ref = w(mel)[0].numpy()
            got = s.run(None, {"mel": mel.numpy()})[0][0]
            maxd = max(maxd, float(np.abs(np.exp(ref) - np.exp(got)).max()))
            agree.append(float((ref.argmax(-1) == got.argmax(-1)).mean()))
            r = ctc_greedy(ref.argmax(-1).tolist(), 0)
            h = ctc_greedy(got.argmax(-1).tolist(), 0)
            errs += edit_distance(r, h)
            toks += len(r)
        lat = {}
        for sec in (3, 8):
            mel = log_mel(torch.from_numpy(rng.standard_normal(16000 * sec).astype(np.float32) * 0.05))[None].numpy()
            s.run(None, {"mel": mel})
            ts = []
            for _ in range(10):
                t0 = time.perf_counter()
                s.run(None, {"mel": mel})
                ts.append(time.perf_counter() - t0)
            lat[f"{sec}s"] = round(1000 * float(np.median(ts)), 1)
        res[name] = dict(size_mb=round(p.stat().st_size / 1e6, 2), max_prob_diff=round(maxd, 4),
                         frame_argmax_agree=round(float(np.mean(agree)), 4), greedy_per_vs_torch=round(errs / max(toks, 1), 4),
                         latency_ms=lat, threads=threads)
        print(name, res[name], flush=True)
    return res


def main():
    ckpt = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else WORK / "export"
    out.mkdir(parents=True, exist_ok=True)
    w, ck, paths = export(ckpt, out)
    res = {f"threads{t}": verify(w, paths, t) for t in (1, 4)}
    meta = dict(
        model="pronunciation phone-posteriorgram student", checkpoint=str(ckpt.relative_to(WORK)) if WORK in ckpt.parents else str(ckpt),
        step=ck.get("step"), params=count_params(w.m),
        input=dict(name="mel", shape=[1, 80, "L"], dtype="float32",
                   features="whisper log-mel of the real audio (no 30-s padding): 16 kHz mono, n_fft 400, hop 160, "
                            "Hann window, centre=True (reflect pad), last STFT frame dropped -> L = n_samples // 160; "
                            "80 whisper mel filters; log10(max(mel,1e-10)); clamp to (max over the utterance - 8); (x + 4) / 4"),
        output=dict(name="log_probs", shape=[1, "ceil(L/2)", len(ck["vocab"])], dtype="float32", kind="log-softmax"),
        vocab=ck["vocab"], blank_id=0, frame_rate_hz=50, frame_hop_samples=320,
        frame_alignment="output frame i is centred at input sample 320*i (0.02*i s)",
        max_frames=1500, max_seconds=30,
        teacher="facebook/wav2vec2-lv-60-espeak-cv-ft (Apache-2.0), targets = teacher posteriors summed onto this phone set",
        init="vb223/whisper-base-en-phoneme-ctc (MIT; encoder from openai/whisper base.en, MIT)",
        phone_set_notes="IPA (espeak en-us style). r-coloured vowels are single tokens (ɑːɹ ɔːɹ ɛɹ ɪɹ ʊɹ oːɹ aɪɚ); "
                        "ɾ = flap / Japanese r; ɯ e o a eː oː aː = Japanese-style vowels; ɕ tɕ dʑ ts ɸ = Japanese consonants. "
                        "See tools/model/distill/README.md for the ARPAbet mapping.",
        verify=res,
    )
    (out / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print("wrote", out / "metadata.json")


if __name__ == "__main__":
    main()
