"""On-the-fly waveform augmentation for the student (teacher targets stay those of the clean audio).

Nothing here shifts the time axis (reverb keeps the direct path at lag 0, filters are zero-phase),
so teacher frame i stays aligned with student frame i.  Speed perturbation is done before
teacher labelling instead (label.py --speed).
"""
import numpy as np
from scipy import signal

SR = 16000


def _db(x):
    return 10 ** (x / 20)


def colored_noise(n, rng, kind):
    white = rng.standard_normal(n).astype(np.float32)
    if kind == "white":
        return white
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1] if n > 1 else 1.0
    spec = np.fft.rfft(white)
    expo = {"pink": 0.5, "brown": 1.0, "blue": -0.5}[kind]
    spec = spec / (f ** expo)
    out = np.fft.irfft(spec, n).astype(np.float32)
    return out / (out.std() + 1e-9)


def hum(n, rng):
    f0 = rng.choice([50.0, 60.0])
    t = np.arange(n) / SR
    x = sum(rng.uniform(0.2, 1.0) / k * np.sin(2 * np.pi * f0 * k * t + rng.uniform(0, 6.28)) for k in range(1, 8))
    x = x + 0.3 * colored_noise(n, rng, "pink")
    return (x / (x.std() + 1e-9)).astype(np.float32)


def synth_rir(rng):
    rt60 = rng.uniform(0.15, 0.8)
    n = int(SR * min(1.2 * rt60, 1.0))
    t = np.arange(n) / SR
    tail = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    # a few early reflections
    for _ in range(rng.integers(2, 6)):
        k = rng.integers(int(0.002 * SR), int(0.03 * SR))
        if k < n:
            tail[k] += rng.uniform(-0.6, 0.6)
    tail[0] = 0.0
    tail = tail / (np.sqrt((tail ** 2).sum()) + 1e-9)
    drr = _db(rng.uniform(-3, 12))  # direct-to-reverberant ratio
    h = tail
    h[0] = drr
    return (h / np.abs(h).max()).astype(np.float32)


def bandlimit(x, rng):
    lo = rng.uniform(80, 400)
    hi = rng.uniform(3000, 7600)
    sos = signal.butter(rng.integers(2, 5), [lo, hi], btype="bandpass", fs=SR, output="sos")
    return signal.sosfiltfilt(sos, x).astype(np.float32)


def telephone(x, rng):
    """8 kHz round trip + optional mu-law 8-bit."""
    y = signal.resample_poly(x, 1, 2)
    if rng.random() < 0.5:
        mu = 255.0
        c = np.sign(y) * np.log1p(mu * np.abs(np.clip(y, -1, 1))) / np.log1p(mu)
        c = np.round(c * 127) / 127
        y = np.sign(c) * ((1 + mu) ** np.abs(c) - 1) / mu
    return signal.resample_poly(y, 2, 1)[: len(x)].astype(np.float32)


def eq(x, rng):
    """1-3 random peaking filters (+-9 dB): mic/room colouration. Zero-phase."""
    for _ in range(rng.integers(1, 4)):
        f0 = rng.uniform(150, 6000)
        gain = rng.uniform(-9, 9)
        q = rng.uniform(0.5, 3)
        A = 10 ** (gain / 40)
        w0 = 2 * np.pi * f0 / SR
        alpha = np.sin(w0) / (2 * q)
        b = [1 + alpha * A, -2 * np.cos(w0), 1 - alpha * A]
        a = [1 + alpha / A, -2 * np.cos(w0), 1 - alpha / A]
        x = signal.filtfilt(b, a, x).astype(np.float32)
    return x


def augment(x, rng, babble_source=None, p=0.85):
    """x: float32 16 kHz clean. Returns augmented copy (same length)."""
    x = x.astype(np.float32).copy()
    if rng.random() > p:
        return x * _db(rng.uniform(-6, 6))
    n = len(x)
    if rng.random() < 0.3:
        h = synth_rir(rng)
        x = signal.fftconvolve(x, h)[:n].astype(np.float32)
    if rng.random() < 0.25:
        x = eq(x, rng)
    if rng.random() < 0.5:
        kind = rng.choice(["white", "pink", "brown", "babble", "hum", "pink"])
        if kind == "babble" and babble_source is not None:
            nz = np.zeros(n, np.float32)
            for _ in range(rng.integers(3, 7)):
                b = babble_source(n)
                nz += b / (b.std() + 1e-9)
        elif kind == "hum":
            nz = hum(n, rng)
        else:
            nz = colored_noise(n, rng, "pink" if kind == "babble" else kind)
        snr = rng.uniform(5, 30)
        ps = np.mean(x ** 2) + 1e-10
        pn = np.mean(nz ** 2) + 1e-10
        x = x + nz * np.sqrt(ps / (pn * 10 ** (snr / 10)))
    r = rng.random()
    if r < 0.15:
        x = telephone(x, rng)
    elif r < 0.45:
        x = bandlimit(x, rng)
    # gain (peak-normalised then random level), occasional clipping
    x = x / (np.abs(x).max() + 1e-6) * _db(rng.uniform(-30, -1))
    if rng.random() < 0.05:
        x = np.clip(x * _db(rng.uniform(3, 12)), -1, 1)
    return x.astype(np.float32)
