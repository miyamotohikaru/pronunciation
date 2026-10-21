#!/usr/bin/env python3
"""Check curriculum.json against CMUdict and the content rules.

  python3 content/check_cmudict.py            # check content/curriculum.json
  python3 content/check_cmudict.py --words a b c   # look up single words

Checks
  - every word in text / tts_text / pair / focus.word is in CMUdict
  - focus.word occurs in the item (text, tts_text or pair)
  - focus.phone is a base ARPAbet symbol and occurs in some CMUdict
    pronunciation of focus.word; watch_for is ARPAbet or "EPEN"
  - ids unique, type / pair / difficulty valid
  - sentence length (units 1-5: <= 6 words, all: <= 10 words)
  - Japanese line breaks: every 、 and 。 not at the end is followed by "\n"
CMUdict is read-only (.work/cmudict.dict).
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DICT = HERE.parent / ".work" / "cmudict.dict"
CURR = HERE / "curriculum.json"

ARPABET = set("""AA AE AH AO AW AY B CH D DH EH ER EY F G HH IH IY JH K L M N NG
OW OY P R S SH T TH UH UW V W Y Z ZH""".split())
TAGS = ["rhythm-stress", "epenthesis", "final-consonants", "r-l", "er",
        "vowels-ae-ah-aa", "vowels-tense-lax", "th", "s-sh", "v-b", "f-h",
        "linking-flap-reduction", "intonation"]
TYPES = {"word", "pair", "phrase", "sentence"}


def load_cmu():
    cmu = {}
    with open(DICT, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            w, *ph = line.split()
            w = re.sub(r"\(\d+\)$", "", w)
            cmu.setdefault(w, []).append([re.sub(r"\d", "", p) for p in ph])
    return cmu


def words(s):
    return [w.strip("'") for w in re.findall(r"[a-z']+", s.lower()) if w.strip("'")]


def lookup(cmu, w):
    w = w.lower()
    return cmu.get(w) or cmu.get(w.strip("'"))


def ja_breaks_ok(s):
    s = s.rstrip()
    for i, ch in enumerate(s[:-1]):
        if ch in "、。":
            nxt = s[i + 1]
            if nxt != "\n" and nxt not in "」』）)":
                return False
    return True


def main():
    cmu = load_cmu()
    if len(sys.argv) > 1 and sys.argv[1] == "--words":
        for w in sys.argv[2:]:
            p = lookup(cmu, w)
            print(f"{w:15s}", " | ".join(" ".join(x) for x in p) if p else "MISSING")
        return 0

    data = json.loads(CURR.read_text(encoding="utf-8"))
    errors, warns, missing = [], [], {}
    seen_ids = set()

    def need(word, where):
        if not lookup(cmu, word):
            missing.setdefault(word, []).append(where)

    def check_id(i, where):
        if not i:
            errors.append(f"{where}: missing id")
        elif i in seen_ids:
            errors.append(f"{where}: duplicate id {i}")
        seen_ids.add(i)

    def check_ja(s, where):
        if not isinstance(s, str) or not s.strip():
            errors.append(f"{where}: empty Japanese")
        elif not ja_breaks_ok(s):
            warns.append(f"{where}: 、/。 not followed by a line break: {s[:30]!r}")

    def check_focus(fl, pool, where):
        for f in fl:
            w, ph = f.get("word", ""), f.get("phone", "")
            need(w, where)
            if w.lower() not in pool:
                errors.append(f"{where}: focus word {w!r} not in item")
            if ph not in ARPAbet_or_none():
                errors.append(f"{where}: bad phone {ph!r}")
            prons = lookup(cmu, w) or []
            if prons and not any(ph in p for p in prons):
                errors.append(f"{where}: phone {ph} not in CMUdict pron of {w!r} {prons}")
            for x in f.get("watch_for", []):
                if x not in ARPABET and x != "EPEN":
                    errors.append(f"{where}: bad watch_for {x!r}")
            if "tip_ja" in f:
                check_ja(f["tip_ja"], where + " tip")
            if "tag" in f and f["tag"] not in TAGS:
                errors.append(f"{where}: bad tag {f['tag']!r}")

    def ARPAbet_or_none():
        return ARPABET

    for p in data.get("placement", []):
        where = f"placement {p.get('id')}"
        check_id(p.get("id"), where)
        check_ja(p.get("ja", ""), where)
        pool = set(words(p["text"]) + words(p.get("tts_text", "")))
        for w in pool:
            need(w, where)
        for t in p.get("diagnoses", []):
            if t not in TAGS:
                errors.append(f"{where}: bad tag {t}")
        check_focus(p.get("focus", []), pool, where)

    n_items = 0
    by_type = {}
    for ui, u in enumerate(data["units"], 1):
        check_id(u["id"], u["id"])
        if u["feature"] not in TAGS:
            errors.append(f"{u['id']}: bad feature {u['feature']}")
        for k in ("title_ja", "subtitle_ja", "why_ja", "how_ja"):
            check_ja(u.get(k, ""), f"{u['id']}.{k}")
        if not 3 <= len(u["lessons"]) <= 5:
            warns.append(f"{u['id']}: {len(u['lessons'])} lessons")
        for l in u["lessons"]:
            check_id(l["id"], l["id"])
            for k in ("title_ja", "goal_ja"):
                check_ja(l.get(k, ""), f"{l['id']}.{k}")
            if l.get("feature", u["feature"]) not in TAGS:
                errors.append(f"{l['id']}: bad feature")
            if not 5 <= len(l["items"]) <= 8:
                warns.append(f"{l['id']}: {len(l['items'])} items")
            for it in l["items"]:
                where = it.get("id", "?")
                check_id(it.get("id"), where)
                n_items += 1
                by_type[it["type"]] = by_type.get(it["type"], 0) + 1
                if it["type"] not in TYPES:
                    errors.append(f"{where}: bad type")
                if (it["type"] == "pair") != bool(it.get("pair")):
                    errors.append(f"{where}: pair field mismatch")
                if not 1 <= it.get("difficulty", 0) <= 5:
                    errors.append(f"{where}: bad difficulty")
                check_ja(it.get("ja", ""), where)
                pool = words(it["text"]) + words(it.get("tts_text", "")) + words(it.get("pair", ""))
                for w in pool:
                    need(w, where)
                if it["type"] == "sentence":
                    n = len(words(it["text"]))
                    lim = 6 if ui <= 5 else 10
                    if n > lim:
                        errors.append(f"{where}: sentence has {n} words (> {lim})")
                if not it.get("focus"):
                    errors.append(f"{where}: no focus")
                check_focus(it.get("focus", []), set(pool), where)

    print(f"units={len(data['units'])} lessons={sum(len(u['lessons']) for u in data['units'])} "
          f"items={n_items} {by_type} placement={len(data.get('placement', []))}")
    for m in sorted(missing):
        print(f"MISSING in CMUdict: {m!r}  ({', '.join(sorted(set(missing[m]))[:3])})")
    for e in errors:
        print("ERROR:", e)
    for w in warns:
        print("WARN:", w)
    ok = not missing and not errors
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
