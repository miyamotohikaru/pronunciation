"""Read only the metadata columns of every GLOBE (CC0) train shard over HTTP range requests.

    python scan_globe_meta.py v1     # MushanW/GLOBE     -> meta/globe_train_meta.tsv
    python scan_globe_meta.py v3     # MushanW/GLOBE_V3  -> meta/globe_v3_train_meta.tsv

TSV columns: shard, row, <metadata columns>. Used to pick accented (non-US/UK) speakers without
downloading the audio (rows of one speaker are contiguous, so few row groups are needed later).
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem

META = Path(__file__).resolve().parents[3] / ".work" / "distill" / "meta"
CFG = {
    "v1": dict(repo="MushanW/GLOBE", pattern="data/train-{:05d}-of-00108.parquet", n=108,
               cols=["speaker_id", "accent", "duration", "gender", "age"], out="globe_train_meta.tsv"),
    "v3": dict(repo="MushanW/GLOBE_V3", pattern="data/train-{:05d}-of-00181.parquet", n=181,
               cols=["common_voice_path", "common_voice_accents", "predicted_accent", "common_voice_gender",
                     "common_voice_age", "snr", "utmos", "common_voice_sentence"], out="globe_v3_train_meta.tsv"),
}


def scan(job):
    cfg, shard = job
    path = f"datasets/{cfg['repo']}/" + cfg["pattern"].format(shard)
    for attempt in range(6):
        try:
            fs = HfFileSystem()
            with fs.open(path, "rb", block_size=1 << 20) as f:
                pf = pq.ParquetFile(f)
                t = pf.read(columns=cfg["cols"]).to_pydict()
            rows = []
            for i in range(len(t[cfg["cols"][0]])):
                vals = [str(t[c][i]).replace("\t", " ").replace("\n", " ") for c in cfg["cols"]]
                rows.append("\t".join([str(shard), str(i)] + vals))
            return shard, rows
        except Exception as e:
            print(f"shard {shard} attempt {attempt}: {e!r}"[:300], flush=True)
            time.sleep(10 * (attempt + 1))
    return shard, []


def main():
    cfg = CFG[sys.argv[1]]
    threads = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    out_path = META / cfg["out"]
    META.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with open(out_path, "w") as out, ThreadPoolExecutor(threads) as ex:
        out.write("shard\trow\t" + "\t".join(cfg["cols"]) + "\n")
        for shard, rows in ex.map(scan, [(cfg, s) for s in range(cfg["n"])]):
            if rows:
                out.write("\n".join(rows) + "\n")
            out.flush()
            print(f"shard {shard}: {len(rows)} rows ({time.time() - t0:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
