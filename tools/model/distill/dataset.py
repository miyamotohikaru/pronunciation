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


class DistillDataset(torch.utils.data.Dataset):
    """Each __getitem__ gets (part_idx, item_idx, seed). Returns mel, teacher log-probs, ctc labels."""

    def __init__(self, parts, train=True, max_sec=12.0, min_crop_sec=1.5, aug_p=0.85):
        self.parts = parts
        self.train = train
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
            if F > self.max_frames or rng.random() < 0.3:
                nf = int(rng.integers(min(self.min_crop, F), min(F, self.max_frames) + 1))
                f0 = int(rng.integers(0, F - nf + 1))
        elif F > self.max_frames:
            nf = self.max_frames
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
        ids = p.argmax(-1).tolist()
        lab, prev = [], -1
        for t in ids:
            if t != prev and t != 0:
                lab.append(t)
            prev = t
        return mel, p, torch.tensor(lab, dtype=torch.long), f"{part.name}:{it['id']}"


def collate(batch):
    B = len(batch)
    N = max(b[0].shape[-1] for b in batch)
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
    """Weighted sampling over parts, length-bucketed batches with a frame budget."""

    def __init__(self, parts, weights, frames_per_batch=10000, max_frames=600, epoch_hours=10.0, seed=0, pool=2000):
        self.parts, self.frames_per_batch, self.max_frames = parts, frames_per_batch, max_frames
        self.epoch_frames = int(epoch_hours * 3600 * 50)
        self.seed, self.pool = seed, pool
        w = np.array(weights, dtype=np.float64)
        self.p = w / w.sum()
        self.epoch = 0

    def __iter__(self):
        rng = np.random.default_rng(self.seed + 1000 * self.epoch)
        self.epoch += 1
        total = 0
        while total < self.epoch_frames:
            cand = []
            for _ in range(self.pool):
                pi = int(rng.choice(len(self.parts), p=self.p))
                ii = int(rng.integers(len(self.parts[pi].items)))
                f = min(self.parts[pi].items[ii]["f_len"], self.max_frames)
                cand.append((f, pi, ii, int(rng.integers(2 ** 31))))
            cand.sort()
            batches, cur, cur_max = [], [], 0
            for c in cand:
                nm = max(cur_max, c[0])
                if cur and nm * (len(cur) + 1) > self.frames_per_batch:
                    batches.append(cur)
                    cur, nm = [], c[0]
                cur.append(c)
                cur_max = nm
            if cur:
                batches.append(cur)
            rng.shuffle(batches)
            for b in batches:
                total += sum(c[0] for c in b)
                yield [(c[1], c[2], c[3]) for c in b]
                if total >= self.epoch_frames:
                    return

    def __len__(self):
        return int(self.epoch_frames / (self.frames_per_batch * 0.8))
