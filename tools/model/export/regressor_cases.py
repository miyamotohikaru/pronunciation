"""Random inputs + sklearn predictions of the GOP regressor, for the TS port's test.

  .venv/bin/python -I tools/model/export/regressor_cases.py OUT.json [N=3000]
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wp_common import load_regressor  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
reg = load_regressor(ROOT / ".work/models/whisper-phoneme")
n = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
rng = np.random.default_rng(0)
X = np.zeros((n, reg.n_features_in_), dtype=np.float32)
X[:, 0] = rng.uniform(-15, 6, n)        # gop
X[:, 1] = rng.uniform(-20, 0, n)        # logp_target
X[:, 2] = rng.uniform(-20, 0, n)        # logp_competitor
X[:, 3] = rng.uniform(-25, 0, n)        # logp_target_min
X[:, 4] = rng.integers(1, 30, n)        # n_frames
X[np.arange(n), 5 + rng.integers(0, reg.n_features_in_ - 5, n)] = 1
# exact thresholds as inputs too (ties at "<=")
for t, row in zip(reg._predictors[:50], X[:50]):
    node = t[0].nodes[0]
    row[int(node["feature_idx"])] = np.float32(node["num_threshold"])
y = reg.predict(X)
json.dump({"X": X.astype(float).tolist(), "y": y.tolist()}, open(sys.argv[1], "w"))
print(n, "cases")
