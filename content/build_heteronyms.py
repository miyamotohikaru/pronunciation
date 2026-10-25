#!/usr/bin/env python3
"""Write content/heteronyms.json: every place a heteronym is spoken or shown
(lines, pair metadata, phoneme examples / pairs, legend examples), with the
intended reading in dictionary IPA and misaki phonemes for the voice engineer.

  python3 content/build_heteronyms.py   (after the other build scripts)

Intended readings live in ipa.INTENDED; per-line exceptions are in EXCEPT.
`tts_risk` is "high" when the intended reading is not CMUdict's first entry
(stress included; a dictionary-based G2P may pick the other one) or the line
is a listed exception, "low" otherwise.
"""
import json
import re
from pathlib import Path

import ipa

HERE = Path(__file__).resolve().parent
# lines where a heteronym has a different meaning from ipa.INTENDED
EXCEPT = {("u02-l1-02", "read"): ("R EH1 D", "過去形「読んだ」（訳: いい本を読みました）")}


def j(s):
    return re.sub(r"([、。])(?!$|\n|[」』）)])", r"\1\n", s.strip())


def entry(fid, file, where, text, word):
    ph, sense = ipa.INTENDED[word]
    ph = ph.split()
    ph, sense = (EXCEPT[(fid, word)][0].split(), EXCEPT[(fid, word)][1]) if (fid, word) in EXCEPT else (ph, sense)
    alts = [p for p in ipa.all_prons(word) if p != ph]
    first = ipa.all_prons(word)[0]
    mk = ipa.to_misaki(ph)
    e = {"id": fid, "file": file, "where": where, "text": text, "word": word, "sense_ja": j(sense),
         "ipa": "/" + ipa.to_ipa(ph) + "/", "misaki": mk, "markup": f"[{word}](/{mk}/)",
         "tts_risk": "high" if first != ph or (fid, word) in EXCEPT else "low"}
    if alts:
        e["avoid_ipa"] = ["/" + ipa.to_ipa(a) + "/" for a in alts]
        e["avoid_misaki"] = [ipa.to_misaki(a) for a in alts]
    return e


def main():
    out = []

    def scan(fid, file, where, text):
        seen = set()
        for w in re.findall(r"[A-Za-z']+", text):
            wl = w.lower()
            if wl in ipa.INTENDED and wl not in seen:
                seen.add(wl)
                out.append(entry(fid, file, where, text, wl))

    load = lambda n: json.loads((HERE / n).read_text(encoding="utf-8"))
    cu = load("curriculum.json")
    for p in cu["placement"]:
        scan(p["id"], "curriculum.json", "text", p["text"])
    for u in cu["units"]:
        for l in u["lessons"]:
            for it in l["items"]:
                scan(it["id"], "curriculum.json", "text", it["text"])
                if it.get("pair"):
                    scan(it["id"], "curriculum.json", "pair", it["pair"])
    ch = load("challenge.json")
    for it in ch["long"] + [x for s in ch["intro"] for x in s["lines"]] + [x for d in ch["dialogues"] for x in d["turns"]]:
        scan(it["id"], "challenge.json", "text", it["text"])
    ph = load("phonemes.json")
    for e in ph["phonemes"]:
        for x in e["examples"]:
            scan(f"ph-{e['id']}", "phonemes.json", "example", x["word"])
        for k, p in enumerate(e["pairs"], 1):
            scan(f"ph-{e['id']}-pair{k}", "phonemes.json", "pair", f"{p['a']} / {p['b']}")
        for it in e["practice"]:
            scan(it["id"], "phonemes.json", "text", it["text"])
    for s in load("ipa-legend.json")["symbols"]:
        for w in s["examples"]:
            scan(f"legend {s['symbol']}", "ipa-legend.json", "example", w)
    for g in load("alphabet.json")["practice"]:
        for it in g["lines"]:
            scan(it["id"], "alphabet.json", "text", it["text"])
    data = {"version": 1,
            "note_ja": j("同じつづりで読み方が2つある単語の一覧です。"
                         "ipa と misaki が、この教材で意図した読み方です。"
                         "tts_risk が high のものは、音声がもう一方の読みになっていないか確認してください。"),
            "entries": out}
    (HERE / "heteronyms.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"heteronyms: {len(out)} entries, high risk {sum(e['tts_risk'] == 'high' for e in out)}")


if __name__ == "__main__":
    main()
