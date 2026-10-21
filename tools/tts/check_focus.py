#!/usr/bin/env python3
"""Does the synthesized pronunciation contain the curriculum's target sound?

    .venv-tts/bin/python tools/tts/check_focus.py [--voice af_heart] [--work .work/tts]

For every focus {word, phone (ARPAbet)} in content/curriculum.json, looks up that word in
the rendered json (.work/tts/<voice>/<id>.json, i.e. exactly what Kokoro was given; a pair
partner's focus word in <id>-pair.json) and checks its misaki phonemes contain the phone. Catches heteronyms read the wrong way
(e.g. "live" as /laɪv/ in an IH-vs-IY pair). Phonemes are voice-independent.
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
    'AA': 'ɑ', 'AE': 'æ', 'AH': 'ʌəᵊɐ', 'AO': 'ɔ', 'AW': 'W', 'AY': 'I', 'EH': 'ɛ', 'ER': ['ɜɹ', 'əɹ', 'ɚ'],
    'EY': 'A', 'IH': 'ɪᵻ', 'IY': 'i', 'OW': 'O', 'OY': 'Y', 'UH': 'ʊ', 'UW': 'u',
    'B': 'b', 'CH': 'ʧ', 'D': 'd', 'DH': 'ð', 'F': 'f', 'G': 'ɡ', 'HH': 'h', 'JH': 'ʤ', 'K': 'k',
    'L': 'l', 'M': 'm', 'N': 'n', 'NG': 'ŋ', 'P': 'p', 'R': 'ɹ', 'S': 's', 'SH': 'ʃ', 'T': 'tT',
    'TH': 'θ', 'V': 'v', 'W': 'w', 'Y': 'j', 'Z': 'z', 'ZH': 'ʒ',
}


def norm(w: str) -> str:
    return re.sub(r"[^a-z']", '', w.lower().replace('’', "'"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--curriculum', type=Path, default=ROOT / 'content' / 'curriculum.json')
    ap.add_argument('--work', type=Path, default=ROOT / '.work' / 'tts')
    ap.add_argument('--voice', default='af_heart')
    args = ap.parse_args(argv)
    cur = json.loads(args.curriculum.read_text(encoding='utf-8'))
    items = [it for u in cur['units'] for l in u['lessons'] for it in l['items']] + cur.get('placement', [])
    bad, missing, checked = [], [], 0
    for it in items:
        jp = args.work / args.voice / f'{it["id"]}.json'
        if not jp.exists():
            missing.append(f'{it["id"]}(no render)')
            continue
        words = json.loads(jp.read_text(encoding='utf-8'))['words']
        pp = jp.with_name(f'{it["id"]}-pair.json')
        if pp.exists():
            words = words + json.loads(pp.read_text(encoding='utf-8'))['words']
        for f in it.get('focus', []):
            want = ARPA.get(f['phone'])
            hits = [w for w in words if norm(w['text']) == norm(f['word'])
                    or norm(f['word']) in norm(w['text']).split()]
            if want is None or not hits:
                missing.append(f'{it["id"]}:{f["word"]}/{f["phone"]}')
                continue
            checked += 1
            ps = hits[0]['phonemes']
            if not any(sym in ps for sym in want):
                bad.append(f'{it["id"]}: "{f["word"]}" {f["phone"]} not in /{ps}/')
    print(f'focus checked {checked}, mismatches {len(bad)}, not checked {len(missing)}')
    for b in bad:
        print('  MISMATCH', b)
    if missing:
        print('  not checked:', ' '.join(missing[:30]) + (' ...' if len(missing) > 30 else ''))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
