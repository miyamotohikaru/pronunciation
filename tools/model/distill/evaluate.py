"""Evaluation: targeted `say` tests, speechocean762 MDD, held-out student-vs-teacher PER/KL.

    python evaluate.py say    teacher,vb223,ckpt:<path>[,onnx:<path>]
    python evaluate.py mdd    teacher,vb223,ckpt:<path>   [n_utts]
    python evaluate.py heldout ckpt:<path> <part,...>
"""
import collections
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from common import SR, VB223_DIR, WORK, Teacher, align_pairs, ctc_greedy, decode_audio, edit_distance, log_mel  # noqa: E402
import phoneset as P  # noqa: E402

EXPAND = {"ɑːɹ": ["ɑː", "ɹ"], "ɔːɹ": ["ɔː", "ɹ"], "ɛɹ": ["ɛ", "ɹ"], "ɪɹ": ["ɪ", "ɹ"], "ʊɹ": ["ʊ", "ɹ"],
          "oːɹ": ["oʊ", "ɹ"], "aɪɚ": ["aɪ", "ɚ"], "aɪə": ["aɪ", "ə"], "iə": ["i", "ə"], "əl": ["ə", "l"]}
VOWELS = set(P.VOWELS) | {"ɑː", "ɔː", "oʊ", "i", "ə"}


def expand(seq):
    out = []
    for p in seq:
        out += EXPAND.get(p, [p])
    return out


# ----------------------------------------------------------------------------- model runners

class TeacherRunner:
    name = "teacher"

    def __init__(self):
        self.t = Teacher("mps", torch.float32)
        self.tmap = torch.tensor(P.teacher_map_matrix(self.t.vocab))

    def logprobs(self, a):
        lp = self.t.logprobs(a)
        V = len(P.STUDENT_VOCAB)
        return torch.zeros(lp.shape[0], V).index_add_(1, self.tmap, lp.exp()).clamp_min(1e-8).log()

    def decode(self, a):
        return expand([P.STUDENT_VOCAB[i] for i in ctc_greedy(self.logprobs(a).argmax(-1).tolist(), 0)])


class StudentRunner:
    def __init__(self, path, device="cpu"):
        from model import Student
        ck = torch.load(path, map_location="cpu")
        self.vocab = ck["vocab"]
        self.m = Student(len(self.vocab))
        self.m.load_state_dict(ck["model"])
        self.m.eval().to(device)
        self.device = device
        self.name = "student:" + Path(path).parent.name + "/" + Path(path).stem

    @torch.no_grad()
    def logprobs(self, a):
        mel = log_mel(torch.from_numpy(np.asarray(a, dtype=np.float32)))[None].to(self.device)
        return torch.log_softmax(self.m(mel)[0].float(), -1).cpu()

    def decode(self, a):
        return expand([self.vocab[i] for i in ctc_greedy(self.logprobs(a).argmax(-1).tolist(), 0)])


class OnnxRunner:
    def __init__(self, path):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = 4
        self.s = ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
        meta = json.loads((Path(path).parent / "metadata.json").read_text())
        self.vocab = meta["vocab"]
        self.name = "onnx:" + Path(path).name

    def logprobs(self, a):
        mel = log_mel(torch.from_numpy(np.asarray(a, dtype=np.float32)))[None].numpy()
        return torch.from_numpy(self.s.run(None, {"mel": mel})[0][0])

    def decode(self, a):
        return expand([self.vocab[i] for i in ctc_greedy(self.logprobs(a).argmax(-1).tolist(), 0)])


class Vb223Runner:
    """vb223 as designed: 30-s padded log-mel, ARPAbet CTC; output mapped to IPA."""
    name = "vb223"

    def __init__(self):
        import torch.nn as nn
        from safetensors.torch import load_file
        from whisper.model import AudioEncoder
        from model import vb223_token_to_ipa
        cfg = json.loads((VB223_DIR / "config.json").read_text())

        class M(nn.Module):
            def __init__(s):
                super().__init__()
                s.encoder = AudioEncoder(cfg["n_mels"], cfg["n_audio_ctx"], cfg["n_audio_state"], cfg["n_audio_head"], cfg["n_audio_layer"])
                L, w = [], cfg["n_audio_state"]
                for h in cfg["head_hidden_sizes"]:
                    L += [nn.Linear(w, h), nn.GELU(), nn.Dropout(0.1)]
                    w = h
                L.append(nn.Linear(w, cfg["output_dim"]))
                s.phoneme_head = nn.Sequential(*L)

            def forward(s, mel):
                return s.phoneme_head(s.encoder(mel))

        self.m = M()
        self.m.load_state_dict(load_file(str(VB223_DIR / "model.safetensors")), strict=True)
        self.m.eval()
        self.vocab = cfg["vocab"]
        self.ipa = [vb223_token_to_ipa(a) if a not in ("<pad>", "<unk>") else None for a in self.vocab]

    @torch.no_grad()
    def decode(self, a):
        import whisper
        a = torch.from_numpy(np.asarray(a, dtype=np.float32))
        mel = whisper.log_mel_spectrogram(whisper.pad_or_trim(a), n_mels=80)[None]
        lp = self.m(mel)[0]
        frames = min(int(len(a) / SR * 50) + 1, lp.shape[0])
        ids = ctc_greedy(lp[:frames].argmax(-1).tolist(), 0)
        return [self.ipa[i] for i in ids if self.ipa[i] is not None]


