"""Held-out agreement report: student (and vb223) vs teacher, plus Kokoro held-out voices vs the known phones.

    python final_eval.py <ckpt.pt|onnx:path> [parts]      -> eval/heldout_<tag>.json

PER here is on the comparison alphabet (eval_saa.norm: r-coloured tokens expanded, coarse vowel classes,
repeats merged) so that vb223 (ARPAbet, no ɾ/ɐ/...) and the student are compared on equal terms.
'fine PER' is the student's PER on its own 79-token alphabet against the teacher's greedy output.
Frame KL(teacher || student) is reported for the student.
"""
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ctc_greedy, edit_distance  # noqa: E402
from dataset import Part  # noqa: E402
from eval_saa import norm  # noqa: E402
from evaluate import OnnxRunner, StudentRunner, Vb223Runner  # noqa: E402
import phoneset as P  # noqa: E402

DEFAULT_PARTS = "ls_testclean,so_test2,globe_test2,kokoro_heldout,globe_ja,edacc_ja,edacc_ko,edacc_zh"


def main():
    spec = sys.argv[1]
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    parts = (args[1] if len(args) > 1 else DEFAULT_PARTS).split(",")
    tag = args[2] if len(args) > 2 else Path(spec.replace("onnx:", "")).parent.name
    student = OnnxRunner(spec[5:]) if spec.startswith("onnx:") else StudentRunner(spec)
    vb = None if "--no-vb223" in sys.argv else Vb223Runner()   # vb223 numbers do not depend on the student
    out = {}
    for name in parts:
        d = WORK / "data" / name
        if not (d / "index.jsonl").exists():
            print("skip (not labelled):", name)
            continue
        part = Part(name)
        n = len(part.items)
        idx = range(n) if n <= 400 else np.linspace(0, n - 1, 400).astype(int)
        acc = dict(fine_err=0, fine_n=0, s_err=0, v_err=0, n=0, kl=0.0, frames=0, truth_n=0, t_truth=0, s_truth=0, v_truth=0)
        for i in idx:
            it = part.items[i]
            a, post = part.get(int(i))
            if len(a) > 1490 * 320:          # student positional embedding covers 30 s
                a, post = a[: 1490 * 320], post[:1490]
            post = torch.from_numpy(post)
            lp = student.logprobs(a)
            m = min(lp.shape[0], post.shape[0])
            acc["kl"] += float((post[:m].exp() * (post[:m] - lp[:m])).sum(-1).sum())
            acc["frames"] += m
            t_ids = ctc_greedy(post.argmax(-1).tolist(), 0)
            s_ids = ctc_greedy(lp.argmax(-1).tolist(), 0)
            acc["fine_err"] += edit_distance(t_ids, s_ids)
            acc["fine_n"] += len(t_ids)
            t = norm([P.STUDENT_VOCAB[k] for k in t_ids])
            s = norm([student.vocab[k] for k in s_ids])
            v = norm(vb.decode(a)) if vb else t
            acc["s_err"] += edit_distance(t, s)
            acc["v_err"] += edit_distance(t, v)
            acc["n"] += len(t)
            if "truth" in it:   # Kokoro: what was actually synthesised
                tr = norm([P.STUDENT_VOCAB[k] for k in it["truth"]])
                acc["truth_n"] += len(tr)
                acc["t_truth"] += edit_distance(tr, t)
                acc["s_truth"] += edit_distance(tr, s)
                acc["v_truth"] += edit_distance(tr, v)
        r = dict(utts=len(idx), hours=round(sum(part.items[int(i)]["a_len"] for i in idx) / 16000 / 3600, 3),
                 student_vs_teacher_per=acc["s_err"] / max(acc["n"], 1), vb223_vs_teacher_per=acc["v_err"] / max(acc["n"], 1),
                 student_fine_per=acc["fine_err"] / max(acc["fine_n"], 1), frame_kl=acc["kl"] / max(acc["frames"], 1))
        if acc["truth_n"]:
            r.update(teacher_vs_truth_per=acc["t_truth"] / acc["truth_n"], student_vs_truth_per=acc["s_truth"] / acc["truth_n"],
                     vb223_vs_truth_per=acc["v_truth"] / acc["truth_n"])
        out[name] = r
        print(name, {k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()}, flush=True)
    (WORK / "eval" / f"heldout_{tag}.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
