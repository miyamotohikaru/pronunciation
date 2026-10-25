"""Speech Accent Archive (CC BY-NC-SA 2.0, EVAL ONLY): human narrow IPA of the 'Please call Stella' paragraph.

    python eval_saa.py teacher,vb223,ckpt:<path> [l1,l1,...]     (default: japanese,korean,mandarin,cantonese,english)

Per L1 group and model:
  * PER vs the human narrow transcription (after mapping both onto the comparison alphabet)
  * deviation test: where the human transcription differs from the native canonical (CMUdict) form,
    does the model output the phone the human heard (faithful) or the canonical one (autocorrect)?
    Substitutions and inserted vowels (epenthesis) are scored separately.
  * student-vs-teacher PER (agreement) when both are run.
"""
import collections
import json
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent))
from common import PROJECT, WORK, align_pairs, decode_audio, edit_distance  # noqa: E402
from evaluate import EXPAND, VOWELS, aligned_at, make_runners  # noqa: E402
import phoneset as P  # noqa: E402

PARAGRAPH = ("please call stella ask her to bring these things with her from the store six spoons of fresh snow peas "
             "five thick slabs of blue cheese and maybe a snack for her brother bob we also need a small plastic snake "
             "and a big toy frog for the kids she can scoop these things into three red bags and we will go meet her "
             "wednesday at the train station")
MODS = set("ʰʲʷˠˤːˑ˺ʼ˞ⁿˡ̚")
BASE = {"ɫ": "l", "ʍ": "w", "ɘ": "ə", "ɵ": "ə", "ʉ": "u", "ɨ": "ᵻ", "ɣ": "ɡ", "g": "ɡ", "ɟ": "ɡ", "c": "k", "ɴ": "n",
        "ɱ": "m", "ʋ": "v", "ɥ": "j", "ʎ": "l", "ɭ": "l", "ɻ": "ɹ", "ɽ": "ɾ", "ʂ": "ʃ", "ʐ": "ʒ", "ɖ": "d", "ʈ": "t",
        "ɳ": "n", "ʁ": "r", "χ": "x", "ħ": "h", "ɦ": "h", "ʕ": "h", "ⱱ": "v", "ɬ": "l", "ɮ": "l", "ʝ": "j", "ʡ": "ʔ",
        "ɝ": "ɚ", "ʑ": "dʑ", "ʙ": "b", "œ": "ə", "ø": "ə", "y": "y", "ɤ": "ʌ", "ɯ": "ɯ", "ɰ": "w", "ɺ": "ɾ", "ɹ̩": "ɚ",
        "ɜ": "ɜː", "ɞ": "ə", "æ": "æ", "ɶ": "a", "ä": "a", "ɛ": "ɛ", "ɪ": "ɪ", "ʊ": "ʊ", "ʌ": "ʌ", "ɔ": "ɔ",
        "ɒ": "ɒ", "ɑ": "ɑ", "ɐ": "ɐ", "ə": "ə", "ɚ": "ɚ"}
LONG_OK = {"iː", "uː", "ɑː", "ɔː", "ɜː", "aː", "eː", "oː"}
DIPH = {("a", "ɪ"): "aɪ", ("a", "i"): "aɪ", ("a", "ʊ"): "aʊ", ("a", "u"): "aʊ", ("e", "ɪ"): "eɪ", ("e", "i"): "eɪ",
        ("ɛ", "ɪ"): "eɪ", ("o", "ʊ"): "oʊ", ("o", "u"): "oʊ", ("ə", "ʊ"): "oʊ", ("ɔ", "ɪ"): "ɔɪ", ("ɔ", "i"): "ɔɪ",
        ("ɑ", "ɪ"): "aɪ", ("ʌ", "ɪ"): "aɪ"}
AFFR = {("t", "ʃ"): "tʃ", ("d", "ʒ"): "dʒ", ("t", "ɕ"): "tɕ", ("d", "dʑ"): "dʑ"}


