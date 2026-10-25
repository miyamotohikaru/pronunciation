"""Kokoro-82M (Apache-2.0) synthetic speech with injected L2 (Japanese-learner style) phone errors.

Run with the TTS venv (read-only use of it):
    .venv-tts/bin/python tools/model/distill/kokoro_gen.py <group> [n_per_voice] [--device mps]

group: us | uk | ja | l2 | heldout     -> .work/distill/kokoro/<voice>/<id>.wav (16 kHz) + .json
The audio's *targets* still come from the lv-60 teacher (label.py wavdir); the injected errors only make
sure the training audio contains real substitutions/epenthesis in lexically misleading contexts.
"""
import json
import os
import random
import re
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / ".work" / "distill" / "kokoro"
MODEL_DIR = ROOT / ".work" / "tts" / "models" / "Kokoro-82M"   # read-only (TTS engineer's copy)

GROUPS = {
    "us": ("a", ["af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "af_nova", "af_alloy", "af_sky", "af_river",
                 "af_jessica", "am_fenrir", "am_puck", "am_echo", "am_eric", "am_liam", "am_onyx", "am_adam", "am_santa"]),
    "uk": ("b", ["bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_fable", "bm_lewis", "bm_daniel"]),
    "ja": ("a", ["jf_alpha", "jf_gongitsune", "jf_tebukuro", "jm_kumo"]),
    "l2": ("a", ["zf_xiaobei", "zf_xiaoni", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunyang", "hf_alpha", "hf_beta",
                 "hm_omega", "hm_psi", "ef_dora", "em_alex", "em_santa", "ff_siwis", "if_sara", "im_nicola", "pf_dora", "pm_alex"]),
    # never used for training: evaluation voices
    "heldout": ("a", ["am_michael", "bf_emma", "jf_nezumi", "zf_xiaoxiao", "zm_yunxia", "pm_santa"]),
}
PROFILES = {  # probability of each error profile per group
    "us": [("clean", .4), ("light", .45), ("medium", .15)],
    "uk": [("clean", .4), ("light", .45), ("medium", .15)],
    "ja": [("light", .2), ("medium", .3), ("katakana", .5)],
    "l2": [("clean", .3), ("light", .4), ("medium", .3)],
    "heldout": [("clean", .3), ("light", .3), ("medium", .2), ("katakana", .2)],
}

VOW = set("æɑɔəɚɛɪiʊuʌAIOWYᵊɜaeoɯɒQ")
CONS = set("bdfhjklmnpstvwzɡŋɹʃʒðθʤʧɾʔɸɕʦ")
FRONT_I = set("iɪ")
BACK_U = set("uʊ")

# substitution options: (replacement, weight); light/medium use the first (most typical) option most of the time
SUBS = {
    "ɹ": [("l", .45), ("ɾ", .45)], "l": [("ɾ", .5), ("ɹ", .5)], "θ": [("s", .75), ("t", .15), ("f", .1)],
    "ð": [("z", .5), ("d", .5)], "v": [("b", 1.0)], "f": [("ɸ", .7), ("h", .3)],
    "æ": [("a", .6), ("ʌ", .2), ("ɛ", .2)], "ʌ": [("a", .7), ("ɑ", .3)], "ɪ": [("i", 1.0)], "ʊ": [("u", .6), ("ɯ", .4)],
    "ɑ": [("a", .8), ("ɔ", .2)], "ɚ": [("a", 1.0)], "ɜ": [("a", 1.0)], "i": [("ɪ", 1.0)],
}
KATA_VOWEL = {"æ": "a", "ɑ": "a", "ʌ": "a", "ə": "a", "ᵊ": "", "ɚ": "aː", "ɜ": "a", "ɪ": "i", "ʊ": "ɯ", "u": "ɯ",
              "ɔ": "o", "ɛ": "e", "A": "ei", "I": "ai", "O": "oː", "W": "aɯ", "Y": "oi", "ɒ": "o", "Q": "oː"}
KATA_CONS = {"ɹ": "ɾ", "θ": "s", "ð": "z", "v": "b", "ʃ": "ɕ", "ʒ": "ʥ", "ʧ": "ʨ", "ʤ": "ʥ"}


def split_word(w):
    return list(w)


def is_v(c):
    return c in VOW


def next_phone(chars, k):
    for c in chars[k + 1:]:
        if c in "ˈˌː":
            continue
        return c
    return None


