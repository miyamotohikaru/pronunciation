"""Phone inventories and mappings.

* teacher (lv-60 espeak, 392 tokens, multilingual) -> student set (reduced IPA, see STUDENT_VOCAB)
* CMUdict / speechocean762 ARPAbet -> student set (for canonical references and vb223 outputs)

Reduction principle (documented in README):
  1. keep every token the teacher actually uses for English / Japanese-accented English
     (frequency counted on a pilot set, see LOG.md),
  2. strip features the app does not need: tones (digits), gemination (ː on consonants),
     palatalisation (ʲ), aspiration (Mandarin 'th','kh','ph' = aspirated stops, NOT θ),
     dental/retroflex/nasal diacritics,
  3. map the remaining rare foreign phones to the nearest kept phone (table EXPLICIT).
Posterior mass is summed over all teacher tokens that map to the same student token,
so the student target is the exact marginal of the teacher distribution.
"""
import re

BLANK = "<blk>"

# Student vocabulary (index 0 = CTC blank). Order is part of the exported model contract.
STUDENT_VOCAB = [
    BLANK,
    # English consonants
    "p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h",
    "tʃ", "dʒ", "m", "n", "ŋ", "l", "ɹ", "w", "j",
    # extra consonants (allophones / L1-transfer phones)
    "ɾ", "r", "ʔ", "ɕ", "tɕ", "dʑ", "ts", "ɸ", "β", "ç", "x", "ɲ",
    # English vowels (espeak en-us style)
    "iː", "i", "ɪ", "ᵻ", "eɪ", "ɛ", "æ", "ɐ", "ə", "ʌ", "ɑː", "ɑ", "ɔː", "ɔ", "ɒ",
    "oʊ", "ʊ", "uː", "u", "ɚ", "ɜː", "aɪ", "aʊ", "ɔɪ", "əl",
    # r-coloured / centring vowels as the teacher emits them (one token each)
    "ɑːɹ", "ɔːɹ", "ɛɹ", "ɪɹ", "ʊɹ", "oːɹ", "iə", "aɪɚ", "aɪə",
    # Japanese / foreign vowels (pure a e o, unrounded u, long forms, front rounded)
    "a", "e", "o", "ɯ", "aː", "eː", "oː", "y",
]
SID = {p: i for i, p in enumerate(STUDENT_VOCAB)}

