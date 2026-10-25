"""Run the lv-60 teacher over a source and store audio + teacher posteriors for distillation.

    python label.py <source> <in_path> <part_name> [--speed] [--max N] [--filter-accent ...] [--rows a-b]

source: librispeech | speechocean | globe | wavdir
Output: .work/distill/data/<part_name>/
    audio.bin      int16 PCM 16 kHz (clean, possibly speed-perturbed), concatenated
    post.bin       float16 [frames, V_student] teacher log-probs marginalised onto the student set
    topk_idx.bin   int16  [frames, 8] teacher top-8 ids in the 392-token space (insurance for remapping)
    topk_lp.bin    float16 [frames, 8] their log-probs
    index.jsonl    one line per utterance: offsets, lengths, ids, speaker, text, speed, teacher greedy
Teacher frame i is centred on student frame i (see common.py). Resumable: existing ids are skipped.
"""
import argparse
import io
import json
import os
import random
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import torch

sys.path.insert(0, str(Path(__file__).parent))
from common import SR, WORK, Teacher, ctc_greedy, decode_audio, n_student_frames, resample  # noqa: E402
import phoneset as P  # noqa: E402

TOPK = 8


def read_parquet_rows(path, columns, rows=None):
    pf = pq.ParquetFile(path)
    i = 0
    for rg in range(pf.num_row_groups):
        n = pf.metadata.row_group(rg).num_rows
        if rows is not None and (i + n <= rows[0] or i >= rows[1]):
            i += n
            continue
        for r in pf.read_row_group(rg, columns=columns).to_pylist():
            if rows is None or rows[0] <= i < rows[1]:
                yield i, r
            i += 1


def src_librispeech(path, args):
    for i, r in read_parquet_rows(path, ["audio", "text", "speaker_id", "id"], args.rows):
        yield dict(id=r["id"], speaker=f"ls{r['speaker_id']}", dataset="librispeech", text=r["text"],
                   audio=lambda r=r: decode_audio(r["audio"]["bytes"]))


def src_speechocean(path, args):
    for i, r in read_parquet_rows(path, ["audio", "text", "speaker", "age", "gender", "accuracy"], args.rows):
        yield dict(id=f"so{r['speaker']}_{i}", speaker=f"so{r['speaker']}", dataset="speechocean762", text=r["text"],
                   meta=dict(age=r["age"], gender=r["gender"], accuracy=r["accuracy"]),
                   audio=lambda r=r: decode_audio(r["audio"]["bytes"]))


def src_globe(path, args):
    keep = None
    if args.filter_tsv:
        keep = set()
        for line in open(args.filter_tsv):
            sh, row = line.split("\t")[:2]
            if sh == args.shard:
                keep.add(int(row))
    for i, r in read_parquet_rows(path, ["audio", "speaker_id", "transcript", "accent", "duration", "gender", "age"], args.rows):
        if keep is not None and i not in keep:
            continue
        yield dict(id=f"gl{Path(path).stem}_{i}", speaker=f"gl{r['speaker_id']}", dataset="globe", text=r["transcript"],
                   meta=dict(accent=r["accent"], gender=r["gender"], age=r["age"]),
                   audio=lambda r=r: decode_audio(r["audio"]["bytes"]))


def src_wavdir(path, args):
    """Directory of .wav (any sr) with optional same-stem .json holding 'text'/'voice'/'phonemes'."""
    dirs = Path(path[1:]).read_text().split() if str(path).startswith("@") else str(path).split(",")
    wavs = [w for d in dirs for w in sorted(Path(d).rglob("*.wav"))]
    for w in wavs:
        meta = {}
        j = w.with_suffix(".json")
        if j.exists():
            try:
                meta = json.loads(j.read_text())
            except Exception:
                meta = {}
        spk = meta.get("voice", w.parent.name)
        yield dict(id=f"{w.parent.name}_{w.stem}", speaker=spk, dataset=args.dataset or "wavdir", text=meta.get("text", ""),
                   meta={k: meta[k] for k in ("phonemes", "voice", "speed", "kind", "target", "produced", "site", "sub",
                                              "intended", "produced_phone", "context", "word", "lang", "sites",
                                              "site_info", "sub_type", "cid", "feature") if k in meta},
                   audio=lambda w=w: decode_audio(str(w)))


SOURCES = {"librispeech": src_librispeech, "speechocean": src_speechocean, "globe": src_globe, "wavdir": src_wavdir}


