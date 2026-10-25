"""Round 4: æ/ʌ/ɑ and v/b minimal pairs synthesised by Kokoro (labels by construction).

    python eval_pairs.py <part> <runner spec: teacher_stored,vb223,ckpt:...,onnx:...>  [tag]

'teacher_stored' reads the teacher's greedy output saved by label.py (no re-run).
At the tested phone (item['sites'][0]) the model output is scored as
  faithful     = the phone that was synthesised (e.g. ʌ when 'map' was rendered as mˈʌp)
  autocorrect  = the word's canonical phone (æ for 'map') although something else was produced
  other        = anything else / deleted
grouped by (canonical -> produced), context (isolated word vs carrier phrase) and accent (US/UK voice).
"""
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK  # noqa: E402
from dataset import Part  # noqa: E402
from evaluate import aligned_at, make_runners  # noqa: E402
import phoneset as P  # noqa: E402

ACCEPT = {"æ": {"æ"}, "ʌ": {"ʌ", "ɐ", "ə"}, "ɑː": {"ɑː", "ɑ"}, "ɒ": {"ɒ", "ɑ", "ɑː", "ɔ"}, "a": {"a"},
          "o": {"o", "oː"}, "v": {"v"}, "b": {"b", "β"}}


def score(truth_toks, site, hyp, produced, intended, sub):
    al = aligned_at(truth_toks, hyp)
    h = al[site] if site < len(al) else None
    if h is not None and h in ACCEPT.get(produced, {produced}):
        return "faithful", h
    if sub and h is not None and h in ACCEPT.get(intended, {intended}):
        return "autocorrect", h
    return "other", h or "∅"


def main():
    part = Part(sys.argv[1])
    spec = sys.argv[2]
    tag = sys.argv[3] if len(sys.argv) > 3 else "pairs"
    runners = []
    if "teacher_stored" in spec.split(","):
        runners.append(("teacher", None))
    rest = ",".join(x for x in spec.split(",") if x != "teacher_stored")
    runners += [(r.name, r) for r in (make_runners(rest) if rest else [])]
    report = {}
    for name, r in runners:
        agg = collections.defaultdict(collections.Counter)
        outs = collections.defaultdict(collections.Counter)
        for i, it in enumerate(part.items):
            if "sites" not in it:
                continue
            meta = it["meta"]
            truth = [P.STUDENT_VOCAB[k] for k in it["truth"]]
            if r is None:
                hyp = it["greedy"].split()
            else:
                a, _ = part.get(i)
                hyp = r.decode(a) if name == "vb223" else [r.vocab[k] for k in __import__("common").ctc_greedy(
                    r.logprobs(a).argmax(-1).tolist(), 0)]
            res, h = score(truth, it["sites"][0], hyp, meta["produced_phone"], meta["intended"], meta["sub"])
            grp = "vb" if meta["kind"].startswith("mp_vb") else "vowel"
            agg[(grp, "sub" if meta["sub"] else "correct", meta.get("context", ""))][res] += 1
            agg[(grp, f"{meta['intended']}->{meta['produced_phone']}", "")][res] += 1
            if meta["kind"] == "mp_vb_phrase":
                agg[(grp, "phrase_" + ("sub" if meta["sub"] else "correct"), "")][res] += 1
            outs[f"{meta['intended']}->{meta['produced_phone']}"][h] += 1
        report[name] = {f"{k[0]}|{k[1]}|{k[2]}": dict(v) for k, v in sorted(agg.items())}
        report[name + "::outputs"] = {k: dict(v.most_common(6)) for k, v in outs.items()}
        print(f"\n== {name}")
        for k, c in sorted(agg.items()):
            n = sum(c.values())
            print(f"  {k[0]:5s} {k[1]:16s} {k[2]:9s} n={n:4d} faithful={c['faithful'] / n:.2f} autocorrect={c['autocorrect'] / n:.2f}")
    out = WORK / "eval" / f"{tag}_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print("wrote", out)


if __name__ == "__main__":
    main()
