"""Random CTC alignment cases solved by torchaudio, for the TS port's fuzz test.

  .venv/bin/python -I tools/model/export/align_cases.py OUT.json [N=400]

Emissions are random log-softmax rows; a third are rounded to 0.5 to force ties, targets
have repeats; T ranges down to the minimum feasible length (L + repeats).
"""
import json
import sys

import torch
import torchaudio

out_path = sys.argv[1]
n = int(sys.argv[2]) if len(sys.argv) > 2 else 400
g = torch.Generator().manual_seed(0)
cases = []
for k in range(n):
    C = int(torch.randint(3, 12, (1,), generator=g))
    L = int(torch.randint(1, 9, (1,), generator=g))
    tg = torch.randint(1, C, (L,), generator=g)
    if k % 4 == 0 and L > 2:
        tg[1] = tg[0]  # a repeat
    R = int((tg[1:] == tg[:-1]).sum())
    T = L + R + int(torch.randint(0, 12, (1,), generator=g))
    em = torch.log_softmax(torch.randn(T, C, generator=g) * 2, dim=-1)
    if k % 3 == 0:
        em = torch.round(em * 2) / 2  # ties
    path, _ = torchaudio.functional.forced_align(em.unsqueeze(0), tg.unsqueeze(0).int(), torch.tensor([T], dtype=torch.int32),
                                                 torch.tensor([L], dtype=torch.int32), blank=0)
    spans = torchaudio.functional.merge_tokens(path[0], _[0], blank=0)
    cases.append({"T": T, "C": C, "targets": tg.tolist(), "em": em.flatten().tolist(), "path": path[0].tolist(),
                  "spans": [[s.token, s.start, s.end] for s in spans]})
json.dump(cases, open(out_path, "w"))
print(len(cases), "cases")
