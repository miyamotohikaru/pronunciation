"""Round 4: Kokoro minimal-pair clips for æ/ʌ/ɑ (hat/hut/hot) and v/b, labels trusted by construction.

    .venv-tts/bin/python tools/model/distill/kokoro_pairs.py <split> [--device mps] [--shard i/n]
    split: train (US + UK voices, training word list) | heldout (am_michael, bf_emma, held-out word list)

For every word we synthesise the correct production AND constructed substitutions by overriding the phoneme
that is under test (misaki phonemes in, Kokoro audio out), e.g. map: mˈæp / mˈʌp / mˈɑp / mˈap(Japanese a);
voice: vˈYs / bˈYs. The JSON records which output-token index is the tested phone, so training can override
the teacher only there (dataset.truth_target with explicit 'sites').
Words used by the `say` tests are excluded so those tests stay out-of-vocabulary.
-> .work/distill/kokoro_mp/<split>/<voice>/<id>.wav (16 kHz) + .json
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

sys.path.insert(0, str(Path(__file__).parent))
import phoneset as P  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / ".work" / "distill" / "kokoro_mp"
MODEL_DIR = ROOT / ".work" / "tts" / "models" / "Kokoro-82M"   # read-only (TTS engineer's copy)

US_TRAIN = ["af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "af_nova", "af_alloy", "af_sky",
            "af_river", "af_jessica", "am_fenrir", "am_puck", "am_echo", "am_eric", "am_liam", "am_onyx", "am_adam",
            "am_santa"]
UK_TRAIN = ["bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_fable", "bm_lewis", "bm_daniel"]
HELDOUT = ["am_michael", "bf_emma"]

# vowel words (US): misaki vowel symbol under test is æ / ʌ / ɑ
VOWEL_WORDS = {
    "train": {
        "æ": ["map", "man", "sad", "bad", "black", "back", "fat", "tap", "bat", "pat", "rat", "mat", "lamp", "hand", "stand",
              "cash", "track", "snack", "sack", "lack", "mad", "dad", "ran", "fan", "pan", "cab", "jam", "ham", "rag", "flag",
              "stack", "tack", "gnat", "lag", "dam", "happy", "apple", "family", "pack", "sand"],
        "ʌ": ["mud", "sun", "run", "fun", "bus", "but", "luck", "truck", "duck", "hum", "rug", "bun", "gun", "love", "come",
              "some", "money", "mother", "study", "lunch", "jump", "up", "buzz", "dull", "tough", "done", "son", "cub", "tub",
              "nut", "shut", "stuck", "suck", "tuck", "dumb", "lug", "bud", "dud", "pump", "uncle"],
        "ɑ": ["hot", "pot", "not", "lot", "got", "top", "stop", "shop", "mop", "rock", "lock", "sock", "dock", "box", "fox",
              "job", "rob", "mob", "cob", "nod", "rod", "pod", "odd", "doll", "father", "calm", "bomb", "cotton", "bottle",
              "model", "problem", "doctor", "hospital", "stock", "log", "mod", "bock", "on", "drop", "spot"],
    },
    "heldout": {
        "æ": ["cat ", "plan", "glad", "slap", "trap", "camp", "grab", "scan", "jacket", "panic"],
        "ʌ": ["cut ", "plum", "glove", "slum", "trust", "jungle", "grub", "scum", "puzzle", "honey"],
        "ɑ": ["cot ", "plot", "gloss", "slot", "trot", "comma", "knob", "scotch", "jog", "honest"],
    },
}
# v/b words: misaki consonant under test is v (substitute b) or b (substitute v)
VB_WORDS = {
    "train": {
        "v": ["voice", "video", "visit", "village", "violin", "vacation", "vegetable", "view", "vine", "vast", "valley",
              "value", "never", "seven", "eleven", "over", "every", "travel", "river", "give", "live", "five", "love",
              "move", "have", "above", "glove", "heavy", "oven", "cover", "silver", "invite", "avoid", "evening", "visa"],
        "b": ["bed", "ball", "bone", "big", "bus", "book", "bird", "about", "rubber", "cabin", "number", "maybe",
              "label", "tube", "globe", "job", "web", "bike", "bath", "bean"],
    },
    "heldout": {
        "v": ["vote ", "vowel", "vivid", "vapor", "velvet", "seventy", "clever", "drive", "brave", "wave"],
        "b": ["bin", "bulb", "robin", "rabbit", "baby", "cube", "rib", "tub", "bone ", "beach"],
    },
}
VB_PHRASES = {   # lexically misleading contexts (the teacher tends to 'hear' the real word)
    "train": ["I love it", "seven days", "five years", "never mind", "have a nice day", "over there", "every day",
              "give me that", "I live here", "move it", "a heavy box", "a new video", "visit us", "a nice view",
              "a big village", "eleven cats", "a silver ring", "the river bank"],   # no 'very' (kept out of training)
    "heldout": ["very fast", "I have five", "eleven o'clock", "never again", "a lovely view"],
}
CARRIERS = ["{w}", "{w}", "{w}.", "I said {w}.", "Say {w} again.", "{w}, please."]
SUBS_VOWEL = {"æ": ["ʌ", "ɑ", "a"], "ʌ": ["æ", "ɑ", "a"], "ɑ": ["æ", "ʌ", "o"]}
SUBS_VB = {"v": ["b"], "b": ["v"]}


def find_target(ps, ch):
    """index (in the word's phoneme string) of the first ch."""
    return ps.find(ch)


def student_site(prefix_ps, full_ps, expect):
    """Token index of the tested phone in kokoro_to_student(full_ps); None if conventions merge it."""
    toks = P.kokoro_to_student(full_ps)
    k = len(P.kokoro_to_student(prefix_ps))
    if k < len(toks) and toks[k] == expect:
        return k
    return None


def build_items(split, rng):
    from kokoro import KPipeline
    g2p = {lc: KPipeline(lang_code=lc, repo_id="hexgrad/Kokoro-82M", model=False) for lc in ("a", "b")}
    items = []

    def add(text_tpl, word, lc, target_ch, subs_map, kind_name, voices):
        for v in voices:
            if lc == "b" and target_ch == "æ":      # misaki UK writes TRAP as 'a' -> not a clean æ test
                continue
            pw, _ = g2p[lc].g2p(word.strip())
            pw = re.sub(r"[.,!?]", "", pw).strip()
            ch = target_ch
            if lc == "b" and ch == "ɑ":
                ch = "ɒ"
            i = find_target(pw, ch)
            if i < 0:
                continue
            for prod in [ch] + subs_map[target_ch]:
                if lc == "b" and prod == "ɑ":
                    prod = "ɒ"
                if prod == ch and False:
                    continue
                pw_prod = pw[:i] + prod + pw[i + 1:]
                tpl = text_tpl
                pre_txt, _, post_txt = tpl.partition("{w}")
                pre_ps = (g2p[lc].g2p(pre_txt.strip())[0] + " ") if pre_txt.strip() else ""
                post_ps = (" " + g2p[lc].g2p(post_txt.strip())[0]) if post_txt.strip(" .,") else post_txt.strip()
                full = pre_ps + pw_prod + post_ps
                prefix = pre_ps + pw_prod[:i]
                expect = P.kokoro_to_student(prod)[0] if P.kokoro_to_student(prod) else None
                site = student_site(prefix, full, expect)
                if site is None:
                    continue
                canon_tok = P.kokoro_to_student(ch)[0]
                items.append(dict(text=tpl.replace("{w}", word.strip()), word=word.strip(), voice=v, lang=lc,
                                  phonemes=pre_ps + pw + post_ps, produced=full, kind=kind_name,
                                  sub=prod != ch, intended=canon_tok, produced_phone=expect, site=site,
                                  context="isolated" if tpl.strip(" .") == "{w}" else "carrier"))
    us = US_TRAIN if split == "train" else [v for v in HELDOUT if v.startswith("a")]
    uk = UK_TRAIN if split == "train" else [v for v in HELDOUT if v.startswith("b")]
    for vowel, words in VOWEL_WORDS[split].items():
        for w in words:
            tpl = rng.choice(CARRIERS)
            add(tpl, w, "a", vowel, SUBS_VOWEL, "mp_vowel", rng.sample(us, min(len(us), 6)))
            if vowel != "æ":
                add(rng.choice(CARRIERS), w, "b", vowel, SUBS_VOWEL, "mp_vowel", rng.sample(uk, min(len(uk), 2)))
    for cons, words in VB_WORDS[split].items():
        for w in words:
            add(rng.choice(CARRIERS), w, "a", cons, SUBS_VB, "mp_vb", rng.sample(us, min(len(us), 6)))
            add(rng.choice(CARRIERS), w, "b", cons, SUBS_VB, "mp_vb", rng.sample(uk, min(len(uk), 2)))
    for ph in VB_PHRASES[split]:
        # the first v of the phrase is under test
        words = ph.split()
        k = next((j for j, x in enumerate(words) if "v" in x), None)
        if k is None:
            continue
        tpl = " ".join(words[:k] + ["{w}"] + words[k + 1:])
        add(tpl, words[k], "a", "v", SUBS_VB, "mp_vb_phrase", rng.sample(us, min(len(us), 8)))
        add(tpl, words[k], "b", "v", SUBS_VB, "mp_vb_phrase", rng.sample(uk, min(len(uk), 3)))
    return items


def main():
    split = sys.argv[1]
    device = "mps" if "--device" in sys.argv and sys.argv[sys.argv.index("--device") + 1] == "mps" else "cpu"
    torch.set_num_threads(4)
    rng = random.Random(4 if split == "train" else 44)
    items = build_items(split, rng)
    print(split, len(items), "items", flush=True)
    from kokoro import KModel
    from huggingface_hub import hf_hub_download
    model = KModel(repo_id="hexgrad/Kokoro-82M", config=str(MODEL_DIR / "config.json"),
                   model=str(MODEL_DIR / "kokoro-v1_0.pth")).to(device).eval()
    packs = {}
    t0, n = time.time(), 0
    shard, nshard = 0, 1
    if "--shard" in sys.argv:
        shard, nshard = map(int, sys.argv[sys.argv.index("--shard") + 1].split("/"))
    for j, it in enumerate(items):
        if j % nshard != shard:
            continue
        v = it["voice"]
        d = OUT / split / v
        d.mkdir(parents=True, exist_ok=True)
        wav = d / f"{v}_{j:05d}.wav"
        if wav.exists():
            continue
        if v not in packs:
            packs[v] = torch.load(hf_hub_download("hexgrad/Kokoro-82M", f"voices/{v}.pt"), weights_only=True)
        ps = it["produced"]
        speed = rng.uniform(0.85, 1.1)
        with torch.no_grad():
            audio = model(ps, packs[v][len(ps) - 1].to(device), speed)
        a = audio.detach().float().cpu().numpy()
        env = np.flatnonzero(np.abs(a) > 0.01 * (np.abs(a).max() + 1e-9))
        if len(env) == 0:
            continue
        a = a[max(0, env[0] - 3600): env[-1] + 3600]
        a16 = resample_poly(a, 2, 3).astype(np.float32)
        sf.write(wav, a16 / (np.abs(a16).max() + 1e-9) * 0.7, 16000, subtype="PCM_16")
        wav.with_suffix(".json").write_text(json.dumps(dict(it, speed=round(speed, 3)), ensure_ascii=False))
        n += 1
        if n % 200 == 0:
            print(f"{n} clips, {time.time() - t0:.0f}s", flush=True)
    print("DONE", split, n)


if __name__ == "__main__":
    main()
