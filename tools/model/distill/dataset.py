"""Distillation dataset over label.py parts (memmapped audio + teacher posteriors)."""
import json
import random
from pathlib import Path

import numpy as np
import torch

from augment import augment
from common import HOP, WORK, log_mel

FRAME = 2 * HOP  # 320 samples per student frame


class Part:
    def __init__(self, name):
        d = WORK / "data" / name
        self.name = name
        if (d / "vocab.json").exists():
            self.vocab = json.loads((d / "vocab.json").read_text())
        else:  # part still being labelled
            import phoneset
            self.vocab = phoneset.STUDENT_VOCAB
        self.items = []
        for l in open(d / "index.jsonl"):
            try:
                self.items.append(json.loads(l))
            except json.JSONDecodeError:  # partially written last line
                break
        self.dir = d
        self.V = len(self.vocab)
        self.n_audio = self.items[-1]["a_off"] + self.items[-1]["a_len"] if self.items else 0
        self.n_frames = self.items[-1]["f_off"] + self.items[-1]["f_len"] if self.items else 0
        self._mm = None
        self.hours = sum(it["a_len"] for it in self.items) / 16000 / 3600

    def _open(self):
        if self._mm is None:  # opened lazily in every (worker) process; never pickled
            self._mm = (np.memmap(self.dir / "audio.bin", dtype=np.int16, mode="r", shape=(self.n_audio,)),
                        np.memmap(self.dir / "post.bin", dtype=np.float16, mode="r", shape=(self.n_frames, self.V)))
        return self._mm

    @property
    def audio(self):
        return self._open()[0]

    @property
    def post(self):
        return self._open()[1]

    def sites(self, i):
        """Injected-error sites (indices into item['truth']) for synthetic clips; cached."""
        it = self.items[i]
        if "sites" in it:                      # explicit (round-4 minimal pairs)
            return it["sites"]
        if "_sites" not in it:
            import phoneset
            meta = it.get("meta") or {}
            it["_sites"] = phoneset.injected_sites(meta["phonemes"], meta["produced"]) if meta.get("produced") else []
            if len(phoneset.kokoro_to_student(meta.get("produced", ""))) != len(it.get("truth", [])):
                it["_sites"] = []
        return it["_sites"]

    def __getstate__(self):
        st = dict(self.__dict__)
        st["_mm"] = None
        return st

    def get(self, i, f0=0, nf=None):
        it = self.items[i]
        nf = it["f_len"] - f0 if nf is None else nf
        a0 = it["a_off"] + f0 * FRAME
        alen = it["a_len"] - f0 * FRAME if f0 + nf >= it["f_len"] else nf * FRAME
        a = self.audio[a0:a0 + alen].astype(np.float32) / 32767.0
        p = np.asarray(self.post[it["f_off"] + f0: it["f_off"] + f0 + nf], dtype=np.float32)
        return a, p


def truth_target(post, truth, sites, mix=0.8):
    """Synthetic clips with known produced phones: keep the teacher posteriors everywhere EXCEPT at the
    injected-error sites (reliably rendered substitutions / inserted vowels). There the known phone sequence
    is CTC-force-aligned onto the teacher's posteriors (teacher timing) and `mix` of each aligned frame's mass
    is put on the produced phone. post: [M,V] teacher log-probs. Returns (log-probs, ctc labels) or None."""
    import torchaudio.functional as AF
    if not sites:
        return None
    M = post.shape[0]
    rep = sum(1 for a, b in zip(truth, truth[1:]) if a == b)
    if len(truth) == 0 or M < len(truth) + rep:
        return None
    try:
        ali, sc = AF.forced_align(post[None].float(), torch.tensor([truth], dtype=torch.int32), blank=0)
        spans = AF.merge_tokens(ali[0], sc[0].exp(), blank=0)
    except Exception:
        return None
    if len(spans) != len(truth):
        return None
    tp = post.exp()
    for k in sites:
        sp = spans[k]
        oh = torch.zeros(tp.shape[1])
        oh[truth[k]] = 1.0
        tp[sp.start:sp.end] = mix * oh + (1 - mix) * tp[sp.start:sp.end]
    lp = tp.clamp_min(1e-8).log()
    ids = lp.argmax(-1).tolist()
    lab, prev = [], -1
    for t in ids:
        if t != prev and t != 0:
            lab.append(t)
        prev = t
    return lp, lab


