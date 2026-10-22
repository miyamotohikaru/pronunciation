"""Round 5: curriculum items rendered by Kokoro voices (labels by construction) - per confusion family.

    python eval_curriculum.py <part> <teacher_stored,vb223,ckpt:...,onnx:...> [tag] [--types-from <report.json>]

For every focus phone of every clip (meta.site_info):
  correct site      -> 'faithful' if the model outputs the phone that was synthesised
  substituted site  -> 'faithful' (output = the substitute that was synthesised), 'autocorrect' (output = the
                       canonical phone of the word), else 'other'.  EPEN: any vowel at the inserted position.
Reported per family: R/L, TH, DH, V/B, F/H, æ/ʌ/ɑ (+AO/OW), tense-lax (IY/IH, UH/UW), ER, EPEN.
"""
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ctc_greedy  # noqa: E402
from dataset import Part  # noqa: E402
from evaluate import VOWELS, aligned_at, make_runners  # noqa: E402
import phoneset as P  # noqa: E402

ACCEPT = {"æ": {"æ"}, "ʌ": {"ʌ", "ɐ", "ə"}, "ə": {"ə", "ɐ", "ʌ"}, "ɑː": {"ɑː", "ɑ"}, "ɒ": {"ɒ", "ɑ", "ɑː", "ɔ"},
          "ɔː": {"ɔː", "ɔ"}, "oʊ": {"oʊ", "o", "oː"}, "uː": {"uː", "u"}, "ʊ": {"ʊ"}, "iː": {"iː", "i"}, "i": {"i", "iː"},
          "ɪ": {"ɪ", "ᵻ"}, "ɛ": {"ɛ"}, "eɪ": {"eɪ", "e", "eː"}, "ɜː": {"ɜː", "ɚ"}, "ɚ": {"ɚ", "ɜː"}, "t": {"t", "ɾ", "ʔ"},
          "d": {"d", "ɾ"}, "b": {"b", "β"}, "ʃ": {"ʃ", "ɕ"}, "tʃ": {"tʃ", "tɕ"}, "dʒ": {"dʒ", "dʑ"}, "h": {"h", "ç", "x"},
          "f": {"f", "ɸ"}}
FAMILY = [("R/L", {"R", "L"}), ("TH", {"TH", "S"}), ("DH", {"DH", "Z", "D"}), ("V/B", {"V", "B"}), ("F/H", {"F", "HH"}),
          ("ae/uh/aa", {"AE", "AH", "AA", "AO", "OW"}), ("tense-lax", {"IY", "IH", "UH", "UW"}), ("ER", {"ER"})]


def family(phone, watch):
    if watch == "EPEN":
        return "EPEN"
    for name, s in FAMILY:
        if phone in s and (watch is None or watch in s or name == "ER"):
            return name
    return "other"


def acc(p):
    return ACCEPT.get(p, {p})


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    part = Part(args[0])
    spec = args[1]
    tag = args[2] if len(args) > 2 else "cur"
    runners = [("teacher", None)] if "teacher_stored" in spec.split(",") else []
    rest = ",".join(x for x in spec.split(",") if x != "teacher_stored")
    runners += [(r.name, r) for r in (make_runners(rest) if rest else [])]
    report = {}
    for name, r in runners:
        agg = collections.defaultdict(collections.Counter)
        types = collections.defaultdict(collections.Counter)
        for i, it in enumerate(part.items):
            meta = it.get("meta") or {}
            info = meta.get("site_info")
            if not info or "truth" not in it:
                continue
            truth = [P.STUDENT_VOCAB[k] for k in it["truth"]]
            if r is None:
                hyp = it["greedy"].split()
            elif name == "vb223":
                hyp = r.decode(part.get(i)[0])
            else:
                hyp = [r.vocab[k] for k in ctc_greedy(r.logprobs(part.get(i)[0]).argmax(-1).tolist(), 0)]
            al = aligned_at(truth, hyp)
            for s in info:
                h = al[s["site"]] if s["site"] < len(al) else None
                fam = family(s["phone"], s["watch"])
                if s["watch"] == "EPEN":
                    res = "faithful" if (h is not None and h in VOWELS) else "autocorrect"
                elif h is not None and h in acc(s["produced"]):
                    res = "faithful"
                elif s["watch"] is not None and h is not None and h in acc(s["canonical"]):
                    res = "autocorrect"
                else:
                    res = "other"
                kind = "sub" if s["watch"] else "correct"
                agg[(kind, fam)][res] += 1
                agg[(kind, "ALL")][res] += 1
                if s["watch"]:
                    types[f"{s['phone']}->{s['watch']}"][res] += 1
        report[name] = {f"{k[0]}|{k[1]}": dict(v) for k, v in sorted(agg.items())}
        report[name + "::types"] = {k: dict(v) for k, v in sorted(types.items())}
        print(f"\n== {name}")
        for k, c in sorted(agg.items()):
            n = sum(c.values())
            print(f"  {k[0]:7s} {k[1]:10s} n={n:5d} faithful={c['faithful'] / n:.3f} autocorrect={c['autocorrect'] / n:.3f}")
    out = WORK / "eval" / f"{tag}_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print("wrote", out)


if __name__ == "__main__":
    main()
