#!/usr/bin/env python3
"""content/*.json (+ tools/tts/overrides.json) -> .work/tts/jobs.json + .work/tts/jobs-map.json.

    .venv-tts/bin/python tools/tts/jobs_from_curriculum.py [--content content] [--overrides ...]

Collects every line the app can play, from all content files:
  curriculum.json  units[].lessons[].items[], placement[]; an item's "pair" word -> "<id>-pair"
  challenge.json   long[], intro[].lines[], dialogues[].turns[] (partner AND you lines)
  phonemes.json    phonemes[].practice[]; listen-only examples[].word and pairs[].a/.b
                   -> shared word clips "w-<word>" (one clip per distinct word + IPA)
  alphabet.json    letters[] -> "abc-letter-<L>" (read as "<L>." so "A" is the letter name,
                   not the article); practice[].lines[]
Ids that already exist in the content are kept, so unchanged texts are not re-synthesized
(synth.py's source_hash re-renders only lines whose text changed). Ids must be unique across
all files: a collision is reported and both ids get a per-file prefix (cur-/chl-/ph-/abc-).
jobs-map.json tells the content build which clip id belongs to which content entry.

`tts_text` from the content is a PLAIN respelling ("I'm gonna go."): the app shows the spoken
form, so the timing words are the respelled words; brackets there are rejected. overrides.json
(id -> markup such as "[for](/fəɹ/) you") is the TTS-side pronunciation fix; with the markup
stripped it must equal the displayed text, so timing words stay the display words.
Each job also carries "focus" ([{word, phone}]) and "letters" for check_focus.py.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ID_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]*')  # same rule as synth.py
LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]*)\)')
PREFIX = {'curriculum.json': 'cur-', 'challenge.json': 'chl-', 'phonemes.json': 'ph-', 'alphabet.json': 'abc-'}


def focus_of(entry: dict) -> list:
    return [{'word': f['word'], 'phone': f['phone']} for f in entry.get('focus', []) if f.get('word')]


def line_job(entry: dict, file: str, ref: str, **extra) -> dict:
    tts = (entry.get('tts_text') or '').strip()
    if any(c in tts for c in '[]'):
        raise SystemExit(f'{file} {ref}: tts_text must be a plain respelling, got {tts!r}')
    job = {'id': entry['id'], 'text': entry['text'].strip(), **({'tts_text': tts} if tts else {}),
           'focus': focus_of(entry), 'file': file, 'ref': ref, **extra}
    return job


def word_slug(word: str) -> str:
    return 'w-' + re.sub(r'[^a-z0-9]+', '-', word.lower().replace("'", '')).strip('-')


def collect(content: Path) -> tuple[list, dict]:
    jobs, word_jobs = [], {}
    cur = json.loads((content / 'curriculum.json').read_text(encoding='utf-8'))
    for unit in cur['units']:
        for lesson in unit['lessons']:
            for it in lesson['items']:
                jobs.append(line_job(it, 'curriculum.json', it['id']))
                if it.get('pair'):
                    pw = str(it['pair']).strip()
                    jobs.append({'id': f'{it["id"]}-pair', 'text': pw, 'file': 'curriculum.json',
                                 'ref': f'{it["id"]}#pair',
                                 'focus': [f for f in focus_of(it) if f['word'].lower() == pw.lower()]})
    for p in cur.get('placement', []):
        jobs.append(line_job(p, 'curriculum.json', f'placement/{p["id"]}'))

    chl = json.loads((content / 'challenge.json').read_text(encoding='utf-8'))
    for x in chl.get('long', []):
        jobs.append(line_job(x, 'challenge.json', f'long/{x["id"]}'))
    for s in chl.get('intro', []):
        for x in s['lines']:
            jobs.append(line_job(x, 'challenge.json', f'intro/{s["id"]}/{x["id"]}'))
    for d in chl.get('dialogues', []):
        for x in d['turns']:
            jobs.append(line_job(x, 'challenge.json', f'dialogues/{d["id"]}/{x["id"]}', speaker=x.get('speaker')))

    ph = json.loads((content / 'phonemes.json').read_text(encoding='utf-8'))
    word_refs = defaultdict(list)  # word clip id -> content refs

    def word_clip(word: str, ipa: str, phone: str | None, ref: str) -> None:
        word, key = word.strip(), (word.strip().lower(), ipa.strip('/ '))
        if key not in word_jobs:
            wid, n = word_slug(word), 2
            while any(j['id'] == wid for j in word_jobs.values()):  # same spelling, different IPA
                wid, n = f'{word_slug(word)}-{n}', n + 1
            word_jobs[key] = {'id': wid, 'text': word, 'focus': [], 'file': 'phonemes.json', 'ref': None,
                              'ipa': ipa}
        j = word_jobs[key]
        if phone and not any(f['phone'] == phone for f in j['focus']):
            j['focus'].append({'word': word, 'phone': phone})
        word_refs[j['id']].append(ref)

    for p in ph['phonemes']:
        for x in p.get('practice', []):
            jobs.append(line_job(x, 'phonemes.json', f'{p["id"]}/practice/{x["id"]}'))
        for i, e in enumerate(p.get('examples', [])):
            word_clip(e['word'], e.get('ipa', ''), p['id'], f'{p["id"]}/examples/{i}')
        for i, pr in enumerate(p.get('pairs', [])):
            word_clip(pr['a'], pr.get('a_ipa', ''), p['id'], f'{p["id"]}/pairs/{i}/a')
            word_clip(pr['b'], pr.get('b_ipa', ''), None, f'{p["id"]}/pairs/{i}/b')
    for j in word_jobs.values():
        j['ref'] = word_refs[j['id']]
        jobs.append(j)

    abc = json.loads((content / 'alphabet.json').read_text(encoding='utf-8'))
    for L in abc.get('letters', []):
        letter = L['letter'].strip()
        jobs.append({'id': f'abc-letter-{letter}', 'text': letter, 'tts_text': f'{letter}.',
                     'letters': [letter], 'focus': [], 'file': 'alphabet.json', 'ref': f'letters/{letter}'})
    for s in abc.get('practice', []):
        for x in s['lines']:
            jobs.append(line_job(x, 'alphabet.json', f'practice/{s["id"]}/{x["id"]}', letters=x.get('spell') or []))
    return jobs, word_refs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--content', type=Path, default=ROOT / 'content')
    ap.add_argument('--overrides', type=Path, default=HERE / 'overrides.json')
    ap.add_argument('--out', type=Path, default=ROOT / '.work' / 'tts' / 'jobs.json')
    ap.add_argument('--map', type=Path, default=ROOT / '.work' / 'tts' / 'jobs-map.json')
    args = ap.parse_args(argv)
    jobs, _ = collect(args.content)

    # global id uniqueness: prefix colliding ids per file and report
    counts = Counter(j['id'] for j in jobs)
    collisions = sorted(i for i, n in counts.items() if n > 1)
    for j in jobs:
        if j['id'] in collisions:
            j['id'] = PREFIX[j['file']] + j['id']
    if len({j['id'] for j in jobs}) != len(jobs):
        raise SystemExit(f'ids still collide after prefixing: {collisions}')
    bad = [j['id'] for j in jobs if not ID_RE.fullmatch(j['id'])]
    if bad:
        raise SystemExit(f'invalid ids: {bad[:10]}')

    overrides = json.loads(args.overrides.read_text(encoding='utf-8')) if args.overrides.exists() else {}
    by_id = {j['id']: j for j in jobs}
    for jid, markup in overrides.items():
        job = by_id.get(jid)
        if job is None:
            raise SystemExit(f'overrides.json: unknown id {jid!r}')
        shown = job.get('tts_text') or job['text']
        if LINK_RE.sub(r'\1', markup) != shown:
            raise SystemExit(f'overrides.json: {jid}: {markup!r} must read {shown!r} without the markup')
        job['tts_text'] = markup

    mapping = {'version': 1, 'note': 'clip id -> public/audio/<voice>/<clip>[.slow|.slower].mp3 and '
               '.work/tts/<voice>/<clip>[...].json; refs point into the content files',
               'collisions': collisions, 'clips': {}}
    for j in jobs:
        mapping['clips'][j['id']] = {'file': j['file'], 'refs': j['ref'] if isinstance(j['ref'], list) else [j['ref']],
                                     **({'speaker': j['speaker']} if j.get('speaker') else {})}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(jobs, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    args.map.write_text(json.dumps(mapping, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    per_file = Counter(j['file'] for j in jobs)
    print(f'{len(jobs)} jobs {dict(per_file)}; words {sum(j["id"].startswith("w-") for j in jobs)}, '
          f'pairs {sum(j["id"].endswith("-pair") for j in jobs)}, letters {sum(j["id"].startswith("abc-letter-") for j in jobs)}; '
          f'tts_text {sum("tts_text" in j for j in jobs)} ({len(overrides)} overrides); collisions {collisions or "none"}')
    print(f'-> {args.out}\n-> {args.map}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