def make_runners(spec):
    out = []
    for s in spec.split(","):
        if s == "teacher":
            out.append(TeacherRunner())
        elif s == "vb223":
            out.append(Vb223Runner())
        elif s.startswith("ckpt:"):
            out.append(StudentRunner(s[5:]))
        elif s.startswith("onnx:"):
            out.append(OnnxRunner(s[5:]))
    return out


# ----------------------------------------------------------------------------- targeted tests

ACCEPT = {"d": {"d", "ɾ"}, "t": {"t", "ɾ", "ʔ"}, "b": {"b", "β"}, "ʌ": {"ʌ", "ə", "ɐ"}, "iː": {"iː", "i"},
          "ɪ": {"ɪ", "ᵻ"}, "ə": {"ə", "ɐ", "ʌ"}, "ʃ": {"ʃ", "ɕ"}, "s": {"s"}, "θ": {"θ"}, "ð": {"ð"}, "ɹ": {"ɹ"},
          "l": {"l"}, "v": {"v"}, "z": {"z"}, "æ": {"æ"}}
EXTRA_INTENDED = {"I like rice": "aɪ l aɪ k ɹ aɪ s", "big": "b ɪ ɡ", "bed": "b ɛ d"}


def accept(p):
    return ACCEPT.get(p, {p})


def n_vowels(seq):
    return sum(1 for p in seq if p in VOWELS)


def aligned_at(ref, hyp):
    """For each ref index -> aligned hyp symbol (None = deleted). Alignment on coarse classes."""
    rc = [P.coarse(p) for p in ref]
    hc = [P.coarse(p) for p in hyp]
    out, i, j = [], 0, 0
    for r, h in align_pairs(rc, hc):
        if r is not None:
            out.append(hyp[j] if h is not None else None)
            i += 1
        if h is not None:
            j += 1
    return out


def score_item(it, hyp):
    """-> list of (check_name, result) with result in {'faithful','autocorrect','other'}."""
    res = []
    intended = (it.get("intended") or EXTRA_INTENDED.get(it.get("english", ""), "")).split()
    produced = it["produced"].split()
    if it["kind"] in ("native_ok", "native_err"):
        if it["cat"] == "epen":
            nv = n_vowels(hyp)
            if it["kind"] == "native_ok":
                res.append(("epen", "faithful" if nv <= n_vowels(intended) else "other"))
            else:
                res.append(("epen", "faithful" if nv > n_vowels(intended) else "autocorrect"))
            return res
        diff = [k for k, (a, b) in enumerate(zip(intended, produced)) if a != b] if len(intended) == len(produced) else []
        al = aligned_at(produced, hyp)
        for k in diff:
            h = al[k]
            want = produced[k] if it["kind"] == "native_err" else intended[k]
            other = intended[k] if it["kind"] == "native_err" else produced[k]
            if h is not None and h in accept(want):
                res.append((it["cat"], "faithful"))
            elif h is not None and h in accept(other):
                res.append((it["cat"], "autocorrect"))
            else:
                res.append((it["cat"], "other"))
        return res
    # ja_kana
    al = aligned_at(intended, hyp) if intended else []
    for c in it["checks"]:
        if c[0] == "not":
            h = al[c[1]] if c[1] < len(al) else None
            res.append((it["cat"] + "/sub", "autocorrect" if (h is not None and h in set(c[2])) else "faithful"))
        else:
            res.append(("epen", "faithful" if n_vowels(hyp) > c[1] else "autocorrect"))
    return res


