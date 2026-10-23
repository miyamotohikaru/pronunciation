"""Native false-alarm proxies: how often a model 'flags' a phone of a native speaker who said it right.

    python native_fa.py <teacher,ckpt:...,onnx:...> [tag]

Sets (both native English, never used for training):
  * LibriSpeech test-clean (CMUdict canonical of the transcript; utterances with OOV words skipped; <= 300 utts)
  * Speech Accent Archive, the 30 English-L1 speakers (canonical = CMUdict of the Stella paragraph)
A canonical phone is flagged when the aligned output is missing or not an accepted native variant
(coarse classes + flaps/glottal t, weak-vowel variants). Inserted phones (e.g. a hallucinated vowel after a
consonant) are counted separately per 100 canonical phones.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, align_pairs, decode_audio  # noqa: E402
from dataset import Part  # noqa: E402
from eval_saa import PARAGRAPH, decode_long, norm  # noqa: E402
from evaluate import VOWELS, make_runners  # noqa: E402
from teacher_check import load_cmudict  # noqa: E402
import phoneset as P  # noqa: E402

LENIENT = {"t": {"t", "ɾ", "ʔ", "d"}, "d": {"d", "ɾ", "t"}, "ə": {"ə", "ɪ", "ᵻ", "ɚ"}, "ɪ": {"ɪ", "ə", "ᵻ", "iː"},
           "iː": {"iː", "ɪ"}, "ɑː": {"ɑː", "ɔː", "ə"}, "ɔː": {"ɔː", "ɑː", "oʊ"}, "uː": {"uː", "ʊ", "ə"},
           "ʊ": {"ʊ", "uː", "ə"}, "ɛ": {"ɛ", "ɪ", "æ", "ə"}, "æ": {"æ", "ɛ", "ə"}, "ð": {"ð", "d"},
           "n": {"n", "ŋ"}, "z": {"z", "s"}, "ɚ": {"ɚ", "ə"}}


def flags(canon, hyp):
    """-> (n canonical, flagged, inserted)"""
    al = align_pairs(canon, hyp)
    n = f = ins = 0
    for c, h in al:
        if c is None:
            ins += 1
            continue
        n += 1
        if h is None or h not in LENIENT.get(c, {c}):
            f += 1
    return n, f, ins


def main():
    runners = make_runners(sys.argv[1])
    tag = sys.argv[2] if len(sys.argv) > 2 else "native_fa"
    cmu = load_cmudict()
    ls = Part("ls_testclean")
    ls_items = []
    for i, it in enumerate(ls.items):
        words = re.findall(r"[a-z']+", it["text"].lower())
        if all(w in cmu for w in words) and it["a_len"] <= 1490 * 320:
            canon = []
            for w in words:
                canon += P.arpa_to_ipa(cmu[w], merge_coda_r=False)
            ls_items.append((i, norm(canon)))
    ls_items = ls_items[:300]
    idx = json.loads((WORK / "meta" / "saa_index.json").read_text())
    import pyarrow.parquet as pq
    saa = []
    for x in idx:
        if re.sub(r"[0-9]+$", "", x["id"]) == "english" and len(saa) < 30:
            saa.append(x)
    canon_saa = []
    for w in PARAGRAPH.split():
        canon_saa += P.arpa_to_ipa(cmu[w], merge_coda_r=False)
    canon_saa = norm(canon_saa)
    saa_audio = {}
    raw = WORK / "raw" / "changelinglab__speechaccentarchive-pr" / "data"
    for shard in sorted({x["shard"] for x in saa}):
        t = pq.read_table(raw / f"test-{shard:05d}-of-00007.parquet", columns=["audio"]).column("audio").to_pylist()
        for x in saa:
            if x["shard"] == shard:
                saa_audio[x["id"]] = decode_audio(t[x["row"]]["bytes"])
    out = {}
    for r in runners:
        res = {}
        for name, items in [("librispeech_test_clean", ls_items), ("saa_english", list(saa_audio.items()))]:
            N = F = I = 0
            for item in items:
                if name.startswith("libri"):
                    i, canon = item
                    a, _ = ls.get(i)
                else:
                    _, a = item
                    canon = canon_saa
                hyp = norm(decode_long(r, a))
                n, f, ins = flags(canon, hyp)
                N += n
                F += f
                I += ins
            res[name] = dict(utts=len(items), canonical_phones=N, flag_rate=round(F / N, 4),
                             insertions_per_100=round(100 * I / N, 2))
        out[r.name] = res
        print(r.name, res, flush=True)
    (WORK / "eval" / f"{tag}.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
