"""Shared pieces: audio I/O, whisper log-mel, teacher wrapper, student model, CTC helpers.

Frame alignment (important):
  * whisper log-mel: n_fft 400, hop 160, centre=True (reflect pad 200), last STFT frame dropped
    -> N_mel = len(audio) // 160 frames, mel frame k centred at sample 160*k.
  * whisper encoder: conv1 (k3,s1,p1) + conv2 (k3,s2,p1) -> M = ceil(N_mel/2) frames,
    encoder frame m centred at mel frame 2m = sample 320*m (50 fps).
  * wav2vec2 (lv-60): conv stack stride 320, receptive field 400 -> frame i covers
    samples [320i, 320i+400), centred at 320i+200.
  -> We zero-pad the teacher input by 200 samples on BOTH sides, so teacher frame i is centred
     at original sample 320*i, i.e. exactly on student frame i. Teacher frames are then cut/padded
     to M = ceil((len(audio)//160)/2).
"""
import io
import json
import math
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torch.nn as nn
import torch.nn.functional as F

SR = 16000
HOP = 160
N_FFT = 400
FPS = 50
TEACHER_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"
PROJECT = Path(__file__).resolve().parents[3]
WORK = PROJECT / ".work" / "distill"
VB223_DIR = PROJECT / ".work" / "models" / "whisper-phoneme"


# ----------------------------------------------------------------------------- audio

def decode_audio(data, target_sr=SR):
    """bytes (wav/flac/...) or path -> float32 mono at target_sr."""
    src = io.BytesIO(data) if isinstance(data, (bytes, bytearray)) else data
    a, sr = sf.read(src, dtype="float32", always_2d=True)
    a = a.mean(axis=1)
    if sr != target_sr:
        a = resample(a, sr, target_sr)
    return np.ascontiguousarray(a, dtype=np.float32)


def resample(a, sr_from, sr_to):
    import torchaudio.functional as AF
    g = math.gcd(int(sr_from), int(sr_to))
    t = torch.from_numpy(np.ascontiguousarray(a, dtype=np.float32))
    return AF.resample(t, int(sr_from) // g, int(sr_to) // g).numpy()


def n_student_frames(n_samples):
    n_mel = n_samples // HOP
    return (n_mel + 1) // 2


# ----------------------------------------------------------------------------- whisper log-mel

_MEL_CACHE = {}


def mel_filters(device, n_mels=80):
    key = (str(device), n_mels)
    if key not in _MEL_CACHE:
        import whisper
        _MEL_CACHE[key] = whisper.audio.mel_filters(device, n_mels)
    return _MEL_CACHE[key]


def log_mel(audio, n_mels=80, device=None):
    """Whisper log-mel for ONE utterance, no 30-s padding. audio: 1-D tensor/array (16 kHz).
    Returns [n_mels, len//160]. Identical maths to whisper.log_mel_spectrogram (per-utterance max clamp)."""
    a = torch.as_tensor(audio, dtype=torch.float32)
    if device is not None:
        a = a.to(device)
    window = torch.hann_window(N_FFT, device=a.device)
    stft = torch.stft(a, N_FFT, HOP, window=window, return_complex=True)
    mag = stft[..., :-1].abs() ** 2
    mel = mel_filters(a.device, n_mels) @ mag
    log_spec = torch.clamp(mel, min=1e-10).log10()
    log_spec = torch.maximum(log_spec, log_spec.max() - 8.0)
    return (log_spec + 4.0) / 4.0


# ----------------------------------------------------------------------------- teacher

class Teacher:
    """lv-60 espeak CTC model; returns frame log-probs aligned to student frames."""

    def __init__(self, device="mps", dtype=torch.float32):
        from transformers import Wav2Vec2ForCTC
        self.device, self.dtype = device, dtype
        self.model = Wav2Vec2ForCTC.from_pretrained(TEACHER_ID).eval().to(device=device, dtype=dtype)
        from huggingface_hub import hf_hub_download
        vocab = json.load(open(hf_hub_download(TEACHER_ID, "vocab.json")))
        self.vocab = [None] * len(vocab)
        for k, i in vocab.items():
            self.vocab[i] = k
        self.blank = self.model.config.pad_token_id

    @torch.no_grad()
    def logprobs(self, audio, ctx_pad_sec=None, short_sec=4.0, quantum=16000):
        """audio: float32 16 kHz numpy -> [M, 392] float32 log-probs (M = student frame count).

        * 200-sample zero pad on both sides centres teacher frame i on sample 320*i.
        * Clips shorter than `short_sec` get `ctx_pad_sec` (default 0.5 s = 25 frames) of silence on both
          sides (helps lv-60 on isolated words); the extra frames are dropped again.
        * The input is zero-padded to a multiple of `quantum` samples with an attention mask, so MPS sees a
          small set of shapes (graph cache) - identical outputs, ~3x faster than a new shape per clip.
        """
        a = np.asarray(audio, dtype=np.float32)
        a = (a - a.mean()) / np.sqrt(a.var() + 1e-7)          # Wav2Vec2FeatureExtractor normalisation
        if ctx_pad_sec is None:
            ctx_pad_sec = 0.5 if len(a) < short_sec * SR else 0.0
        cf = int(round(ctx_pad_sec * FPS))                    # context frames (whole frames keep alignment)
        a = np.pad(a, (200 + cf * 320, 200 + cf * 320))       # centre teacher frames on 320*i
        L = int(np.ceil(len(a) / quantum) * quantum) if quantum else len(a)
        x = np.zeros((1, L), np.float32)
        x[0, :len(a)] = a
        mask = np.zeros((1, L), np.int64)
        mask[0, :len(a)] = 1
        lg = self.model(torch.from_numpy(x).to(self.device, self.dtype),
                        attention_mask=torch.from_numpy(mask).to(self.device)).logits[0].float()
        lp = torch.log_softmax(lg, dim=-1)[cf:]
        m = n_student_frames(len(audio))
        if lp.shape[0] >= m:
            lp = lp[:m]
        else:  # pad with blank
            pad = torch.full((m - lp.shape[0], lp.shape[1]), -30.0, device=lp.device)
            pad[:, self.blank] = 0.0
            lp = torch.cat([lp, pad], 0)
        return lp.cpu()


# ----------------------------------------------------------------------------- CTC helpers

def ctc_greedy(ids, blank=0):
    out, prev = [], -1
    for t in ids:
        if t != prev and t != blank:
            out.append(int(t))
        prev = t
    return out


def edit_distance(a, b):
    """Levenshtein distance between two sequences."""
    n, m = len(a), len(b)
    if n == 0:
        return m
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        ai = a[i - 1]
        for j in range(1, m + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai != b[j - 1]))
        prev = cur
    return prev[m]


def align_pairs(ref, hyp):
    """Levenshtein alignment -> list of (ref_sym or None, hyp_sym or None)."""
    n, m = len(ref), len(hyp)
    D = np.zeros((n + 1, m + 1), dtype=np.int32)
    D[:, 0] = np.arange(n + 1)
    D[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j] + 1, D[i, j - 1] + 1, D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    i, j, out = n, m, []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i, j] == D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            out.append((ref[i - 1], hyp[j - 1])); i -= 1; j -= 1
        elif i > 0 and D[i, j] == D[i - 1, j] + 1:
            out.append((ref[i - 1], None)); i -= 1
        else:
            out.append((None, hyp[j - 1])); j -= 1
    return out[::-1]
