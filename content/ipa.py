"""CMUdict (ARPAbet) -> IPA in the style of Japanese learner's dictionaries.

Style (ジーニアス / ウィズダム-like, American):
  - English r is written r:            rice    /ráɪs/
  - primary stress = acute accent,     think   /θíŋk/
    secondary = grave accent:          okay    /òʊkéɪ/
  - r-coloured vowels: ɚ (weak), ɚ́ː (strong):  bird /bɚ́ːd/, teacher /tíːtʃɚ/
  - vowel + r in one syllable:  car /kɑ́ːr/, more /mɔ́ːr/, here /híɚ/, hair /héɚ/
  - short (lax) vowels are written i / u as in those dictionaries:
    think /θíŋk/, book /búk/  (long ones carry ː: seat /síːt/, food /fúːd/)
  - weak IY/UW are short: happy /hǽpi/
  - the American flap is still written t (water /wɔ́ːtɚ/); flap_note() says so.
CMUdict is read-only (.work/cmudict.dict).
"""
import re
from pathlib import Path

DICT = Path(__file__).resolve().parent.parent / ".work" / "cmudict.dict"
ACUTE, GRAVE = "́", "̀"

CONS = {"B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "g", "HH": "h", "JH": "dʒ",
        "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "r", "S": "s",
        "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ"}
# vowel -> (stressed, unstressed)
VOW = {"AA": ("ɑ", "ɑ"), "AE": ("æ", "æ"), "AH": ("ʌ", "ə"), "AO": ("ɔː", "ɔ"),
       "AW": ("aʊ", "aʊ"), "AY": ("aɪ", "aɪ"), "EH": ("e", "e"), "ER": ("ɚː", "ɚ"),
       "EY": ("eɪ", "eɪ"), "IH": ("i", "i"), "IY": ("iː", "i"), "OW": ("oʊ", "oʊ"),
       "OY": ("ɔɪ", "ɔɪ"), "UH": ("u", "u"), "UW": ("uː", "u")}
# vowel + R closing the syllable
VR = {"AA": "ɑːr", "AO": "ɔːr", "OW": "ɔːr", "IY": "iɚ", "IH": "iɚ", "EH": "eɚ", "EY": "eɚ",
      "AE": "eɚ", "UH": "uɚ", "UW": "uɚ", "AY": "aɪɚ", "AW": "aʊɚ", "OY": "ɔɪɚ", "AH": "ɚ"}
# reference symbol for each phoneme (what the library and legend show)
SYMBOL = {**CONS, "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AH0": "ə", "AO": "ɔː", "AW": "aʊ",
          "AY": "aɪ", "EH": "e", "ER": "ɚː", "ER0": "ɚ", "EY": "eɪ", "IH": "i", "IY": "iː",
          "OW": "oʊ", "OY": "ɔɪ", "UH": "u", "UW": "uː", "DX": "ɾ"}
# a few words whose first CMUdict entry is not the everyday form
PREFER = {"usually": 1, "usual": 1, "thirty": 1, "leisure": 0}

_cmu = None


