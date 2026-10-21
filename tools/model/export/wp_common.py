"""Shared Python reference for the whisper-phoneme CTC scorer.

This is the numerical reference the TypeScript engine (src/engine/scoring) is tested
against. It re-implements the upstream logic (vb223/whisper-base-en-phoneme-ctc,
modeling_whisper_phoneme.py) instead of importing it from the model folder.

Variants (see eval_speechocean.py):
  pad30  : mel of the audio zero-padded to 30 s, encoder over 1500 frames (upstream)
  trim   : mel of the real audio only, positional embedding sliced to the real frame count
  merged : stress variants (AA, AA0, AA1, AA2) merged with logsumexp into one unit per
           ARPAbet base symbol before alignment and GOP
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchaudio
import whisper
from safetensors.torch import load_file
from whisper.model import AudioEncoder

SAMPLE_RATE = 16000
HOP = 160
SAMPLES_PER_FRAME = 320  # the encoder's stride-2 conv: 50 frames per second
FPS = 50
GOP_FEATURES = ["gop", "logp_target", "logp_competitor", "logp_target_min", "n_frames"]


# --------------------------------------------------------------------------- model
class PhonemeNet(nn.Module):
    """Whisper base.en AudioEncoder + MLP head (same layer layout as the checkpoint)."""

    def __init__(self, c):
        super().__init__()
        self.encoder = AudioEncoder(c["n_mels"], c["n_audio_ctx"], c["n_audio_state"],
                                    c["n_audio_head"], c["n_audio_layer"])
        layers, width = [], c["n_audio_state"]
        for h in c["head_hidden_sizes"]:
            layers += [nn.Linear(width, h), nn.GELU(), nn.Dropout(0.1)]
            width = h
        layers.append(nn.Linear(width, c["output_dim"]))
        self.phoneme_head = nn.Sequential(*layers)

    def forward(self, mel):  # upstream forward: needs exactly 3000 mel frames
        return self.phoneme_head(self.encoder(mel))


class DynamicLogProbs(nn.Module):
    """Export wrapper: any mel length, positional embedding sliced, log-softmax inside.

    mel [1, 80, L] -> log_probs [1, ceil(L/2), V]
    """

    def __init__(self, net: PhonemeNet):
        super().__init__()
        self.enc = net.encoder
        self.head = net.phoneme_head

    def forward(self, mel):
        x = F.gelu(self.enc.conv1(mel))
        x = F.gelu(self.enc.conv2(x))
        x = x.permute(0, 2, 1)
        x = x + self.enc.positional_embedding[: x.shape[1]]
        for block in self.enc.blocks:
            x = block(x)
        x = self.enc.ln_post(x)
        return torch.log_softmax(self.head(x), dim=-1)


def load_net(model_dir: Path):
    cfg = json.loads((Path(model_dir) / "config.json").read_text())
    net = PhonemeNet(cfg)
    net.load_state_dict(load_file(str(Path(model_dir) / "model.safetensors")), strict=True)
    net.eval()
    return net, cfg


def load_regressor(model_dir: Path):
    from safe_load_regressor import safe_load
    return safe_load(str(Path(model_dir) / "gop_regressor.joblib"))


# --------------------------------------------------------------------------- audio
def needed_samples(n_samples: int, n_phones: int) -> int:
    """Zero-pad very short clips so CTC always has a feasible path (n_phones + 5 frames)."""
    return max(n_samples, (n_phones + 5) * SAMPLES_PER_FRAME)


def log_mel(audio: np.ndarray, pad30: bool, n_phones: int = 0) -> torch.Tensor:
    """Whisper log-mel [80, L]. pad30 = upstream 30-s padding; else the real audio only."""
    a = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))
    if pad30:
        a = whisper.pad_or_trim(a)
    else:
        need = needed_samples(len(a), n_phones)
        if need > len(a):
            a = F.pad(a, (0, need - len(a)))
    return whisper.log_mel_spectrogram(a, n_mels=80)


def align_frames(n_samples: int, n_phones: int, available: int) -> int:
    """Upstream valid_frames_for(): encoder frames holding real audio, floored at n+5."""
    frames = min(int(n_samples / SAMPLE_RATE * FPS), 1500)
    frames = min(max(frames, n_phones + 5), 1500)
    return min(frames, available)


# --------------------------------------------------------------------------- units
def base_symbol(p: str) -> str:
    return re.sub(r"[0-2]$", "", p)


class UnitTable:
    """Model tokens grouped into scoring units.

    unmerged: one unit per model token (identity), the upstream behaviour.
    merged  : unit 0 = blank, then one unit per ARPAbet base symbol; a unit's
              log-prob is the logsumexp of its tokens (AA = AA|AA0|AA1|AA2).
    """

    def __init__(self, vocab, output_dim, blank_id=0, merged=False):
        self.vocab = list(vocab)
        self.output_dim = output_dim
        self.blank_tok = blank_id
        self.merged = merged
        if merged:
            groups = {}
            for i, p in enumerate(vocab):
                if i == blank_id or p.startswith("<"):
                    continue
                groups.setdefault(base_symbol(p), []).append(i)
            self.names = ["<blank>"] + list(groups)
            self.groups = [[blank_id]] + list(groups.values())
            self.blank = 0
            # competitors: every phone unit (blank excluded)
            self.competitor_mask = np.ones(len(self.names), dtype=bool)
            self.competitor_mask[0] = False
        else:
            self.names = list(vocab) + [f"<tok{i}>" for i in range(len(vocab), output_dim)]
            self.groups = [[i] for i in range(output_dim)]
            self.blank = blank_id
            self.competitor_mask = np.ones(output_dim, dtype=bool)
            self.competitor_mask[blank_id] = False
        self.index = {n: i for i, n in enumerate(self.names)}

    def unit_of(self, phone: str) -> int:
        return self.index[base_symbol(phone)] if self.merged else self.index[phone]

    def apply(self, lp: torch.Tensor) -> torch.Tensor:
        """[T, V] token log-probs -> [T, U] unit log-probs."""
        if not self.merged:
            return lp
        return torch.stack([torch.logsumexp(lp[:, g], dim=-1) for g in self.groups], dim=-1)


# --------------------------------------------------------------------------- align + GOP
def forced_align(ulp: torch.Tensor, targets: list[int], blank: int):
    """torchaudio CTC forced alignment + merge_tokens over unit log-probs [T, U]."""
    T = ulp.shape[0]
    tok, fs = torchaudio.functional.forced_align(
        ulp.unsqueeze(0).contiguous(), torch.tensor([targets], dtype=torch.int32),
        torch.tensor([T], dtype=torch.int32), torch.tensor([len(targets)], dtype=torch.int32), blank=blank)
    spans = torchaudio.functional.merge_tokens(tok[0], fs[0], blank=blank)
    return tok[0].tolist(), spans


def gop_rows(ulp: torch.Tensor, spans, units: UnitTable):
    rows = []
    mask = torch.from_numpy(units.competitor_mask)
    for s in spans:
        seg = ulp[s.start:s.end]
        comp = seg.masked_fill(~mask, float("-inf")).clone()
        comp[:, s.token] = float("-inf")
        best = comp.max(dim=-1).values
        tgt = seg[:, s.token]
        rows.append({
            "unit": s.token, "start": s.start, "end": s.end,
            "gop": float((tgt - best).mean()),
            "logp_target": float(tgt.mean()),
            "logp_competitor": float(best.mean()),
            "logp_target_min": float(tgt.min()),
            "n_frames": s.end - s.start,
        })
    return rows


def feature_matrix(rows, onehot_ids, n_classes):
    numeric = np.array([[r[f] for f in GOP_FEATURES] for r in rows], dtype=np.float32)
    onehot = np.zeros((len(rows), n_classes), dtype=np.float32)
    onehot[np.arange(len(rows)), onehot_ids] = 1.0
    return np.hstack([numeric, onehot])


def score_logprobs(lp: torch.Tensor, phones: list[str], n_samples: int, units: UnitTable,
                   reg, onehot_mode: str, vocab_index: dict):
    """lp: [T_avail, V] token log-probs. Returns (rows, scores) or raises ValueError.

    onehot_mode: 'label'  -> one-hot of the phone exactly as given (e.g. AA0)
                 'stress0'-> one-hot of the base symbol's stress-0 variant (AA -> AA0)
    """
    frames = align_frames(n_samples, len(phones), lp.shape[0])
    if len(phones) >= frames:
        raise ValueError("too many phones for the frames")
    ulp = units.apply(lp[:frames].float())
    targets = [units.unit_of(p) for p in phones]
    _, spans = forced_align(ulp, targets, units.blank)
    if len(spans) != len(phones):
        raise ValueError("span count mismatch")
    rows = gop_rows(ulp, spans, units)
    if onehot_mode == "label":
        oh = [vocab_index[p] for p in phones]
    else:  # consonants have no stress variants; vowels -> their stress-0 token
        oh = [vocab_index.get(base_symbol(p) + "0", vocab_index[base_symbol(p)]) for p in phones]
    X = feature_matrix(rows, oh, units.output_dim)
    return rows, reg.predict(X)


# --------------------------------------------------------------------------- lexicon
def load_cmudict(path: Path):
    d = {}
    for line in open(path, encoding="utf-8"):
        w, *ph = line.split()
        if "(" in w:
            continue
        d[w] = ph
    return d


def phones_mono0(words, cmu):
    """CMUdict phones with speechocean762's convention: monosyllables carry stress 0."""
    out = []
    for wi, w in enumerate(words):
        ph = cmu[w.lower()]
        nv = sum(1 for p in ph if p[-1].isdigit())
        for p in ph:
            if p[-1].isdigit() and nv == 1:
                p = p[:-1] + "0"
            out.append((wi, p))
    return out


def logsumexp_np(x, axis=-1):
    m = np.max(x, axis=axis, keepdims=True)
    return (m + np.log(np.sum(np.exp(x - m), axis=axis, keepdims=True))).squeeze(axis)


def pcc(a, b):
    return float(np.corrcoef(np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64))[0, 1])
