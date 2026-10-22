#!/usr/bin/env python3
"""Check every content JSON against CMUdict and the content rules.

  python3 content/check_cmudict.py              # all files that exist
  python3 content/check_cmudict.py --words a b  # look up words

Files: curriculum.json, challenge.json, phonemes.json, ipa-legend.json, alphabet.json
Rules checked
  - every English token (text, tts_text, pair, focus.word, examples, practice)
    is in CMUdict; acronyms must sound like their letters (else spell them out)
  - focus.word occurs in the line; focus.phone is base ARPAbet and occurs in
    a CMUdict pronunciation of the word; watch_for is ARPAbet or "EPEN"
  - curriculum v2: only sentence / phrase items; lessons 1-2: 3-6 words,
    later lessons: 3-12, boss lesson (last, boss=true): 3 items of 12-20 words
  - challenge: long 12-20 words; intro scripts 3-5 lines / 30-60 words;
    dialogues 4-8 turns alternating partner / you, each line <= 20 words
  - phonemes: 5 examples with verified positions, 2-4 pairs, 6-8 practice
    sentences that contain the sound at least twice
  - Japanese: non-empty, "\n" after every 、。 not at the end, and no katakana
    readings of English words (only Japanese sound descriptions like 「アー」)
CMUdict is read-only (.work/cmudict.dict).
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ipa  # noqa: E402

HERE = Path(__file__).resolve().parent
ARPABET = set("""AA AE AH AO AW AY B CH D DH EH ER EY F G HH IH IY JH K L M N NG
OW OY P R S SH T TH UH UW V W Y Z ZH""".split())
VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}
TAGS = ["rhythm-stress", "epenthesis", "final-consonants", "r-l", "er",
        "vowels-ae-ah-aa", "vowels-tense-lax", "th", "s-sh", "v-b", "f-h",
        "linking-flap-reduction", "intonation"]
KATA = re.compile(r"[ァ-ヺー]{2,}")
# Japanese sound descriptions are fine; katakana readings of English words are not.
KATA_OK = {"アー", "イー", "ウー", "エー", "オー", "エイ", "オウ", "アイ", "アウ", "オイ",
           "スー", "シュ", "ズー", "ハー", "フー", "ンー", "ウッ"}

errors, warns, missing = [], [], {}


def words(s):
    return [w.strip("'") for w in re.findall(r"[a-z']+", s.lower()) if w.strip("'")]


def nwords(s):
    return len(re.findall(r"[A-Za-z']+", s))


def need(word, where):
    if not ipa.prons(word):
        missing.setdefault(word, set()).add(where)


def bases(word):
    return [[ipa.base(p) for p in pr] for pr in ipa.prons(word)]


def check_ja(s, where):
    if not isinstance(s, str) or not s.strip():
        errors.append(f"{where}: empty Japanese")
        return
    t = s.rstrip()
    for i, ch in enumerate(t[:-1]):
        if ch in "、。" and t[i + 1] != "\n" and t[i + 1] not in "」』）)":
            warns.append(f"{where}: 、/。 not followed by a line break: {s[:30]!r}")
            break
    for k in KATA.findall(s):
        if k not in KATA_OK:
            errors.append(f"{where}: katakana {k!r} in Japanese text")


def check_focus(fl, pool, where, need_focus=True):
    if need_focus and not fl:
        errors.append(f"{where}: no focus")
    for f in fl or []:
        w, ph = f.get("word", ""), f.get("phone", "")
        need(w, where)
        if w.lower().strip("'") not in pool:
            errors.append(f"{where}: focus word {w!r} not in line")
        if ph not in ARPABET:
            errors.append(f"{where}: bad phone {ph!r}")
        b = bases(w)
        if b and not any(ph in p for p in b):
            errors.append(f"{where}: phone {ph} not in CMUdict pron of {w!r}")
        for x in f.get("watch_for", []):
            if x not in ARPABET and x != "EPEN":
                errors.append(f"{where}: bad watch_for {x!r}")
        if "tip_ja" in f:
            check_ja(f["tip_ja"], where + " tip")
        if "tag" in f and f["tag"] not in TAGS:
            errors.append(f"{where}: bad tag {f['tag']!r}")
        if not f.get("ipa"):
            warns.append(f"{where}: focus {w!r} has no ipa")


def check_line(it, where, need_focus=True):
    """A spoken line: id, text, ja, focus, difficulty, optional tts_text."""
    for k in ("id", "text", "ja"):
        if not it.get(k):
            errors.append(f"{where}: missing {k}")
    check_ja(it.get("ja", ""), where)
    pool = words(it.get("text", "")) + words(it.get("tts_text", ""))
    for w in pool:
        need(w, where)
    if "difficulty" in it and not 1 <= it["difficulty"] <= 5:
        errors.append(f"{where}: bad difficulty")
    check_focus(it.get("focus"), set(pool), where, need_focus)
    return nwords(it.get("text", ""))


def _merge_r(pr):
    """vowel + R -> one unit, so heart/hurt and far/fur count as minimal pairs."""
    out = []
    for p in pr:
        if p == "R" and out and out[-1] in VOWELS - {"ER"}:
            out[-1] += "_R"
        else:
            out.append(p)
    return out


def minimal(a, b):
    """True if some prons of a and b differ by exactly one phone substitution."""
    for pa in map(_merge_r, bases(a)):
        for pb in map(_merge_r, bases(b)):
            if len(pa) == len(pb) and sum(x != y for x, y in zip(pa, pb)) == 1:
                return True
    return False


seen = set()


def uid(i, where):
    if not i:
        errors.append(f"{where}: missing id")
    elif i in seen:
        errors.append(f"{where}: duplicate id {i}")
    seen.add(i)


# ------------------------------------------------------------------ files
def check_curriculum(d):
    for p in d.get("placement", []):
        uid(p.get("id"), p.get("id"))
        check_line(p, f"placement {p.get('id')}")
        for t in p.get("diagnoses", []):
            if t not in TAGS:
                errors.append(f"placement {p['id']}: bad tag {t}")
    n = 0
    for u in d["units"]:
        uid(u["id"], u["id"])
        if u["feature"] not in TAGS:
            errors.append(f"{u['id']}: bad feature")
        for k in ("title_ja", "subtitle_ja", "why_ja", "how_ja"):
            check_ja(u.get(k, ""), f"{u['id']}.{k}")
        les = u["lessons"]
        if not les or not les[-1].get("boss"):
            errors.append(f"{u['id']}: last lesson is not a boss lesson")
        if not 3 <= len([l for l in les if not l.get("boss")]) <= 5:
            warns.append(f"{u['id']}: {len(les)} lessons")
        for li, l in enumerate(les, 1):
            uid(l["id"], l["id"])
            for k in ("title_ja", "goal_ja"):
                check_ja(l.get(k, ""), f"{l['id']}.{k}")
            if l.get("feature", u["feature"]) not in TAGS:
                errors.append(f"{l['id']}: bad feature")
            boss = l.get("boss")
            if boss and (li != len(les) or len(l["items"]) != 3):
                errors.append(f"{l['id']}: boss lesson must be last with 3 items")
            if not boss and not 5 <= len(l["items"]) <= 8:
                warns.append(f"{l['id']}: {len(l['items'])} items")
            lo, hi = (12, 20) if boss else ((3, 6) if li <= 2 else (3, 12))
            for it in l["items"]:
                where = it.get("id", "?")
                uid(it.get("id"), where)
                n += 1
                if it.get("type") not in ("sentence", "phrase"):
                    errors.append(f"{where}: type {it.get('type')!r} (v2 allows sentence / phrase only)")
                k = check_line(it, where)
                if not lo <= k <= hi:
                    errors.append(f"{where}: {k} words (lesson allows {lo}-{hi})")
                if it.get("pair"):
                    need(it["pair"], where)
                    w0 = it["focus"][0]["word"]
                    if not minimal(w0, it["pair"]):
                        warns.append(f"{where}: pair {w0!r}/{it['pair']!r} is not a one-phone minimal pair")
    return f"curriculum: units={len(d['units'])} items={n} placement={len(d.get('placement', []))}"


def check_challenge(d):
    prev = 0
    for it in d.get("long", []):
        where = f"long {it.get('id')}"
        uid(it.get("id"), where)
        k = check_line(it, where)
        if not 12 <= k <= 20:
            errors.append(f"{where}: {k} words (12-20)")
        if it.get("difficulty", 0) < prev:
            warns.append(f"{where}: difficulty goes down")
        prev = it.get("difficulty", 0)
    for s in d.get("intro", []):
        uid(s.get("id"), s.get("id"))
        for k in ("title_ja", "situation_ja", "note_ja"):
            check_ja(s.get(k, ""), f"intro {s.get('id')}.{k}")
        lines = s.get("lines", [])
        if not 3 <= len(lines) <= 5:
            errors.append(f"intro {s['id']}: {len(lines)} sentences (3-5)")
        total = 0
        for it in lines:
            uid(it.get("id"), it.get("id"))
            total += check_line(it, f"intro {it.get('id')}")
        if not 30 <= total <= 60:
            errors.append(f"intro {s['id']}: {total} words (30-60)")
    for dlg in d.get("dialogues", []):
        uid(dlg.get("id"), dlg.get("id"))
        for k in ("title_ja", "situation_ja"):
            check_ja(dlg.get(k, ""), f"dialogue {dlg.get('id')}.{k}")
        turns = dlg.get("turns", [])
        if not 4 <= len(turns) <= 8:
            errors.append(f"dialogue {dlg['id']}: {len(turns)} turns (4-8)")
        last = None
        for it in turns:
            where = f"dialogue {it.get('id')}"
            uid(it.get("id"), where)
            sp = it.get("speaker")
            if sp not in ("partner", "you"):
                errors.append(f"{where}: bad speaker {sp!r}")
            if sp == last:
                errors.append(f"{where}: speakers do not alternate")
            last = sp
            k = check_line(it, where, need_focus=True)
            if k > 20:
                errors.append(f"{where}: {k} words (<= 20)")
    return (f"challenge: long={len(d.get('long', []))} intro={len(d.get('intro', []))} "
            f"dialogues={len(d.get('dialogues', []))}")


POS = ("initial", "medial", "final")


def has_target(pr, entry):
    """Does a pronunciation (with stress digits) contain this phoneme entry?"""
    pid = entry["id"]
    if pid == "DX":
        return bool(ipa.flap_index(pr))
    if pid == "AH0":
        return "AH0" in pr
    if pid == "ER0":
        return "ER0" in pr
    if pid in ("AH", "ER"):
        return any(ipa.base(p) == pid and p[-1] in "12" for p in pr)
    return any(ipa.base(p) == entry["arpabet"] for p in pr)


def check_phonemes(d, legend):
    ents = d.get("phonemes", [])
    for e in ents:
        where = f"phoneme {e.get('id')}"
        uid("ph:" + str(e.get("id")), where)
        for k in ("arpabet", "ipa", "category"):
            if not e.get(k):
                errors.append(f"{where}: missing {k}")
        for k in ("name_ja", "how_ja", "jp_trap_ja"):
            check_ja(e.get(k, ""), f"{where}.{k}")
        if legend is not None and e.get("ipa") not in legend:
            errors.append(f"{where}: ipa {e.get('ipa')!r} not in ipa-legend.json")
        ex = e.get("examples", [])
        if len(ex) != 5:
            errors.append(f"{where}: {len(ex)} examples (5)")
        for x in ex:
            w = x.get("word", "")
            need(w, where)
            if re.sub(r"[\[\]]", "", x.get("marked", "")) != w:
                errors.append(f"{where}: marked {x.get('marked')!r} does not spell {w!r}")
            if x.get("position") not in POS:
                errors.append(f"{where}: bad position for {w!r}")
            ok = False
            for pr in ipa.prons(w):
                if not has_target(pr, e):
                    continue
                if e["id"] == "DX":
                    ok = x["position"] == "medial"
                    break
                bs = [ipa.base(p) for p in pr]
                tgt = e["arpabet"]
                hits = [i for i, b in enumerate(bs) if b == tgt]
                pos = {("initial" if i == 0 else "final" if i == len(bs) - 1 else "medial") for i in hits}
                if x["position"] in pos:
                    ok = True
                    break
            if ipa.prons(w) and not ok:
                errors.append(f"{where}: {w!r} does not have the sound in {x.get('position')} position")
        prs = e.get("pairs", [])
        if not 2 <= len(prs) <= 4:
            errors.append(f"{where}: {len(prs)} pairs (2-4)")
        for p in prs:
            need(p.get("a", ""), where)
            need(p.get("b", ""), where)
            if p.get("kind", "minimal") == "minimal" and not minimal(p.get("a", ""), p.get("b", "")):
                errors.append(f"{where}: {p.get('a')}/{p.get('b')} is not a minimal pair")
        pr_ = e.get("practice", [])
        if not 6 <= len(pr_) <= 8:
            errors.append(f"{where}: {len(pr_)} practice sentences (6-8)")
        for it in pr_:
            w2 = f"{where} {it.get('id')}"
            uid(it.get("id"), w2)
            if check_line(it, w2) < 3:
                errors.append(f"{w2}: practice must be a sentence (3+ words)")
            hits = sum(1 for w in words(it.get("text", "")) if any(has_target(p, e) for p in ipa.prons(w)))
            if hits < 2:
                errors.append(f"{w2}: only {hits} word(s) with the sound (need 2+)")
    return f"phonemes: {len(ents)}"


def check_legend(d):
    for s in d.get("symbols", []):
        where = f"legend {s.get('symbol')}"
        for k in ("name_ja", "how_ja"):
            check_ja(s.get(k, ""), f"{where}.{k}")
        for w in s.get("examples", []):
            need(w, where)
    return f"ipa-legend: {len(d.get('symbols', []))}"


def letter_prons(ch):
    return [[ipa.base(p) for p in pr] for pr in ipa.prons(ch.lower() + ".")]


def check_alphabet(d):
    letters = d.get("letters", [])
    if [x.get("letter") for x in letters] != [chr(c) for c in range(65, 91)]:
        errors.append("alphabet: letters must be A-Z in order")
    for x in letters:
        where = f"letter {x.get('letter')}"
        if not letter_prons(x.get("letter", "")):
            errors.append(f"{where}: no CMUdict letter entry")
        for k in ("name_ja", "how_ja"):
            check_ja(x.get(k, ""), f"{where}.{k}")
        exp = "/" + ipa.to_ipa(ipa.prons(x["letter"].lower() + ".")[0]) + "/"
        if x.get("ipa") != exp and not x.get("ipa_note_ja"):
            warns.append(f"{where}: ipa {x.get('ipa')} differs from CMUdict {exp}")
    for c in d.get("confusions", []):
        check_ja(c.get("tip_ja", ""), f"confusion {c.get('id')}")
        uid(c.get("id"), c.get("id"))
    n = 0
    for g in d.get("practice", []):
        uid(g.get("id"), g.get("id"))
        check_ja(g.get("title_ja", ""), f"group {g.get('id')}")
        for it in g.get("lines", []):
            where = f"alphabet {it.get('id')}"
            uid(it.get("id"), where)
            n += 1
            if check_line(it, where) < 3:
                errors.append(f"{where}: practice must be a sentence")
            for tok in re.findall(r"[A-Za-z']+", it.get("text", "")):
                if len(tok) >= 2 and tok.isupper():
                    spelled = [p for ch in tok for p in letter_prons(ch)[0]]
                    if spelled not in bases(tok):
                        errors.append(f"{where}: acronym {tok!r} is not read as its letters in CMUdict")
            for ch in it.get("spell", []):
                if not letter_prons(ch):
                    errors.append(f"{where}: bad spell letter {ch!r}")
    return f"alphabet: letters={len(letters)} practice={n}"


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--words":
        for w in sys.argv[2:]:
            p = ipa.prons(w)
            print(f"{w:15s}", " | ".join(" ".join(x) for x in p) if p else "MISSING",
                  ipa.word_ipa(w) or "")
        return 0
    out = []
    load = lambda n: json.loads((HERE / n).read_text(encoding="utf-8")) if (HERE / n).exists() else None
    legend = load("ipa-legend.json")
    syms = {s["symbol"] for s in legend["symbols"]} if legend else None
    for name, fn in (("curriculum.json", check_curriculum), ("challenge.json", check_challenge),
                     ("phonemes.json", lambda d: check_phonemes(d, syms)),
                     ("ipa-legend.json", check_legend), ("alphabet.json", check_alphabet)):
        d = load(name)
        if d is not None:
            out.append(fn(d))
    for line in out:
        print(line)
    for m in sorted(missing):
        print(f"MISSING in CMUdict: {m!r}  ({', '.join(sorted(missing[m])[:3])})")
    for e in errors:
        print("ERROR:", e)
    for w in warns:
        print("WARN:", w)
    ok = not missing and not errors
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