def cmu():
    """word -> list of pronunciations (phones with stress digits)."""
    global _cmu
    if _cmu is None:
        _cmu = {}
        with open(DICT, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.split("#", 1)[0].strip()
                if line:
                    w, *ph = line.split()
                    _cmu.setdefault(re.sub(r"\(\d+\)$", "", w), []).append(ph)
    return _cmu


# Heteronyms: the reading this content intends (CMUdict's first entry is often the
# other one, e.g. live = /láɪv/). Every use of these words in content/ has this
# meaning; the one exception (past-tense "read" in u02-l1-02) is listed in
# heteronyms.json for the voice engineer. Keep this table and heteronyms.json in sync.
INTENDED = {
    "live": ("L IH1 V", "動詞「住む」"), "lives": ("L IH1 V Z", "動詞「住む」"),
    "read": ("R IY1 D", "現在形「読む」"), "lead": ("L IY1 D", "動詞「率いる」"),
    "close": ("K L OW1 Z", "動詞「閉める」"), "use": ("Y UW1 Z", "動詞「使う」"),
    "excuse": ("IH0 K S K Y UW1 Z", "動詞（Excuse me）"), "wind": ("W IH1 N D", "名詞「風」"),
    "perfect": ("P ER1 F IH0 K T", "形容詞「完璧な」"), "survey": ("S ER1 V EY0", "名詞「調査」"),
    "desert": ("D EH1 Z ER0 T", "名詞「砂漠」"), "minute": ("M IH1 N AH0 T", "名詞「分」"),
    "minutes": ("M IH1 N AH0 T S", "名詞「分」"), "learned": ("L ER1 N D", "過去形「学んだ」"),
    "does": ("D AH1 Z", "動詞 do"), "house": ("HH AW1 S", "名詞「家」"), "row": ("R OW1", "名詞「列」"),
}


def prons(word):
    d = cmu()
    w = word.lower().strip()
    if w in INTENDED:
        return [INTENDED[w][0].split()]
    return d.get(w) or d.get(w.strip("'")) or []


def all_prons(word):
    """Every CMUdict pronunciation, ignoring INTENDED (for listing alternatives)."""
    d = cmu()
    w = word.lower().strip()
    return d.get(w) or d.get(w.strip("'")) or []


def base(p):
    return re.sub(r"\d", "", p)


def _accent(sym, stress):
    if stress not in ("1", "2"):
        return sym
    mark = ACUTE if stress == "1" else GRAVE
    return sym[0] + mark + sym[1:]


def to_ipa(phones):
    out, i = [], 0
    while i < len(phones):
        p = phones[i]
        b, s = base(p), p[-1] if p[-1].isdigit() else ""
        if b in VOW:
            nxt = phones[i + 1] if i + 1 < len(phones) else None
            after = phones[i + 2] if i + 2 < len(phones) else None
            if nxt == "R" and b != "ER" and not (after and base(after) in VOW):
                out.append(_accent(VR[b], s))
                i += 2
                continue
            if b == "ER" and s in ("1", "2"):
                out.append(_accent("ɚː", s))
            else:
                out.append(_accent(VOW[b][0 if s in ("1", "2") else 1], s))
        else:
            out.append(CONS[b])
        i += 1
    return "".join(out)


WEAK = {"a", "an", "the", "to", "of", "and", "for", "from", "can", "at", "some", "them",
        "her", "him", "was", "are", "you", "your", "as", "than", "that", "or", "but", "do"}


# weak forms that CMUdict lacks (dictionaries list them as 弱形)
WEAK_EXTRA = {"of": ["AH0", "V"], "from": ["F", "R", "AH0", "M"], "some": ["S", "AH0", "M"],
              "at": ["AH0", "T"]}


def pick(word, phone=None, weak=False):
    """Choose the CMUdict pronunciation that best fits a focus phone."""
    ps = prons(word)
    if not ps:
        return None
    w = word.lower()
    if weak and w in WEAK_EXTRA and (phone is None or phone in map(base, WEAK_EXTRA[w])):
        return WEAK_EXTRA[w]
    if word.lower() in PREFER and phone is None:
        return ps[PREFER[word.lower()]]
    cand = [p for p in ps if phone is None or phone in map(base, p)] or ps
    if w in WEAK and phone in ("AH", "ER", "IH", "UW"):
        red = [p for p in cand if any(base(x) == phone and x.endswith("0") for x in p)]
        if red:
            return red[0]
    if w in WEAK and weak:
        red = [p for p in cand if all(x.endswith("0") for x in p if base(x) in VOW)]
        if red:
            return red[0]
    return cand[0]


def flap_index(phones):
    """Indices of T/D that General American turns into a flap ɾ."""
    idx = []
    for i in range(1, len(phones) - 1):
        if base(phones[i]) not in ("T", "D"):
            continue
        prev, nxt = phones[i - 1], phones[i + 1]
        prev_ok = base(prev) in VOW or base(prev) == "R"
        nxt_ok = base(nxt) in VOW and nxt[-1] in ("0", "2")
        if prev_ok and nxt_ok:
            idx.append(i)
    return idx


def word_ipa(word, phone=None, weak=False):
    p = pick(word, phone, weak)
    return "/" + to_ipa(p) + "/" if p else None


FLAP_NOTE = "米国英語では、この t は舌先で軽くはじく音（ラ行に近い音）になります。"


def flap_note(word):
    p = pick(word)
    return FLAP_NOTE if p and any(base(p[i]) == "T" for i in flap_index(p)) else None


# ------------------------------------------------------------------ misaki
# misaki (Kokoro G2P) style for the voice engineer: stress mark before the vowel,
# r = ɹ, diphthongs as single letters (A = eɪ, I = aɪ, W = aʊ, Y = ɔɪ, O = oʊ).
MK_CONS = {**CONS, "CH": "ʧ", "JH": "ʤ", "G": "ɡ", "R": "ɹ"}
MK_VOW = {"AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "W", "AY": "I", "EH": "ɛ", "ER": "ɜɹ",
          "EY": "A", "IH": "ɪ", "IY": "i", "OW": "O", "OY": "Y", "UH": "ʊ", "UW": "u"}


def to_misaki(phones):
    flaps = set(flap_index(phones))
    out = []
    for i, p in enumerate(phones):
        b, st = base(p), (p[-1] if p[-1].isdigit() else "")
        if b in VOW:
            v = MK_VOW[b]
            if st == "0":
                v = {"AH": "ə", "ER": "əɹ"}.get(b, v)
            out.append({"1": "ˈ", "2": "ˌ"}.get(st, "") + v)
        else:
            out.append("ɾ" if i in flaps else MK_CONS[b])
    return "".join(out)
