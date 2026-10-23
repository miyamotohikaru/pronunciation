"""Step 1: is the lv-60 teacher reliable on native speech for θ ð ɹ v æ (and friends)?

LibriSpeech (CC BY 4.0) utterances -> teacher greedy phones (argmax of the student-space marginal)
vs CMUdict canonical phones. Native readers mostly say the canonical phone for these consonants,
so per-phone recall/precision against canonical is a fair (slightly pessimistic) reliability estimate.

    python teacher_check.py [n_per_split]
"""
import collections
import json
import re
import sys
import time

import numpy as np
import pyarrow.parquet as pq
import torch

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from common import WORK, PROJECT, Teacher, align_pairs, ctc_greedy, decode_audio, edit_distance  # noqa: E402
import phoneset as P  # noqa: E402

FOCUS = ["θ", "ð", "ɹ", "v", "æ", "b", "f", "s", "z", "l", "ʃ", "d", "t", "ʌ", "ɑː", "ɪ", "iː", "ɛ", "w", "h"]
EXPAND = {"ɑːɹ": ["ɑː", "ɹ"], "ɔːɹ": ["ɔː", "ɹ"], "ɛɹ": ["ɛ", "ɹ"], "ɪɹ": ["ɪ", "ɹ"], "ʊɹ": ["ʊ", "ɹ"],
          "oːɹ": ["oʊ", "ɹ"], "aɪɚ": ["aɪ", "ɚ"], "aɪə": ["aɪ", "ə"], "iə": ["i", "ə"], "əl": ["ə", "l"]}


def expand(seq):
    out = []
    for p in seq:
        out += EXPAND.get(p, [p])
    return out


def load_cmudict():
    d = {}
    for line in open(PROJECT / ".work" / "cmudict.dict"):
        parts = line.split("#")[0].split()
        if not parts or "(" in parts[0]:
            continue
        d[parts[0]] = parts[1:]
    return d


def canonical(text, cmu):
    words = re.findall(r"[a-z']+", text.lower())
    phones = []
    for w in words:
        if w not in cmu:
            return None
        phones += P.arpa_to_ipa(cmu[w], merge_coda_r=False)
    return phones


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    cmu = load_cmudict()
    teacher = Teacher("mps", torch.float32)
    tmap = torch.tensor(P.teacher_map_matrix(teacher.vocab))
    V = len(P.STUDENT_VOCAB)
    conf = collections.defaultdict(collections.Counter)   # canonical -> hyp counter
    hyp_tot = collections.Counter()
    hyp_ok = collections.Counter()
    errs = toks = 0
    examples = []
    t0 = time.time()
    raw = WORK / "raw" / "openslr__librispeech_asr" / "all"
    for split in ["validation.clean", "validation.other"]:
        pf = pq.ParquetFile(raw / split / "0000.parquet")
        rows = []
        for rg in range(pf.num_row_groups):
            rows += pf.read_row_group(rg, columns=["audio", "text", "speaker_id"]).to_pylist()
            if len(rows) >= n * 3:
                break
        # spread over speakers: take every 3rd utterance
        rows = rows[::3][:n]
        used = 0
        for r in rows:
            ref = canonical(r["text"], cmu)
            if ref is None:
                continue
            a = decode_audio(r["audio"]["bytes"])
            lp = teacher.logprobs(a)                                   # [M, 392]
            pm = torch.zeros(lp.shape[0], V).index_add_(1, tmap, lp.exp())
            hyp = [P.STUDENT_VOCAB[i] for i in ctc_greedy(pm.argmax(-1).tolist(), 0)]
            hyp = expand(hyp)
            errs += edit_distance(ref, hyp)
            toks += len(ref)
            for c, h in align_pairs(ref, hyp):
                if c is not None:
                    conf[c][h or "∅"] += 1
                if h is not None:
                    hyp_tot[h] += 1
                    hyp_ok[h] += (c == h)
            if len(examples) < 6:
                examples.append((r["text"], " ".join(ref), " ".join(hyp)))
            used += 1
        print(f"{split}: {used} utterances", flush=True)
    print(f"elapsed {time.time() - t0:.0f}s; PER vs CMUdict canonical: {errs / toks:.3f} ({toks} phones)")
    report = {"per_vs_canonical": errs / toks, "n_phones": toks, "phones": {}}
    for p in FOCUS:
        c = conf[p]
        tot = sum(c.values())
        rec = c[p] / max(tot, 1)
        prec = hyp_ok[p] / max(hyp_tot[p], 1)
        top = [(h, round(k / tot, 3)) for h, k in c.most_common(6) if h != p][:5]
        report["phones"][p] = {"n": tot, "recall": rec, "precision": prec, "confusions": top}
        print(f"{p:3s} n={tot:5d} recall={rec:.3f} precision={prec:.3f}  confusions={top}")
    for e in examples:
        print("\n" + e[0] + "\n  ref: " + e[1] + "\n  hyp: " + e[2])
    out = WORK / "eval" / "teacher_check_librispeech.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print("wrote", out)


if __name__ == "__main__":
    main()
