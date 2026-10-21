"""Pull selected rows out of remote HF parquet files (only the row groups needed) into 16 kHz WAVs.

    python extract_remote.py <selection.json> <out_dir> [threads]

selection.json: list of {"repo": ..., "file": "data/xxx.parquet", "row": int, "id": str, "speaker": str, ...}
Writes <out_dir>/<speaker>/<id>.wav + .json (all extra keys + 'text' if the row has one).
"""
import json
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
from huggingface_hub import HfFileSystem

sys.path.insert(0, str(Path(__file__).parent))
from common import decode_audio  # noqa: E402

TEXT_COLS = ["text", "transcript", "transcription", "common_voice_sentence"]


def work(args):
    (repo, file), rows, out = args
    for attempt in range(5):
        try:
            fs = HfFileSystem()
            with fs.open(f"datasets/{repo}/{file}", "rb", block_size=1 << 20) as fh:
                pf = pq.ParquetFile(fh)
                names = pf.schema_arrow.names
                cols = ["audio"] + [c for c in TEXT_COLS if c in names]
                starts, acc = [], 0
                for k in range(pf.num_row_groups):
                    starts.append(acc)
                    acc += pf.metadata.row_group(k).num_rows
                by_rg = defaultdict(list)
                for r in rows:
                    rg = max(k for k in range(len(starts)) if starts[k] <= r["row"])
                    by_rg[rg].append(r)
                n = 0
                for rg, rs in sorted(by_rg.items()):
                    t = pf.read_row_group(rg, columns=cols).to_pylist()
                    for r in rs:
                        rec = t[r["row"] - starts[rg]]
                        d = out / r["speaker"].replace("/", "_")
                        d.mkdir(parents=True, exist_ok=True)
                        wav = d / f"{r['id']}.wav"
                        if wav.exists():
                            continue
                        a = decode_audio(rec["audio"]["bytes"])
                        sf.write(wav, np.clip(a, -1, 1), 16000, subtype="PCM_16")
                        meta = dict(r)
                        for c in TEXT_COLS:
                            if c in rec and rec[c]:
                                meta["text"] = rec[c]
                        wav.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False))
                        n += 1
            return file, n
        except Exception as e:
            print(f"{file} attempt {attempt}: {e!r}"[:300], flush=True)
            time.sleep(10 * (attempt + 1))
    return file, -1


def main():
    sel = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    threads = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    groups = defaultdict(list)
    for r in sel:
        groups[(r["repo"], r["file"])].append(r)
    t0 = time.time()
    with ThreadPoolExecutor(threads) as ex:
        for file, n in ex.map(work, [(k, v, out) for k, v in groups.items()]):
            print(f"{file}: {n} rows ({time.time() - t0:.0f}s)", flush=True)
    print("DONE")


if __name__ == "__main__":
    main()
