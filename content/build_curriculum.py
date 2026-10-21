#!/usr/bin/env python3
"""Assemble content/curriculum.json from the unit dicts below.

  python3 content/build_curriculum.py && python3 content/check_cmudict.py

Each unit() call appends the unit and rewrites the JSON, so the file is
always saved up to the last finished unit. IDs are positional
(u03-l2-04 = unit 3, lesson 2, item 4): add new items at the END of a
lesson so learner progress keeps pointing at the same items.

Japanese strings are written without line breaks; j() inserts "\n" after
every 、 and 。 that is not at the end (the owner's rule: no automatic
wrapping, break at 読点/句点). Use 、 only where a line break reads well.
"""
import json
import re
from pathlib import Path

OUT = Path(__file__).resolve().parent / "curriculum.json"
PLACEMENT, UNITS = [], []


def j(s):
    s = s.strip()
    return re.sub(r"([、。])(?!$|\n|[」』）)])", r"\1\n", s)


def F(word, phone, watch=(), tip=""):
    f = {"word": word, "phone": phone, "watch_for": list(watch)}
    if tip:
        f["tip_ja"] = j(tip)
    return f


def _item(kind, text, ja, focus, d, tts=None, pair=None):
    it = {"type": kind, "text": text, "ja": j(ja)}
    if pair:
        it["pair"] = pair
    if tts:
        it["tts_text"] = tts
    it["focus"] = focus
    it["difficulty"] = d
    return it


def W(text, ja, focus, d=1, tts=None):
    return _item("word", text, ja, focus, d, tts)


def PR(text, pair, ja, focus, d=1):
    return _item("pair", text, ja, focus, d, pair=pair)


def PH(text, ja, focus, d=2, tts=None):
    return _item("phrase", text, ja, focus, d, tts)


def S(text, ja, focus, d=2, tts=None):
    return _item("sentence", text, ja, focus, d, tts)


def L(title, goal, items, feature=None):
    return {"title_ja": j(title), "goal_ja": j(goal), "feature": feature, "items": items}


def save():
    data = {"version": 1, "placement": PLACEMENT, "units": UNITS}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def unit(title, subtitle, feature, why, how, lessons):
    uid = f"u{len(UNITS) + 1:02d}"
    out = []
    for li, l in enumerate(lessons, 1):
        lid = f"{uid}-l{li}"
        items = []
        for ii, it in enumerate(l["items"], 1):
            items.append({"id": f"{lid}-{ii:02d}", **it})
        out.append({"id": lid, "title_ja": l["title_ja"], "goal_ja": l["goal_ja"],
                    "feature": l["feature"] or feature, "items": items})
    UNITS.append({"id": uid, "title_ja": j(title), "subtitle_ja": j(subtitle), "feature": feature,
                  "why_ja": j(why), "how_ja": j(how), "lessons": out})
    save()


def T(word, phone, watch, tag):
    """Placement focus: which phone in which word feeds which tag."""
    return {"word": word, "phone": phone, "watch_for": list(watch), "tag": tag}


# ---------------------------------------------------------------- placement
# About 2 minutes: 8 sentences, listen once, say once, no retries.
PLACEMENT += [
    {"id": "p1", "text": "Turn right at the light.", "ja": j("信号を右に曲がってください。"),
     "diagnoses": ["r-l", "er", "th", "linking-flap-reduction", "rhythm-stress"],
     "focus": [T("turn", "ER", ["AA", "AH"], "er"), T("right", "R", ["L"], "r-l"),
               T("light", "L", ["R"], "r-l"), T("right", "T", ["EPEN"], "linking-flap-reduction"),
               T("the", "DH", ["Z", "D"], "th")]},
    {"id": "p2", "text": "I think this is very good.", "ja": j("これ、すごくいいと思う。"),
     "diagnoses": ["th", "v-b", "epenthesis", "linking-flap-reduction"],
     "focus": [T("think", "TH", ["S"], "th"), T("this", "DH", ["Z", "D"], "th"),
               T("very", "V", ["B"], "v-b"), T("good", "D", ["EPEN"], "epenthesis"),
               T("think", "K", ["EPEN"], "epenthesis"), T("this", "S", ["EPEN"], "linking-flap-reduction")]},
    {"id": "p3", "text": "Please speak slowly.", "ja": j("ゆっくり話してください。"),
     "diagnoses": ["epenthesis", "final-consonants", "vowels-tense-lax"],
     "focus": [T("please", "P", ["EPEN"], "epenthesis"), T("speak", "S", ["EPEN"], "epenthesis"),
               T("slowly", "S", ["EPEN"], "epenthesis"), T("please", "Z", ["EPEN", "S"], "final-consonants"),
               T("speak", "K", ["EPEN"], "final-consonants"), T("speak", "IY", ["IH"], "vowels-tense-lax"),
               T("slowly", "OW", ["AO"], "vowels-tense-lax")]},
    {"id": "p4", "text": "Can I have a cup of hot coffee?", "ja": j("温かいコーヒーを1杯もらえますか？"),
     "diagnoses": ["vowels-ae-ah-aa", "v-b", "f-h", "rhythm-stress", "intonation"],
     "focus": [T("have", "AE", ["AA", "AH"], "vowels-ae-ah-aa"), T("cup", "AH", ["AA", "AE"], "vowels-ae-ah-aa"),
               T("hot", "AA", ["AO", "OW"], "vowels-ae-ah-aa"), T("have", "V", ["B", "EPEN"], "v-b"),
               T("coffee", "F", ["HH"], "f-h"), T("can", "AH", ["AE"], "rhythm-stress"),
               T("of", "AH", ["AO", "OW"], "rhythm-stress")]},
    {"id": "p5", "text": "I'll see you at six.", "ja": j("6時に会おう。"),
     "diagnoses": ["s-sh", "final-consonants", "linking-flap-reduction"],
     "focus": [T("see", "S", ["SH"], "s-sh"), T("six", "S", ["SH"], "s-sh"),
               T("six", "K", ["EPEN"], "final-consonants"), T("at", "T", ["EPEN"], "linking-flap-reduction")]},
    {"id": "p6", "text": "Her work starts early.", "ja": j("彼女の仕事は朝早く始まる。"),
     "diagnoses": ["er", "final-consonants", "epenthesis"],
     "focus": [T("her", "ER", ["AA", "AH"], "er"), T("work", "ER", ["AA", "AO"], "er"),
               T("early", "ER", ["AA", "AH"], "er"), T("work", "K", ["EPEN"], "final-consonants"),
               T("starts", "S", ["EPEN"], "epenthesis")]},
    {"id": "p7", "text": "Who would like some food?", "ja": j("食べ物がほしい人はいますか？"),
     "diagnoses": ["f-h", "vowels-tense-lax", "r-l"],
     "focus": [T("who", "HH", ["F"], "f-h"), T("food", "F", ["HH"], "f-h"), T("would", "W", [], "f-h"),
               T("would", "UH", ["UW"], "vowels-tense-lax"), T("food", "UW", ["UH"], "vowels-tense-lax"),
               T("like", "L", ["R"], "r-l")]},
    {"id": "p8", "text": "What are you going to do?", "tts_text": "What are you gonna do?",
     "ja": j("これからどうするの？"),
     "diagnoses": ["linking-flap-reduction", "intonation", "rhythm-stress"],
     "focus": [T("what", "T", ["EPEN"], "linking-flap-reduction"),
               T("gonna", "AH", ["UW", "OW"], "linking-flap-reduction"),
               T("do", "UW", [], "intonation")]},
]
save()

