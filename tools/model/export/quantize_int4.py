"""4-bit weight-only model ("int4w"): MatMul weights -> MatMulNBits (block-wise int4), the
remaining large initializers (convs, positional embedding) -> int8 + DequantizeLinear.

  .venv/bin/python tools/model/export/quantize_int4.py [BLOCK=32] [IN.onnx] [OUT.onnx]

Activations stay fp32 (accuracy_level 0 = fp32 compute where the runtime allows), so the
numbers are close to the int8w model. MatMulNBits runs on the CPU / WASM and WebGPU EPs.
"""
import sys
from pathlib import Path

import onnx
from onnxruntime.quantization import matmul_nbits_quantizer as mnb

sys.path.insert(0, str(Path(__file__).parent))
import quantize_weights  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
BLOCK = int(sys.argv[1]) if len(sys.argv) > 1 else 32
SRC = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / ".work/onnx/model.fp32.onnx"
DST = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / f".work/onnx/model.int4w{'' if BLOCK == 32 else BLOCK}.onnx"
TMP = DST.with_suffix(".nbits.onnx")


def main():
    model = onnx.load(str(SRC))
    cfg = mnb.DefaultWeightOnlyQuantConfig(block_size=BLOCK, is_symmetric=True, accuracy_level=0, bits=4)
    q = mnb.MatMulNBitsQuantizer(model, block_size=BLOCK, is_symmetric=True, accuracy_level=0, algo_config=cfg)
    q.process()
    q.model.save_model_to_file(str(TMP), use_external_data_format=False)
    # convs + positional embedding: int8 weight-only like model.int8w.onnx
    sys.argv = ["quantize_weights.py", str(TMP), str(DST)]
    quantize_weights.SRC, quantize_weights.DST = TMP, DST
    quantize_weights.main()
    TMP.unlink()
    m = onnx.load(str(DST))
    ops = {}
    for n in m.graph.node:
        ops[n.op_type] = ops.get(n.op_type, 0) + 1
    print(f"{DST.name}: {DST.stat().st_size / 1e6:.2f} MB, MatMulNBits {ops.get('MatMulNBits', 0)}, MatMul {ops.get('MatMul', 0)}, DequantizeLinear {ops.get('DequantizeLinear', 0)}")


if __name__ == "__main__":
    main()
