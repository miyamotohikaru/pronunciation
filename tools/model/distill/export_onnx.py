"""Export the distilled student to ONNX and verify every variant against PyTorch.

    .venv/bin/python tools/model/distill/export_onnx.py <ckpt.pt> [out_dir] [--q4-block 32]

Variants (same graph contract as tools/model/export for vb223):
    student.fp32.onnx   reference
    student.int8w.onnx  weight-only int8 (per-channel symmetric int8 + DequantizeLinear, fp32 compute)  <- ship
                        load with session option session.disable_quant_qdq=1 (DequantizeLinear folded at load)
    student.q4.onnx     4-bit weight-only (MatMulNBits, block-wise symmetric) + int8w for Conv / positional emb.
    student.int8.onnx   dynamic int8 (activations quantised at run time) - reference only
    student.fp16.onnx   fp16 weights + compute (WebGPU) - reference only

Graph: mel [1, 80, L] float32 (whisper log-mel of the real audio, no 30-s padding)
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
from onnx import helper, numpy_helper

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ctc_greedy, decode_audio, edit_distance, log_mel  # noqa: E402
from model import Student, count_params  # noqa: E402

SESSION_CONFIG = {"int8w": {"session.disable_quant_qdq": "1"}, "q4": {"session.disable_quant_qdq": "1"}}


class Wrapper(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, mel):
        return torch.log_softmax(self.m(mel), dim=-1)


def weight_only_int8(src, dst, min_size=4096):
    """Every remaining fp32 MatMul / Conv weight and the positional embedding -> symmetric per-channel int8
    + DequantizeLinear (MatMul [in,out]: per output column; Conv [out,in,k]: per output channel)."""
    m = onnx.load(str(src))
    g = m.graph
    # large fp32 Constant nodes (the positional embedding is exported as one) -> initializers first
    keep_nodes = []
    for n in g.node:
        if n.op_type == "Constant" and len(n.output) == 1:
            val = next((a.t for a in n.attribute if a.name == "value"), None)
            if val is not None:
                arr = numpy_helper.to_array(val)
                if arr.dtype == np.float32 and arr.size >= min_size:
                    g.initializer.append(numpy_helper.from_array(arr, n.output[0]))
                    continue
        keep_nodes.append(n)
    del g.node[:]
    g.node.extend(keep_nodes)
    users = {}
    for n in g.node:
        for k, x in enumerate(n.input):
            users.setdefault(x, []).append((n.op_type, k))
    new_inits, new_nodes, drop = [], [], set()
    for t in g.initializer:
        w = numpy_helper.to_array(t)
        if w.dtype != np.float32 or w.size < min_size:
            continue
        ops = set(users.get(t.name, []))
        if ops and ops <= {("MatMul", 1)} and w.ndim == 2:
            axis = 1
        elif ops and ops <= {("Conv", 1)} and w.ndim == 3:
            axis = 0
        elif w.ndim == 2:          # positional embedding [ctx, state]
            axis = 1
        else:
            continue
        red = tuple(i for i in range(w.ndim) if i != axis)
        scale = (np.abs(w).max(axis=red) / 127.0).astype(np.float32)
        scale[scale == 0] = 1.0
        shape = [1] * w.ndim
        shape[axis] = -1
        q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
        new_inits += [numpy_helper.from_array(q, t.name + "_q"), numpy_helper.from_array(scale, t.name + "_scale"),
                      numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), t.name + "_zp")]
        new_nodes.append(helper.make_node("DequantizeLinear", [t.name + "_q", t.name + "_scale", t.name + "_zp"], [t.name],
                                          name=t.name + "_dq", axis=axis))
        drop.add(t.name)
    kept = [t for t in g.initializer if t.name not in drop]
    del g.initializer[:]
    g.initializer.extend(kept + new_inits)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(new_nodes + nodes)
    onnx.checker.check_model(m)
    onnx.save(m, str(dst))
    return len(drop)


def export(ckpt, out, q4_block=32):
    ck = torch.load(ckpt, map_location="cpu")
    m = Student(len(ck["vocab"]))
    m.load_state_dict(ck["model"])
    m.eval()
    w = Wrapper(m).eval()
    paths = {k: out / f"student.{k}.onnx" for k in ["fp32", "int8w", "q4", "int8", "fp16"]}
    with torch.no_grad():
        torch.onnx.export(w, (torch.randn(1, 80, 400),), str(paths["fp32"]), input_names=["mel"], output_names=["log_probs"],
                          dynamic_axes={"mel": {0: "batch", 2: "mel_frames"}, "log_probs": {0: "batch", 1: "frames"}},
                          opset_version=17, do_constant_folding=True, dynamo=False)
    g = onnx.load(str(paths["fp32"]))
    onnx.checker.check_model(g)
    g.doc_string = "Phone posteriorgram student (whisper base.en encoder, distilled from wav2vec2-lv-60-espeak-cv-ft)"
    onnx.save(g, str(paths["fp32"]))
    n8 = weight_only_int8(paths["fp32"], paths["int8w"])
    # 4-bit: MatMulNBits for every MatMul with a constant weight, then int8w for the rest (Conv, positional emb.)
    from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer
    cfg = DefaultWeightOnlyQuantConfig(block_size=q4_block, is_symmetric=True, accuracy_level=4, bits=4)
    qz = MatMulNBitsQuantizer(onnx.load(str(paths["fp32"])), algo_config=cfg)
    qz.process()
    tmp = out / "_q4_tmp.onnx"
    qz.model.save_model_to_file(str(tmp), use_external_data_format=False)
    weight_only_int8(tmp, paths["q4"])
    tmp.unlink()   # intermediate file written by this script
    from onnxruntime.quantization import QuantType, quantize_dynamic
    quantize_dynamic(str(paths["fp32"]), str(paths["int8"]), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"],
                     per_channel=False, reduce_range=False)
    from onnxconverter_common import float16
    onnx.save(float16.convert_float_to_float16(onnx.load(str(paths["fp32"])), keep_io_types=True), str(paths["fp16"]))
    print(f"int8w: {n8} tensors quantised", flush=True)
    return w, ck, paths


def eval_clips():
    clips = []
    items = json.loads((WORK / "eval" / "say" / "items.json").read_text())
    clips += [decode_audio(str(WORK / it["path"])) for it in items[::29][:30]]
    for name in ["so_test2", "globe_test2", "kokoro_heldout", "ls_testclean", "edacc_ja"]:
        idx = [json.loads(l) for l in open(WORK / "data" / name / "index.jsonl")]
        aud = np.memmap(WORK / "data" / name / "audio.bin", dtype=np.int16, mode="r")
        for it in idx[:: max(1, len(idx) // 12)][:12]:
            clips.append(aud[it["a_off"]: it["a_off"] + min(it["a_len"], 16000 * 20)].astype(np.float32) / 32767)
    return clips


def session(p, name, threads):
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    for k, v in SESSION_CONFIG.get(name, {}).items():
        so.add_session_config_entry(k, v)
    return ort.InferenceSession(str(p), so, providers=["CPUExecutionProvider"])


def verify(w, paths):
    clips = eval_clips()
    mels = [log_mel(torch.from_numpy(a))[None] for a in clips]
    with torch.no_grad():
        refs = [w(m)[0].numpy() for m in mels]
    rng = np.random.default_rng(0)
    lat_mels = {sec: log_mel(torch.from_numpy(rng.standard_normal(16000 * sec).astype(np.float32) * 0.05))[None].numpy()
                for sec in (3, 8)}
    res = {}
    for name, p in paths.items():
        s = session(p, name, 4)
        maxd, agree, errs, toks = 0.0, [], 0, 0
        for mel, ref in zip(mels, refs):
            got = s.run(None, {"mel": mel.numpy()})[0][0]
            maxd = max(maxd, float(np.abs(np.exp(ref) - np.exp(got)).max()))
            agree.append(float((ref.argmax(-1) == got.argmax(-1)).mean()))
            r = ctc_greedy(ref.argmax(-1).tolist(), 0)
            h = ctc_greedy(got.argmax(-1).tolist(), 0)
            errs += edit_distance(r, h)
            toks += len(r)
        lat = {}
        for threads in (1, 4):
            s = session(p, name, threads)
            for sec, mel in lat_mels.items():
                s.run(None, {"mel": mel})
                ts = []
                for _ in range(7):
                    t0 = time.perf_counter()
                    s.run(None, {"mel": mel})
                    ts.append(time.perf_counter() - t0)
                lat[f"{sec}s_{threads}thr"] = round(1000 * float(np.median(ts)), 1)
        res[name] = dict(size_mb=round(p.stat().st_size / 1e6, 2), max_prob_diff=round(maxd, 4),
                         frame_argmax_agree=round(float(np.mean(agree)), 4),
                         greedy_per_vs_torch=round(errs / max(toks, 1), 4), latency_ms=lat)
        print(name, res[name], flush=True)
    return res


def main():
    ckpt = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else WORK / "export"
    q4_block = int(sys.argv[sys.argv.index("--q4-block") + 1]) if "--q4-block" in sys.argv else 32
    out.mkdir(parents=True, exist_ok=True)
    w, ck, paths = export(ckpt, out, q4_block)
    res = verify(w, paths)
    meta = dict(
        model="pronunciation phone-posteriorgram student (whisper base.en encoder + MLP CTC head)",
        checkpoint=str(ckpt), step=ck.get("step"), params=count_params(w.m),
        files={k: p.name for k, p in paths.items()}, recommended="int8w",
        session_config=SESSION_CONFIG,
        input=dict(name="mel", shape=[1, 80, "L"], dtype="float32",
                   features="whisper log-mel of the real audio (no 30-s padding): 16 kHz mono, n_fft 400, hop 160, "
                            "Hann window, centre=True (reflect pad), last STFT frame dropped -> L = n_samples // 160; "
                            "80 whisper mel filters (whisper/assets/mel_filters.npz); log10(max(mel,1e-10)); "
                            "clamp to (max over the utterance - 8); (x + 4) / 4"),
        output=dict(name="log_probs", shape=[1, "ceil(L/2)", len(ck["vocab"])], dtype="float32", kind="log-softmax"),
        vocab=ck["vocab"], blank_id=0, frame_rate_hz=50, frame_hop_samples=320,
        frame_alignment="output frame i is centred at input sample 320*i (0.02*i s)",
        max_frames=1500, max_seconds=30,
        teacher="facebook/wav2vec2-lv-60-espeak-cv-ft (Apache-2.0); targets = teacher posteriors summed onto this phone set",
        init="vb223/whisper-base-en-phoneme-ctc (MIT; encoder from openai/whisper base.en, MIT)",
        phone_set_notes="IPA (espeak en-us style). r-coloured vowels are single tokens (ɑːɹ ɔːɹ ɛɹ ɪɹ ʊɹ oːɹ aɪɚ); "
                        "ɾ = flap / Japanese r; ɯ e o a eː oː aː = Japanese-style vowels; ɕ tɕ dʑ ts ɸ = Japanese consonants. "
                        "Mapping tables: tools/model/distill/README.md",
        verify=res,
    )
    (out / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print("wrote", out / "metadata.json")


if __name__ == "__main__":
    main()
