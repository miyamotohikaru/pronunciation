/**
 * sklearn HistGradientBoostingRegressor (squared error, numerical features) exported to
 * JSON by tools/model/export/export_assets.py. Prediction follows sklearn exactly:
 * baseline + tree_0 + tree_1 + ... in float64, "x <= threshold" goes left, NaN follows
 * missing_go_to_left. Inputs are float32 in the reference, so callers pass
 * Math.fround()-ed values.
 */
import type { RegressorJson, TreeJson } from "./types.ts";

type Tree = {
  feature: Int32Array;
  threshold: Float64Array;
  left: Int32Array;
  right: Int32Array;
  leaf: Uint8Array;
  value: Float64Array;
  missingLeft: Uint8Array;
};

export type Regressor = { nFeatures: number; predict(x: ArrayLike<number>): number };

function compile(t: TreeJson): Tree {
  return {
    feature: Int32Array.from(t.feature),
    threshold: Float64Array.from(t.threshold.map((v) => (v === null ? Infinity : v))),
    left: Int32Array.from(t.left),
    right: Int32Array.from(t.right),
    leaf: Uint8Array.from(t.leaf),
    value: Float64Array.from(t.value),
    missingLeft: Uint8Array.from(t.missingLeft),
  };
}

export function loadRegressor(json: RegressorJson): Regressor {
  if (json.type !== "sklearn.HistGradientBoostingRegressor") throw new Error(`unsupported regressor ${json.type}`);
  const trees = json.trees.map(compile);
  const baseline = json.baseline;
  return {
    nFeatures: json.nFeatures,
    predict(x: ArrayLike<number>): number {
      if (x.length !== json.nFeatures) throw new Error(`regressor wants ${json.nFeatures} features, got ${x.length}`);
      let raw = baseline;
      for (const tr of trees) {
        let n = 0;
        while (!tr.leaf[n]) {
          const v = x[tr.feature[n]];
          if (Number.isNaN(v)) n = tr.missingLeft[n] ? tr.left[n] : tr.right[n];
          else n = v <= tr.threshold[n] ? tr.left[n] : tr.right[n];
        }
        raw += tr.value[n];
      }
      return raw;
    },
  };
}