def inject(ps, profile, rng):
    """Return produced phoneme string and number of changes."""
    if profile == "clean":
        return ps, 0
    words = ps.split(" ")
    sites = []  # (word idx, char idx, kind)
    for wi, w in enumerate(words):
        ch = split_word(w)
        for k, c in enumerate(ch):
            nx = next_phone(ch, k)
            if c in SUBS:
                sites.append((wi, k, "sub"))
            if c in CONS and c not in "nŋ" and (nx is None or nx in CONS) and k + 1 <= len(ch):
                if nx is None and k == len(ch) - 1 or nx in CONS:
                    sites.append((wi, k, "ep"))
            if c == "s" and nx in FRONT_I:
                sites.append((wi, k, "si"))
            if c == "ɹ" and k > 0 and is_v(ch[k - 1]) and (nx is None or nx in CONS):
                sites.append((wi, k, "coda_r"))
    if not sites:
        return ps, 0
    if profile == "light":
        chosen = set(rng.sample(sites, min(len(sites), rng.choice([1, 1, 2]))))
        p_site = None
    else:
        chosen = None
        p_site = {"medium": 0.3, "katakana": 0.9}[profile]
    changes = 0
    new_words = []
    for wi, w in enumerate(words):
        ch = split_word(w)
        out = []
        for k, c in enumerate(ch):
            here = [s for s in sites if s[0] == wi and s[1] == k]
            take = [s for s in here if (chosen is not None and s in chosen) or (p_site is not None and rng.random() < p_site)]
            kinds = {s[2] for s in take}
            rep = c
            if profile == "katakana":
                if c in KATA_VOWEL:
                    rep = KATA_VOWEL[c]
                elif c in KATA_CONS:
                    rep = KATA_CONS[c]
                elif c == "l" and rng.random() < 0.7:
                    rep = "ɾ"
                elif c == "f" and rng.random() < 0.6:
                    rep = "ɸ"
            if "coda_r" in kinds:
                rep = "ː"
            elif "si" in kinds:
                rep = rng.choice(["ʃ", "ɕ"])
            elif "sub" in kinds and profile != "katakana":
                opts = SUBS[c]
                rep = rng.choices([o for o, _ in opts], [wt for _, wt in opts])[0]
            if rep != c:
                changes += 1
            out.append(rep)
            if "ep" in kinds and rep not in ("ː",):
                v = "o" if c in "td" else "i" if c in "ʧʤ" else ("ɯ" if profile == "katakana" or rng.random() < 0.5 else "u")
                out.append(v)
                changes += 1
        new_words.append("".join(out))
    return " ".join(new_words), changes


def main():
    group = sys.argv[1]
    n_per_voice = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    device = "mps" if "--device" in sys.argv and sys.argv[sys.argv.index("--device") + 1] == "mps" else "cpu"
    torch.set_num_threads(4)
    from kokoro import KModel, KPipeline
    from huggingface_hub import hf_hub_download
    lang, voices = GROUPS[group]
    model = KModel(repo_id="hexgrad/Kokoro-82M", config=str(MODEL_DIR / "config.json"),
                   model=str(MODEL_DIR / "kokoro-v1_0.pth")).to(device).eval()
    g2p = {lc: KPipeline(lang_code=lc, repo_id="hexgrad/Kokoro-82M", model=False) for lc in {"a", "b"}}
    phrases = json.loads((OUT / "phrases.json").read_text())
    seed = sum(ord(c) for c in group)
    rng = random.Random(seed)
    t0, n, sec = time.time(), 0, 0.0
    for vi, voice in enumerate(voices):
        pack = torch.load(hf_hub_download("hexgrad/Kokoro-82M", f"voices/{voice}.pt"), weights_only=True)
        vdir = OUT / voice
        vdir.mkdir(parents=True, exist_ok=True)
        sel = rng.sample(range(len(phrases)), n_per_voice)
        for j, pi in enumerate(sel):
            wav = vdir / f"{voice}_{pi:05d}.wav"
            if wav.exists():
                continue
            text = phrases[pi]["text"]
            lc = "b" if voice[0] == "b" else "a"
            try:
                ps, _ = g2p[lc].g2p(text)
            except Exception:
                continue
            ps = re.sub(r"\s+", " ", ps).strip()
            profile = rng.choices([p for p, _ in PROFILES[group]], [w for _, w in PROFILES[group]])[0]
            produced, changes = inject(ps, profile, rng)
            if len(produced) > 500 or len(produced) < 4:
                continue
            speed = rng.uniform(0.85, 1.15)
            with torch.no_grad():
                ref = pack[len(produced) - 1].to(device)
                audio = model(produced, ref, speed)
            a = audio.detach().float().cpu().numpy()
            # trim edge silence to ~150 ms
            env = np.abs(a) > 0.01 * (np.abs(a).max() + 1e-9)
            idx = np.flatnonzero(env)
            if len(idx) == 0:
                continue
            a = a[max(0, idx[0] - 3600): idx[-1] + 3600]
            a16 = resample_poly(a, 2, 3).astype(np.float32)
            a16 = a16 / (np.abs(a16).max() + 1e-9) * 0.7
            sf.write(wav, a16, 16000, subtype="PCM_16")
            meta = dict(text=text, voice=voice, kind=profile, speed=round(speed, 3), phonemes=ps, produced=produced,
                        target=ps, changes=changes, group=group)
            wav.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False))
            n += 1
            sec += len(a16) / 16000
        print(f"{group} {voice}: done ({vi + 1}/{len(voices)}), total {n} clips {sec / 3600:.2f} h, {time.time() - t0:.0f}s", flush=True)
    print("DONE", group, n, f"{sec / 3600:.2f} h")


if __name__ == "__main__":
    main()
