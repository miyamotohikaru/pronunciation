#!/usr/bin/env python3
"""content/curriculum.json (+ tools/tts/overrides.json) -> .work/tts/jobs.json for synth.py.

    .venv-tts/bin/python tools/tts/jobs_from_curriculum.py [--curriculum ...] [--overrides ...] [--out ...]

Jobs, ids unchanged:
  - every unit item (units[].lessons[].items[]) and every placement sentence;
  - for every item with a "pair" field, the partner word as "<item-id>-pair" (ear training).
`tts_text` from the curriculum is passed through as a PLAIN respelling ("I'm gonna go."):
the app shows the spoken form, so the word timings are the respelled words. Markdown
brackets there are rejected so a respelling is never read as a phoneme override.
overrides.json (id -> markup such as "[for](/fəɹ/) you") is the TTS-side pronunciation fix;
with the markup stripped it must equal the displayed text, so timing words stay identical.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ID_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]*')  # same rule as synth.py
LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]*)\)')


def build_jobs(curriculum: dict, overrides: dict) -> list:
    src = [it for unit in curriculum['units'] for lesson in unit['lessons'] for it in lesson['items']]
    src += list(curriculum.get('placement', []))
    jobs = []
    for it in src:
        tts = (it.get('tts_text') or '').strip()
        if any(c in tts for c in '[]'):
            raise SystemExit(f'{it["id"]}: tts_text must be a plain respelling, got {tts!r}')
        jobs.append({'id': it['id'], 'text': it['text'].strip(), **({'tts_text': tts} if tts else {})})
        if it.get('pair'):
            jobs.append({'id': f'{it["id"]}-pair', 'text': str(it['pair']).strip()})

    by_id = {}
    for j in jobs:
        if not ID_RE.fullmatch(j['id']) or j['id'] in by_id:
            raise SystemExit(f'bad or duplicate id: {j["id"]!r}')
        by_id[j['id']] = j
    for jid, markup in overrides.items():
        job = by_id.get(jid)
        if job is None:
            raise SystemExit(f'overrides.json: unknown id {jid!r}')
        shown = job.get('tts_text') or job['text']
        if LINK_RE.sub(r'\1', markup) != shown:
            raise SystemExit(f'overrides.json: {jid}: {markup!r} must read {shown!r} without the markup')
        job['tts_text'] = markup
    return jobs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--curriculum', type=Path, default=ROOT / 'content' / 'curriculum.json')
    ap.add_argument('--overrides', type=Path, default=HERE / 'overrides.json')
    ap.add_argument('--out', type=Path, default=ROOT / '.work' / 'tts' / 'jobs.json')
    args = ap.parse_args(argv)
    overrides = json.loads(args.overrides.read_text(encoding='utf-8')) if args.overrides.exists() else {}
    jobs = build_jobs(json.loads(args.curriculum.read_text(encoding='utf-8')), overrides)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(jobs, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    n_pair = sum(j['id'].endswith('-pair') for j in jobs)
    print(f'{len(jobs)} jobs ({len(jobs) - n_pair} items + {n_pair} pair partners; '
          f'{sum("tts_text" in j for j in jobs)} with tts_text, {len(overrides)} from overrides) -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
