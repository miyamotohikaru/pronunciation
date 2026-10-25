"""Weight-only int8: int8 weights + DequantizeLinear, fp32 compute ("int8w").

  .venv/bin/python tools/model/export/quantize_weights.py [IN.onnx] [OUT.onnx]

Dynamic quantization (model.int8.onnx) also quantizes the activations at run time, and
how it rounds differs between ONNX Runtime builds (python 1.23 vs node 1.30 differ by up
to ~1 log-prob on likely tokens, WASM/WebGPU may differ again). Weight-only int8 keeps the
download small but computes in fp32, so every runtime agrees to ~1e-4 like the fp32
model. Every MatMul / Conv weight and the positional embedding is stored as symmetric
per-channel int8 (MatMul [in, out]: per output column; Conv [out, in, k]: per output
channel). With session config session.disable_quant_qdq=1 ONNX Runtime folds the
DequantizeLinear nodes into fp32 weights once at load.
"""
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper

ROOT = Path(__file__).resolve().parents[3]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".work/onnx/model.fp32.onnx"
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / ".work/onnx/model.int8w.onnx"
MIN_SIZE = 4096


def main():
    m = onnx.load(str(SRC))
    g = m.graph
    inits = {t.name: t for t in g.initializer}
    users = {}
    for n in g.node:
        for k, x in enumerate(n.input):
            users.setdefault(x, []).append((n, k))
    new_inits, new_nodes, drop = [], [], set()
    for name, t in inits.items():
        w = numpy_helper.to_array(t)
        if w.dtype != np.float32 or w.size < MIN_SIZE:
            continue
        us = users.get(name, [])
        ops = {(n.op_type, k) for n, k in us}
        if ops <= {("MatMul", 1)} and w.ndim == 2:
            axis = 1  # [in, out]: one scale per output column
        elif ops <= {("Conv", 1)} and w.ndim == 3:
            axis = 0  # [out, in, k]
        elif w.ndim == 2:
            axis = 1  # positional embedding [ctx, state]: per state column
        else:
            continue
        red = tuple(i for i in range(w.ndim) if i != axis)
        scale = (np.abs(w).max(axis=red) / 127.0).astype(np.float32)
        scale[scale == 0] = 1.0
        shape = [1] * w.ndim
        shape[axis] = -1
        q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
        new_inits += [numpy_helper.from_array(q, name + "_q"), numpy_helper.from_array(scale, name + "_scale"),
                      numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), name + "_zp")]
        new_nodes.append(helper.make_node("DequantizeLinear", [name + "_q", name + "_scale", name + "_zp"], [name],
                                          name=name + "_dq", axis=axis))
        drop.add(name)
    kept = [t for t in g.initializer if t.name not in drop]
    del g.initializer[:]
    g.initializer.extend(kept + new_inits)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(new_nodes + nodes)
    m.doc_string = (m.doc_string or "") + " | weight-only int8 (DequantizeLinear), fp32 compute"
    onnx.checker.check_model(m)
    onnx.save(m, str(DST))
    print(f"{len(drop)} tensors -> int8; {DST.name}: {DST.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
