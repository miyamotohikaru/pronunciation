"""GOP regressor for a model, trained on features computed by the TS engine itself.

  .venv/bin/python -I tools/model/export/train_student_regressor.py MODEL_DIR TRAIN.json TEST.json OUT.json [VB223_TEST.json]

TRAIN/TEST come from tools/scoring-tests/so762-features.mts (speechocean762, human phone
scores 0..2). Same estimator settings as vb223's gop_regressor (HistGradientBoosting, squared
error, lr 0.1, <= 300 iterations with early stopping, 31 leaves, 20 samples per leaf).
Prints the pooled phone-level PCC on test (and vb223's, from its TS-pipeline raw scores).
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).parent))
from export_assets import export_regressor  # noqa: E402

model_dir, train_p, test_p, out_p = (Path(a) for a in sys.argv[1:5])
vb_p = Path(sys.argv[5]) if len(sys.argv) > 5 else None
meta = json.loads((model_dir / "meta.json").read_text())
class_of = meta["regressor"]["classOf"]
n_cls = meta["regressor"]["oneHotSize"]


def matrix(d):
    feats = np.asarray(d["features"], dtype=np.float32)
    oh = np.zeros((len(feats), n_cls), dtype=np.float32)
    for k, p in enumerate(d["phones"]):
        oh[k, class_of.get(p, class_of.get(re.sub(r"[0-2]$", "", p)))] = 1
    return np.hstack([feats, oh]), np.asarray(d["human"], dtype=np.float64)


tr = json.loads(train_p.read_text())
te = json.loads(test_p.read_text())
Xtr, ytr = matrix(tr)
Xte, yte = matrix(te)
reg = HistGradientBoostingRegressor(loss="squared_error", learning_rate=0.1, max_iter=300, max_leaf_nodes=31,
                                    min_samples_leaf=20, l2_regularization=0.0, early_stopping="auto",
                                    validation_fraction=0.1, n_iter_no_change=10, random_state=0)
reg.fit(Xtr, ytr)
pred = reg.predict(Xte)
pcc = float(np.corrcoef(pred, yte)[0, 1])
print(f"student: {len(ytr)} train phones, {len(yte)} test phones, {reg.n_iter_} trees; test PCC {pcc:.4f}")
if vb_p:
    vb = json.loads(vb_p.read_text())
    print(f"vb223 (TS pipeline, its own regressor): test PCC {np.corrcoef(vb['raw'], vb['human'])[0, 1]:.4f} on {len(vb['human'])} phones")
# calibration check: share of human-2 phones >= 90 / human-0 phones < 60 under the current knots
knots = np.asarray(meta["calibration"]["knots"])
cal = np.interp(pred, knots[:, 0], knots[:, 1])
for name, sel in (("human 2", yte >= 1.9), ("human 1.x", (yte > 0.5) & (yte < 1.9)), ("human 0", yte <= 0.5)):
    print(f"  {name:9s} n={sel.sum():6d} median raw {np.median(pred[sel]):.2f}  >=90: {(cal[sel] >= 90).mean():.2f}  <60: {(cal[sel] < 60).mean():.2f}")
export_regressor(reg, out_p)
print("wrote", out_p)
