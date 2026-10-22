#!/usr/bin/env python3
"""Do the synthesized pronunciations contain the content's target sounds and letter names?

    .venv-tts/bin/python tools/tts/check_focus.py [--voice af_heart] [--g2p]

Reads .work/tts/jobs.json (built by jobs_from_curriculum.py; every job carries the content's
focus [{word, phone (ARPAbet)}] and, for spelling lines, the spelled "letters").
  focus   : the focus word's misaki phonemes must contain the phone (catches heteronyms such
            as "live" read /laɪv/, or strong forms where the lesson wants a weak form)
  letters : spelled letters, single capital letters (except I and A outside spelling lists) and
            acronyms (BBC, I.D., ASAP) must be read as letter names, not as words
Phonemes come from the rendered json (.work/tts/<voice>/<id>.json = exactly what Kokoro got),
or with --g2p straight from misaki (no audio needed; use it before rendering).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# ARPAbet -> misaki (Kokoro v1.0) symbols that count as that sound
ARPA = {
    'AA': 'ɑ', 'AE': 'æ', 'AH': 'ʌəᵊɐ', 'AH0': 'əᵊɐ', 'AO': 'ɔ', 'AW': 'W', 'AY': 'I', 'EH': 'ɛ',
    'ER': ['ɜɹ', 'əɹ', 'ɚ'], 'ER0': ['əɹ', 'ɚ'], 'EY': 'A', 'IH': 'ɪᵻ', 'IY': 'i', 'OW': 'O', 'OY': 'Y',
    'UH': 'ʊ', 'UW': 'u', 'B': 'b', 'CH': 'ʧ', 'D': 'd', 'DH': 'ð', 'DX': 'T', 'F': 'f', 'G': 'ɡ',
    'HH': 'h', 'JH': 'ʤ', 'K': 'k', 'L': 'l', 'M': 'm', 'N': 'n', 'NG': 'ŋ', 'P': 'p', 'R': 'ɹ',
    'S': 's', 'SH': 'ʃ', 'T': 'tT', 'TH': 'θ', 'V': 'v', 'W': 'w', 'Y': 'j', 'Z': 'z', 'ZH': 'ʒ',
}
LETTER_NAMES = {  # misaki spelling of each letter name, stress marks removed
    'A': 'A', 'B': 'bi', 'C': 'si', 'D': 'di', 'E': 'i', 'F': 'ɛf', 'G': 'ʤi', 'H': 'Aʧ', 'I': 'I',
    'J': 'ʤA', 'K': 'kA', 'L': 'ɛl', 'M': 'ɛm', 'N': 'ɛn', 'O': 'O', 'P': 'pi', 'Q': 'kju', 'R': 'ɑɹ',
    'S': 'ɛs', 'T': 'ti', 'U': 'ju', 'V': 'vi', 'W': 'dʌbᵊlju', 'X': 'ɛks', 'Y': 'wI', 'Z': 'zi',
}
ACRONYM_RE = re.compile(r"(?:[A-Z]\.?){2,}")
POSSESSIVE_RE = re.compile(r"(?:'s|’s)$")


def norm(w: str) -> str:
    return re.sub(r"[^a-z']", '', w.lower().replace('’', "'"))


def bare(ps: str) -> str:
    return ps.replace('ˈ', '').replace('ˌ', '').replace(' ', '')


def letter_problems(job: dict, words: list) -> list:
    out, covered = [], set()
    spelled = {L.upper() for L in job.get('letters', [])}
    for w in words:
        text = POSSESSIVE_RE.sub('', w['text'].strip('.,!?;:"“”'))
        letters = text.replace('.', '')
        if not letters.isalpha() or not letters.isupper():
            continue
        is_acronym = ACRONYM_RE.fullmatch(text) is not None and len(letters) >= 2
        is_letter = len(letters) == 1 and (letters in spelled or letters not in ('I', 'A'))
        if not (is_acronym or is_letter):
            continue
        covered |= set(letters)
        want = ''.join(LETTER_NAMES[c] for c in letters)
        got = bare(w['phonemes'])
        if not (got == want or (POSSESSIVE_RE.search(w['text']) and got.startswith(want))):
            out.append(f'{job["id"]}: "{w["text"]}" read /{w["phonemes"]}/, letter names /{want}/')
    for L in sorted(spelled - covered):
        out.append(f'{job["id"]}: spelled letter {L} not found among words')
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', type=Path, default=ROOT / '.work' / 'tts' / 'jobs.json')
    ap.add_argument('--work', type=Path, default=ROOT / '.work' / 'tts')
    ap.add_argument('--voice', default='af_heart')
    ap.add_argument('--g2p', action='store_true', help='use misaki directly instead of rendered json')
    args = ap.parse_args(argv)
    jobs = json.loads(args.jobs.read_text(encoding='utf-8'))
    g2p = None
    if args.g2p:
        from misaki import en, espeak
        g2p = en.G2P(trf=False, british=False, fallback=espeak.EspeakFallback(british=False), unk='')

    focus_bad, letter_bad, missing, checked, oov = [], [], [], 0, []
    for job in jobs:
        if g2p:
            _, toks = g2p(job.get('tts_text') or job['text'])
            words = [{'text': t.text, 'phonemes': t.phonemes or ''} for t in toks if any(c.isalnum() for c in t.text)]
        else:
            jp = args.work / args.voice / f'{job["id"]}.json'
            if not jp.exists():
                missing.append(f'{job["id"]}(no render)')
                continue
            m = json.loads(jp.read_text(encoding='utf-8'))
            words, oov = m['words'], oov + [f'{job["id"]}:{w}' for w in m.get('oov', [])]
        for f in job.get('focus', []):
            want = ARPA.get(f['phone'])
            hits = [w for w in words if norm(w['text']) == norm(f['word'])
                    or norm(f['word']) in (norm(x) for x in re.split(r'[\s-]+', w['text']))]
            if want is None or not hits:
                missing.append(f'{job["id"]}:{f["word"]}/{f["phone"]}')
                continue
            checked += 1
            if not any(sym in hits[0]['phonemes'] for sym in want):
                focus_bad.append(f'{job["id"]}: "{f["word"]}" {f["phone"]} not in /{hits[0]["phonemes"]}/')
        letter_bad += letter_problems(job, words)

    print(f'focus checked {checked}, mismatches {len(focus_bad)}, not checked {len(missing)}; '
          f'letter/acronym problems {len(letter_bad)}' + ('' if g2p else f'; OOV {len(oov)}'))
    for b in focus_bad:
        print('  MISMATCH', b)
    for b in letter_bad:
        print('  LETTER  ', b)
    if missing:
        print('  not checked:', ' '.join(missing[:30]) + (' ...' if len(missing) > 30 else ''))
    if oov:
        print('  OOV:', ' '.join(oov[:40]) + (' ...' if len(oov) > 40 else ''))
    return 1 if focus_bad or letter_bad else 0


if __name__ == '__main__':
    sys.exit(main())
