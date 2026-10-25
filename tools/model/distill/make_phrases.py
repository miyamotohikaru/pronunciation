"""Phrase list for Kokoro synthetic speech (.work/distill/kokoro/phrases.json).

Sources (texts only): speechocean762 train sentences (learner-style), short chunks of LibriSpeech
train/dev transcripts, and 2-3 word combinations of frequent words rich in the target contrasts.
Words used by the `say` targeted tests are excluded so those tests stay out-of-domain.
"""
import collections
import json
import random
import re
import sys
from pathlib import Path

import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK  # noqa: E402
from say_tests import KANA, PAIRS  # noqa: E402

RAW = WORK / "raw"


def say_words():
    w = set()
    for p in PAIRS:
        w |= set(p[1].lower().split()) | set(p[2].lower().split())
    for k in KANA:
        w |= set(k[1].lower().split())
    return w - {"i", "you", "the", "is", "it", "so", "a", "like", "good", "much"}


def main():
    rng = random.Random(0)
    banned = say_words()
    texts = []
    so = pq.read_table(RAW / "mispeech__speechocean762/data/train-00000-of-00001.parquet", columns=["text"]).column("text").to_pylist()
    texts += [("so", t.capitalize()) for t in sorted(set(so))]
    ls = []
    for f in ["all/train.clean.100/0000.parquet", "all/train.clean.100/0001.parquet", "all/validation.clean/0000.parquet"]:
        ls += pq.read_table(RAW / "openslr__librispeech_asr" / f, columns=["text"]).column("text").to_pylist()
    words = collections.Counter(w for t in ls + so for w in re.findall(r"[a-z']+", t.lower()))
    chunks = []
    for t in ls:
        ws = t.lower().split()
        if len(ws) < 3:
            continue
        n = rng.randint(3, 8)
        s = rng.randint(0, max(0, len(ws) - n))
        chunks.append(" ".join(ws[s:s + n]))
    rng.shuffle(chunks)
    texts += [("ls", c.capitalize()) for c in chunks[:4000]]
    # contrast-rich frequent words (r/l, th, v/b, s/sh, ae/uh, clusters)
    pat = re.compile(r"(r|l|th|v|b|sh|si|se|a|st|sp|sk|tr|dr|pl|pr|bl|br|fr|fl|gr|gl|cr|cl)")
    cand = [w for w, c in words.most_common(6000) if len(w) > 2 and w not in banned and pat.search(w) and "'" not in w]
    combos = []
    for _ in range(3000):
        k = rng.choice([2, 3, 3, 4])
        combos.append(" ".join(rng.sample(cand[:3000], k)))
    texts += [("words", c.capitalize()) for c in combos]
    out = WORK / "kokoro" / "phrases.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([dict(src=s, text=t) for s, t in texts], ensure_ascii=False, indent=0))
    print(len(texts), "phrases;", collections.Counter(s for s, _ in texts), "banned words:", len(banned))


if __name__ == "__main__":
    main()