# Teacher tokens mapped explicitly (after the generic stripping in teacher_to_student).
EXPLICIT = {
    "<pad>": BLANK, "<s>": BLANK, "</s>": BLANK, "<unk>": BLANK, "??": BLANK, "1": BLANK, "ʲ": BLANK,
    # rhotics / laterals
    "ʁ": "r", "r̝": "r", "r̝̊": "r", "ɽ": "ɾ", "ɻ": "ɹ", "r̩": "r", "ɭ": "l", "ɫ": "l", "ʎ": "l", "ɬ": "l",
    "l̩": "əl", "ʋ": "v",
    # fricatives / affricates
    "s.": "ʃ", "ʂ": "ʃ", "ʐ": "ʒ", "ʑ": "dʑ", "ts.": "tʃ", "ts.h": "tʃ", "tɕh": "tɕ", "tsh": "ts",
    "S": "ʃ", "tS": "tʃ", "dZ": "dʒ", "s^": "s", "sx": "s", "χ": "x", "X": "x", "ɣ": "ɡ", "ʝ": "j",
    "ħ": "h", "ʕ": "h", "pf": "f", "dz": "z",
    # stops
    "th": "t", "kh": "k", "ph": "p", "c": "k", "ɟ": "ɡ", "q": "k", "ʈ": "t", "ɖ": "d", "t[": "t", "d[": "d",
    "t^": "t", "d^": "d", "dˤ": "d", "dˤdˤ": "d", "cʰcʰ": "k",
    # nasals
    "ɴ": "n", "N": "n", "n̩": "n", "ɳ": "n", "nʲʲ": "n",
    # vowels
    "e̞": "e", "o̞": "o", "e̞e̞": "eː", "o̞o̞": "oː", "ɯᵝ": "ɯ", "ɯᵝɯᵝ": "ɯ", "ɯɯ": "ɯ",
    "ɜ": "ɜː", "ɵ": "ə", "ɘ": "ə", "œ": "ə", "ø": "ə", "øː": "ə", "œː": "ə", "ɵː": "ə", "ɨ": "ᵻ", "ɨː": "ᵻ",
    "ʉ": "u", "ä": "a", "ää": "aː", "ɐɐ": "ɐ", "ã": "a", "ɑ̃": "ɑ", "ɔ̃": "ɔ", "ɛ̃": "ɛ", "œ̃": "ə",
    "ɐ̃": "ɐ", "ɐ̃ʊ̃": "aʊ", "ũ": "u", "õ": "o", "ĩ": "i", "ẽ": "e", "ẽː": "eː",
    "ɛː": "ɛ", "æː": "æ", "ɪː": "ɪ", "ʊː": "ʊ", "iːː": "iː", "yː": "y", "ɔø": "ɔɪ",
    "əl": "əl", "eʊ": "oʊ", "əʊ": "oʊ", "ɛʊ": "oʊ", "ou": "oʊ", "ei": "eɪ", "ɛɪ": "eɪ", "ee": "eː", "ai": "aɪ", "æi": "aɪ",
    "æiː": "aɪ", "au": "aʊ", "oɪ": "ɔɪ", "əɪ": "aɪ", "ɑɨ": "aɪ", "aɨ": "aɪ", "ɔɨ": "ɔɪ", "uɨ": "uː", "əɨ": "aɪ",
    "eə": "ɛɹ", "ʊə": "ʊɹ", "iɜ": "iə", "əɜ": "ɚ", "oɜ": "oʊ", "uɜ": "uː", "ɑɜ": "ɑ", "aɜ": "a", "yɜ": "y",
    "ər": "ɚ", "u\"": "u", "ɪ^": "ɪ", "ie": "iə", "iɛ": "iə", "ja": "j", "ju": "j", "ɪu": "uː", "ɪuː": "uː",
    "iʊ": "uː", "ɨu": "uː", "eɑ": "ɑ", "øi": "ɔɪ", "uɪ": "ɔɪ", "ui": "uː", "ua": "w", "uo": "w", "uə": "w",
    "uai": "w", "uei": "w", "yi": "y", "yu": "y", "yə": "y", "yɛ": "y", "yæ": "y", "iou": "j", "iɑ": "j",
    "iɑu": "j", "iɛ5ʲ": "iə", "oe": "o", "oe:": "oː", "e:": "eː", "o:": "oː", "u:": "uː", "i:": "iː",
    "a:": "aː", "ɑ:": "ɑː", "y:": "y", "oːɹ": "oːɹ", "aɪɚ": "aɪɚ", "aɪə": "aɪə", "iə": "iə",
    "ɑu": "aʊ", "onɡ": "ʊ", "a.": "a", "a.ː": "aː", "i.": "i", "i.ː": "iː", "u.": "u", "u.ː": "uː",
    "r.": "ɹ", "s̪": "s", "t̪": "t", "i̪": "i", "æː": "æ",
}

_TONE = re.compile(r"[0-9]+$")


def _candidates(tok):
    """Progressively simplified spellings of a teacher token."""
    import unicodedata
    t = unicodedata.normalize("NFC", tok)
    yield t
    t = t.replace("ʲ", "").replace("ʰ", "")             # palatalisation / aspiration marks
    yield t
    t = _TONE.sub("", t)                                  # Mandarin tones: 'i5' -> 'i'
    yield t
    if len(t) > 2 and t.endswith("ɜ"):                    # tone-3 written as 'ɜ' ('iɛɜ')
        t = t[:-1]
        yield t
    if len(t) > 1 and t.endswith("ː") and t[:-1] in CONSONANTS:
        yield t[:-1]                                      # geminate consonant
    t = t.replace(".", "")
    yield t
    d = unicodedata.normalize("NFD", t)
    d = "".join(ch for ch in d if not unicodedata.combining(ch))  # nasal / dental / syllabic marks
    yield unicodedata.normalize("NFC", d)
    yield d.replace("ː", "")


