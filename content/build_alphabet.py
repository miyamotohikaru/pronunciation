#!/usr/bin/env python3
"""Assemble content/alphabet.json: the 26 letter names, common confusions,
and sentence practice (spelling names, codes, acronyms).

  python3 content/build_alphabet.py && python3 content/check_cmudict.py

Letter-name IPA comes from CMUdict's "x." entries in dictionary style
(W is written /dʌ́bljuː/ as in dictionaries). In practice lines, `spell`
lists the tokens that are letter names: the scorer must use the letter
entry ("a." = EY1), not the word ("a" = AH0). Acronyms are only used when
CMUdict reads them as their letters (FBI, BBC, VIP, PR ...); others are
written with dots so they split into letters (I.D., G.P.S.).
Saved after each section.
"""
import json
import re
from pathlib import Path

import ipa

OUT = Path(__file__).resolve().parent / "alphabet.json"
DATA = {"version": 1,
        "style_ja": "文字の名前の発音です。\n記号の読み方は ipa-legend.json と同じです。",
        "letters": [], "confusions": [], "practice": []}


def j(s):
    return re.sub(r"([、。])(?!$|\n|[」』）)])", r"\1\n", s.strip())


def save():
    OUT.write_text(json.dumps(DATA, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def F(word, phone, watch=(), tip=""):
    f = {"word": word, "phone": phone, "watch_for": list(watch)}
    if tip:
        f["tip_ja"] = j(tip)
    w = ipa.word_ipa(word, phone)
    if w:
        f["ipa"] = w
    return f


# ---------------------------------------------------------------- letters
LETTERS = {
    "A": ("エイと動く A", "日本語では「エー」と伸ばしがちです。英語は「エ」から「イ」へ動く éɪ です。最後に口を閉じていくと、E と聞き分けてもらえます。", ["a-e"]),
    "B": ("くちびるを閉じる B", "くちびる同士をしっかり閉じてから、長い「イー」を続けます。V と区別するため、上の歯はくちびるに当てません。", ["b-v", "p-b", "ee-set"]),
    "C": ("息の s で始まる C", "歯を近づけて細い息を出してから、長い「イー」へ。「シ」の音で始めると she に聞こえます。", ["c-z-s", "ee-set"]),
    "D": ("舌先を付ける D", "舌先を上の歯ぐきに付けて、声を出しながら離し、長い「イー」へ。T との違いは、声が出ているかどうかです。", ["t-d", "ee-set"]),
    "E": ("長い iː だけの E", "口を横に強く引いた、長い「イー」だけの音です。I や A と混ざらないよう、口の形を最後まで変えません。", ["e-i", "a-e", "ee-set"]),
    "F": ("最後に歯を当てる F", "「エ」のあと、上の歯を下くちびるに乗せて息を出します。最後に母音を足さないこと。S と聞き間違えられやすいので、歯を当てるのをはっきりさせます。", ["f-s"]),
    "G": ("dʒ で始まる G", "舌先をいったん付けてから声を出し、長い「イー」へ。Z や J と混ざりやすい文字です。", ["g-z-j", "ee-set"]),
    "H": ("エイと tʃ の H", "「エ」から「イ」へ動いたあと、くちびるを突き出して tʃ で終わります。最後に母音を足さないこと。", []),
    "I": ("アイと動く I", "口を大きく開けた「ア」から「イ」へ、ひとつながりに動かします。E と取り違えられないよう、最初の「ア」をはっきり。", ["e-i"]),
    "J": ("dʒ とエイの J", "舌先をいったん付けてから声を出し、「エイ」へ動かします。G との違いは、後ろが「エイ」か「イー」かです。", ["g-z-j"]),
    "K": ("息の k とエイの K", "舌の奥で息を強く出してから、「エイ」へ動かします。「エー」と伸ばしません。", []),
    "L": ("舌先を付けて止める L", "「エ」のあと、舌先を前歯の付け根に付けたまま止めます。最後に母音を足すと、R と聞き分けにくくなります。", ["l-r"]),
    "M": ("くちびるを閉じて終わる M", "「エ」のあと、くちびるを閉じて鼻に響かせて終わります。N と区別するため、最後は必ずくちびるを閉じます。", ["m-n"]),
    "N": ("舌先を付けて終わる N", "「エ」のあと、舌先を歯ぐきに付けて鼻に響かせて終わります。口は開けたまま、くちびるは閉じません。", ["m-n"]),
    "O": ("オウと動く O", "「オー」と伸ばさず、最後にくちびるをすぼめて「オウ」と動かします。", []),
    "P": ("息を破裂させる P", "くちびるを閉じて息をため、強く破裂させてから長い「イー」へ。B と聞き間違えられないよう、息をしっかり出します。", ["p-b", "ee-set"]),
    "Q": ("k と j の Q", "舌の奥で k を出してから、舌を上あごに近づけた j を入れて、くちびるを突き出した長い「ウー」へ。", []),
    "R": ("大きく開けて舌を引く R", "口を縦に大きく開けた「アー」から、舌をどこにも付けずに奥へ引いて終わります。最後に l を付けないこと。", ["l-r"]),
    "S": ("エと細い息の S", "「エ」のあと、歯を近づけて細い息で終わります。最後に母音を足さないこと。F と聞き間違えられやすい文字です。", ["c-z-s", "f-s"]),
    "T": ("舌先ではじく T", "舌先を歯ぐきの一点に当てて、息を強く出してから長い「イー」へ。「チ」にならないようにします。", ["t-d", "ee-set"]),
    "U": ("j と長い uː の U", "舌を上あごに近づけてから、くちびるを突き出した長い「ウー」へ。最初の j を省くと、別の音に聞こえます。", []),
    "V": ("歯を下くちびるに当てる V", "上の歯を下くちびるに乗せて声を出してから、長い「イー」へ。B と間違えられるいちばんの原因は、くちびる同士を閉じてしまうことです。", ["b-v", "ee-set"]),
    "W": ("3つの音節の W", "dʌ́b、l、juː の3つに分けて、最初を強く言います。ʌ は短く軽く、残りは弱く流します。", []),
    "X": ("エと ks の X", "「エ」のあと、k と s を母音なしで続けて終わります。最後に母音を足さないこと。", []),
    "Y": ("w とアイの Y", "くちびるをすぼめた w から、「アイ」へ動かします。最初の w を省かないこと。", []),
    "Z": ("声の z で始まる Z", "s と同じ口で、舌先を付けずに声を響かせてから、長い「イー」へ。米国では zíː、英国では zéd と言います。", ["g-z-j", "c-z-s", "ee-set"]),
}
for ch, (name, how, conf) in LETTERS.items():
    x = {"letter": ch, "ipa": "/" + ipa.to_ipa(ipa.prons(ch.lower() + ".")[0]) + "/"}
    if ch == "W":
        x["ipa"] = "/dʌ́bljuː/"
        x["ipa_note_ja"] = j("辞書では /dʌ́bljuː/ と書きます。弱い ə を入れて、3つの音節で言う人も多くいます。")
    x.update({"name_ja": j(name), "how_ja": j(how), "confusions": conf})
    DATA["letters"].append(x)
save()

# ---------------------------------------------------------------- confusions
CONF = [
    ("b-v", ["B", "V"], "B はくちびる同士を閉じて、V は上の歯を下くちびるに当てて言います。"),
    ("l-r", ["L", "R"], "L は「エ」のあと舌先を付けて止め、R は口を大きく開けてから舌を奥へ引きます。"),
    ("m-n", ["M", "N"], "M はくちびるを閉じて終わり、N は口を開けたまま舌先を付けて終わります。"),
    ("g-z-j", ["G", "Z", "J"], "G は舌を付けて「イー」、Z は舌を付けずに「イー」、J は舌を付けて「エイ」です。"),
    ("e-i", ["E", "I"], "E は口を横に引いた長い「イー」、I は大きく開けた「ア」から「イ」へ動く音です。"),
    ("a-e", ["A", "E"], "A は「エイ」と動かし、E は「イー」とのばします。A を「エー」と言わないこと。"),
    ("c-z-s", ["C", "Z", "S"], "C は息の s から「イー」、Z は声の z から「イー」、S は「エ」のあと息の s で終わります。"),
    ("p-b", ["P", "B"], "P は息を強く破裂させ、B は声を出してくちびるを開きます。"),
    ("t-d", ["T", "D"], "T は息を強く出し、D は声を出します。どちらも舌先は歯ぐきの一点に当てます。"),
    ("f-s", ["F", "S"], "F は最後に上の歯を下くちびるに当て、S は最後に細い息を出します。"),
    ("ee-set", ["B", "C", "D", "E", "G", "P", "T", "V", "Z"], "長い「イー」で終わる文字は、最初の子音だけで聞き分けます。最初の子音をはっきり言います。"),
]
DATA["confusions"] = [{"id": i, "letters": ls, "tip_ja": j(t)} for i, ls, t in CONF]
save()

# ---------------------------------------------------------------- practice
TB = "B はくちびる同士を閉じてから。"
TV = "V は上の歯を下くちびるに当てて。"
TL = "L は「エ」のあと、舌先を付けて止めます。"
TR = "R は大きく開けてから、舌を奥へ引きます。"
TM = "M は最後にくちびるを閉じます。"
TN = "N は口を開けたまま、舌先を付けて終わります。"
TG = "G は舌先をいったん付けてから「イー」。"
TZ = "Z は舌先を付けずに、声を響かせてから「イー」。"
TJ = "J は舌先を付けてから「エイ」。"
TA = "A は「エイ」と動かします。"
TE = "E は口を横に引いた「イー」。"
TI = "I は大きく開けた「ア」から「イ」へ。"
TC = "C は細い息の s から「イー」。"
TS = "S は「エ」のあと、細い息で終わります。"
TF = "F は最後に上の歯を下くちびるに当てます。"
TP = "P は息を強く破裂させます。"
TT = "T は舌先の一点から、息を強く。"
TD = "D は声を出して離します。"


def group(gid, title, conf, lines):
    DATA["practice"].append({
        "id": gid, "title_ja": j(title), "confusion": conf,
        "lines": [{"id": f"{gid}-{k:02d}", "text": t, "ja": j(ja), **({"spell": sp} if sp else {}),
                   "focus": fo, "difficulty": d} for k, (t, ja, sp, fo, d) in enumerate(lines, 1)]})
    save()


group("abc-b-v", "B と V", "b-v", [
    ("My code starts with a V.", "私の番号は V から始まります。", ["V"], [F("v", "V", ["B"], TV)], 1),
    ("We sat in row B.", "私たちは B 列に座りました。", ["B"], [F("b", "B", ["V"], TB)], 1),
    ("Is that B as in boy, or V as in very?", "それは boy の B ですか、それとも very の V ですか？", ["B", "V"],
     [F("b", "B", ["V"], TB), F("v", "V", ["B"], TV)], 2),
    ("She works for the BBC.", "彼女は BBC で働いています。", None, [F("bbc", "B", ["V"], TB)], 2),
])
group("abc-l-r", "L と R", "l-r", [
    ("Is that L as in lemon, or R as in rice?", "それは lemon の L ですか、それとも rice の R ですか？", ["L", "R"],
     [F("l", "L", ["R"], TL), F("r", "R", ["L"], TR)], 2),
    ("Is it spelled with an R or an L?", "つづりは R ですか、L ですか？", ["R", "L"], [F("r", "R", ["L"], TR), F("l", "L", ["R"], TL)], 2),
    ("She works in PR.", "彼女は広報の仕事をしています。", None, [F("pr", "R", ["L"], TR)], 2),
    ("My last name has an R and two L's.", "私の名字には R が1つと L が2つあります。", ["R", "L"],
     [F("r", "R", ["L"], TR), F("l's", "L", ["R"], TL)], 3),
])
group("abc-m-n", "M と N", "m-n", [
    ("Is that M as in money, or N as in name?", "それは money の M ですか、それとも name の N ですか？", ["M", "N"],
     [F("m", "M", ["N"], TM), F("n", "N", ["M"], TN)], 2),
    ("My initials are M and N.", "私の頭文字は M と N です。", ["M", "N"], [F("m", "M", ["N"], TM), F("n", "N", ["M"], TN)], 2),
    ("Is there an ATM near here?", "この近くに ATM はありますか？", None, [F("atm", "M", ["N"], TM)], 2),
])
group("abc-a-e-i", "A・E・I", "a-e", [
    ("Is that A as in apple, or E as in egg?", "それは apple の A ですか、それとも egg の E ですか？", ["A", "E"],
     [F("a", "EY", ["EH", "IY"], TA), F("e", "IY", ["EY"], TE)], 2),
    ("Is it E as in easy, or I as in ice?", "それは easy の E ですか、それとも ice の I ですか？", ["E", "I"],
     [F("e", "IY", ["AY"], TE), F("i", "AY", ["IY"], TI)], 2),
    ("I got an A on the test.", "試験で A を取りました。", ["A"], [F("a", "EY", ["EH"], TA)], 2),
    ("Please show me your I.D.", "身分証を見せてください。", ["I", "D"], [F("i", "AY", ["IY"], TI), F("d", "D", ["T"], TD)], 2),
])
group("abc-g-z-j", "G・Z・J", "g-z-j", [
    ("He works as a DJ.", "彼は DJ として働いています。", None, [F("dj", "JH", ["Z"], TJ)], 2),
    ("Is that G as in good, or Z as in zoo?", "それは good の G ですか、それとも zoo の Z ですか？", ["G", "Z"],
     [F("g", "JH", ["Z"], TG), F("z", "Z", ["JH"], TZ)], 3),
    ("Our gate is J, not G.", "私たちの搭乗口は G ではなく J です。", ["J", "G"], [F("j", "EY", ["IY"], TJ), F("g", "IY", ["EY"], TG)], 3),
    ("Turn on the G.P.S., please.", "GPS をつけてください。", ["G", "P", "S"], [F("g", "JH", ["G"], TG), F("p", "P", ["B"], TP)], 3),
])
group("abc-c-s-f", "C・S・Z・F", "c-z-s", [
    ("Is that C as in city, or Z as in zero?", "それは city の C ですか、それとも zero の Z ですか？", ["C", "Z"],
     [F("c", "S", ["SH", "Z"], TC), F("z", "Z", ["S", "JH"], TZ)], 3),
    ("Is it S as in sun, or F as in fun?", "それは sun の S ですか、それとも fun の F ですか？", ["S", "F"],
     [F("s", "S", ["F"], TS), F("f", "F", ["S"], TF)], 3),
    ("The CEO will speak at six.", "CEO が6時に話します。", None, [F("ceo", "S", ["SH"], TC)], 3),
])
group("abc-p-b-t-d", "P・B・T・D", "p-b", [
    ("Is that P as in park, or B as in boy?", "それは park の P ですか、それとも boy の B ですか？", ["P", "B"],
     [F("p", "P", ["B"], TP), F("b", "B", ["P"], TB)], 3),
    ("Is it T as in time, or D as in day?", "それは time の T ですか、それとも day の D ですか？", ["T", "D"],
     [F("t", "T", ["D"], TT), F("d", "D", ["T"], TD)], 3),
    ("Can you send it as a PDF?", "PDF で送ってもらえますか？", None, [F("pdf", "P", ["B"], TP), F("pdf", "D", ["T"], TD)], 3),
    ("I watched it on DVD.", "それは DVD で見ました。", None, [F("dvd", "V", ["B"], TV), F("dvd", "D", ["T"], TD)], 3),
])
group("abc-spell", "つづりと番号を伝える", "ee-set", [
    ("My name is Ken. K, E, N.", "名前は Ken です。K、E、N。", ["K", "E", "N"],
     [F("k", "EY", ["EH"], "K は「エイ」と動かします。"), F("e", "IY", ["EY"], TE), F("n", "N", ["M"], TN)], 3),
    ("My last name is Sato. S, A, T, O.", "名字は Sato です。S、A、T、O。", ["S", "A", "T", "O"],
     [F("s", "S", ["F"], TS), F("a", "EY", ["EH"], TA), F("t", "T", ["CH", "D"], TT), F("o", "OW", ["AO"], "O は「オウ」と動かします。")], 4),
    ("My booking code is B, V, seven, two.", "予約番号は B、V、7、2 です。", ["B", "V"],
     [F("b", "B", ["V"], TB), F("v", "V", ["B"], TV), F("seven", "V", ["B"], "seven の v も歯を下くちびるに。")], 4),
    ("That's K, E, N, at mail dot com.", "K、E、N、@mail.com です。", ["K", "E", "N"],
     [F("k", "EY", ["EH"], "K は「エイ」と動かします。"), F("mail", "L", ["EPEN"], "mail の最後は、舌先を付けて止めます。"),
      F("dot", "AA", ["AO", "OW"], "dot は口を縦に大きく開けて。")], 5),
    ("That's V as in very, R as in rice, and L as in lemon.", "very の V、rice の R、lemon の L です。", ["V", "R", "L"],
     [F("v", "V", ["B"], TV), F("r", "R", ["L"], TR), F("l", "L", ["R"], TL)], 5),
    ("I'll send the PDF to the CEO ASAP.", "その PDF を、できるだけ早く CEO に送ります。", None,
     [F("pdf", "P", ["B"], TP), F("ceo", "S", ["SH"], TC), F("asap", "EY", ["EH"], TA)], 5),
])
