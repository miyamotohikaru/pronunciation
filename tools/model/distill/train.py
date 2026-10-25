"""Distil lv-60 (316M) into a whisper-base.en-encoder student (23M).

    python train.py --run r1 --train ls_dev,ls_tr0,so_train,... --weights 1,1,3,... --val ls_testclean,so_test,...

Loss per valid frame: tau^2 * KL(teacher_tau || student_tau)  (teacher = stored marginal log-probs)
                    + ctc_w * CTC(student, teacher greedy labels)
"""
import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).parent))
from common import VB223_DIR, WORK, ctc_greedy, edit_distance  # noqa: E402
from dataset import BucketBatchSampler, DistillDataset, Part, collate  # noqa: E402
from model import Student, count_params, init_from_vb223, vb223_token_to_ipa  # noqa: E402
import phoneset as P  # noqa: E402


def _worker_init(_):
    torch.set_num_threads(1)


def kd_loss(logits, post, mel_lens, tau, focus_idx=None, focus_w=0.0):
    """logits [B,M,V], post = target log-probs [B,M,V]; mean over valid frames.
    focus_w > 0: frames whose target puts mass on the focus phones get weight 1 + focus_w * mass
    (class-balanced emphasis; normalised by the number of valid frames, so other frames keep their weight)."""
    M = logits.shape[1]
    valid = torch.arange(M, device=logits.device)[None, :] < ((mel_lens + 1) // 2)[:, None]
    t = torch.log_softmax(post / tau, -1)
    s = torch.log_softmax(logits.float() / tau, -1)
    kl = (t.exp() * (t - s)).sum(-1)
    w = valid.float()
    if focus_w > 0 and focus_idx is not None:
        w = w * (1.0 + focus_w * post.exp()[..., focus_idx].sum(-1))
    return (kl * w).sum() / valid.sum() * tau * tau, valid


@torch.no_grad()
def evaluate(model, parts, device, max_utts=400):
    model.eval()
    res = {}
    for part in parts:
        ds = DistillDataset([part], train=False, max_sec=30.0, use_truth=False)
        errs = toks = 0
        kl_sum = n_fr = 0.0
        for ii in range(min(len(part.items), max_utts)):
            mel, post, lab, key = ds[(0, ii, 0)]
            n = mel.shape[-1]
            N = int(np.ceil(n / 100) * 100)          # bucketed shape + mask (MPS graph cache)
            melp = torch.zeros(1, 80, N)
            melp[0, :, :n] = mel
            lg = model(melp.to(device), torch.tensor([n], device=device))[0, : (n + 1) // 2].float().cpu()
            m = min(lg.shape[0], post.shape[0])
            t = post[:m]
            s = torch.log_softmax(lg[:m], -1)
            kl_sum += float((t.exp() * (t - s)).sum(-1).sum())
            n_fr += m
            hyp = ctc_greedy(lg.argmax(-1).tolist(), 0)
            ref = lab.tolist()
            errs += edit_distance(ref, hyp)
            toks += len(ref)
        res[part.name] = dict(per=errs / max(toks, 1), kl=kl_sum / max(n_fr, 1), n=min(len(part.items), max_utts))
    model.train()
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--train", required=True)
    ap.add_argument("--weights", default=None)
    ap.add_argument("--val", required=True)
    ap.add_argument("--steps", type=int, default=20000)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--head-lr", type=float, default=5e-4)
    ap.add_argument("--warmup", type=int, default=800)
    ap.add_argument("--tau", type=float, default=1.0)
    ap.add_argument("--ctc", type=float, default=0.2)
    ap.add_argument("--frames-per-batch", type=int, default=10000)
    ap.add_argument("--max-sec", type=float, default=12.0)
    ap.add_argument("--aug-p", type=float, default=0.85)
    ap.add_argument("--crop-p", type=float, default=0.5, help="prob. of a random short crop (forces local acoustic evidence)")
    ap.add_argument("--min-crop-sec", type=float, default=1.0)
    ap.add_argument("--eval-every", type=int, default=1000)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--init", default="vb223", help="vb223 | path to a student checkpoint")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--freeze-steps", type=int, default=0, help="train only the head for the first N steps")
    ap.add_argument("--focus-weight", type=float, default=0.0, help="extra KL weight on frames of the focus phones")
    ap.add_argument("--focus-phones", default="æ,ʌ,ɑː,ɑ,ɒ,a,o,ɔ,ɔː,v,b,β")
    ap.add_argument("--empty-cache-every", type=int, default=25,
                    help="release the MPS allocator cache every N steps (variable shapes otherwise pile up GBs)")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    out = WORK / "ckpt" / args.run
    out.mkdir(parents=True, exist_ok=True)
    (out / "args.json").write_text(json.dumps(vars(args), indent=1))
    log = open(WORK / "logs" / f"train_{args.run}.log", "a")

    def say(*a):
        s = " ".join(str(x) for x in a)
        print(s, flush=True)
        log.write(s + "\n")
        log.flush()

    train_parts = [Part(n) for n in args.train.split(",")]
    val_parts = [Part(n) for n in args.val.split(",")]
    # --weights = desired share of training AUDIO TIME per part; converted to per-utterance draw weights
    shares = [float(w) for w in args.weights.split(",")] if args.weights else [p.hours for p in train_parts]
    weights = []
    for p, w in zip(train_parts, shares):
        mean_sec = p.hours * 3600 / max(len(p.items), 1)
        eff = min(mean_sec, args.max_sec)
        weights.append(w / eff)
        say(f"train part {p.name}: {len(p.items)} utts, {p.hours:.2f} h, mean {mean_sec:.1f}s, time share {w}, "
            f"truth-labelled {sum(1 for it in p.items if 'truth' in it)}")
    V = len(P.STUDENT_VOCAB)
    model = Student(V)
    if args.init == "vb223":
        copied, hit = init_from_vb223(model, VB223_DIR, P.STUDENT_VOCAB, vb223_token_to_ipa)
        say(f"init from vb223: {copied} tensors, {len(hit)} output rows mapped")
    else:
        model.load_state_dict(torch.load(args.init, map_location="cpu")["model"])
        say(f"init from {args.init}")
    say(f"params {count_params(model) / 1e6:.2f}M")
    model.to(device).train()

    focus_idx = torch.tensor([P.SID[p] for p in args.focus_phones.split(",") if p in P.SID], device=device)
    head_params = list(model.phoneme_head.parameters())
    head_ids = {id(p) for p in head_params}
    enc_params = [p for p in model.parameters() if id(p) not in head_ids]
    opt = torch.optim.AdamW([{"params": enc_params, "lr": args.lr}, {"params": head_params, "lr": args.head_lr}],
                            weight_decay=0.01, betas=(0.9, 0.98))
    base_lrs = [args.lr, args.head_lr]

    sampler = BucketBatchSampler(train_parts, weights, frames_per_batch=args.frames_per_batch,
                                 max_frames=int(args.max_sec * 50), epoch_hours=1e6, seed=args.seed)
    ds = DistillDataset(train_parts, train=True, max_sec=args.max_sec, aug_p=args.aug_p, crop_p=args.crop_p,
                        min_crop_sec=args.min_crop_sec)
    dl = torch.utils.data.DataLoader(ds, batch_sampler=sampler, collate_fn=collate, num_workers=args.workers,
                                     persistent_workers=True, prefetch_factor=4,
                                     worker_init_fn=_worker_init)
    best = math.inf
    step, t0, agg = 0, time.time(), dict(kd=0.0, ctc=0.0, n=0, sec=0.0)
    hist = []
    for batch in dl:
        if step >= args.steps:
            break
        # lr schedule: linear warmup + cosine
        f = min(1.0, (step + 1) / args.warmup) * 0.5 * (1 + math.cos(math.pi * min(step / args.steps, 1.0)))
        for g, lr in zip(opt.param_groups, base_lrs):
            g["lr"] = lr * max(f, 0.02)
        freeze = step < args.freeze_steps
        for p in enc_params:
            p.requires_grad_(not freeze)
        mel = batch["mel"].to(device)
        mel_lens = batch["mel_lens"].to(device)
        post = batch["post"].to(device)
        try:
            logits = model(mel, mel_lens)
        except RuntimeError as e:          # MPS OOM on a rare large batch: drop it and carry on
            if "out of memory" not in str(e):
                raise
            del mel, mel_lens, post
            opt.zero_grad(set_to_none=True)
            if device == "mps":
                torch.mps.empty_cache()
            agg["oom"] = agg.get("oom", 0) + 1
            say(f"  OOM on a batch at step {step}: skipped")
            continue
        kd, valid = kd_loss(logits, post, mel_lens, args.tau, focus_idx, args.focus_weight)
        loss = kd
        if args.ctc > 0:
            lp = torch.log_softmax(logits.float(), -1).transpose(0, 1).cpu()   # CTC on CPU (MPS lacks it)
            olen = ((batch["mel_lens"] + 1) // 2)
            ctc = F.ctc_loss(lp, batch["labels"], olen, batch["label_lens"], blank=0, reduction="sum",
                             zero_infinity=True) / olen.sum()
            loss = loss + args.ctc * ctc.to(device)
            agg["ctc"] += float(ctc)
        opt.zero_grad(set_to_none=True)
        try:
            loss.backward()
        except RuntimeError as e:
            if "out of memory" not in str(e):
                raise
            del loss, logits, kd
            opt.zero_grad(set_to_none=True)
            if device == "mps":
                torch.mps.empty_cache()
            say(f"  OOM in backward at step {step}: skipped")
            continue
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        opt.step()
        step += 1
        if device == "mps" and args.empty_cache_every and step % args.empty_cache_every == 0:
            torch.mps.empty_cache()
        agg["kd"] += kd.detach()          # stays on the device: no GPU sync every step
        agg["n"] += 1
        agg["sec"] += float(batch["mel_lens"].sum()) / 100
        if step % 100 == 0 or step in (1, 2, 5, 10, 20, 50):
            el = time.time() - t0
            mem = f" mps {torch.mps.driver_allocated_memory() / 2**30:.1f}GB" if device == "mps" else ""
            say(f"step {step} kd {float(agg['kd']) / agg['n']:.4f} ctc {agg['ctc'] / agg['n']:.4f} lr {opt.param_groups[0]['lr']:.2e} "
                f"audio {agg['sec'] / 3600:.2f}h/100steps  {el:.0f}s  x{agg['sec'] / el:.0f}rt{mem}")
            agg = dict(kd=0.0, ctc=0.0, n=0, sec=0.0)
            t0 = time.time()
        if step % args.eval_every == 0 or step == args.steps:
            res = evaluate(model, val_parts, device)
            if device == "mps":
                torch.mps.empty_cache()
            mean_per = float(np.mean([r["per"] for r in res.values()]))
            say(f"EVAL step {step} mean_per {mean_per:.4f} " + " ".join(f"{k}: per {v['per']:.4f} kl {v['kl']:.4f}" for k, v in res.items()))
            hist.append(dict(step=step, mean_per=mean_per, **{k: v for k, v in res.items()}))
            (out / "hist.json").write_text(json.dumps(hist, indent=1))
            ck = dict(model=model.state_dict(), step=step, vocab=P.STUDENT_VOCAB, args=vars(args), eval=res)
            torch.save(ck, out / "last.pt")
            if mean_per < best:
                best = mean_per
                torch.save(ck, out / "best.pt")
                say(f"  new best {best:.4f}")
            t0 = time.time()
    say("done")


if __name__ == "__main__":
    main()
