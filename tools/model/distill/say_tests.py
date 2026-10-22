"""Targeted faithfulness tests (EVAL ONLY: macOS `say` audio must never be used for training).

    python say_tests.py make     # writes .work/distill/eval/say/<voice>/<id>.wav + items.json

Three kinds of items:
  native_ok   English voice says the intended word          -> model should output the canonical phone
  native_err  English voice says the error word (e.g. 'lice' for 'rice', 'sank you' for 'thank you')
              -> model should output the PRODUCED phone, not the intended one ("auto-correct" = fail)
  ja_kana     Japanese voice reads the katakana loanword (ライス, ストリート ...)
              -> model should NOT output the English target phone (ɹ, θ, v ...) and should show the
                 inserted vowels (epenthesis)
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import WORK  # noqa: E402

OUT = WORK / "eval" / "say"

EN_VOICES = ["Samantha", "Daniel", "Karen", "Moira", "Tessa", "Rishi",
             "Eddy (英語（アメリカ）)", "Flo (英語（イギリス）)", "Reed (英語（アメリカ）)", "Sandy (英語（イギリス）)",
             "Shelley (英語（アメリカ）)", "Rocko (英語（イギリス）)"]
JA_VOICES = ["Kyoko", "Eddy (日本語（日本）)", "Flo (日本語（日本）)", "Reed (日本語（日本）)", "Sandy (日本語（日本）)",
             "Shelley (日本語（日本）)", "Rocko (日本語（日本）)", "Grandma (日本語（日本）)", "Grandpa (日本語（日本）)"]

# (category, intended text, error text, intended IPA, produced IPA, critical: list of (index in produced, accepted set, intended phone))
# IPA in the comparison alphabet (r-coloured tokens expanded, see evaluate.expand).
PAIRS = [
    ("r_l", "rice", "lice", "ɹ aɪ s", "l aɪ s"),
    ("r_l", "right", "light", "ɹ aɪ t", "l aɪ t"),
    ("r_l", "road", "load", "ɹ oʊ d", "l oʊ d"),
    ("r_l", "grass", "glass", "ɡ ɹ æ s", "ɡ l æ s"),
    ("r_l", "fry", "fly", "f ɹ aɪ", "f l aɪ"),
    ("r_l", "correct", "collect", "k ə ɹ ɛ k t", "k ə l ɛ k t"),
    ("r_l", "I really like rice", "I lealy like lice", "aɪ ɹ ɪ l i l aɪ k ɹ aɪ s", "aɪ l ɪ l i l aɪ k l aɪ s"),
    ("r_l", "I read the book", "I lead the book", "aɪ ɹ ɛ d ð ə b ʊ k", "aɪ l ɛ d ð ə b ʊ k"),
    ("th_s", "think", "sink", "θ ɪ ŋ k", "s ɪ ŋ k"),
    ("th_s", "thing", "sing", "θ ɪ ŋ", "s ɪ ŋ"),
    ("th_s", "mouth", "mouse", "m aʊ θ", "m aʊ s"),
    ("th_s", "path", "pass", "p æ θ", "p æ s"),
    ("th_s", "I think so", "I sink so", "aɪ θ ɪ ŋ k s oʊ", "aɪ s ɪ ŋ k s oʊ"),
    ("th_s", "thank you", "sank you", "θ æ ŋ k j uː", "s æ ŋ k j uː"),
    ("dh_z", "this is it", "zis is it", "ð ɪ s ɪ z ɪ t", "z ɪ s ɪ z ɪ t"),
    ("dh_z", "they", "day", "ð eɪ", "d eɪ"),
    ("dh_z", "then", "den", "ð ɛ n", "d ɛ n"),
    ("v_b", "very", "berry", "v ɛ ɹ i", "b ɛ ɹ i"),
    ("v_b", "vest", "best", "v ɛ s t", "b ɛ s t"),
    ("v_b", "vote", "boat", "v oʊ t", "b oʊ t"),
    ("v_b", "van", "ban", "v æ n", "b æ n"),
    ("v_b", "very good", "berry good", "v ɛ ɹ i ɡ ʊ d", "b ɛ ɹ i ɡ ʊ d"),
    ("v_b", "thank you very much", "thank you bery much", "θ æ ŋ k j uː v ɛ ɹ i m ʌ tʃ", "θ æ ŋ k j uː b ɛ ɹ i m ʌ tʃ"),
    ("s_sh", "sea", "she", "s iː", "ʃ iː"),
    ("s_sh", "seat", "sheet", "s iː t", "ʃ iː t"),
    ("s_sh", "sip", "ship", "s ɪ p", "ʃ ɪ p"),
    ("s_sh", "save", "shave", "s eɪ v", "ʃ eɪ v"),
    ("ae_uh", "hat", "hut", "h æ t", "h ʌ t"),
    ("ae_uh", "cat", "cut", "k æ t", "k ʌ t"),
    ("ae_uh", "bag", "bug", "b æ ɡ", "b ʌ ɡ"),
    ("ae_uh", "cap", "cup", "k æ p", "k ʌ p"),
    ("i_ih", "sheep", "ship", "ʃ iː p", "ʃ ɪ p"),
    ("i_ih", "leave", "live", "l iː v", "l ɪ v"),
    ("i_ih", "feel", "fill", "f iː l", "f ɪ l"),
    ("epen", "street", "sutoreeto", "s t ɹ iː t", "s u t oʊ ɹ iː t oʊ"),
    ("epen", "desk", "desuku", "d ɛ s k", "d ɛ s u k u"),
    ("epen", "milk", "miruku", "m ɪ l k", "m i ɹ u k u"),
    ("epen", "drink", "dorinku", "d ɹ ɪ ŋ k", "d oʊ ɹ i ŋ k u"),
    ("epen", "test", "tesuto", "t ɛ s t", "t ɛ s u t oʊ"),
]

# katakana readings for Japanese voices: (category, intended English, kana, produced (approx. Japanese), check)
# check: ("not", index_in_intended, set_of_wrong) -> fail if the phone aligned to that intended position is in the set
#        ("vowels_gt", n) -> pass if the hypothesis has more than n vowels (epenthesis visible)
KANA = [
    ("r_l", "rice", "ライス", "ɾ a i s ɯ", [("not", 0, {"ɹ"}), ("vowels_gt", 1)]),
    ("r_l", "right", "ライト", "ɾ a i t o", [("not", 0, {"ɹ"}), ("vowels_gt", 1)]),
    ("r_l", "road", "ロード", "ɾ oː d o", [("not", 0, {"ɹ"}), ("vowels_gt", 1)]),
    ("r_l", "grass", "グラス", "ɡ ɯ ɾ a s ɯ", [("not", 1, {"ɹ"}), ("vowels_gt", 1)]),
    ("r_l", "fry", "フライ", "ɸ ɯ ɾ a i", [("not", 1, {"ɹ"}), ("vowels_gt", 1)]),
    ("r_l", "I like rice", "アイ ライク ライス", "a i ɾ a i k ɯ ɾ a i s ɯ", [("not", 4, {"ɹ"})]),
    ("th_s", "think", "シンク", "ɕ i ŋ k ɯ", [("not", 0, {"θ"}), ("vowels_gt", 1)]),
    ("th_s", "thank you", "サンキュー", "s a ŋ k j ɯː", [("not", 0, {"θ"})]),
    ("th_s", "I think so", "アイ シンク ソー", "a i ɕ i ŋ k ɯ s oː", [("not", 1, {"θ"})]),
    ("v_b", "very", "ベリー", "b e ɾ iː", [("not", 0, {"v"}), ("not", 2, {"ɹ"})]),
    ("v_b", "vest", "ベスト", "b e s ɯ t o", [("not", 0, {"v"}), ("vowels_gt", 1)]),
    ("v_b", "vote", "ボート", "b oː t o", [("not", 0, {"v"}), ("vowels_gt", 1)]),
    ("v_b", "thank you very much", "サンキュー ベリー マッチ", "s a ŋ k j ɯː b e ɾ iː m a tɕ i",
     [("not", 0, {"θ"}), ("not", 6, {"v"})]),
    ("s_sh", "sea", "シー", "ɕ iː", [("not", 0, {"s"})]),
    ("s_sh", "seat", "シート", "ɕ iː t o", [("not", 0, {"s"}), ("vowels_gt", 1)]),
    ("ae_uh", "hat", "ハット", "h a t t o", [("not", 1, {"æ"}), ("vowels_gt", 1)]),
    ("ae_uh", "cat", "キャット", "k j a t t o", [("not", 1, {"æ"}), ("vowels_gt", 1)]),
    ("epen", "street", "ストリート", "s ɯ t o ɾ iː t o", [("vowels_gt", 1), ("not", 2, {"ɹ"})]),
    ("epen", "desk", "デスク", "d e s ɯ k ɯ", [("vowels_gt", 1)]),
    ("epen", "milk", "ミルク", "m i ɾ ɯ k ɯ", [("vowels_gt", 1)]),
    ("epen", "drink", "ドリンク", "d o ɾ i ŋ k ɯ", [("vowels_gt", 1)]),
    ("epen", "test", "テスト", "t e s ɯ t o", [("vowels_gt", 1)]),
    ("epen", "big", "ビッグ", "b i ɡ ɡ ɯ", [("vowels_gt", 1)]),
    ("epen", "bed", "ベッド", "b e d d o", [("vowels_gt", 1)]),
]


def vslug(v):
    return v.split(" ")[0] + ("_" + ("us" if "アメリカ" in v else "gb" if "イギリス" in v else "ja" if "日本" in v else ""))


def synth(voice, text, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return True
    for attempt in range(3):
        try:
            r = subprocess.run(["say", "-v", voice, "--file-format=WAVE", "--data-format=LEI16@16000", "-o", str(path), text],
                               capture_output=True, text=True, timeout=20)
            if r.returncode == 0 and path.exists() and path.stat().st_size > 1000:
                return True
        except subprocess.TimeoutExpired:
            pass
        if path.exists():
            path.unlink()
    print("FAILED", voice, text, flush=True)
    return False


def make():
    items = []
    for v in EN_VOICES:
        for k, (cat, good, bad, ipa_good, ipa_bad) in enumerate(PAIRS):
            for kind, text, produced, contrast in [("native_ok", good, ipa_good, ipa_bad), ("native_err", bad, ipa_bad, ipa_good)]:
                p = OUT / vslug(v) / f"{kind}_{k:02d}_{text.replace(' ', '_')}.wav"
                if synth(v, text, p):
                    items.append(dict(kind=kind, cat=cat, voice=vslug(v), text=text, intended=ipa_good,
                                      produced=produced, contrast=contrast, path=str(p.relative_to(WORK))))
    for v in JA_VOICES:
        for k, (cat, eng, kana, produced, checks) in enumerate(KANA):
            p = OUT / vslug(v) / f"ja_kana_{k:02d}_{eng.replace(' ', '_')}.wav"
            ipa_good = next((pg for c, g, b, pg, pb in PAIRS if g == eng), None)
            if synth(v, kana, p):
                items.append(dict(kind="ja_kana", cat=cat, voice=vslug(v), text=kana, english=eng, intended=ipa_good,
                                  produced=produced, checks=[[c[0], c[1], sorted(c[2])] if c[0] == "not" else list(c) for c in checks],
                                  path=str(p.relative_to(WORK))))
    (OUT / "items.json").write_text(json.dumps(items, ensure_ascii=False, indent=0))
    print(len(items), "items")


if __name__ == "__main__":
    if sys.argv[1] == "make":
        make()