def speed_perturb(a, s):
    if s == 1.0:
        return a
    # s=1.1 -> 11:10 (shorter, faster, higher); s=0.9 -> 9:10
    return resample(a, int(round(s * 10)), 10)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("in_path")
    ap.add_argument("part")
    ap.add_argument("--speed", action="store_true", help="random speed 0.9/1.0/1.1 (p .2/.6/.2)")
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--rows", type=str, default=None, help="a-b row range")
    ap.add_argument("--filter-tsv", type=str, default=None, help="GLOBE: tsv (shard,row,...) of rows to keep")
    ap.add_argument("--shard", type=str, default=None)
    ap.add_argument("--dataset", type=str, default=None)
    ap.add_argument("--max-sec", type=float, default=35.0)
    ap.add_argument("--min-sec", type=float, default=0.6)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--every", type=int, default=1, help="keep every k-th source row (spread over speakers)")
    args = ap.parse_args()
    if args.rows:
        a, b = args.rows.split("-")
        args.rows = (int(a), int(b))

    out = WORK / "data" / args.part
    out.mkdir(parents=True, exist_ok=True)
    idx_path = out / "index.jsonl"
    done, a_off, f_off = set(), 0, 0
    if idx_path.exists():
        lines = [json.loads(l) for l in open(idx_path) if l.strip()]
        for l in lines:
            done.add(l["id"])
        if lines:
            a_off = lines[-1]["a_off"] + lines[-1]["a_len"]
            f_off = lines[-1]["f_off"] + lines[-1]["f_len"]
    V = len(P.STUDENT_VOCAB)
    # truncate partially written tails (crash safety)
    for name, unit in [("audio.bin", 2 * a_off), ("post.bin", 2 * V * f_off), ("topk_idx.bin", 2 * TOPK * f_off), ("topk_lp.bin", 2 * TOPK * f_off)]:
        p = out / name
        if p.exists() and p.stat().st_size > unit:
            with open(p, "r+b") as fh:
                fh.truncate(unit)

    teacher = Teacher("mps", torch.float32)
    tmap = torch.tensor(P.teacher_map_matrix(teacher.vocab))
    rng = random.Random(args.seed)
    files = {n: open(out / n, "ab") for n in ["audio.bin", "post.bin", "topk_idx.bin", "topk_lp.bin"]}
    idx_f = open(idx_path, "a")
    n_new, sec, t0 = 0, 0.0, time.time()
    for k, item in enumerate(SOURCES[args.source](args.in_path, args)):
        if k % args.every:
            continue
        if item["id"] in done:
            continue
        if args.max and n_new >= args.max:
            break
        a = item["audio"]()
        dur = len(a) / SR
        if dur < args.min_sec or dur > args.max_sec:
            continue
        s = 1.0
        if args.speed:
            s = rng.choices([0.9, 1.0, 1.1], [0.2, 0.6, 0.2])[0]
            a = speed_perturb(a, s)
        peak = float(np.abs(a).max()) + 1e-9
        if peak > 1.0:
            a = a / peak
        lp = teacher.logprobs(a)                                     # [M, 392] float32 (cpu)
        m = lp.shape[0]
        assert m == n_student_frames(len(a))
        post = torch.zeros(m, V).index_add_(1, tmap, lp.exp()).clamp_min(1e-8).log()
        tk = lp.topk(TOPK, dim=-1)
        greedy = " ".join(P.STUDENT_VOCAB[i] for i in ctc_greedy(post.argmax(-1).tolist(), 0))
        files["audio.bin"].write((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())
        files["post.bin"].write(post.numpy().astype(np.float16).tobytes())
        files["topk_idx.bin"].write(tk.indices.numpy().astype(np.int16).tobytes())
        files["topk_lp.bin"].write(tk.values.numpy().astype(np.float16).tobytes())
        for fh in files.values():
            fh.flush()
        rec = dict(id=item["id"], speaker=item["speaker"], dataset=item["dataset"], text=item["text"], speed=s,
                   a_off=a_off, a_len=len(a), f_off=f_off, f_len=m, greedy=greedy, **({"meta": item["meta"]} if item.get("meta") else {}))
        meta = item.get("meta") or {}
        if meta.get("produced") and str(meta.get("kind", "")).startswith("cur_"):
            # round-5 curriculum clips: every focus phone position is known by construction
            toks = P.kokoro_to_student(meta["produced"])
            sites = [int(x) for x in meta.get("sites", []) if int(x) < len(toks)]
            if toks and all(t in P.SID for t in toks) and sites:
                rec["truth"] = [P.SID[t] for t in toks]
                rec["sites"] = sites
        elif meta.get("produced") and str(meta.get("kind", "")).startswith("mp_"):
            # round-4 minimal pairs: the tested phone is known by construction (explicit site)
            toks = P.kokoro_to_student(meta["produced"])
            if toks and all(t in P.SID for t in toks) and meta.get("site") is not None and meta["site"] < len(toks):
                rec["truth"] = [P.SID[t] for t in toks]
                rec["sites"] = [int(meta["site"])]
        elif meta.get("produced") and meta.get("kind") in ("clean", "light", "medium"):
            # synthetic speech: we know what was actually synthesised -> truth labels (student ids)
            toks = P.kokoro_to_student(meta["produced"])
            if toks and all(t in P.SID for t in toks):
                rec["truth"] = [P.SID[t] for t in toks]
        idx_f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        idx_f.flush()
        a_off += len(a)
        f_off += m
        n_new += 1
        sec += len(a) / SR
        if n_new % 100 == 0 and torch.backends.mps.is_available():
            torch.mps.empty_cache()
        if n_new % 200 == 0:
            el = time.time() - t0
            print(f"{args.part}: {n_new} utts, {sec / 3600:.2f} h audio, {el:.0f}s, x{sec / el:.1f} realtime", flush=True)
    el = time.time() - t0
    print(f"DONE {args.part}: {n_new} new utts, {sec / 3600:.2f} h, {el:.0f}s", flush=True)
    (out / "vocab.json").write_text(json.dumps(P.STUDENT_VOCAB, ensure_ascii=False))


if __name__ == "__main__":
    main()