# ---------------------------------------------------------------- unit 1
unit(
    "英語のリズム", "強い音と弱い音の差をつける", "rhythm-stress",
    "日本語は、どの音もほぼ同じ長さで言います。"
    "英語は、強い音節（音のかたまり）を高く長く言い、弱い音節を短くあいまいに言います。"
    "この差がつくだけで、英語らしさが大きく変わります。",
    "お手本で強く聞こえるところだけ、声を高く、長く、はっきり出します。"
    "それ以外は力を抜いて、短く流します。"
    "手をたたきながら言うのもおすすめです。",
    [
        L("強いところはひとつ", "カタカナ語とは違う場所を、強く言えるようになる。", [
            W("hotel", "ホテル", [F("hotel", "EH", [], "後ろの tel を高く長く言います。ho は短く軽く。")], 1),
            W("idea", "考え・アイデア", [F("idea", "IY", [], "まん中の de を高く長く言います。最後の a は弱く短く。")], 1),
            W("guitar", "ギター", [F("guitar", "AA", [], "後ろの tar を強く言います。gui は短く軽く。")], 1),
            W("machine", "機械", [F("machine", "IY", [], "後ろの chine を高く長く言います。ma は弱く短く。")], 1),
            W("banana", "バナナ", [F("banana", "AE", [], "まん中の na だけを強く言います。"),
                                   F("banana", "AH", ["AA"], "最初と最後の a は、口の力を抜いた弱い「ア」です。")], 2),
            W("camera", "カメラ", [F("camera", "AE", [], "最初の ca を強く言います。残りは短く弱く。")], 2),
            W("image", "イメージ", [F("image", "IH", [], "最初の i を強く言います。後ろは伸ばさず短く。")], 2),
            W("chocolate", "チョコレート", [F("chocolate", "AO", [], "強いのは最初の cho だけです。choc と late の2つのかたまりで言います。")], 3),
        ]),
        L("弱い母音", "強くないところの母音を、短く弱くする。", [
            W("about", "〜について", [F("about", "AH", ["AA"], "最初の a は力を抜いた短い「ア」です。強いのは bout です。")], 1),
            W("again", "もう一度", [F("again", "AH", ["AA"], "最初の a は弱く短く。gain を強く言います。")], 1),
            W("today", "今日", [F("today", "AH", ["UW", "OW"], "to は伸ばさず、弱く短く。day を強く言います。")], 1),
            W("lemon", "レモン", [F("lemon", "AH", ["AO", "OW"], "強いのは le です。mon は「モン」ではなく、弱く短く。")], 2),
            W("salad", "サラダ", [F("salad", "AH", ["AA"], "強いのは最初の sa です。lad は弱く短く。")], 2),
            W("problem", "問題", [F("problem", "AH", ["EH"], "強いのは最初の pro です。blem は弱く短く。")], 2),
            W("station", "駅", [F("station", "AH", ["OW"], "強いのは sta です。tion は「ション」より弱く短く。")], 2),
            W("breakfast", "朝ごはん", [F("breakfast", "AH", ["AA"], "強いのは最初の break だけです。fast は弱く短く。")], 3),
        ]),
        L("強い単語と弱い単語", "大事な単語を強く、a や of などを弱く言う。", [
            PH("go to bed", "寝る", [F("to", "AH", ["UW"], "go と bed を強く言います。to は「タ」くらいに弱く短く。")], 1),
            PH("time to go", "そろそろ行く時間", [F("to", "AH", ["UW"], "time と go を強く、to は弱く短く。")], 1),
            PH("a cup of coffee", "コーヒー1杯", [F("of", "AH", ["AO", "OW"], "cup と co を強く言います。a と of は弱く短く。")], 2),
            PH("a piece of cake", "かんたんなこと", [F("of", "AH", ["AO", "OW"], "piece と cake を強く、a と of は小さく短く。")], 2),
            PH("in the morning", "朝に", [F("morning", "AO", [], "強いのは mor です。in と the は軽く流します。")], 2),
            PH("for a minute", "少しの間", [F("for", "ER", ["AO"], "for は伸ばさず、弱く短く。強いのは mi です。")], 2),
        ]),
        L("短い文でリズム", "文の中で、強い音と弱い音の差をつける。", [
            S("Nice to meet you.", "はじめまして。", [F("to", "AH", ["UW"], "Nice と meet を強く、to と you は軽く。")], 1),
            S("See you tomorrow.", "また明日。", [F("tomorrow", "AA", [], "強いのは mor です。to は弱く短く。")], 1),
            S("What time is it now?", "今何時？", [F("time", "AY", [], "time と now を強く言います。is it は軽くつなげます。")], 2),
            S("It's a beautiful day.", "いい天気ですね。", [F("beautiful", "UW", [], "beau と day を強く言います。ti と ful は弱く短く。")], 2),
            S("Can I have the check?", "お会計をお願いします。", [F("can", "AH", ["AE"], "強いのは check です。Can は弱く短く言います。")], 2),
            S("I'd like a cup of tea.", "紅茶をください。", [F("of", "AH", ["AO", "OW"], "like と cup と tea を強く、a と of は弱く。")], 2),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 2
unit(
    "母音を足さない", "子音で終わる・子音をつなげる", "epenthesis",
    "日本語の音は、ほとんどが母音で終わります。"
    "そのため英語の子音のあとに、つい「ウ」や「オ」を足してしまいます。"
    "母音が増えると音節も増えて、リズムが崩れ、聞き取りにくくなります。",
    "子音の口の形を作ったら、そこで止めます。"
    "母音を足さずに、息か声だけを短く出します。"
    "足した母音が見つかったら、その子音だけを短く言い直します。",
    [
        L("最後の子音で止める", "good を「グッド」にせず、d で止める。", [
            W("good", "よい", [F("good", "D", ["EPEN"], "舌先を上の歯ぐきに当てたら、そこで止めます。「ド」と母音を付けません。")], 1),
            W("book", "本", [F("book", "K", ["EPEN"], "舌の奥を上あごに付けて止めます。「ク」と言い切りません。")], 1),
            W("big", "大きい", [F("big", "G", ["EPEN"], "舌の奥を上あごに付けて止めるだけ。「グ」にしません。")], 1),
            W("night", "夜", [F("night", "T", ["EPEN"], "舌先を歯ぐきに付けて止めます。「ト」と母音を付けません。")], 1),
            W("job", "仕事", [F("job", "B", ["EPEN"], "くちびるを閉じたら、そこで止めます。「ブ」にしません。")], 1),
            W("bed", "ベッド", [F("bed", "D", ["EPEN"], "舌先を歯ぐきに付けて止めます。「ド」にしません。")], 1),
            W("milk", "牛乳", [F("milk", "L", ["EPEN"], "l のあとに「ル」を入れず、すぐ k へ。"),
                               F("milk", "K", ["EPEN"], "最後の k は止めるだけ。「ク」にしません。")], 2),
        ]),
        L("子音をつなげる", "street を「ストリート」にせず、母音なしで子音をつなげる。", [
            W("stay", "とどまる", [F("stay", "S", ["EPEN"], "s と t の間に「ウ」を入れません。「スー」と息を出したまま t へ。")], 1),
            W("school", "学校", [F("school", "S", ["EPEN"], "s と k の間に母音を入れません。息を続けたまま一気に。")], 2),
            W("sleep", "眠る", [F("sleep", "S", ["EPEN"], "s から l へ、母音を入れずにすべらせます。")], 2),
            W("dream", "夢", [F("dream", "D", ["EPEN"], "d と r の間に「オ」を入れません。d を言いながら、もう r の口にします。")], 2),
            W("glass", "グラス・コップ", [F("glass", "G", ["EPEN"], "g と l の間に「ウ」を入れません。gl を一気に言います。")], 2),
            W("smile", "笑顔", [F("smile", "S", ["EPEN"], "s と m の間に母音を入れません。s は息だけです。")], 2),
            W("street", "通り", [F("street", "S", ["EPEN"], "s、t、r の間に母音を入れません。3つの子音を一息で。"),
                                 F("street", "T", ["EPEN"], "t のあとに「ト」を入れず、すぐ r へ。")], 3),
        ]),
        L("語尾の s と ed", "最後の s や ed を、母音を足さずに付ける。", [
            W("books", "本（2冊以上）", [F("books", "S", ["EPEN"], "最後の s は息だけです。「ス」にしません。")], 1),
            W("likes", "（あの人は）〜が好き", [F("likes", "S", ["EPEN"], "k から s へ、母音を入れずに息だけで。")], 2),
            W("dogs", "犬（2匹以上）", [F("dogs", "Z", ["S", "EPEN"], "最後は声を響かせたまま止めます。「ズ」と言い切りません。")], 2),
            W("walked", "歩いた", [F("walked", "T", ["EPEN"], "最後は小さな t だけ。「ウォークト」と母音を足しません。")], 2),
            W("played", "遊んだ", [F("played", "D", ["EPEN"], "最後は舌先を歯ぐきに付けて止めるだけ。「ド」にしません。")], 2),
            W("needed", "必要だった", [F("needed", "D", ["EPEN"], "ed は弱く短く、最後の d で止めます。")], 2),
            W("watched", "見た", [F("watched", "T", ["EPEN"], "ch のすぐあとに小さな t。全体でひとかたまりです。")], 3),
        ], feature="final-consonants"),
        L("n・ng・l で終わる", "最後の n、ng、l を、母音を足さずに言い分ける。", [
            PR("win", "wing", "勝つ ／ 翼", [F("win", "N", ["NG"], "n は舌先を上の歯ぐきに付けて止めます。"),
                                              F("wing", "NG", ["N", "EPEN"], "ng は舌の奥を上あごに付けて、鼻に響かせます。「グ」は付けません。")], 2),
            PR("ran", "rang", "走った ／ 鳴った", [F("ran", "N", ["NG"], "舌先を歯ぐきに付けたまま終わります。"),
                                                   F("rang", "NG", ["N", "EPEN"], "舌の奥で止めて、鼻に響かせます。")], 2),
            PR("sun", "sung", "太陽 ／ 歌われた", [F("sun", "N", ["NG"], "舌先を歯ぐきに付けて止めます。"),
                                                   F("sung", "NG", ["N", "EPEN"], "舌の奥を上あごに付けて止めます。")], 2),
            W("long", "長い", [F("long", "NG", ["EPEN"], "最後は舌の奥を上あごに付けて止めます。「グ」は言いません。")], 2),
            W("feel", "感じる", [F("feel", "L", ["EPEN"], "最後は舌先を上の歯ぐきに付けたまま止めます。「ル」と母音を付けません。")], 2),
            W("tell", "伝える", [F("tell", "L", ["EPEN"], "舌先を歯ぐきに付けて、そのまま終わります。")], 2),
            W("people", "人々", [F("people", "L", ["EPEN"], "最後は「プル」ではなく、p のあと舌先を付けて止めます。")], 3),
        ], feature="final-consonants"),
        L("短い文で", "文の中でも、子音のあとに母音を足さない。", [
            S("It's a good job.", "よくできました。", [F("good", "D", ["EPEN"], "good の d は止めるだけで、次の job へ。"),
                                                     F("job", "B", ["EPEN"], "最後はくちびるを閉じて止めます。")], 2),
            S("Please stand up.", "立ってください。", [F("please", "P", ["EPEN"], "p と l の間に母音を入れません。"),
                                                     F("stand", "S", ["EPEN"], "s と t の間に「ウ」を入れません。")], 2),
            S("I like this song.", "この歌が好き。", [F("like", "K", ["EPEN"], "like の k で止めて、すぐ this へ。"),
                                                    F("song", "NG", ["EPEN"], "最後は舌の奥で止めます。「グ」は言いません。")], 2),
            S("Let's take a break.", "ひと休みしよう。", [F("let's", "S", ["EPEN"], "Let's の最後は「ツ」ではなく、小さな ts だけ。"),
                                                        F("break", "K", ["EPEN"], "最後の k は止めるだけ。")], 2),
            S("I drink black coffee.", "ブラックコーヒーを飲みます。", [F("drink", "D", ["EPEN"], "d と r の間に母音を入れません。"),
                                                                     F("black", "K", ["EPEN"], "black の k は止めるだけで、すぐ次へ。")], 3),
            S("She walked to school.", "彼女は歩いて学校へ行った。", [F("walked", "T", ["EPEN"], "walked の最後は小さな t。to とほぼ重なります。"),
                                                                    F("school", "L", ["EPEN"], "最後の l は舌先を付けて止めます。")], 3),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 3
R1 = "くちびるを「ウ」の形に軽く丸め、舌先を少し奥に引きます。舌先はどこにも付けずに、そのまま声を出します。"
R2 = "最初に口を「ゥ」と丸めてから始めます。舌はどこにも付けません。"
L1_ = "舌先を上の前歯の付け根に、しっかり押し当てます。当てたまま声を出し、それから離します。"
L2_ = "舌先を前歯の付け根に付けてから始めます。"
PR_R = "R は舌をどこにも付けず、口を丸めて始めます。"
PR_L = "L は舌先を前歯の付け根に付けて始めます。"
unit(
    "R と L", "right と light を言い分ける", "r-l",
    "日本語のラ行は、R とも L とも違う音です。"
    "英語では、right と light、rice と lice のように、この違いで意味が変わる単語がとても多くあります。",
    "R は舌先をどこにも付けず、くちびるを少し丸めて始めます。"
    "L は舌先を上の前歯の付け根に、しっかり付けます。"
    "まずは R だけ、L だけで練習し、そのあと並べて比べます。",
    [
        L("R の音", "舌をどこにも付けない R を出せるようになる。", [
            W("red", "赤", [F("red", "R", ["L"], R1)], 1),
            W("right", "右・正しい", [F("right", "R", ["L"], R1)], 1),
            W("rain", "雨", [F("rain", "R", ["L"], R2)], 1),
            W("read", "読む", [F("read", "R", ["L"], R2)], 1),
            W("run", "走る", [F("run", "R", ["L"], R2)], 1),
            W("room", "部屋", [F("room", "R", ["L"], R2)], 1),
            W("rice", "ごはん・米", [F("rice", "R", ["L"], R2)], 1),
        ]),
        L("L の音", "舌先を付ける L を出せるようになる。", [
            W("light", "光・明かり", [F("light", "L", ["R"], L1_)], 1),
            W("late", "遅い", [F("late", "L", ["R"], L1_)], 1),
            W("look", "見る", [F("look", "L", ["R"], L2_)], 1),
            W("lunch", "昼ごはん", [F("lunch", "L", ["R"], L2_)], 1),
            W("line", "線・列", [F("line", "L", ["R"], L2_)], 1),
            W("leg", "脚", [F("leg", "L", ["R"], L2_)], 1),
            W("lake", "湖", [F("lake", "L", ["R"], L2_)], 1),
        ]),
        L("R と L をくらべる", "R と L の違いで、意味を言い分ける。", [
            PR("right", "light", "右 ／ 光", [F("right", "R", ["L"], PR_R), F("light", "L", ["R"], PR_L)], 2),
            PR("rice", "lice", "ごはん ／ シラミ", [F("rice", "R", ["L"], PR_R), F("lice", "L", ["R"], PR_L)], 2),
            PR("road", "load", "道 ／ 荷物", [F("road", "R", ["L"], PR_R), F("load", "L", ["R"], PR_L)], 2),
            PR("wrong", "long", "間違った ／ 長い", [F("wrong", "R", ["L"], "wrong の w は読みません。R から始めます。"), F("long", "L", ["R"], PR_L)], 2),
            PR("rock", "lock", "岩 ／ 鍵をかける", [F("rock", "R", ["L"], PR_R), F("lock", "L", ["R"], PR_L)], 2),
            PR("grass", "glass", "草 ／ グラス", [F("grass", "R", ["L"], "g のすぐあと、舌を付けずに r へ。"),
                                                  F("glass", "L", ["R"], "g のすぐあと、舌先を付けて l へ。")], 3),
            PR("pray", "play", "祈る ／ 遊ぶ", [F("pray", "R", ["L"], "p のすぐあと、舌を付けずに r へ。"),
                                                F("play", "L", ["R"], "p のすぐあと、舌先を付けて l へ。")], 3),
        ]),
        L("単語の中の R と L", "単語のまん中でも、R と L を言い分ける。", [
            W("sorry", "ごめんなさい", [F("sorry", "R", ["L"], "o のあと、舌先を付けずに奥へ引いて r へ。")], 2),
            W("hello", "こんにちは", [F("hello", "L", ["R"], "まん中で舌先を前歯の付け根にしっかり付けます。")], 2),
            W("really", "本当に", [F("really", "R", ["L"], "最初は R。舌を付けずに口を丸めて。"),
                                   F("really", "L", ["R"], "後ろは L。舌先を付けます。")], 3),
            W("already", "もう・すでに", [F("already", "L", ["R"], "先に L。舌先を付けます。"),
                                          F("already", "R", ["L"], "すぐあとに R。舌を離して奥へ引きます。")], 3),
            PR("correct", "collect", "正しい ／ 集める", [F("correct", "ER", ["L", "AO"], "cor は弱く、舌を付けずに奥へ引いた r の響き。"),
                                                          F("collect", "L", ["R"], "まん中は L。舌先を付けます。")], 3),
            W("library", "図書館", [F("library", "L", ["R"], "最初は L。舌先を付けます。"),
                                    F("library", "R", ["L"], "後ろの r は、舌を付けずに。")], 4),
        ]),
        L("短い文で", "文の中でも、R と L を言い分ける。", [
            S("That's right.", "その通り。", [F("right", "R", ["L"], "舌をどこにも付けず、口を丸めて right。")], 1),
            S("Let me read it.", "読ませて。", [F("let", "L", ["R"], "Let は舌先を付けて。"),
                                              F("read", "R", ["L"], "read は舌を付けずに。")], 2),
            S("The rice is ready.", "ごはんができたよ。", [F("rice", "R", ["L"], "舌を付けずに rice。"),
                                                         F("ready", "R", ["L"], "ready も舌を付けずに。")], 2),
            S("I'm late for class.", "授業に遅れそう。", [F("late", "L", ["R"], "舌先を付けて late。"),
                                                        F("class", "L", ["R"], "k のすぐあとに、舌先を付けて l。")], 2),
            S("I really like it.", "すごく気に入っています。", [F("really", "R", ["L"], "really の最初は R。"),
                                                              F("like", "L", ["R"], "like は舌先を付けて。")], 3),
            S("Please call me later.", "あとで電話してください。", [F("call", "L", ["R", "EPEN"], "call の最後は、舌先を付けて止めます。"),
                                                                 F("later", "L", ["R"], "later の最初は舌先を付けて。")], 3),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 4
AE = "「エ」の口の形のまま「ア」と言います。口の両端を横に引き、あごも下げます。"
AE2 = "「エ」の口で「ア」。口を横にも開けます。"
AH = "口をあまり開けずに、短く軽い「ア」。日本語の「ア」より少し小さめです。"
AH2 = "口を小さく、短く軽い「ア」。"
AA = "あくびのように口を縦に大きく開けて、のどの奥から「アー」。「オ」にはしません。"
AA2 = "口を縦に大きく開けた「ア」。「オ」にしません。"
unit(
    "3つの「ア」", "hat・hut・hot を言い分ける", "vowels-ae-ah-aa",
    "日本語の「ア」はひとつですが、英語には「ア」に聞こえる母音が3つあります。"
    "hat、hut、hot は、口の開け方だけで意味が変わります。"
    "どれも、よく使う単語にたくさん出てきます。",
    "hat の a は、「エ」の口のまま「ア」と言います。"
    "hut の u は、口を小さく、短く軽く言います。"
    "hot の o は、あくびのように縦に大きく開けます。",
    [
        L("hat の a", "「エ」の口で言う「ア」を出せるようになる。", [
            W("cat", "猫", [F("cat", "AE", ["AA", "AH"], AE)], 1),
            W("bad", "悪い", [F("bad", "AE", ["AA", "AH"], AE)], 1),
            W("back", "後ろ・戻って", [F("back", "AE", ["AA", "AH"], AE2)], 1),
            W("map", "地図", [F("map", "AE", ["AA", "AH"], AE2)], 1),
            W("happy", "うれしい", [F("happy", "AE", ["AA", "AH"], AE2)], 1),
            W("apple", "りんご", [F("apple", "AE", ["AA", "AH"], AE2)], 2),
            W("black", "黒", [F("black", "AE", ["AA", "AH"], AE2)], 2),
        ]),
        L("hut の u", "小さく短い「ア」を出せるようになる。", [
            W("cup", "カップ", [F("cup", "AH", ["AA", "AE"], AH)], 1),
            W("bus", "バス", [F("bus", "AH", ["AA", "AE"], AH)], 1),
            W("much", "たくさん", [F("much", "AH", ["AA", "AE"], AH2)], 1),
            W("fun", "楽しい", [F("fun", "AH", ["AA", "AE"], AH2)], 1),
            W("come", "来る", [F("come", "AH", ["AA", "AO"], AH2)], 1),
            W("money", "お金", [F("money", "AH", ["AA", "AO"], AH2)], 2),
            W("young", "若い", [F("young", "AH", ["AA", "AE"], AH2)], 2),
        ]),
        L("hot の o", "縦に大きく開ける「ア」を出せるようになる。", [
            W("hot", "熱い・暑い", [F("hot", "AA", ["AO", "OW"], AA)], 1),
            W("not", "〜ない", [F("not", "AA", ["AO", "OW"], AA)], 1),
            W("got", "手に入れた", [F("got", "AA", ["AO", "OW"], AA2)], 1),
            W("shop", "店", [F("shop", "AA", ["AO", "OW"], AA2)], 1),
            W("box", "箱", [F("box", "AA", ["AO", "OW"], AA2)], 1),
            W("stop", "止まる", [F("stop", "AA", ["AO", "OW"], AA2)], 2),
            W("doctor", "医者", [F("doctor", "AA", ["AO", "OW"], "doc は縦に大きく開けます。「ドク」にしません。")], 2),
        ]),
        L("3つをくらべる", "口の開け方で、意味を言い分ける。", [
            PR("hat", "hut", "帽子 ／ 小屋", [F("hat", "AE", ["AH", "AA"], "hat は「エ」の口で「ア」。"),
                                              F("hut", "AH", ["AE", "AA"], "hut は口を小さく、短く。")], 2),
            PR("cap", "cup", "帽子 ／ カップ", [F("cap", "AE", ["AH", "AA"], "cap は「エ」の口で「ア」。"),
                                                F("cup", "AH", ["AE", "AA"], "cup は口を小さく、短く。")], 2),
            PR("bag", "bug", "かばん ／ 虫", [F("bag", "AE", ["AH", "AA"], "bag は口を横にも開けて。"),
                                              F("bug", "AH", ["AE", "AA"], "bug は小さく短く。")], 2),
            PR("match", "much", "試合 ／ たくさん", [F("match", "AE", ["AH", "AA"], "match は「エ」の口で「ア」。"),
                                                     F("much", "AH", ["AE", "AA"], "much は小さく短く。")], 2),
            PR("hot", "hut", "熱い ／ 小屋", [F("hot", "AA", ["AH", "AO"], "hot は縦に大きく開けて。"),
                                              F("hut", "AH", ["AA"], "hut は小さく短く。")], 3),
            PR("black", "block", "黒 ／ ブロック", [F("black", "AE", ["AA"], "black は「エ」の口で「ア」。"),
                                                    F("block", "AA", ["AE", "AO"], "block は縦に大きく開けて。")], 3),
            PR("ran", "run", "走った ／ 走る", [F("ran", "AE", ["AH"], "ran は「エ」の口で「ア」。"),
                                                F("run", "AH", ["AE"], "run は小さく短く。")], 3),
        ]),
        L("短い文で", "文の中でも、3つの「ア」を言い分ける。", [
            S("I have a cat.", "猫を飼っています。", [F("have", "AE", ["AA", "AH"], "have も「エ」の口で「ア」。"),
                                                      F("cat", "AE", ["AA", "AH"], "cat は口を横にも開けて。")], 2),
            S("That's not my bag.", "それは私のかばんではありません。", [F("not", "AA", ["AO", "OW"], "not は縦に大きく開けて。"),
                                                                       F("bag", "AE", ["AA", "AH"], "bag は「エ」の口で「ア」。")], 2),
            S("It's hot and sunny.", "暑くて晴れています。", [F("hot", "AA", ["AO", "OW"], "hot は縦に大きく。"),
                                                            F("sunny", "AH", ["AA", "AE"], "sun は小さく短く。")], 2),
            S("I'm so hungry.", "すごくおなかがすいた。", [F("hungry", "AH", ["AA", "AE"], "hun は口を小さく、短く。")], 2),
            S("Let's catch the bus.", "バスに乗ろう。", [F("catch", "AE", ["AA", "AH"], "catch は「エ」の口で「ア」。"),
                                                        F("bus", "AH", ["AA", "AE"], "bus は小さく短く。")], 3),
            S("My mother is a doctor.", "母は医者です。", [F("mother", "AH", ["AA"], "mo は小さく短い「ア」。"),
                                                          F("doctor", "AA", ["AO", "OW"], "doc は縦に大きく開けて。")], 3),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 5
ER = "舌先を少し持ち上げて奥へ引き、どこにも付けません。その形のまま、「ア」と「ウ」の間のこもった音を出します。"
ER2 = "舌を奥へ引いたまま、こもった音を響かせます。「アー」と伸ばしません。"
ERW = "最後の er は「アー」と伸ばさず、舌を奥へ引いて短く響かせます。"
RC = "母音のあと、舌を奥へ引いて r の響きで終わります。母音だけで止めないこと。"
unit(
    "ER の音", "bird・work・teacher の響き", "er",
    "アメリカ英語らしさが、いちばんよく出る音のひとつです。"
    "work や bird を「ワーク」「バード」と伸ばすと、walk や bad のように聞こえることがあります。"
    "teacher の er のように、単語の最後にもよく出てきます。",
    "R と同じ舌の形で、母音を響かせます。"
    "舌先はどこにも付けずに奥へ引き、くちびるは少し丸めます。"
    "音の最初から最後まで、舌の形を変えません。",
    [
        L("強い ER", "work や bird の ER を、舌の形で響かせる。", [
            W("her", "彼女の", [F("her", "ER", ["AA", "AH"], ER)], 1),
            W("bird", "鳥", [F("bird", "ER", ["AA", "AH"], ER)], 1),
            W("turn", "曲がる", [F("turn", "ER", ["AA", "AH"], ER2)], 1),
            W("work", "働く・仕事", [F("work", "ER", ["AA", "AO"], ER2)], 1),
            W("first", "最初の", [F("first", "ER", ["AA", "AH"], ER2)], 2),
            W("learn", "学ぶ", [F("learn", "ER", ["AA", "AH"], ER2)], 2),
            W("shirt", "シャツ", [F("shirt", "ER", ["AA", "AH"], ER2)], 2),
        ]),
        L("語尾の er", "teacher の er を、伸ばさずに響かせる。", [
            W("teacher", "先生", [F("teacher", "ER", ["AA", "AH"], ERW)], 1),
            W("dinner", "夕食", [F("dinner", "ER", ["AA", "AH"], ERW)], 1),
            W("paper", "紙", [F("paper", "ER", ["AA", "AH"], ERW)], 1),
            W("summer", "夏", [F("summer", "ER", ["AA", "AH"], ERW)], 1),
            W("sister", "姉・妹", [F("sister", "ER", ["AA", "AH"], ERW)], 2),
            W("number", "数・番号", [F("number", "ER", ["AA", "AH"], ERW)], 2),
            W("after", "〜のあとで", [F("after", "ER", ["AA", "AH"], ERW)], 2),
        ]),
        L("母音のあとの r", "car や more の最後に、r の響きを付ける。", [
            W("car", "車", [F("car", "R", [], RC)], 1),
            W("park", "公園", [F("park", "R", [], RC)], 1),
            W("start", "始める", [F("start", "R", [], RC)], 2),
            W("more", "もっと", [F("more", "R", [], RC)], 1),
            W("door", "ドア", [F("door", "R", [], RC)], 1),
            W("here", "ここ", [F("here", "R", [], RC)], 2),
            W("hair", "髪", [F("hair", "R", [], RC)], 2),
        ]),
        L("ER と「ア」をくらべる", "ER と「ア」の違いで、意味を言い分ける。", [
            PR("walk", "work", "歩く ／ 働く", [F("walk", "AO", ["ER"], "walk は舌を動かさず、口を縦に開けます。"),
                                                F("work", "ER", ["AO", "AA"], "work は舌を奥へ引いて、こもった音。")], 2),
            PR("heart", "hurt", "心 ／ 痛む", [F("heart", "AA", ["ER"], "heart は口を縦に大きく開けてから r。"),
                                               F("hurt", "ER", ["AA"], "hurt は口をあまり開けず、最初から舌を奥へ。")], 3),
            PR("far", "fur", "遠い ／ 毛皮", [F("far", "AA", ["ER"], "far は大きく開けてから r。"),
                                              F("fur", "ER", ["AA"], "fur は最初から舌を奥へ。")], 3),
            PR("star", "stir", "星 ／ かき混ぜる", [F("star", "AA", ["ER"], "star は大きく開けてから r。"),
                                                    F("stir", "ER", ["AA"], "stir は最初から舌を奥へ。")], 3),
            PR("bud", "bird", "つぼみ ／ 鳥", [F("bud", "AH", ["ER"], "bud は短く軽い「ア」。舌は動かしません。"),
                                               F("bird", "ER", ["AH", "AA"], "bird は舌を奥へ引いて響かせます。")], 3),
        ]),
        L("短い文で", "文の中でも、ER を響かせる。", [
            S("What's your number?", "電話番号は？", [F("your", "R", [], "your の最後は舌を奥へ引いて。"),
                                                     F("number", "ER", ["AA", "AH"], "number の er は伸ばさず、短く響かせます。")], 2),
            S("Dinner is at four.", "夕食は4時です。", [F("dinner", "ER", ["AA", "AH"], "dinner の er は短く響かせます。"),
                                                       F("four", "R", [], "four の最後に r の響きを付けます。")], 2),
            S("Is it far from here?", "ここから遠いですか？", [F("far", "R", [], "far の最後に r の響き。"),
                                                              F("here", "R", [], "here の最後も r の響き。")], 2),
            S("Her sister is a nurse.", "彼女の姉は看護師です。", [F("her", "ER", ["AA", "AH"], "her は舌を奥へ引いて。"),
                                                                F("nurse", "ER", ["AA", "AH"], "nurse も同じ舌の形で。")], 3),
            S("I learned a new word.", "新しい単語を覚えました。", [F("learned", "ER", ["AA", "AH"], "learned の ear は ER の音。"),
                                                                 F("word", "ER", ["AA", "AO"], "word も ER の音。walk にしません。")], 3),
            S("Turn left at the corner.", "角を左に曲がってください。", [F("turn", "ER", ["AA", "AH"], "turn は舌を奥へ引いて。"),
                                                                      F("corner", "ER", ["AA", "AH"], "corner の最後の er は短く響かせます。")], 3),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 6
FLAP = "舌先で上の歯ぐきを、ラ行のように一回だけ軽くはじきます。強く「タ」と言わないこと。"
unit(
    "音をつなげる", "つなげる・はじく t・弱い形", "linking-flap-reduction",
    "ネイティブは、単語を一つずつ区切らずに、つなげて話します。"
    "water の t は、日本語のラ行に近い軽い音になります。"
    "to や and は、短く弱くなります。"
    "ここが変わると、一気に自然に聞こえます。",
    "単語の最後の子音を、次の単語の最初の母音にくっつけます。"
    "母音にはさまれた t は、舌先で一回だけ軽くはじきます。"
    "to、and、of などは、力を抜いて短く言います。",
    [
        L("子音と母音をつなげる", "前の単語の最後の子音を、次の母音にくっつける。", [
            PH("come on", "さあ・がんばって", [F("come", "M", ["EPEN"], "come の m を、そのまま on にくっつけます。")], 1),
            PH("wake up", "起きる", [F("wake", "K", ["EPEN"], "wake の k を up にくっつけて、ひと続きに。")], 1),
            PH("an apple", "りんご1個", [F("an", "N", ["EPEN"], "an の n を、apple の頭にくっつけます。")], 1),
            PH("turn off", "（電気などを）消す", [F("turn", "N", ["EPEN"], "turn の n を off にくっつけます。")], 2),
            PH("hold on", "ちょっと待って", [F("hold", "D", ["EPEN"], "hold の d を on にくっつけます。")], 2),
            PH("check it out", "見てみて", [F("check", "K", ["EPEN"], "check の k を it にくっつけます。"),
                                             F("it", "T", ["EPEN"], "it の t は軽くはじいて out へ。")], 3),
        ]),
        L("はじく t", "water の t を、ラ行のように軽くはじく。", [
            W("water", "水", [F("water", "T", [], FLAP)], 2),
            W("better", "もっとよい", [F("better", "T", [], FLAP)], 2),
            W("city", "街", [F("city", "T", [], "t はラ行のように軽く。「シティ」の「テ」を強く言いません。")], 2),
            W("party", "パーティー", [F("party", "T", [], "r のあとの t も、ラ行のように軽くはじきます。")], 2),
            W("little", "少し・小さい", [F("little", "T", [], "t は軽くはじき、最後は舌先を付けたまま l で止めます。")], 3),
            PH("get up", "起きる", [F("get", "T", ["EPEN"], "get の t を up にくっつけて、軽くはじきます。")], 2),
            PH("a lot of", "たくさんの", [F("lot", "T", ["EPEN"], "lot の t を軽くはじいて of へ。of は弱く。")], 3),
        ]),
        L("弱くなる言葉", "and、of、can などを、弱く短く言う。", [
            PH("for you", "あなたに", [F("for", "ER", ["AO"], "for は「フォー」と伸ばさず、弱く短く。")], 1),
            PH("you and me", "あなたと私", [F("and", "AH", ["AE"], "and は「アンド」ではなく、弱く短い「ン」くらい。")], 2),
            PH("salt and pepper", "塩こしょう", [F("and", "AH", ["AE"], "and は弱く短く。salt と pepper を強く。")], 2),
            PH("from time to time", "ときどき", [F("from", "AH", ["AO", "OW"], "from は弱く短く。"),
                                                  F("to", "AH", ["UW"], "to も弱く短く。")], 2),
            PH("a friend of mine", "友だちの一人", [F("of", "AH", ["AO", "OW"], "of は弱く短く。"),
                                                    F("of", "V", ["B", "EPEN"], "of の最後は「ブ」ではなく、歯を下くちびるに軽く当てるだけ。")], 3),
            S("I can swim.", "泳げます。", [F("can", "AH", ["AE"], "can は弱く短く。強いのは swim です。")], 2),
        ]),
        L("gonna と wanna", "くだけた会話の言い方を、まねして言う。", [
            S("I'm going to go.", "もう行きます。", [F("gonna", "AH", ["UW", "OW"], "going to は gonna と短く言います。")], 2,
              tts="I'm gonna go."),
            S("I want to eat.", "食べたいな。", [F("wanna", "AH", ["UW", "OW"], "want to は wanna と短く言います。")], 2,
              tts="I wanna eat."),
            S("Let me see.", "ええと。", [F("lemme", "M", ["EPEN"], "Let me は lemme と、t を言わずにつなげます。")], 2,
              tts="Lemme see."),
            S("Do you want to come?", "一緒に来る？", [F("wanna", "AH", ["UW"], "want to は wanna。do you も軽く短く。")], 3,
              tts="Do you wanna come?"),
            S("I've got to go.", "もう行かなきゃ。", [F("gotta", "T", ["EPEN"], "got to は gotta。t はラ行のように軽く。")], 3,
              tts="I've gotta go."),
            S("Give me a minute.", "ちょっと待って。", [F("gimme", "M", ["EPEN"], "Give me は gimme と、v を言わずにつなげます。")], 3,
              tts="Gimme a minute."),
        ]),
        L("文でつなげる", "つなげる、はじく、弱くするを、文の中でまとめて使う。", [
            S("Not at all.", "どういたしまして。", [F("not", "T", ["EPEN"], "not の t を at にくっつけ、軽くはじきます。"),
                                                  F("at", "T", ["EPEN"], "at の t も軽くはじいて all へ。")], 3),
            S("Put it on the table.", "テーブルに置いて。", [F("put", "T", ["EPEN"], "put と it をつなげ、t は軽くはじきます。"),
                                                            F("it", "T", ["EPEN"], "it の t も軽くはじいて on へ。")], 3),
            S("It's a lot of fun.", "とても楽しいです。", [F("lot", "T", ["EPEN"], "lot の t を軽くはじいて of へ。")], 3),
            S("Can I get a glass of water?", "水を1杯もらえますか？", [F("get", "T", ["EPEN"], "get a は軽くはじいてつなげます。"),
                                                                     F("water", "T", [], FLAP)], 4),
            S("Let's get out of here.", "ここから出よう。", [F("get", "T", ["EPEN"], "get out of は、t を軽くはじいて一続きに。"),
                                                           F("out", "T", ["EPEN"], "out の t も軽くはじいて of へ。")], 4),
            S("I'll think about it.", "考えておきます。", [F("think", "K", ["EPEN"], "think の k を about にくっつけます。"),
                                                         F("about", "T", ["EPEN"], "about の t を軽くはじいて it へ。")], 4),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 7
TH = "舌先を上の前歯の先に軽く当て、そのすき間から息を通します。噛まずに、軽く触れるだけ。"
TH2 = "舌先を前歯に軽く当てて、息だけを通します。"
DH = "舌先を上の前歯の先に軽く当て、声を出しながら息を通します。"
DH2 = "舌先を前歯に軽く当てたまま、声を出します。"
SI = "歯を近づけて「スー」と細い息を出し、そのまま「イ」へ。舌先は前に保ちます。"
SH = "くちびるを前に突き出し、舌を少し奥に引いて「シュ」。"
TI = "舌先を歯ぐきに当てて、はじくように「ティ」。「チ」にしません。"
unit(
    "TH・S・SH", "舌先の位置で決まる音", "th",
    "think を「シンク」と言うと、sink（流し台）に聞こえます。"
    "TH は the や this のように、とてもよく使う単語に出てきます。"
    "また sea を「シー」と言うと、she に聞こえます。"
    "どれも、舌先の位置を少し変えるだけで直せます。",
    "TH は、舌先を上の前歯の先に軽く当てて息を通します。"
    "強く噛まなくて大丈夫です。"
    "S は歯を近づけ、舌先を前に保ったまま細い息を出します。"
    "SH は、くちびるを前に突き出して出します。",
    [
        L("息だけの TH", "舌先を歯に当てて、息だけの TH を出す。", [
            W("thank", "感謝する", [F("thank", "TH", ["S"], TH)], 1),
            W("think", "思う", [F("think", "TH", ["S"], TH)], 1),
            W("thing", "もの・こと", [F("thing", "TH", ["S"], TH2)], 1),
            W("both", "両方", [F("both", "TH", ["S", "EPEN"], "最後は舌先を前歯に当てて、息だけで終わります。")], 2),
            W("bath", "お風呂", [F("bath", "TH", ["S", "EPEN"], "最後は舌先を前歯に当てて、息だけで終わります。")], 2),
            W("nothing", "何もない", [F("nothing", "TH", ["S"], TH2)], 2),
            W("birthday", "誕生日", [F("birthday", "TH", ["S"], "ER のあと、舌先を前歯に当てて TH。すぐ d へ。")], 3),
        ]),
        L("声を出す TH", "the や this の TH を、声を出して言う。", [
            W("this", "これ", [F("this", "DH", ["Z", "D"], DH)], 1),
            W("that", "あれ", [F("that", "DH", ["Z", "D"], DH)], 1),
            W("they", "彼ら", [F("they", "DH", ["Z", "D"], DH2)], 1),
            W("mother", "母", [F("mother", "DH", ["Z", "D"], DH2)], 2),
            W("other", "ほかの", [F("other", "DH", ["Z", "D"], DH2)], 2),
            W("weather", "天気", [F("weather", "DH", ["Z", "D"], DH2)], 2),
            W("with", "〜と一緒に", [F("with", "DH", ["Z", "EPEN"], "最後は舌先を前歯に当てたまま止めます。「ズ」にしません。")], 2),
        ]),
        L("TH と S をくらべる", "TH と S の違いで、意味を言い分ける。", [
            PR("think", "sink", "思う ／ 流し台", [F("think", "TH", ["S"], "think は舌先を前歯に当てて。"),
                                                   F("sink", "S", ["TH"], "sink は舌先を歯の内側に置いたまま。")], 2),
            PR("thing", "sing", "もの ／ 歌う", [F("thing", "TH", ["S"], "thing は舌先を前歯に当てて。"),
                                                 F("sing", "S", ["TH"], "sing は舌を歯の外に出しません。")], 2),
            PR("thick", "sick", "厚い ／ 病気の", [F("thick", "TH", ["S"], "thick は舌先を前歯に当てて。"),
                                                   F("sick", "S", ["TH", "SH"], "sick は「シ」にならないよう、細い息で。")], 2),
            PR("thin", "sin", "薄い ／ 罪", [F("thin", "TH", ["S"], "thin は舌先を前歯に当てて。"),
                                             F("sin", "S", ["TH", "SH"], "sin は歯を近づけて細い息で。")], 2),
            PR("mouth", "mouse", "口 ／ ネズミ", [F("mouth", "TH", ["S"], "mouth は最後に舌先を前歯に当てます。"),
                                                  F("mouse", "S", ["TH"], "mouse は最後まで舌を歯の内側に。")], 3),
            PR("path", "pass", "小道 ／ 通る", [F("path", "TH", ["S"], "path は最後に舌先を前歯に当てます。"),
                                                F("pass", "S", ["TH"], "pass は最後まで舌を歯の内側に。")], 3),
        ]),
        L("スィ・ティ・トゥ", "「シ」「チ」「ツ」にならないように言う。", [
            W("sit", "座る", [F("sit", "S", ["SH"], SI)], 1),
            PR("sea", "she", "海 ／ 彼女", [F("sea", "S", ["SH"], SI), F("she", "SH", ["S"], SH)], 2),
            PR("sip", "ship", "ひと口飲む ／ 船", [F("sip", "S", ["SH"], SI), F("ship", "SH", ["S"], SH)], 2),
            W("team", "チーム", [F("team", "T", ["CH"], TI)], 1),
            W("ticket", "切符・チケット", [F("ticket", "T", ["CH"], TI)], 2),
            W("two", "2", [F("two", "T", ["S", "CH"], "「ツー」ではなく「トゥー」。舌先を歯ぐきからすばやく離し、くちびるを丸めます。")], 1),
            W("music", "音楽", [F("music", "Z", ["JH"], "si は「ジ」ではなく「ズィ」。舌先を歯ぐきに付けずに、声を響かせます。")], 2),
        ], feature="s-sh"),
        L("短い文で", "文の中でも、舌先の位置を保つ。", [
            S("I think so.", "そう思います。", [F("think", "TH", ["S"], TH2)], 1),
            S("Thank you so much.", "本当にありがとう。", [F("thank", "TH", ["S"], TH2)], 1),
            S("They're over there.", "あそこにいます。", [F("they're", "DH", ["Z", "D"], DH2),
                                                        F("there", "DH", ["Z", "D"], DH2)], 2),
            S("This is my seat.", "ここは私の席です。", [F("this", "DH", ["Z", "D"], DH2),
                                                       F("seat", "S", ["SH"], "seat の s は「シ」にしません。")], 2),
            S("Three tickets, please.", "チケットを3枚ください。", [F("three", "TH", ["S"], "舌先を前歯に当てて息を出し、すぐ r へ。"),
                                                                 F("tickets", "T", ["CH"], "「チ」ではなく「ティ」。")], 3),
            S("Thanks for everything.", "いろいろありがとう。", [F("thanks", "TH", ["S"], TH2),
                                                               F("everything", "TH", ["S"], "thing の TH も舌先を前歯に。")], 3),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 8
V = "上の前歯を下くちびるに軽く乗せ、声を出しながら息を通します。くちびる同士は付けません。"
V2 = "上の前歯を下くちびるに乗せて、声を出します。"
FF = "上の前歯を下くちびるに軽く乗せ、息だけを通します。くちびる同士は付けません。"
FF2 = "上の前歯を下くちびるに乗せて、息だけを出します。"
HU = "くちびるで息をこすらず、のどから「ハ」の息を出して、そのまま「ウー」。"
WU = "くちびるを小さくすぼめてから、ゆるめながら次の母音へ。最初の「ゥ」を省きません。"
unit(
    "V・F・H・W", "くちびると歯の音", "v-b",
    "日本語の「ブ」や「フ」は、両方のくちびるで作ります。"
    "英語の V と F は、上の歯を下くちびるに当てて作ります。"
    "very を「ベリー」と言うと、berry（ベリー類）に聞こえます。"
    "「フ」につられて、who や woman も崩れやすくなります。",
    "上の前歯を、下くちびるの内側に軽く乗せます。"
    "そのすき間から息だけを出すと F、声を出すと V です。"
    "who は、くちびるをこすらずに、のどから息を出します。"
    "woman は、くちびるを小さくすぼめてから始めます。",
    [
        L("V の音", "歯を下くちびるに当てて、V を出す。", [
            W("very", "とても", [F("very", "V", ["B"], V)], 1),
            W("voice", "声", [F("voice", "V", ["B"], V)], 1),
            W("visit", "訪ねる", [F("visit", "V", ["B"], V2)], 1),
            W("over", "〜の上に・終わって", [F("over", "V", ["B"], V2)], 1),
            W("every", "毎〜・すべての", [F("every", "V", ["B"], V2)], 2),
            W("love", "大好き", [F("love", "V", ["B", "EPEN"], "最後は歯を下くちびるに当てたまま止めます。「ブ」にしません。")], 2),
            W("give", "あげる", [F("give", "V", ["B", "EPEN"], "最後は歯を下くちびるに当てたまま止めます。")], 2),
        ]),
        L("V と B をくらべる", "V と B の違いで、意味を言い分ける。", [
            PR("very", "berry", "とても ／ ベリー", [F("very", "V", ["B"], "very は歯を下くちびるに当てて。"),
                                                     F("berry", "B", ["V"], "berry は両方のくちびるを閉じてから。")], 2),
            PR("vote", "boat", "投票する ／ ボート", [F("vote", "V", ["B"], "vote は歯を下くちびるに当てて。"),
                                                      F("boat", "B", ["V"], "boat はくちびるを閉じてから。")], 2),
            PR("van", "ban", "ワゴン車 ／ 禁止する", [F("van", "V", ["B"], "van は歯を下くちびるに当てて。"),
                                                       F("ban", "B", ["V"], "ban はくちびるを閉じてから。")], 2),
            PR("vest", "best", "ベスト（服） ／ いちばんよい", [F("vest", "V", ["B"], "vest は歯を下くちびるに当てて。"),
                                                                 F("best", "B", ["V"], "best はくちびるを閉じてから。")], 2),
            PR("vet", "bet", "獣医 ／ 賭ける", [F("vet", "V", ["B"], "vet は歯を下くちびるに当てて。"),
                                                F("bet", "B", ["V"], "bet はくちびるを閉じてから。")], 2),
            PR("curve", "curb", "カーブ ／ 縁石", [F("curve", "V", ["B", "EPEN"], "curve の最後は、歯を下くちびるに当てて止めます。"),
                                                   F("curb", "B", ["V", "EPEN"], "curb の最後は、くちびるを閉じて止めます。")], 3),
        ]),
        L("F の音", "歯を下くちびるに当てて、F を出す。", [
            W("fine", "元気な・よい", [F("fine", "F", ["HH"], FF)], 1),
            W("phone", "電話", [F("phone", "F", ["HH"], FF)], 1),
            W("fun", "楽しい", [F("fun", "F", ["HH"], FF2)], 1),
            W("food", "食べ物", [F("food", "F", ["HH"], "「フ」ではなく、歯を下くちびるに当てて息を出してから「ウー」。")], 2),
            W("coffee", "コーヒー", [F("coffee", "F", ["HH"], "「コーヒー」の「ヒ」ではなく、歯を下くちびるに当てて F。")], 2),
            W("fruit", "果物", [F("fruit", "F", ["HH"], "歯を下くちびるに当てて息を出し、すぐ r へ。")], 2),
            W("off", "離れて・オフ", [F("off", "F", ["HH", "EPEN"], "最後は歯を下くちびるに当てて、息だけで終わります。")], 2),
        ], feature="f-h"),
        L("F・H・W", "「フ」につられずに、F、H、W を言い分ける。", [
            PR("fat", "hat", "太った ／ 帽子", [F("fat", "F", ["HH"], "fat は歯を下くちびるに当てて。"),
                                                F("hat", "HH", ["F"], "hat はくちびるを使わず、のどから息を出します。")], 2),
            PR("feel", "heel", "感じる ／ かかと", [F("feel", "F", ["HH"], "feel は歯を下くちびるに当てて。"),
                                                    F("heel", "HH", ["F"], "heel はのどから息を出します。")], 2),
            PR("fold", "hold", "たたむ ／ 持つ", [F("fold", "F", ["HH"], "fold は歯を下くちびるに当てて。"),
                                                  F("hold", "HH", ["F"], "hold はのどから息を出します。")], 2),
            W("who", "だれ", [F("who", "HH", ["F"], HU)], 2),
            W("whose", "だれの", [F("whose", "HH", ["F"], HU)], 2),
            W("woman", "女性", [F("woman", "W", [], WU)], 2),
            W("would", "〜だろう・〜したい", [F("would", "W", [], WU)], 2),
        ], feature="f-h"),
        L("短い文で", "文の中でも、歯とくちびるを使い分ける。", [
            S("It's very good.", "とてもいいです。", [F("very", "V", ["B"], V2)], 1),
            S("I feel fine.", "元気です。", [F("feel", "F", ["HH"], FF2), F("fine", "F", ["HH"], FF2)], 2),
            S("I love my family.", "家族が大好きです。", [F("love", "V", ["B", "EPEN"], "love の最後は、歯を下くちびるに当てて止めます。"),
                                                        F("family", "F", ["HH"], FF2)], 2),
            S("Can I have a fork?", "フォークをもらえますか？", [F("have", "V", ["B", "EPEN"], "have の v は、歯を下くちびるに軽く当てるだけ。"),
                                                               F("fork", "F", ["HH"], FF2)], 2),
            S("Five or seven?", "5ですか？ 7ですか？", [F("five", "V", ["B", "EPEN"], "five の最後は v。歯を下くちびるに当てて。"),
                                                       F("seven", "V", ["B"], "seven の v も歯を下くちびるに当てて。")], 2),
            S("Who's that woman?", "あの女性はだれ？", [F("who's", "HH", ["F"], HU), F("woman", "W", [], WU)], 3),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 9
IH = "口の力を抜いた、短くゆるい「イ」。少し「エ」に近い音です。"
IY = "口を横にしっかり引いて、はっきり長い「イー」。"
UH = "くちびるは軽く丸めるだけの、短くゆるい「ウ」。"
UW = "くちびるを小さく丸めて前に突き出す、長い「ウー」。"
EY = "「エー」と伸ばさず、「エイ」と最後に口を閉じていきます。"
OW = "「オー」と伸ばさず、「オウ」と最後にくちびるをすぼめます。"


def ii(a, b, ja, d=2):
    return PR(a, b, ja, [F(a, "IH", ["IY"], IH), F(b, "IY", ["IH"], IY)], d)


unit(
    "長い音と短い音", "ship と sheep、full と fool", "vowels-tense-lax",
    "日本語の「イ」と「イー」は、長さだけの違いです。"
    "英語の ship と sheep は、長さだけでなく、口の形も違います。"
    "また make や go は、英語では「エイ」「オウ」と、口が動く音です。",
    "短い方は、口の力を抜いて、少しゆるく言います。"
    "長い方は、口を横にしっかり引くか、くちびるを丸めて突き出します。"
    "「エイ」「オウ」は、最後まで口を動かします。",
    [
        L("イとイー", "ship と sheep を、口の形で言い分ける。", [
            ii("it", "eat", "それ ／ 食べる", 1),
            ii("sit", "seat", "座る ／ 座席"),
            ii("ship", "sheep", "船 ／ 羊"),
            ii("live", "leave", "住む ／ 去る"),
            ii("chip", "cheap", "かけら ／ 安い"),
            ii("hit", "heat", "打つ ／ 熱"),
            ii("fill", "feel", "満たす ／ 感じる", 3),
        ]),
        L("ウとウー", "full と fool を、口の形で言い分ける。", [
            PR("full", "fool", "いっぱいの ／ おろか者", [F("full", "UH", ["UW"], UH), F("fool", "UW", ["UH"], UW)], 2),
            PR("pull", "pool", "引く ／ プール", [F("pull", "UH", ["UW"], UH), F("pool", "UW", ["UH"], UW)], 2),
            W("look", "見る", [F("look", "UH", ["UW"], UH)], 1),
            W("cook", "料理する", [F("cook", "UH", ["UW"], UH)], 1),
            W("should", "〜したほうがいい", [F("should", "UH", ["UW"], UH)], 2),
            W("soon", "もうすぐ", [F("soon", "UW", ["UH"], UW)], 1),
            W("choose", "選ぶ", [F("choose", "UW", ["UH"], UW)], 2),
        ]),
        L("エイとオウ", "「エー」「オー」と伸ばさずに、口を動かす。", [
            W("make", "作る", [F("make", "EY", ["EH"], EY)], 1),
            W("go", "行く", [F("go", "OW", ["AO"], OW)], 1),
            W("home", "家", [F("home", "OW", ["AO"], OW)], 1),
            W("okay", "いいよ", [F("okay", "OW", ["AO"], OW), F("okay", "EY", ["EH"], EY)], 2),
            W("don't", "〜しない", [F("don't", "OW", ["AO"], "「ドント」ではなく、o で「オウ」と口を動かします。")], 2),
            PR("wet", "wait", "ぬれた ／ 待つ", [F("wet", "EH", ["EY"], "wet は短い「エ」で止めます。"),
                                                 F("wait", "EY", ["EH"], "wait は「エイ」と口を動かします。")], 2),
            PR("called", "cold", "呼んだ ／ 寒い", [F("called", "AO", ["OW"], "called は口を縦に開けた「オー」のまま。"),
                                                   F("cold", "OW", ["AO"], "cold は「オウ」と、くちびるをすぼめていきます。")], 3),
        ]),
        L("短い文で", "文の中でも、長い音と短い音を言い分ける。", [
            S("Where do you live?", "どこに住んでいますか？", [F("live", "IH", ["IY"], "live は短くゆるい「イ」。leave にしません。")], 2),
            S("Is this seat free?", "この席は空いていますか？", [F("seat", "IY", ["IH"], IY), F("free", "IY", ["IH"], IY)], 2),
            S("It's a good book.", "いい本です。", [F("good", "UH", ["UW"], UH), F("book", "UH", ["UW"], UH)], 2),
            S("I don't know.", "わかりません。", [F("don't", "OW", ["AO"], OW), F("know", "OW", ["AO"], OW)], 2),
            S("Let's go home.", "家に帰ろう。", [F("go", "OW", ["AO"], OW), F("home", "OW", ["AO"], OW)], 2),
            S("The pool is full.", "プールは人でいっぱいです。", [F("pool", "UW", ["UH"], UW), F("full", "UH", ["UW"], UH)], 3),
            S("Please wait a minute.", "少し待ってください。", [F("wait", "EY", ["EH"], EY)], 3),
        ]),
    ],
)

# ---------------------------------------------------------------- unit 10
unit(
    "声のメロディー", "高さの幅・強調・上げ下げ", "intonation",
    "日本語で話す英語は、声の高さの幅がせまく、平らに聞こえがちです。"
    "英語では、いちばん伝えたい単語で、声が大きく上がって下がります。"
    "気持ちや意味も、この動きで伝わります。",
    "お手本の声の高さの線を、なぞるように言います。"
    "少し大げさかなと思うくらいで、ちょうど自然に聞こえます。"
    "最初は短い言葉で、高さの幅を広げます。",
    [
        L("高さの幅を広げる", "声の高さを大きく動かして、気持ちを伝える。", [
            W("Really?", "本当？", [F("really", "IH", [], "rea を低めに始めて、最後に大きく上げます。")], 1),
            W("Great!", "いいね！", [F("great", "EY", [], "高いところから一気に下げます。")], 1),
            PH("No problem.", "大丈夫ですよ。", [F("problem", "AA", [], "pro で高く上げて、そこから下げます。")], 1),
            PH("That's amazing!", "すごい！", [F("amazing", "EY", [], "ma で大きく上げて、一気に下げます。")], 2),
            PH("Thank you so much!", "本当にありがとう！", [F("much", "AH", [], "much で一番高くして、気持ちをこめて下げます。")], 2),
            PH("Nice to meet you, too.", "こちらこそ、よろしく。", [F("too", "UW", [], "最後の too を一番高くして下げます。")], 2),
        ]),
        L("いちばん大事な単語", "伝えたい単語を、高く強く目立たせる。", [
            S("Where are you from?", "出身はどこですか？", [F("from", "AH", [], "この文では from が一番高くなります。where は低めに。")], 2),
            S("What do you do?", "お仕事は何ですか？", [F("do", "UW", [], "最後の do を高くして、そこから下げます。")], 2),
            S("Which one? The red one.", "どれ？ 赤いの。", [F("red", "EH", [], "答えの red だけを高く強く。one は低く。")], 3),
            S("It's my turn, not yours.", "あなたじゃなくて、私の番。", [F("my", "AY", [], "my と yours を高く目立たせます。"),
                                                                     F("yours", "R", [], "yours で下げて終わります。")], 3),
            S("I said coffee, not tea.", "紅茶じゃなくて、コーヒーって言ったの。", [F("coffee", "AA", [], "coffee と tea を高く強く。ほかは低く軽く。")], 3),
            S("I'm not tired, I'm hungry.", "疲れたんじゃなくて、おなかがすいたの。", [F("tired", "AY", [], "tired で少し上げます。"),
                                                                                 F("hungry", "AH", [], "hungry を一番高くして下げます。")], 3),
        ]),
        L("質問の上げ下げ", "はい・いいえで答える質問は上げ、what や where の質問は下げる。", [
            S("Are you ready?", "準備できた？", [F("ready", "EH", [], "最後の ready で声を上げます。")], 1),
            S("Do you like it?", "気に入った？", [F("like", "AY", [], "like から声を上げていきます。")], 1),
            S("Is this your first time?", "初めてですか？", [F("first", "ER", [], "first time に向けて声を上げていきます。")], 2),
            S("Where do you work?", "どこで働いていますか？", [F("work", "ER", [], "where の質問は、最後の work で下げます。")], 2),
            S("What would you like?", "何にしますか？", [F("like", "AY", [], "like で高くしてから下げます。上げないこと。")], 2),
            S("How was your weekend?", "週末はどうでしたか？", [F("weekend", "IY", [], "week で高くして、そこから下げます。")], 2),
            S("Coffee or tea?", "コーヒーと紅茶、どちらにしますか？", [F("coffee", "AA", [], "coffee で上げて、tea で下げます。")], 2),
        ]),
        L("区切りとまとまり", "長い文を区切りながら、メロディーをつける。", [
            S("Sorry, I didn't catch that.", "すみません、聞き取れませんでした。", [F("catch", "AE", [], "catch を高く強くして、そこから下げます。")], 3),
            S("Could you say that again, please?", "もう一度言ってもらえますか？", [F("again", "EH", [], "again を高くします。please は軽く。")], 3),
            S("I'm not sure, but I think so.", "よくわからないけど、そうだと思います。", [F("sure", "R", [], "sure で少し上げて、ひと区切り。"),
                                                                                    F("think", "IH", [], "後半は think を高くして下げます。")], 4),
            S("If you have time, let's get lunch.", "時間があれば、お昼を食べに行こう。", [F("time", "AY", [], "time で少し上げて、ひと区切り。"),
                                                                                       F("lunch", "AH", [], "最後の lunch で下げます。")], 4),
            S("When I got home, I was really tired.", "家に帰ったら、すごく疲れていました。", [F("home", "OW", [], "home で少し上げて区切ります。"),
                                                                                          F("tired", "AY", [], "最後の tired で下げます。")], 5),
            S("I'd like a coffee, a salad, and some water.", "コーヒーとサラダと、お水をください。", [F("coffee", "AA", [], "並べるときは、coffee と salad で上げます。"),
                                                                                              F("water", "AO", [], "最後の water で下げて終わります。")], 5),
        ]),
    ],
)
