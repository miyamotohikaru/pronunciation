"""Download HF dataset parquet shards into .work/distill/raw/<repo>/ (audio + metadata).

    python fetch_data.py librispeech_eval      # dev/test clean+other (CC BY 4.0)
    python fetch_data.py librispeech_train 0-3 # train.clean.100 shards 0..3
    python fetch_data.py speechocean           # speechocean762 train+test (CC BY 4.0 / Apache-2.0)
    python fetch_data.py globe_test            # GLOBE (CC0) test + val
    python fetch_data.py globe_train 0-9       # GLOBE train shards
    python fetch_data.py saa                   # Speech Accent Archive (CC BY-NC-SA: EVAL ONLY)
"""
import os
import sys
import time
from pathlib import Path

from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[3] / ".work" / "distill" / "raw"

SETS = {
    "librispeech_eval": ("openslr/librispeech_asr", [
        "all/validation.clean/0000.parquet", "all/validation.other/0000.parquet",
        "all/test.clean/0000.parquet", "all/test.other/0000.parquet"]),
    "librispeech_train": ("openslr/librispeech_asr", "all/train.clean.100/{:04d}.parquet"),
    "speechocean": ("mispeech/speechocean762", [
        "data/train-00000-of-00001.parquet", "data/test-00000-of-00001.parquet"]),
    "globe_test": ("MushanW/GLOBE", [
        "data/test-00000-of-00001.parquet", "data/val-00000-of-00001.parquet"]),
    "globe_train": ("MushanW/GLOBE", "data/train-{:05d}-of-00108.parquet"),
    "saa": ("changelinglab/speechaccentarchive-pr", "data/test-{:05d}-of-00007.parquet"),
}


def parse_range(s):
    out = []
    for part in s.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b or a) + 1))
    return out


def main():
    name = sys.argv[1]
    repo, files = SETS[name]
    if isinstance(files, str):
        files = [files.format(i) for i in parse_range(sys.argv[2])]
    dest = ROOT / repo.replace("/", "__")
    dest.mkdir(parents=True, exist_ok=True)
    for f in files:
        for attempt in range(5):
            try:
                t0 = time.time()
                p = hf_hub_download(repo, f, repo_type="dataset", local_dir=str(dest))
                print(f"{f}: {os.path.getsize(p) / 1e6:.0f} MB in {time.time() - t0:.0f}s", flush=True)
                break
            except Exception as e:  # transient HF errors
                print(f"{f}: attempt {attempt} failed: {e!r}"[:300], flush=True)
                time.sleep(10 * (attempt + 1))


if __name__ == "__main__":
    main()