class DistillDataset(torch.utils.data.Dataset):
    """Each __getitem__ gets (part_idx, item_idx, seed). Returns mel, teacher log-probs, ctc labels."""

    def __init__(self, parts, train=True, max_sec=12.0, min_crop_sec=1.5, aug_p=0.85, use_truth=True, truth_mix=0.8,
                 crop_p=0.3):
        self.parts = parts
        self.train = train
        self.crop_p = crop_p
        self.use_truth = use_truth
        self.truth_mix = truth_mix
        self.max_frames = int(max_sec * 50)
        self.min_crop = int(min_crop_sec * 50)
        self.aug_p = aug_p

    def __len__(self):
        return sum(len(p.items) for p in self.parts)

    def _babble(self, rng):
        def src(n):
            p = self.parts[rng.integers(len(self.parts))]
            it = p.items[rng.integers(len(p.items))]
            a = p.audio[it["a_off"]: it["a_off"] + it["a_len"]].astype(np.float32) / 32767.0
            if len(a) < n:
                a = np.tile(a, n // max(len(a), 1) + 1)
            s = rng.integers(0, len(a) - n + 1)
            return a[s:s + n]
        return src

    def __getitem__(self, key):
        pi, ii, seed = key
        rng = np.random.default_rng(seed)
        part = self.parts[pi]
        it = part.items[ii]
        F = it["f_len"]
        f0, nf = 0, F
        if self.train:
            if F > self.max_frames or rng.random() < self.crop_p:
                nf = int(rng.integers(min(self.min_crop, F), min(F, self.max_frames) + 1))
                f0 = int(rng.integers(0, F - nf + 1))
        elif F > self.max_frames:
            nf = self.max_frames
        truth = it.get("truth") if self.use_truth else None
        if truth is not None:
            f0, nf = 0, F                                        # never crop utterances with truth labels
        a, p = part.get(ii, f0, nf)
        if self.train:
            a = augment(a, rng, self._babble(rng), p=self.aug_p)
        mel = log_mel(torch.from_numpy(a))                      # [80, len//160]
        m = (mel.shape[-1] + 1) // 2
        p = torch.from_numpy(p)
        if p.shape[0] < m:   # crop of the last frames may leave one frame short -> pad blank
            pad = torch.full((m - p.shape[0], p.shape[1]), -18.0)
            pad[:, 0] = 0.0
            p = torch.cat([p, pad])
        p = p[:m]
        if truth is not None:
            r = truth_target(p, truth, part.sites(ii), self.truth_mix)
            if r is not None:
                return mel, r[0], torch.tensor(r[1], dtype=torch.long), f"{part.name}:{it['id']}"
        ids = p.argmax(-1).tolist()
        lab, prev = [], -1
        for t in ids:
            if t != prev and t != 0:
                lab.append(t)
            prev = t
        return mel, p, torch.tensor(lab, dtype=torch.long), f"{part.name}:{it['id']}"


MEL_QUANTUM = 100   # pad mel length to a multiple of 1 s: MPS caches one graph per shape


def collate(batch):
    B = len(batch)
    N = max(b[0].shape[-1] for b in batch)
    N = int(np.ceil(N / MEL_QUANTUM) * MEL_QUANTUM)
    M = (N + 1) // 2
    V = batch[0][1].shape[1]
    mel = torch.zeros(B, 80, N)
    post = torch.full((B, M, V), -18.0)
    post[:, :, 0] = 0.0
    mel_lens = torch.zeros(B, dtype=torch.long)
    labs, lab_lens, keys = [], [], []
    for i, (m, p, l, k) in enumerate(batch):
        mel[i, :, : m.shape[-1]] = m
        post[i, : p.shape[0]] = p
        mel_lens[i] = m.shape[-1]
        labs.append(l)
        lab_lens.append(len(l))
        keys.append(k)
    return dict(mel=mel, mel_lens=mel_lens, post=post, labels=torch.cat(labs) if labs else torch.zeros(0, dtype=torch.long),
                label_lens=torch.tensor(lab_lens), keys=keys)


class BucketBatchSampler(torch.utils.data.Sampler):
    """Weighted sampling over parts; batches of ONE length bucket (50 student frames = 1 s) with a fixed
    batch size per bucket (frames_per_batch // bucket), so the GPU only ever sees ~12 tensor shapes."""

    def __init__(self, parts, weights, frames_per_batch=10000, max_frames=600, epoch_hours=10.0, seed=0, pool=3000):
        self.parts, self.frames_per_batch, self.max_frames = parts, frames_per_batch, max_frames
        self.epoch_frames = int(epoch_hours * 3600 * 50)
        self.seed, self.pool = seed, pool
        w = np.array(weights, dtype=np.float64)
        self.p = w / w.sum()
        self.epoch = 0

    def bucket(self, f):
        return int(np.ceil(min(f, self.max_frames) / 50) * 50)

    def __iter__(self):
        rng = np.random.default_rng(self.seed + 1000 * self.epoch)
        self.epoch += 1
        total = 0
        waiting = {}
        while total < self.epoch_frames:
            for _ in range(self.pool):
                pi = int(rng.choice(len(self.parts), p=self.p))
                ii = int(rng.integers(len(self.parts[pi].items)))
                it = self.parts[pi].items[ii]
                f = it["f_len"] if "truth" in it else min(it["f_len"], self.max_frames)
                waiting.setdefault(self.bucket(f), []).append((pi, ii, int(rng.integers(2 ** 31))))
            batches = []
            for b, lst in waiting.items():
                bs = max(1, self.frames_per_batch // b)
                while len(lst) >= bs:
                    batches.append((b, lst[:bs]))
                    lst = lst[bs:]
                waiting[b] = lst
            rng.shuffle(batches)
            for b, items in batches:
                total += b * len(items)
                yield items
                if total >= self.epoch_frames:
                    return

    def __len__(self):
        return int(self.epoch_frames / self.frames_per_batch)