def tokenize_ipa(s):
    """Narrow IPA string (no spaces) -> student-alphabet tokens."""
    raw, tie = [], False
    for ch in unicodedata.normalize("NFD", s):
        if ch.isspace() or ch in ".|‖-_ˈˌ'()[]/":
            continue
        if ch in "͜͡":
            tie = True
            continue
        if unicodedata.combining(ch) or ch in MODS:
            if raw:
                raw[-1] += ch
            continue
        if tie and raw:
            raw[-1] += ch
            tie = False
            continue
        raw.append(ch)
    toks = []
    for r in raw:
        base = "".join(c for c in r if not unicodedata.combining(c) and c not in MODS)
        long = "ː" in r
        b = BASE.get(base, base)
        if len(b) == 2 and b not in P.SID:     # tie-barred pair like 'ts' or 'tʃ'
            b = AFFR.get((b[0], b[1]), b)
        if long and (b + "ː") in LONG_OK:
            b = b + "ː"
        if b not in P.SID:
            m = P.teacher_to_student(b)
            if m is None or m == P.BLANK:
                continue
            b = m
        toks.append(b)
    out = []
    for t in toks:  # merge affricates / diphthongs written as two symbols
        if out and (out[-1], t) in AFFR:
            out[-1] = AFFR[(out[-1], t)]
        elif out and (out[-1], t) in DIPH:
            out[-1] = DIPH[(out[-1], t)]
        else:
            out.append(t)
    return out


def norm(seq):
    """Comparison alphabet: expand r-coloured tokens, coarse classes, 'ts'->'t s', merge 'ɚ ɹ' and repeats."""
    e = []
    for p in seq:
        e += EXPAND.get(p, [p])
    c = []
    for p in e:
        if p == "ts":
            c += ["t", "s"]
            continue
        q = P.coarse(p)
        if q == "ɹ" and c and c[-1] == "ɚ":
            continue
        if c and c[-1] == q:        # 'i iː' (gliding vowel), geminates across word boundaries
            continue
        c.append(q)
    return c


def canonical():
    d = {}
    for line in open(PROJECT / ".work" / "cmudict.dict"):
        parts = line.split("#")[0].split()
        if parts and "(" not in parts[0]:
            d[parts[0]] = parts[1:]
    out = []
    for w in PARAGRAPH.split():
        out += P.arpa_to_ipa(d[w], merge_coda_r=False)
    return out


def decode_long(r, a, max_sec=24.0):
    """Split long audio at low-energy points (<= max_sec per chunk) and concatenate decodes."""
    sr = 16000
    if len(a) <= max_sec * sr:
        return r.decode(a)
    fr = 320
    e = np.array([np.mean(a[i:i + fr] ** 2) for i in range(0, len(a) - fr, fr)])
    cuts, start = [], 0
    while len(a) - start > max_sec * sr:
        lo, hi = (start + int(0.6 * max_sec * sr)) // fr, (start + int(max_sec * sr)) // fr
        k = lo + int(np.argmin(e[lo:hi]))
        cuts.append(k * fr)
        start = k * fr
    out, s = [], 0
    for c in cuts + [len(a)]:
        out += r.decode(a[s:c])
        s = c
    return out