def run_say(runners, items_path=None, tag="say"):
    items = json.loads(Path(items_path or WORK / "eval" / "say" / "items.json").read_text())
    report = {}
    detail = collections.defaultdict(dict)
    for r in runners:
        agg = collections.defaultdict(collections.Counter)
        t0 = time.time()
        for it in items:
            a = decode_audio(str(WORK / it["path"]))
            hyp = r.decode(a)
            detail[it["path"]][r.name] = " ".join(hyp)
            for name, res in score_item(it, hyp):
                agg[(it["kind"], name)][res] += 1
        report[r.name] = {f"{k[0]}|{k[1]}": dict(v) for k, v in sorted(agg.items())}
        print(f"\n== {r.name} ({time.time() - t0:.0f}s)")
        for (kind, name), c in sorted(agg.items()):
            n = sum(c.values())
            print(f"  {kind:10s} {name:12s} n={n:3d} faithful={c['faithful'] / n:.2f} autocorrect={c['autocorrect'] / n:.2f} other={c['other'] / n:.2f}")
        tot = collections.Counter()
        for (kind, name), c in agg.items():
            tot[kind + "_f"] += c["faithful"]
            tot[kind + "_n"] += sum(c.values())
        print("  overall: " + "  ".join(f"{k}={tot[k + '_f'] / max(tot[k + '_n'], 1):.3f}" for k in ["native_ok", "native_err", "ja_kana"]))
    out = WORK / "eval" / f"{tag}_report.json"
    out.write_text(json.dumps(dict(summary=report, detail=detail), ensure_ascii=False, indent=1))
    print("wrote", out)
    return report


# ----------------------------------------------------------------------------- speechocean762 MDD

def run_mdd(runners, n_utts=1000, split="test"):
    import pyarrow.parquet as pq
    pf = pq.ParquetFile(WORK / "raw" / "mispeech__speechocean762" / "data" / f"{split}-00000-of-00001.parquet")
    rows = []
    for rg in range(pf.num_row_groups):
        rows += pf.read_row_group(rg, columns=["audio", "words", "text", "speaker"]).to_pylist()
    rows = rows[:: max(1, len(rows) // n_utts)][:n_utts]
    report = {}
    for r in runners:
        c = collections.Counter()
        diag = collections.Counter()
        confusions = collections.defaultdict(collections.Counter)
        t0 = time.time()
        for row in rows:
            ref, acc, mis = [], [], {}
            for wi, w in enumerate(row["words"]):
                ipa = P.arpa_to_ipa(w["phones"], merge_coda_r=False)
                for pi, (p, s) in enumerate(zip(ipa, w["phones-accuracy"])):
                    mis_key = len(ref)
                    ref.append(p)
                    acc.append(s)
                for m in w["mispronunciations"] or []:
                    pp = m["pronounced-phone"]
                    if pp in ("<unk>",) or "*" in pp:
                        continue
                    k0 = len(ref) - len(ipa) + m["index"]
                    if pp == "<DEL>":
                        mis[k0] = None
                    else:
                        try:
                            mis[k0] = P.arpa_to_ipa(pp.split(), merge_coda_r=False)[0]
                        except KeyError:
                            pass
            a = decode_audio(row["audio"]["bytes"])
            hyp = r.decode(a)
            al = aligned_at(ref, hyp)
            for k, (p, s, h) in enumerate(zip(ref, acc, al)):
                det = h is None or P.coarse(h) != P.coarse(p)
                if s < 0.5:
                    c["err_n"] += 1
                    c["err_det"] += det
                elif s >= 1.5:
                    c["ok_n"] += 1
                    c["ok_det"] += det
                if k in mis:
                    want = mis[k]
                    diag["n"] += 1
                    if want is None:
                        diag["hit"] += h is None
                    else:
                        diag["hit"] += h is not None and P.coarse(h) == P.coarse(want)
                    diag["canon"] += h is not None and P.coarse(h) == P.coarse(p)
                    confusions[f"{p}->{want}"][h or "∅"] += 1
        rec = c["err_det"] / max(c["err_n"], 1)
        far = c["ok_det"] / max(c["ok_n"], 1)
        prec = c["err_det"] / max(c["err_det"] + c["ok_det"], 1)
        f1 = 2 * prec * rec / max(prec + rec, 1e-9)
        report[r.name] = dict(recall=rec, false_alarm=far, precision=prec, f1=f1, n_err=c["err_n"], n_ok=c["ok_n"],
                              diag_n=diag["n"], diag_acc=diag["hit"] / max(diag["n"], 1),
                              canon_rate=diag["canon"] / max(diag["n"], 1))
        print(f"== {r.name} ({time.time() - t0:.0f}s): error recall {rec:.3f}  false-alarm {far:.3f}  precision {prec:.3f}  F1 {f1:.3f}  "
              f"| annotated substitutions/deletions n={diag['n']}: model shows produced phone {diag['hit'] / max(diag['n'], 1):.3f}, "
              f"shows canonical {diag['canon'] / max(diag['n'], 1):.3f}", flush=True)
    out = WORK / "eval" / f"mdd_{split}_report.json"
    old = json.loads(out.read_text()) if out.exists() else {}
    old.update(report)
    out.write_text(json.dumps(old, ensure_ascii=False, indent=1))
    return report


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "say":
        run_say(make_runners(sys.argv[2]), sys.argv[3] if len(sys.argv) > 3 else None,
                tag=sys.argv[4] if len(sys.argv) > 4 else "say")
    elif cmd == "mdd":
        run_mdd(make_runners(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 1000)
