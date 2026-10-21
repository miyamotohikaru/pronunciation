"""Load a joblib pickle with a whitelist of allowed globals (refuses anything else).

Copied from .work/scripts/safe_load_regressor.py so the export tools do not depend on
the local scratch folder. Never call joblib.load() on the upstream regressor directly.
"""
import pickle
import sys

from joblib import numpy_pickle

SAFE_BUILTINS = {"slice", "dict", "list", "tuple", "set", "frozenset", "int", "float", "bool", "str",
                 "bytes", "bytearray", "complex", "object", "type", "range"}
seen = []


class SafeUnpickler(numpy_pickle.NumpyUnpickler):
    def find_class(self, module, name):
        seen.append(f"{module}.{name}")
        ok = (
            module.startswith("sklearn.") or (module == "_loss" and name.startswith("Cy"))
            or module.startswith("numpy") or module == "joblib.numpy_pickle"
            or module == "_codecs" and name == "encode"
            or module == "copyreg" and name in ("_reconstructor",)
            or module == "builtins" and name in SAFE_BUILTINS
            or module == "collections" and name in ("OrderedDict", "defaultdict")
        )
        if not ok:
            raise pickle.UnpicklingError(f"BLOCKED global {module}.{name}")
        return super().find_class(module, name)


def safe_load(path):
    with open(path, "rb") as f:
        u = SafeUnpickler(path, f, ensure_native_byte_order=True)
        return u.load()


if __name__ == "__main__":
    obj = safe_load(sys.argv[1])
    print("globals used:", sorted(set(seen)))
    print("type:", type(obj))
    print(obj)