def main():
    runners = make_runners(sys.argv[1])
    groups = (sys.argv[2] if len(sys.argv) > 2 else "japanese,korean,mandarin,cantonese,english").split(",")
    idx = json.loads((WORK / "meta" / "saa_index.json").read_text())
    want = {}
    for x in idx:
        l1 = re.sub(r"[0-9]+$", "", x["id"].lower())
        if l1 in groups and (l1 != "english" or len([w for w in want.values() if w[0] == "english"]) < 30):
            want[(x["shard"], x["row"])] = (l1, x)
    raw = WORK / "raw" / "changelinglab__speechaccentarchive-pr" / "data"
    canon = norm(canonical())
    res = {r.name: collections.defaultdict(collections.Counter) for r in runners}
    agree = collections.defaultdict(collections.Counter)
    detail = []
    for shard in range(7):
        rows = [k for k in want if k[0] == shard]
        if not rows:
            continue
        t = pq.read_table(raw / f"test-{shard:05d}-of-00007.parquet", columns=["id", "audio", "transcript"]).to_pylist()
        for (_, row) in rows:
            l1, x = want[(shard, row)]
            rec = t[row]
            human = norm(tokenize_ipa(rec["transcript"]))
            a = decode_audio(rec["audio"]["bytes"])
            # deviations of the human transcription from the canonical form
            hc = align_pairs(canon, human)
            sub_pos, ins_pos, hi = [], [], 0
            for c, h in hc:
                if h is not None:
                    if c is not None and c != h:
                        sub_pos.append((hi, c, h))
                    elif c is None and h in VOWELS:
                        ins_pos.append(hi)
                    hi += 1
            hyps = {}
            for r in runners:
                hyp = norm(decode_long(r, a))
                hyps[r.name] = hyp
                C = res[r.name][l1]
                C["err"] += edit_distance(human, hyp)
                C["n"] += len(human)
                C["canon_err"] += edit_distance(canon, hyp)
                C["canon_n"] += len(canon)
                al = aligned_at(human, hyp)
                for k, c, h in sub_pos:
                    got = al[k]
                    C["sub_n"] += 1
                    C["sub_faithful"] += got == h
                    C["sub_autocorrect"] += got == c
                for k in ins_pos:
                    C["ins_n"] += 1
                    C["ins_faithful"] += al[k] is not None and al[k] in VOWELS
                C["speakers"] += 1
            names = list(hyps)
            if len(names) > 1:
                t_name = next((n for n in names if n == "teacher"), None)
                for n in names:
                    if n != t_name and t_name:
                        agree[(n, l1)]["err"] += edit_distance(hyps[t_name], hyps[n])
                        agree[(n, l1)]["n"] += len(hyps[t_name])
            detail.append(dict(id=x["id"], l1=l1, human=" ".join(human), **{k: " ".join(v) for k, v in hyps.items()}))
            print(x["id"], " | ".join(f"{n}: PER {edit_distance(human, h) / len(human):.3f}" for n, h in hyps.items()), flush=True)
    report = {}
    for name, per_l1 in res.items():
        report[name] = {}
        for l1, C in per_l1.items():
            report[name][l1] = dict(speakers=C["speakers"], per_vs_human=C["err"] / max(C["n"], 1),
                                    per_vs_canonical=C["canon_err"] / max(C["canon_n"], 1),
                                    sub_n=C["sub_n"], sub_faithful=C["sub_faithful"] / max(C["sub_n"], 1),
                                    sub_autocorrect=C["sub_autocorrect"] / max(C["sub_n"], 1),
                                    ins_n=C["ins_n"], ins_faithful=C["ins_faithful"] / max(C["ins_n"], 1))
    report["student_vs_teacher_per"] = {f"{n}|{l1}": c["err"] / max(c["n"], 1) for (n, l1), c in agree.items()}
    for name in res:
        print(f"\n== {name}")
        for l1, v in report[name].items():
            print(f"  {l1:10s} spk={v['speakers']:3d} PER(human)={v['per_vs_human']:.3f} PER(canon)={v['per_vs_canonical']:.3f} "
                  f"subs n={v['sub_n']} faithful={v['sub_faithful']:.3f} autocorrect={v['sub_autocorrect']:.3f} | "
                  f"inserted vowels n={v['ins_n']} found={v['ins_faithful']:.3f}")
    print("student-vs-teacher PER:", {k: round(v, 3) for k, v in report["student_vs_teacher_per"].items()})
    tag = sys.argv[3] if len(sys.argv) > 3 else "saa"
    (WORK / "eval" / f"{tag}_report.json").write_text(json.dumps(dict(summary=report, detail=detail), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