def teacher_to_student(tok):
    """Map one teacher token to a student token (string), or None."""
    for c in _candidates(tok):
        if c in SID:
            return c
        if c in EXPLICIT:
            return EXPLICIT[c]
    return None


CONSONANTS = {"p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "tʃ", "dʒ", "m",
              "n", "ŋ", "l", "ɹ", "w", "j", "ɾ", "r", "ʔ", "ɕ", "tɕ", "dʑ", "ts", "ɸ", "β", "ç", "x", "ɲ"}
VOWELS = [p for p in STUDENT_VOCAB[1:] if p not in CONSONANTS]


def teacher_map_matrix(teacher_vocab):
    """List: teacher id -> student id (every teacher token must map)."""
    out = []
    for tok in teacher_vocab:
        s = teacher_to_student(tok)
        if s is None:
            raise KeyError(f"unmapped teacher token {tok!r}")
        out.append(SID[s])
    return out


# ----------------------------------------------------------------------------- ARPAbet

ARPA_CONS = {
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "dʒ", "K": "k",
    "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t",
    "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}
ARPA_VOW = {  # base -> (stressed, unstressed)
    "AA": ("ɑː", "ɑː"), "AE": ("æ", "æ"), "AH": ("ʌ", "ə"), "AO": ("ɔː", "ɔː"), "AW": ("aʊ", "aʊ"),
    "AY": ("aɪ", "aɪ"), "EH": ("ɛ", "ɛ"), "ER": ("ɜː", "ɚ"), "EY": ("eɪ", "eɪ"), "IH": ("ɪ", "ɪ"),
    "IY": ("iː", "i"), "OW": ("oʊ", "oʊ"), "OY": ("ɔɪ", "ɔɪ"), "UH": ("ʊ", "ʊ"), "UW": ("uː", "uː"),
}
# vowel + coda R -> single teacher token
R_COLOURED = {"ɑː": "ɑːɹ", "ɔː": "ɔːɹ", "oʊ": "oːɹ", "ɛ": "ɛɹ", "eɪ": "ɛɹ", "æ": "ɛɹ", "ɪ": "ɪɹ",
              "iː": "ɪɹ", "i": "ɪɹ", "ʊ": "ʊɹ", "uː": "ʊɹ", "aɪ": "aɪɚ"}


def arpa_to_ipa(phones, merge_coda_r=True, stress_aware=True):
    """['TH','IH1','NG','K'] -> ['θ','ɪ','ŋ','k'].  Accepts stress digits or none (speechocean
    phones are mostly unstressed '0' or bare). Vowel + R not followed by a vowel -> r-coloured token."""
    out = []
    base = [re.sub(r"[0-9]", "", p).upper() for p in phones]
    stress = [re.sub(r"[^0-9]", "", p) for p in phones]
    for i, (b, s) in enumerate(zip(base, stress)):
        if b in ARPA_CONS:
            if (b == "R" and merge_coda_r and out and out[-1] in R_COLOURED and (i + 1 == len(base) or base[i + 1] not in ARPA_VOW)
                    and i > 0 and base[i - 1] in ARPA_VOW):
                out[-1] = R_COLOURED[out[-1]]
                continue
            out.append(ARPA_CONS[b])
        elif b in ARPA_VOW:
            st, un = ARPA_VOW[b]
            out.append(un if (stress_aware and s == "0") else st)
        else:
            raise KeyError(b)
    return out


# Coarse classes for "lenient" PER (allophonic / accent variation that the app should not flag)
COARSE = {
    "i": "iː", "ᵻ": "ɪ", "ɐ": "ə", "ʌ": "ə", "ɑ": "ɑː", "ɒ": "ɑː", "ɔ": "ɔː", "u": "uː", "ɜː": "ɚ",
    "e": "eɪ", "eː": "eɪ", "o": "oʊ", "oː": "oʊ", "a": "ɑː", "aː": "ɑː", "ɯ": "uː", "y": "uː",
}


def coarse(p):
    return COARSE.get(p, p)


# ----------------------------------------------------------------------------- Kokoro / misaki phonemes

KOKORO_MAP = {"A": "eɪ", "I": "aɪ", "O": "oʊ", "W": "aʊ", "Y": "ɔɪ", "Q": "oʊ", "ᵊ": "ə", "ʤ": "dʒ", "ʧ": "tʃ", "T": "ɾ",
              "ʨ": "tɕ", "ʥ": "dʑ", "ʦ": "ts", "g": "ɡ", "ɑ": "ɑː", "ɔ": "ɔː", "u": "uː", "ɜ": "ɜː"}
KOKORO_VOWEL_CHARS = set("AIOWYQᵊæɑɔəɚɛɪiʊuʌɜɒaeoɯᵻɐ")
KOKORO_SKIP = set(" .,!?;:\"“”()—…→↓↗↘'-")
_R_MERGE = {"ɑː": "ɑːɹ", "ɔː": "ɔːɹ", "ɛ": "ɛɹ", "ɪ": "ɪɹ", "ʊ": "ʊɹ", "oʊ": "oːɹ", "ɜː": "ɜː", "ɚ": "ɚ"}


def kokoro_to_student(ps):
    """misaki/Kokoro phoneme string (as synthesised) -> student tokens, following the teacher's
    espeak en-us conventions (stressed i -> iː, coda r merged into r-coloured vowel tokens)."""
    toks, stressed = [], False
    for c in ps:
        if c in KOKORO_SKIP:
            continue
        if c in "ˈˌ":
            stressed = True
            continue
        if c == "ː":
            if toks and toks[-1] + "ː" in SID:
                toks[-1] += "ː"
            continue
        if c == "i":
            t = "iː" if stressed else "i"
        else:
            t = KOKORO_MAP.get(c, c)
        if c in KOKORO_VOWEL_CHARS:
            stressed = False
        toks.append(t)
    out = []
    for k, t in enumerate(toks):
        nxt = toks[k + 1] if k + 1 < len(toks) else None
        if t == "ɹ" and out and out[-1] in _R_MERGE and (nxt is None or nxt not in VOWELS_SET):
            out[-1] = _R_MERGE[out[-1]]
            continue
        if t == "ɚ" and out and out[-1] == "aɪ":
            out[-1] = "aɪɚ"
            continue
        if t == "ə" and out and out[-1] == "ɪ":       # British NEAR
            out[-1] = "iə"
            continue
        if t == "ɹ" and out and out[-1] == "ə" and (nxt is None or nxt not in VOWELS_SET):
            out[-1] = "ɚ"                             # 'əɹ' coda = teacher's ɚ
            continue
        out.append(t)
    return out


# Injected errors that Kokoro renders reliably (the teacher hears most of them, see LOG.md);
# only these sites override the teacher in truth_target().
RELIABLE_SUBS = {("ɹ", "l"), ("l", "ɹ"), ("v", "b"), ("θ", "s"), ("θ", "t"), ("θ", "f"), ("ð", "z"), ("ð", "d"),
                 ("s", "ʃ"), ("s", "ɕ"), ("f", "h")}
EPENTHETIC = {"u", "uː", "ɯ", "o", "oʊ", "i", "iː", "ə"}


def injected_sites(canonical_ps, produced_ps):
    """Indices (into kokoro_to_student(produced_ps)) of reliably rendered injected errors."""
    import numpy as np
    c = kokoro_to_student(canonical_ps)
    p = kokoro_to_student(produced_ps)
    n, m = len(c), len(p)
    D = np.zeros((n + 1, m + 1), dtype=np.int32)
    D[:, 0] = np.arange(n + 1)
    D[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j] + 1, D[i, j - 1] + 1, D[i - 1, j - 1] + (c[i - 1] != p[j - 1]))
    i, j, sites = n, m, []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i, j] == D[i - 1, j - 1] + (c[i - 1] != p[j - 1]):
            if c[i - 1] != p[j - 1] and (c[i - 1], p[j - 1]) in RELIABLE_SUBS:
                sites.append(j - 1)
            i, j = i - 1, j - 1
        elif j > 0 and D[i, j] == D[i, j - 1] + 1:
            if p[j - 1] in EPENTHETIC and j >= 2 and p[j - 2] in CONSONANTS:
                sites.append(j - 1)
            j -= 1
        else:
            i -= 1
    return sorted(sites)


VOWELS_SET = set(VOWELS)
