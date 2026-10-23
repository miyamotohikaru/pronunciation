"""Pick GLOBE (V1, CC0) training rows by accent: all East-Asian/Japanese, capped other non-native, a few native.

    python select_globe.py            -> meta/globe_sel_train.json, meta/globe_sel_ja_heldout.json (+ summary)
"""
import collections
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK  # noqa: E402

NATIVE = ["united states", "england", "canadian", "australian", "new zealand", "irish", "scottish", "welsh",
          "southern african", "south africa", "northern irish", "british", "kiwi", "american", "canada", "midwest",
          "california", "texas", "northumbrian", "english north", "london", "yorkshire", "transatlantic", "philadelphia",
          "new england", "southern united states", "pacific northwest", "west indies", "ontario"]
EAST_ASIAN = ["japan", "chin", "mandarin", "canton", "hong kong", "taiwan", "korea", "vietnam", "thai", "indones",
              "malay", "filipin", "singapor", "javanese", "asian"]
NONNATIVE = ["india", "pakistan", "sri lanka", "bangla", "nepal", "german", "french", "spanish", "ital", "russian",
             "polish", "dutch", "portug", "brazil", "arab", "turk", "persian", "farsi", "greek", "swed", "norw", "danish",
             "finn", "czech", "slovak", "hungar", "roman", "ukrain", "serb", "croat", "bulgar", "nigeria", "kenya", "ghana",
             "latin", "mexic", "hebrew", "israel", "non native", "non-native", "esl", "foreign", "second language", "slavic",
             "european", "swiss", "austria", "belgi", "african", "khoja", "lithuan", "latvia", "eston", "albania", "iran"]


def category(acc):
    a = acc.lower()
    if "japan" in a:
        return "japanese"
    if any(k in a for k in EAST_ASIAN):
        return "east_asian"
    if any(k in a for k in NONNATIVE):
        return "nonnative"
    if any(k in a for k in NATIVE):
        return "native"
    return "unknown"


def main():
    rng = random.Random(0)
    rows = [l.rstrip("\n").split("\t") for l in open(WORK / "meta" / "globe_train_meta.tsv")][1:]
    rows = [r for r in rows if len(r) >= 7]
    by_spk = collections.defaultdict(list)
    for sh, row, spk, acc, dur, g, age in rows:
        by_spk[spk].append(dict(shard=int(sh), row=int(row), speaker=spk, accent=acc, duration=float(dur), gender=g, age=age))
    caps = {"japanese": 10 ** 6, "east_asian": 80, "nonnative": 40, "native": 1, "unknown": 4}
    sel, held = [], []
    ja_spk = sorted(s for s, v in by_spk.items() if category(v[0]["accent"]) == "japanese")
    # Japanese-accented GLOBE speakers are so few (a handful of clips) that all of them are held out for evaluation
    ja_held = set(ja_spk)
    # native speakers: only those sitting in row groups (100 rows) we must read anyway for the accented
    # speakers, so the native share costs no extra download
    need_rg = {(r["shard"], r["row"] // 100) for v in by_spk.values() if category(v[0]["accent"]) not in ("native", "unknown")
               for r in v}
    native_spk = sorted(s for s, v in by_spk.items() if category(v[0]["accent"]) == "native"
                        and any((r["shard"], r["row"] // 100) in need_rg for r in v))
    native_keep = set(rng.sample(native_spk, min(4000, len(native_spk))))
    stats = collections.defaultdict(lambda: [0, 0.0, 0])
    for spk, v in by_spk.items():
        cat = category(v[0]["accent"])
        if cat == "native":
            if spk not in native_keep:
                continue
            v = [r for r in v if (r["shard"], r["row"] // 100) in need_rg]
        take = v if len(v) <= caps[cat] else rng.sample(v, caps[cat])
        for r in take:
            rec = dict(repo="MushanW/GLOBE", file=f"data/train-{r['shard']:05d}-of-00108.parquet", row=r["row"],
                       id=f"gl{r['shard']:03d}_{r['row']:05d}", speaker=spk, accent=r["accent"], category=cat,
                       gender=r["gender"], age=r["age"], license="CC0-1.0")
            (held if spk in ja_held else sel).append(rec)
        st = stats["ja_heldout" if spk in ja_held else cat]
        st[0] += len(take)
        st[1] += sum(r["duration"] for r in take) / 3600
        st[2] += 1
    (WORK / "meta" / "globe_sel_train.json").write_text(json.dumps(sel, ensure_ascii=False))
    (WORK / "meta" / "globe_sel_ja_heldout.json").write_text(json.dumps(held, ensure_ascii=False))
    for k, (n, h, s) in sorted(stats.items()):
        print(f"{k:12s} utts={n:6d} hours={h:6.2f} speakers={s}")
    print("japanese speakers:", ja_spk, "held out:", sorted(ja_held))
    print("accents of japanese speakers:", sorted({by_spk[s][0]["accent"] for s in ja_spk}))


if __name__ == "__main__":
    main()
