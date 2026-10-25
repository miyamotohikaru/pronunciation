"""Round 5: the app's own curriculum (content/curriculum.json) rendered by Kokoro, with constructed substitutions.

    .venv-tts/bin/python tools/model/distill/kokoro_curriculum.py <train|heldout> [--device mps] [--shard i/n]

Every item text (word / pair partner / phrase / sentence / placement) is synthesised as written (correct) and, for
each focus phone, with each `watch_for` confusion constructed by overriding that phone in the misaki phonemes
(R<->L, TH->S/T, DH->Z/D, V<->B, F<->HH(ɸ), AE/AH/AA, IY<->IH, UH<->UW, S<->SH, ER->AA/AH/AO, EPEN = vowel inserted
after the consonant). The JSON records the output-token index of every focus phone ('sites') and which one was
substituted, so training overrides the teacher only there.
Voices: HELDOUT_US (af_heart, af_bella, am_michael, am_puck) are never used for training in round 5
(the round-5 student is retrained from vb223 with these voices removed from every Kokoro part).
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
OUT = ROOT / ".work" / "distill" / "kokoro_cur"
MODEL_DIR = ROOT / ".work" / "tts" / "models" / "Kokoro-82M"   # read-only (TTS engineer's copy)
CURRICULUM = ROOT / "content" / "curriculum.json"               # read-only

HELDOUT_US = ["af_heart", "af_bella", "am_michael", "am_puck"]
US_ALL = ["af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river",
          "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx",
          "am_puck", "am_santa"]
UK_TRAIN = ["bf_isabella", "bf_alice", "bf_lily", "bm_george", "bm_fable", "bm_lewis", "bm_daniel"]   # bf_emma held out
US_TRAIN = [v for v in US_ALL if v not in HELDOUT_US]

# ARPAbet focus phone -> misaki symbol(s) to look for (first match wins)
SYM = {"R": ["ɹ"], "L": ["l"], "TH": ["θ"], "DH": ["ð"], "S": ["s"], "SH": ["ʃ"], "T": ["t", "T", "ɾ"], "D": ["d"],
       "Z": ["z"], "V": ["v"], "B": ["b"], "F": ["f"], "HH": ["h"], "K": ["k"], "G": ["ɡ"], "P": ["p"], "M": ["m"],
       "N": ["n"], "NG": ["ŋ"], "CH": ["ʧ"], "JH": ["ʤ"], "W": ["w"], "AE": ["æ"], "AH": ["ʌ", "ə", "ᵊ"],
       "AA": ["ɑ"], "AO": ["ɔ"], "IY": ["i"], "IH": ["ɪ"], "UH": ["ʊ"], "UW": ["u"], "EH": ["ɛ"], "EY": ["A"],
       "AY": ["I"], "OW": ["O"], "ER": ["ɜɹ", "əɹ", "ɚ"]}
# substitute symbol for a watch_for phone
SUB = {"L": "l", "R": "ɹ", "S": "s", "T": "t", "Z": "z", "D": "d", "B": "b", "V": "v", "HH": "h", "F": "f",
       "AE": "æ", "AH": "ʌ", "AA": "ɑ", "AO": "ɔ", "OW": "O", "UW": "u", "UH": "ʊ", "IY": "i", "IH": "ɪ", "SH": "ʃ",
       "TH": "θ", "CH": "ʧ", "EY": "A", "EH": "ɛ", "NG": "ŋ", "N": "n", "ER": "ɜɹ", "JH": "ʤ"}
CONS = set("bdfhjklmnpstvwzɡŋɹʃʒðθʤʧT")


def curriculum_texts():
    d = json.loads(CURRICULUM.read_text())
    items = [dict(it, feature="placement", type="placement") for it in d["placement"]]
    for u in d["units"]:
        for l in u["lessons"]:
            for it in l["items"]:
                items.append(dict(it, feature=u["feature"]))
    texts = []
    for it in items:
        if it["type"] == "pair":   # render both partners as single words
            for w in dict.fromkeys(f["word"] for f in it["focus"]):
                texts.append(dict(id=f"{it['id']}_{w}", text=w, feature=it["feature"],
                                  focus=[f for f in it["focus"] if f["word"] == w]))
        else:
            texts.append(dict(id=it["id"], text=it["text"], feature=it["feature"], focus=it["focus"]))
    return texts


def word_phonemes(g2p, text):
    """[(word, misaki phonemes)] in order (punctuation dropped)."""
    out = []
    for w in re.findall(r"[A-Za-z']+", text):
        ps, _ = g2p(w)
        out.append((w, re.sub(r"[.,!?;:\"“”]", "", ps).strip()))
    return out


def locate(ps, phone):
    for s in SYM.get(phone, []):
        i = ps.find(s)
        if i >= 0:
            return i, s
    return -1, None


def build(split, rng):
    from kokoro import KPipeline
    g2p = {lc: KPipeline(lang_code=lc, repo_id="hexgrad/Kokoro-82M", model=False).g2p for lc in ("a", "b")}
    jobs = []
    for t in curriculum_texts():
        for lc in ("a", "b"):
            if split == "heldout" and lc == "b":
                continue
            wp = word_phonemes(g2p[lc], t["text"])
            if not wp:
                continue
            # locate every focus phone once
            foc = []
            for f in t["focus"]:
                if f["phone"] in ("AE", "ER") and lc == "b":     # UK TRAP = 'a', UK is non-rhotic
                    continue
                wi = next((k for k, (w, _) in enumerate(wp) if w.lower() == f["word"].lower()), None)
                if wi is None:
                    continue
                i, s = locate(wp[wi][1], f["phone"])
                if i < 0:
                    continue
                foc.append(dict(wi=wi, i=i, sym=s, phone=f["phone"], watch=[w for w in f.get("watch_for", [])]))
            variants = [("correct", None, None)]
            for k, f in enumerate(foc):
                for w in f["watch"]:
                    if w == "EPEN" and f["sym"] in CONS:
                        variants.append(("sub", k, "EPEN"))
                    elif w in SUB and SUB[w] != f["sym"]:
                        variants.append(("sub", k, w))
            for kind, k, w in variants:
                words = [list(x) for x in wp]
                marks = []   # (word index, char index, symbol written)
                for j, f in enumerate(foc):
                    ps = words[f["wi"]][1]
                    if j == k:
                        if w == "EPEN":
                            v = "o" if f["sym"] in "tdT" else "ɯ"
                            ins = f["i"] + len(f["sym"])
                            words[f["wi"]][1] = ps[:ins] + v + ps[ins:]
                            marks.append((f["wi"], ins, v, j, "EPEN"))
                            continue
                        sub = SUB[w]
                        if lc == "b" and sub == "ɑ":
                            sub = "ɒ"
                        words[f["wi"]][1] = ps[:f["i"]] + sub + ps[f["i"] + len(f["sym"]):]
                        marks.append((f["wi"], f["i"], sub, j, w))
                    else:
                        marks.append((f["wi"], f["i"], f["sym"], j, None))
                full = " ".join(p for _, p in words)
                sites, subs = [], []
                ok = True
                for (wi, ci, sym, j, w2) in marks:
                    # positions may have shifted inside the same word if an earlier mark changed its length
                    prefix = " ".join(p for _, p in words[:wi]) + (" " if wi else "") + words[wi][1][:ci]
                    if words[wi][1][ci:ci + len(sym)] != sym:
                        ok = False
                        break
                    toks = P.kokoro_to_student(full)
                    kk = len(P.kokoro_to_student(prefix))
                    exp = P.kokoro_to_student(sym)
                    if not exp or kk >= len(toks) or toks[kk] != exp[0]:
                        ok = False
                        break
                    sites.append(kk)
                    subs.append(dict(site=kk, phone=foc[j]["phone"], produced=exp[0], watch=w2,
                                     canonical=P.kokoro_to_student(foc[j]["sym"])[0]))
                if not ok or not sites:
                    continue
                canon = " ".join(p for _, p in wp)
                jobs.append(dict(text=t["text"], cid=t["id"], feature=t["feature"], lang=lc, phonemes=canon, produced=full,
                                 kind="cur_" + kind, sites=sites, site_info=subs,
                                 sub_type=(f"{foc[k]['phone']}->{w}" if kind == "sub" else "correct")))
    # voices
    out = []
    for j in jobs:
        if split == "train":
            pool = US_TRAIN if j["lang"] == "a" else UK_TRAIN
            n = (4 if j["lang"] == "a" else 1) if j["kind"] == "cur_correct" else (2 if j["lang"] == "a" else 1)
        else:
            pool = HELDOUT_US
            n = 2 if j["kind"] == "cur_correct" else 1
        for v in rng.sample(pool, min(n, len(pool))):
            out.append(dict(j, voice=v))
    return out


def main():
    split = sys.argv[1]
    device = "mps" if "--device" in sys.argv and sys.argv[sys.argv.index("--device") + 1] == "mps" else "cpu"
    shard, nshard = 0, 1
    if "--shard" in sys.argv:
        shard, nshard = map(int, sys.argv[sys.argv.index("--shard") + 1].split("/"))
    torch.set_num_threads(3)
    rng = random.Random(5 if split == "train" else 55)
    items = build(split, rng)
    print(split, len(items), "clips planned", flush=True)
    if "--plan" in sys.argv:
        return
    from kokoro import KModel
    from huggingface_hub import hf_hub_download
    model = KModel(repo_id="hexgrad/Kokoro-82M", config=str(MODEL_DIR / "config.json"),
                   model=str(MODEL_DIR / "kokoro-v1_0.pth")).to(device).eval()
    packs, t0, n = {}, time.time(), 0
    srng = random.Random(shard)
    order = list(enumerate(items))
    if "--reverse" in sys.argv:          # helper: walk the list backwards, skipping clips that already exist
        order = order[::-1]
    for j, it in order:
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
        speed = srng.uniform(0.85, 1.1)
        with torch.no_grad():
            audio = model(ps, packs[v][min(len(ps), 509) - 1].to(device), speed)
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
    print("DONE", split, shard, n)


if __name__ == "__main__":
    main()
