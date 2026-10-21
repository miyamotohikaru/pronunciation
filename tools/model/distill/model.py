"""Student: whisper base.en encoder (variable length, sliced positional embedding) + MLP CTC head.

Weights are initialised from vb223/whisper-base-en-phoneme-ctc (MIT): encoder as is, the two
hidden head layers as is, and the new output layer row-by-row from the vb223 ARPAbet rows that
correspond to each student IPA token (blank <- <pad>); tokens with no ARPAbet counterpart get the
mean row with a lowered bias.  (Structure copied from openai-whisper's AudioEncoder, MIT.)
"""
import json
import math
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

N_MELS, N_CTX, N_STATE, N_HEAD, N_LAYER = 80, 1500, 512, 8, 6


def sinusoids(length, channels, max_timescale=10000):
    log_inc = np.log(max_timescale) / (channels // 2 - 1)
    inv = torch.exp(-log_inc * torch.arange(channels // 2))
    t = torch.arange(length)[:, None] * inv[None, :]
    return torch.cat([torch.sin(t), torch.cos(t)], dim=1)


class MHA(nn.Module):
    def __init__(self, n_state, n_head):
        super().__init__()
        self.n_head = n_head
        self.query = nn.Linear(n_state, n_state)
        self.key = nn.Linear(n_state, n_state, bias=False)
        self.value = nn.Linear(n_state, n_state)
        self.out = nn.Linear(n_state, n_state)

    def forward(self, x, attn_mask=None):
        b, t, c = x.shape
        q = self.query(x).view(b, t, self.n_head, -1).transpose(1, 2)
        k = self.key(x).view(b, t, self.n_head, -1).transpose(1, 2)
        v = self.value(x).view(b, t, self.n_head, -1).transpose(1, 2)
        if attn_mask is None:
            a = F.scaled_dot_product_attention(q, k, v)
        else:  # attn_mask: [B,1,1,T] additive (0 keep / -inf pad)
            a = F.scaled_dot_product_attention(q, k, v, attn_mask=attn_mask)
        return self.out(a.transpose(1, 2).reshape(b, t, c))


class Block(nn.Module):
    def __init__(self, n_state, n_head):
        super().__init__()
        self.attn = MHA(n_state, n_head)
        self.attn_ln = nn.LayerNorm(n_state)
        self.mlp = nn.Sequential(nn.Linear(n_state, 4 * n_state), nn.GELU(), nn.Linear(4 * n_state, n_state))
        self.mlp_ln = nn.LayerNorm(n_state)

    def forward(self, x, attn_mask=None):
        x = x + self.attn(self.attn_ln(x), attn_mask)
        return x + self.mlp(self.mlp_ln(x))


class Student(nn.Module):
    def __init__(self, n_vocab, head_hidden=(2048, 1024), dropout=0.1, n_layer=N_LAYER):
        super().__init__()
        self.conv1 = nn.Conv1d(N_MELS, N_STATE, 3, padding=1)
        self.conv2 = nn.Conv1d(N_STATE, N_STATE, 3, stride=2, padding=1)
        self.register_buffer("positional_embedding", sinusoids(N_CTX, N_STATE), persistent=False)
        self.blocks = nn.ModuleList([Block(N_STATE, N_HEAD) for _ in range(n_layer)])
        self.ln_post = nn.LayerNorm(N_STATE)
        layers, w = [], N_STATE
        for h in head_hidden:
            layers += [nn.Linear(w, h), nn.GELU(), nn.Dropout(dropout)]
            w = h
        layers.append(nn.Linear(w, n_vocab))
        self.phoneme_head = nn.Sequential(*layers)
        self.n_vocab = n_vocab

    @staticmethod
    def out_lengths(mel_lens):
        return (mel_lens + 1) // 2

    def forward(self, mel, mel_lens=None):
        """mel [B,80,N] (whisper log-mel, zero-padded on the right in a batch) -> logits [B,ceil(N/2),V]."""
        x = F.gelu(self.conv1(mel))
        if mel_lens is not None:  # zero conv1 output past the end, exactly like conv2's zero padding at inference
            keep = torch.arange(x.shape[-1], device=x.device)[None, :] < mel_lens[:, None]
            x = x * keep[:, None, :].to(x.dtype)
        x = F.gelu(self.conv2(x)).transpose(1, 2)
        t = x.shape[1]
        x = x + self.positional_embedding[:t].to(x.dtype)
        mask = None
        if mel_lens is not None:
            olen = self.out_lengths(mel_lens)
            pad = torch.arange(t, device=x.device)[None, :] >= olen[:, None]
            if bool(pad.any()):
                mask = torch.zeros(pad.shape, dtype=x.dtype, device=x.device).masked_fill(pad, float("-inf"))
                mask = mask[:, None, None, :]
        for blk in self.blocks:
            x = blk(x, mask)
        return self.phoneme_head(self.ln_post(x))


def init_from_vb223(student, vb_dir, student_vocab, arpa_to_ipa_token):
    """Copy vb223 encoder + hidden head layers; build output rows from matching ARPAbet rows."""
    from safetensors.torch import load_file
    sd = load_file(str(Path(vb_dir) / "model.safetensors"))
    cfg = json.loads((Path(vb_dir) / "config.json").read_text())
    own = student.state_dict()
    copied = 0
    for k, v in sd.items():
        if k.startswith("encoder."):
            kk = k[len("encoder."):]
            if kk == "positional_embedding":
                continue
            own[kk].copy_(v); copied += 1
        elif k.startswith("phoneme_head.") and not k.startswith(f"phoneme_head.{3 * len(cfg['head_hidden_sizes'])}."):
            own[k].copy_(v); copied += 1
    last = 3 * len(cfg["head_hidden_sizes"])
    W, B = sd[f"phoneme_head.{last}.weight"], sd[f"phoneme_head.{last}.bias"]
    groups = {}
    for j, a in enumerate(cfg["vocab"]):
        ipa = "<blk>" if a == "<pad>" else arpa_to_ipa_token(a)
        if ipa is not None:
            groups.setdefault(ipa, []).append(j)
    w_new = torch.zeros(len(student_vocab), W.shape[1])
    b_new = torch.zeros(len(student_vocab))
    mean_w, low_b = W[1:].mean(0), B[1:].mean() - 2.0
    hit = []
    for i, p in enumerate(student_vocab):
        if p in groups:
            idx = groups[p]
            w_new[i], b_new[i] = W[idx].mean(0), B[idx].mean()
            hit.append(p)
        else:
            w_new[i], b_new[i] = mean_w + 0.01 * torch.randn_like(mean_w), low_b
    own[f"phoneme_head.{last}.weight"].copy_(w_new)
    own[f"phoneme_head.{last}.bias"].copy_(b_new)
    student.load_state_dict(own)
    return copied, hit


def vb223_token_to_ipa(a):
    """vb223 ARPAbet token (with or without stress digit) -> student IPA token (None if not mappable)."""
    import phoneset as P
    if a in ("<pad>", "<unk>"):
        return None
    try:
        return P.arpa_to_ipa([a], merge_coda_r=False)[0]
    except KeyError:
        return None


def count_params(m):
    return sum(p.numel() for p in m.parameters())
