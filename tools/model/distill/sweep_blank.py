"""Choose the blank-logit offset under a native false-alarm constraint (round 5).

    python sweep_blank.py <ckpt> [offsets, default 0,0.5,1,1.5] [--ref <ckpt of the current student>]

Log-probs are computed once per clip, then decoded with blank log-prob lowered by b. Metrics per b:
  native FA:  LibriSpeech test-clean + SAA English flag rate / insertions per 100 (native_fa.flags),
              held-out Kokoro voices: 1 - faithful at correctly produced curriculum focus phones,
              say native_ok: 1 - faithful
  detection:  say native_err / ja_kana faithful, held-out Kokoro substitutions faithful
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ctc_greedy, decode_audio  # noqa: E402
from dataset import Part  # noqa: E402
from eval_curriculum import ACCEPT as CUR_ACCEPT  # noqa: E402
from eval_saa import PARAGRAPH, norm  # noqa: E402
from evaluate import VOWELS, StudentRunner, aligned_at, expand, score_item  # noqa: E402
from native_fa import flags  # noqa: E402
from teacher_check import load_cmudict  # noqa: E402
import phoneset as P  # noqa: E402


def lp_long(r, a, max_sec=24.0):
    """log-probs of long audio in <= max_sec chunks split at low-energy points (as eval_saa.decode_long)."""
    import torch
    sr = 16000
    if len(a) <= max_sec * sr:
        return [r.logprobs(a)]
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
        out.append(r.logprobs(a[s:c]))
        s = c
    return out


def dec(lps, vocab, b):
    out = []
    for lp in lps:
        l = lp.clone()
        l[:, 0] -= b
        out += [vocab[k] for k in ctc_greedy(l.argmax(-1).tolist(), 0)]
    return out


def collect(r):
    cmu = load_cmudict()
    data = {"ls": [], "saa": [], "cur": [], "say": []}
    ls = Part("ls_testclean")
    for i, it in enumerate(ls.items):
        words = re.findall(r"[a-z']+", it["text"].lower())
        if all(w in cmu for w in words) and it["a_len"] <= 1490 * 320 and len(data["ls"]) < 300:
            canon = []
            for w in words:
                canon += P.arpa_to_ipa(cmu[w], merge_coda_r=False)
            data["ls"].append((norm(canon), lp_long(r, ls.get(i)[0])))
    idx = json.loads((WORK / "meta" / "saa_index.json").read_text())
    eng = [x for x in idx if re.sub(r"[0-9]+$", "", x["id"]) == "english"][:30]
    canon = []
    for w in PARAGRAPH.split():
        canon += P.arpa_to_ipa(cmu[w], merge_coda_r=False)
    canon = norm(canon)
    raw = WORK / "raw" / "changelinglab__speechaccentarchive-pr" / "data"
    for shard in sorted({x["shard"] for x in eng}):
        t = pq.read_table(raw / f"test-{shard:05d}-of-00007.parquet", columns=["audio"]).column("audio").to_pylist()
        for x in eng:
            if x["shard"] == shard:
                data["saa"].append((canon, lp_long(r, decode_audio(t[x["row"]]["bytes"]))))
    cur = Part("cur_heldout")
    for i, it in enumerate(cur.items):
        info = (it.get("meta") or {}).get("site_info")
        if info and "truth" in it:
            data["cur"].append(([P.STUDENT_VOCAB[k] for k in it["truth"]], info, [r.logprobs(cur.get(i)[0])]))
    items = json.loads((WORK / "eval" / "say" / "items.json").read_text())
    for it in items:
        data["say"].append((it, [r.logprobs(decode_audio(str(WORK / it["path"])))]))
    return data


def metrics(data, vocab, b):
    m = {}
    for key in ("ls", "saa"):
        N = F = I = 0
        for canon, lps in data[key]:
            n, f, ins = flags(canon, norm(dec(lps, vocab, b)))
            N, F, I = N + n, F + f, I + ins
        m[f"{key}_flag"] = round(F / N, 4)
        m[f"{key}_ins100"] = round(100 * I / N, 2)
    ok = okn = sub = subn = 0
    for truth, info, lps in data["cur"]:
        hyp = dec(lps, vocab, b)
        al = aligned_at(truth, hyp)
        for s in info:
            h = al[s["site"]] if s["site"] < len(al) else None
            if s["watch"] is None:
                okn += 1
                ok += h is not None and h in CUR_ACCEPT.get(s["produced"], {s["produced"]})
            else:
                subn += 1
                if s["watch"] == "EPEN":
                    sub += h is not None and h in VOWELS
                else:
                    sub += h is not None and h in CUR_ACCEPT.get(s["produced"], {s["produced"]})
    m["heldout_voices_correct_FA"] = round(1 - ok / okn, 4)
    m["heldout_voices_sub_found"] = round(sub / subn, 4)
    agg = {}
    for it, lps in data["say"]:
        hyp = expand(dec(lps, vocab, b))
        for _, res in score_item(it, hyp):
            c = agg.setdefault(it["kind"], [0, 0])
            c[0] += res == "faithful"
            c[1] += 1
    m["say_native_ok_FA"] = round(1 - agg["native_ok"][0] / agg["native_ok"][1], 4)
    m["say_native_err"] = round(agg["native_err"][0] / agg["native_err"][1], 4)
    m["say_ja_kana"] = round(agg["ja_kana"][0] / agg["ja_kana"][1], 4)
    return m


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    offs = [float(x) for x in (args[1] if len(args) > 1 else "0,0.5,1,1.5").split(",")]
    res = {}
    if "--ref" in sys.argv:
        ref = sys.argv[sys.argv.index("--ref") + 1]
        r = StudentRunner(ref)
        res["ref:" + ref] = metrics(collect(r), r.vocab, 0.0)     # the reference already has its offset baked in
        print("REF", res["ref:" + ref], flush=True)
    r = StudentRunner(args[0])
    data = collect(r)
    for b in offs:
        res[f"b={b}"] = metrics(data, r.vocab, b)
        print(f"b={b}", res[f"b={b}"], flush=True)
    tag = Path(args[0]).parent.name
    (WORK / "eval" / f"sweep_blank_{tag}.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
