#!/usr/bin/env python3
"""Assemble content/curriculum.json (v2: sentences only).

  python3 content/build_curriculum.py && python3 content/check_cmudict.py

v2 rules (owner): no single-word items; every item is a phrase or sentence.
  lessons 1-2: 3-6 words, later lessons: up to 12, boss lesson: 12-20.
  Minimal pairs live inside one natural sentence; `pair` is metadata only
  (the minimal-pair partner of focus[0].word, for listen-only reference).
  No katakana readings of English words anywhere; stress is shown as
  ho·TEL（・●）. IPA is dictionary style (see ipa.py).
Each unit() call appends the unit and rewrites the JSON (saved as we go).
IDs are positional (u03-l2-04): v2 kept every lesson's item count, so the
ids of v1 still point at the same lesson and position.
Japanese strings are written without line breaks; j() inserts "\n" after
every 、 and 。 that is not at the end.
"""
import json
import re
from pathlib import Path

import ipa

OUT = Path(__file__).resolve().parent / "curriculum.json"
PLACEMENT, UNITS = [], []


def j(s):
    s = s.strip()
    return re.sub(r"([、。])(?!$|\n|[」』）)])", r"\1\n", s)


def F(word, phone, watch=(), tip=""):
    f = {"word": word, "phone": phone, "watch_for": list(watch)}
    if tip:
        f["tip_ja"] = j(tip)
    w = ipa.word_ipa(word, phone, weak=bool(watch))
    if w:
        f["ipa"] = w
    if phone == "T" and ipa.flap_note(word):
        f["ipa_note_ja"] = j(ipa.flap_note(word))
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


def S(text, ja, focus, d=2, tts=None, pair=None):
    return _item("sentence", text, ja, focus, d, tts, pair)


def PH(text, ja, focus, d=2, tts=None, pair=None):
    return _item("phrase", text, ja, focus, d, tts, pair)


def L(title, goal, items, feature=None):
    return {"title_ja": j(title), "goal_ja": j(goal), "feature": feature, "items": items}


def save():
    data = {"version": 2, "placement": PLACEMENT, "units": UNITS}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def unit(title, subtitle, feature, why, how, lessons, boss, boss_goal):
    uid = f"u{len(UNITS) + 1:02d}"
    out = []
    for li, l in enumerate(lessons + [L("まとめの長い文", boss_goal, boss)], 1):
        lid = f"{uid}-l{li}"
        les = {"id": lid, "title_ja": l["title_ja"], "goal_ja": l["goal_ja"],
               "feature": l["feature"] or feature}
        if li == len(lessons) + 1:
            les["boss"] = True
        les["items"] = [{"id": f"{lid}-{ii:02d}", **it} for ii, it in enumerate(l["items"], 1)]
        out.append(les)
    UNITS.append({"id": uid, "title_ja": j(title), "subtitle_ja": j(subtitle), "feature": feature,
                  "why_ja": j(why), "how_ja": j(how), "lessons": out})
    save()


def T(word, phone, watch, tag):
    """Placement focus: which phone in which word feeds which tag."""
    f = {"word": word, "phone": phone, "watch_for": list(watch), "tag": tag}
    w = ipa.word_ipa(word, phone)
    if w:
        f["ipa"] = w
    return f


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
    {"id": "p4", "text": "Can I have a cup of hot coffee?", "ja": j("温かい珈琲を1杯もらえますか？"),
     "diagnoses": ["vowels-ae-ah-aa", "v-b", "f-h", "rhythm-stress", "intonation"],
     "focus": [T("have", "AE", ["AA", "AH"], "vowels-ae-ah-aa"), T("cup", "AH", ["AA", "AE"], "vowels-ae-ah-aa"),
               T("hot", "AA", ["AO", "OW"], "vowels-ae-ah-aa"), T("have", "V", ["B", "EPEN"], "v-b"),
               T("coffee", "F", ["HH"], "f-h"), T("can", "AH", ["AE"], "rhythm-stress"),
               T("of", "AH", ["AO", "OW"], "rhythm-stress")]},
    {"id": "p5", "text": "I'll see you at six.", "ja": j("6時に会いましょう。"),
     "diagnoses": ["s-sh", "final-consonants", "linking-flap-reduction"],
     "focus": [T("see", "S", ["SH"], "s-sh"), T("six", "S", ["SH"], "s-sh"),
               T("six", "K", ["EPEN"], "final-consonants"), T("at", "T", ["EPEN"], "linking-flap-reduction")]},
    {"id": "p6", "text": "Her work starts early.", "ja": j("彼女の仕事は朝早く始まります。"),
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
    "英語の強弱", "強い音と弱い音の差をつける", "rhythm-stress",
    "日本語は、どの音もほぼ同じ長さで言います。"
    "英語は、強い音節（音のかたまり）を高く長く言い、弱い音節を短くあいまいに言います。"
    "この差がつくだけで、英語らしさが大きく変わります。",
    "説明の ho·TEL（・●）のように、大きな文字と●が強い音節です。"
    "そこだけ声を高く、長く、はっきり出します。"
    "それ以外は力を抜いて、短く流します。",
    [
        L("強いところはひとつ", "単語の中で強く言う場所を、正しく決める。", [
            S("I have an idea.", "いい考えがあります。", [F("idea", "IY", [], "i·DE·a（・●・）。まん中の DE を高く長く言います。最後の a は弱く短く。")], 1),
            S("Let's begin again.", "もう一度始めよう。", [F("begin", "IH", [], "be·GIN（・●）。後ろの GIN を強く言います。"),
                                                       F("again", "EH", [], "a·GAIN（・●）。後ろの GAIN を強く言います。")], 1),
            S("The machine is broken.", "機械が壊れています。", [F("machine", "IY", [], "ma·CHINE（・●）。後ろの CHINE を高く長く言います。ma は弱く短く。")], 1),
            S("Can you peel the potatoes?", "じゃがいもの皮をむいてくれる？", [F("potatoes", "EY", [], "po·TA·toes（・●・）。まん中の TA だけを強く言います。"),
                                                                           F("potatoes", "AH", ["OW", "AO"], "最初の po は、力を抜いた弱い音です。")], 2),
            S("Please call the police.", "警察を呼んでください。", [F("police", "IY", [], "po·LICE（・●）。後ろの LICE を高く長く言います。po は弱く短く。")], 1),
            S("My family is big.", "うちは大家族です。", [F("family", "AE", [], "FAM·i·ly（●・・）。最初の FAM だけを強く言います。")], 1),
            S("Is the chair comfortable?", "その椅子は座り心地がいいですか？", [F("comfortable", "AH", [], "COMF·ta·ble（●・・）。強いのは最初の COMF だけ。全体で3つのかたまりです。")], 3),
            S("I love animals.", "動物が大好きです。", [F("animals", "AE", [], "AN·i·mals（●・・）。最初の AN を強く、残りは短く弱く。")], 2),
        ]),
        L("弱い母音", "強くないところの母音を、短く弱くする。", [
            S("What's it about?", "何の話？", [F("about", "AH", ["AA"], "a·BOUT（・●）。最初の a は力を抜いた短い音です。")], 1),
            S("Say it again, please.", "もう一度言ってください。", [F("again", "AH", ["AA"], "a·GAIN（・●）。最初の a は弱く短く。")], 1),
            S("I'm busy today.", "今日は忙しいです。", [F("today", "AH", ["UW", "OW"], "to·DAY（・●）。to は伸ばさず、弱く短く。")], 1),
            S("Wait a second.", "ちょっと待って。", [F("second", "AH", ["AO", "OW"], "SEC·ond（●・）。強いのは SEC です。ond は弱く短く。")], 1),
            S("It starts at seven.", "7時に始まります。", [F("seven", "AH", ["EH"], "SEV·en（●・）。強いのは SEV です。en は弱く短く。")], 1),
            S("That's not a problem.", "問題ありません。", [F("problem", "AH", ["EH"], "PROB·lem（●・）。強いのは PROB です。lem は弱く短く。")], 2),
            S("Where is the station?", "駅はどこですか？", [F("station", "AH", ["OW"], "STA·tion（●・）。強いのは STA です。tion は弱く短く。")], 2),
            S("I skipped breakfast today.", "今日は朝ごはんを抜きました。", [F("breakfast", "AH", ["AA"], "BREAK·fast（●・）。強いのは BREAK だけ。fast は弱く短く。")], 3),
        ]),
        L("強い単語と弱い単語", "大事な単語を強く、a や of などを弱く言う。", [
            S("It's time to go to bed.", "もう寝る時間です。", [F("to", "AH", ["UW"], "time、go、bed を強く。to は弱く短く。")], 2),
            S("I'll be back in a minute.", "すぐ戻ります。", [F("minute", "IH", [], "MIN·ute（●・）。強いのは back と MIN。in a は軽く流します。")], 2),
            S("Can I have a glass of water?", "水を1杯もらえますか？", [F("of", "AH", ["AO", "OW"], "glass と wa を強く。a と of は弱く短く。")], 2),
            S("It was a piece of cake.", "朝飯前でした。", [F("was", "AH", ["AA"], "was は弱く短く。強いのは piece と cake です。"),
                                                       F("of", "AH", ["AO", "OW"], "of も弱く短く。")], 2),
            S("I go for a walk in the morning.", "朝は散歩に行きます。", [F("for", "ER", ["AO"], "for は伸ばさず、弱く短く。強いのは walk と mor です。")], 3),
            S("We need some milk and eggs.", "牛乳と卵が要ります。", [F("and", "AH", ["AE"], "and は弱く短く。強いのは need、milk、eggs です。")], 2),
        ]),
        L("文の強弱", "文の中で、強い音と弱い音の差をつける。", [
            S("Nice to meet you.", "はじめまして。", [F("to", "AH", ["UW"], "Nice と meet を強く、to と you は軽く。")], 1),
            S("See you tomorrow.", "また明日。", [F("tomorrow", "AA", [], "to·MOR·row（・●・）。強いのは MOR です。")], 1),
            S("What time is it now?", "今何時ですか？", [F("time", "AY", [], "time と now を強く言います。is it は軽くつなげます。")], 2),
            S("It's a beautiful day, isn't it?", "いい天気ですね。", [F("beautiful", "UW", [], "BEAU·ti·ful（●・・）。強いのは BEAU と day です。")], 3),
            S("Can I have the check, please?", "お会計をお願いします。", [F("can", "AH", ["AE"], "Can は弱く短く。強いのは check です。")], 2),
            S("I'd like to make a reservation for two.", "2名で予約をしたいのですが。", [F("reservation", "EY", [], "res·er·VA·tion（・・●・）。強いのは VA です。"),
                                                                                  F("to", "AH", ["UW"], "to と a と for は弱く短く。")], 4),
        ]),
    ],
    [
        S("I'd like a cup of tea and a bowl of rice with some fish, please.", "紅茶と、ごはんを1杯、それに魚を少しください。",
          [F("of", "AH", ["AO", "OW"], "of は2回とも弱く短く。"), F("and", "AH", ["AE"], "and も弱く。"),
           F("some", "AH", ["AA"], "some は弱く短く。強いのは fish です。")], 4),
        S("We're going to the station at seven in the morning, so let's go to bed early tonight.", "朝7時に駅へ行くから、今夜は早く寝よう。",
          [F("station", "EY", [], "STA·tion（●・）。"), F("seven", "EH", [], "SEV·en（●・）。"),
           F("tonight", "AY", [], "to·NIGHT（・●）。to は弱く短く。")], 5),
        S("My family and I usually have breakfast together at about half past six.", "家族と私は、たいてい6時半ごろに一緒に朝ごはんを食べます。",
          [F("family", "AE", [], "FAM·i·ly（●・・）。"), F("together", "EH", [], "to·GETH·er（・●・）。"),
           F("about", "AH", ["AA"], "a·BOUT（・●）。最初の a は弱く。")], 5),
    ],
    "強い音節と弱い音節の差を、長い文の最後まで保つ。",
)

# ---------------------------------------------------------------- unit 2
EP_D = "舌先を上の歯ぐきに当てたら、そこで止めます。母音を付けません。"
EP_K = "舌の奥を上あごに付けて止めます。「ク」と言い切りません。"
EP_T = "舌先を歯ぐきに付けて止めます。「ト」と母音を付けません。"
EP_G = "舌の奥を上あごに付けて止めるだけ。「グ」にしません。"
EP_B = "くちびるを閉じたら、そこで止めます。「ブ」にしません。"
CL_S = "s のあとに「ウ」を入れません。息を続けたまま次の子音へ。"
unit(
    "母音を足さない", "子音で終わる・子音をつなげる", "epenthesis",
    "日本語の音は、ほとんどが母音で終わります。"
    "そのため英語の子音のあとに、つい「ウ」や「オ」を足してしまいます。"
    "母音が増えると音節も増えて、強弱が崩れ、聞き取りにくくなります。",
    "子音の口の形を作ったら、そこで止めます。"
    "母音を足さずに、息か声だけを短く出します。"
    "足した母音が見つかったら、その子音だけを短く言い直します。",
    [
        L("最後の子音で止める", "good の d のような最後の子音を、母音を付けずに止める。", [
            S("It looks good.", "よさそうですね。", [F("good", "D", ["EPEN"], EP_D)], 1),
            S("I read a good book.", "いい本を読みました。", [F("book", "K", ["EPEN"], EP_K), F("good", "D", ["EPEN"], "good の d は止めるだけで、すぐ book へ。")], 1),
            S("That's a big dog.", "大きな犬ですね。", [F("big", "G", ["EPEN"], EP_G), F("dog", "G", ["EPEN"], "最後の g も止めるだけ。")], 1),
            S("Good night, sleep tight.", "おやすみなさい。", [F("night", "T", ["EPEN"], EP_T), F("tight", "T", ["EPEN"], "最後の t も、止めるだけです。")], 1),
            S("I got a new job.", "新しい仕事が決まりました。", [F("job", "B", ["EPEN"], EP_B), F("got", "T", ["EPEN"], "got の t は止めるだけ。")], 1),
            S("Go back to bed.", "もう一度寝なさい。", [F("bed", "D", ["EPEN"], EP_D), F("back", "K", ["EPEN"], "back の k は止めるだけで、すぐ to へ。")], 1),
            S("I drink milk at night.", "夜に牛乳を飲みます。", [F("milk", "L", ["EPEN"], "l のあとに「ル」を入れず、すぐ k へ。"), F("milk", "K", ["EPEN"], "最後の k は止めるだけ。")], 2),
        ]),
        L("子音をつなげる", "st や dr のような子音の並びを、母音なしで言う。", [
            S("Please stay here.", "ここにいてください。", [F("stay", "S", ["EPEN"], "s と t の間に「ウ」を入れません。「スー」と息を出したまま t へ。"),
                                                       F("please", "P", ["EPEN"], "p と l の間にも母音を入れません。")], 1),
            S("School starts at eight.", "学校は8時に始まります。", [F("school", "S", ["EPEN"], CL_S), F("starts", "S", ["EPEN"], "starts の st も一気に。")], 2),
            S("I can't sleep well.", "よく眠れません。", [F("sleep", "S", ["EPEN"], "s から l へ、母音を入れずにすべらせます。")], 2),
            S("I had a strange dream.", "変な夢を見ました。", [F("strange", "S", ["EPEN"], "s、t、r を一息で言います。"),
                                                           F("dream", "D", ["EPEN"], "d と r の間に「オ」を入れません。")], 3),
            PH("A glass of cold water.", "冷たい水を1杯。", [F("glass", "G", ["EPEN"], "g と l の間に「ウ」を入れません。gl を一気に。")], 2),
            S("She has a nice smile.", "彼女は笑顔がすてきです。", [F("smile", "S", ["EPEN"], "s と m の間に母音を入れません。s は息だけです。")], 2),
            S("Cross the street slowly.", "ゆっくり道を渡ってね。", [F("street", "S", ["EPEN"], "s、t、r の間に母音を入れません。"),
                                                              F("cross", "K", ["EPEN"], "k と r の間にも母音を入れません。")], 3),
        ]),
        L("語尾の s と ed", "最後の s や ed を、母音を足さずに付ける。", [
            S("I bought two books.", "本を2冊買いました。", [F("books", "S", ["EPEN"], "最後の s は息だけです。「ス」にしません。")], 1),
            S("She likes cats and dogs.", "彼女は猫も犬も好きです。", [F("likes", "S", ["EPEN"], "k から s へ、母音を入れずに息だけで。"),
                                                                F("dogs", "Z", ["S", "EPEN"], "最後は声を響かせたまま止めます。「ズ」と言い切りません。")], 2),
            S("He walked to work yesterday.", "彼は昨日、歩いて仕事に行きました。", [F("walked", "T", ["EPEN"], "walked の最後は小さな t だけ。母音を足しません。")], 2),
            S("We played in the park after school.", "放課後、公園で遊びました。", [F("played", "D", ["EPEN"], "最後は舌先を歯ぐきに付けて止めるだけ。")], 2),
            S("I needed more time.", "もっと時間が必要でした。", [F("needed", "D", ["EPEN"], "ed は弱く短く、最後の d で止めます。")], 2),
            S("We watched a movie last night.", "昨日の夜、映画を見ました。", [F("watched", "T", ["EPEN"], "ch のすぐあとに小さな t。全体でひとかたまりです。"),
                                                                       F("last", "T", ["EPEN"], "st で止めて、すぐ night へ。")], 3),
            S("He asked me a question.", "彼に質問されました。", [F("asked", "T", ["EPEN"], "s、k、t を母音なしで続けます。")], 3),
        ], feature="final-consonants"),
        L("n・ng・l で終わる", "最後の n、ng、l を、母音を足さずに言い分ける。", [
            S("The phone rang, so I ran.", "電話が鳴ったので、走りました。", [F("rang", "NG", ["N", "EPEN"], "ng は舌の奥を上あごに付けて、鼻に響かせます。「グ」は付けません。"),
                                                                         F("ran", "N", ["NG"], "n は舌先を上の歯ぐきに付けて止めます。")], 2, pair="ran"),
            S("My son loves this song.", "息子はこの歌が大好きです。", [F("son", "N", ["NG"], "son は舌先を歯ぐきに付けて止めます。"),
                                                                F("song", "NG", ["N", "EPEN"], "song は舌の奥で止めます。「グ」は言いません。")], 2),
            S("We sang songs in the sun.", "日なたで歌を歌いました。", [F("sun", "N", ["NG"], "sun は舌先を歯ぐきに付けて止めます。"),
                                                                F("sang", "NG", ["N", "EPEN"], "sang は舌の奥で止めます。")], 2, pair="sung"),
            S("It's a long way home.", "家まで遠いです。", [F("long", "NG", ["EPEN"], "最後は舌の奥を上あごに付けて止めます。「グ」は言いません。")], 2),
            S("I feel a little cold.", "少し寒いです。", [F("feel", "L", ["EPEN"], "最後は舌先を上の歯ぐきに付けたまま止めます。「ル」と母音を付けません。")], 2),
            S("Please tell me the truth.", "本当のことを教えてください。", [F("tell", "L", ["EPEN"], "舌先を歯ぐきに付けて、そのまま次の me へ。")], 2),
            S("Many people came to the meeting.", "会議にたくさんの人が来ました。", [F("people", "L", ["EPEN"], "最後は p のあと、舌先を付けて止めます。")], 3),
        ], feature="final-consonants"),
        L("文で止める・つなげる", "文の中でも、子音のあとに母音を足さない。", [
            S("Please stand up and take a deep breath.", "立ち上がって、深呼吸してください。", [F("stand", "S", ["EPEN"], "s と t の間に「ウ」を入れません。"),
                                                                                      F("deep", "P", ["EPEN"], "deep の p は止めるだけで、すぐ breath へ。")], 3),
            S("I like this song a lot.", "この歌がすごく好きです。", [F("like", "K", ["EPEN"], "like の k で止めて、すぐ this へ。"),
                                                               F("song", "NG", ["EPEN"], "song は舌の奥で止めます。")], 2),
            S("Let's take a break and drink some tea.", "ひと休みしてお茶を飲もう。", [F("let's", "S", ["EPEN"], "Let's の最後は、小さな ts だけ。"),
                                                                              F("drink", "D", ["EPEN"], "d と r の間に母音を入れません。")], 3),
            S("I drink black coffee every morning.", "毎朝、珈琲を何も入れずに飲みます。", [F("black", "K", ["EPEN"], "black の k は止めるだけで、すぐ次へ。"),
                                                                                  F("drink", "K", ["EPEN"], "drink の最後の k も止めるだけ。")], 3),
            S("She walked to school with her friends.", "彼女は友だちと歩いて学校へ行きました。", [F("walked", "T", ["EPEN"], "walked の最後は小さな t。"),
                                                                                     F("friends", "Z", ["EPEN"], "最後の nds は、母音を入れずに一息で。")], 3),
            S("The kids played outside until it got dark.", "子どもたちは暗くなるまで外で遊びました。", [F("kids", "Z", ["EPEN"], "kids の最後は、声を響かせたまま止めます。"),
                                                                                         F("dark", "K", ["EPEN"], "最後の k は止めるだけ。")], 3),
        ]),
    ],
    [
        S("She walked six blocks in the cold wind and stopped at the best street stand for lunch.",
          "彼女は冷たい風の中を6区画歩いて、いちばんの屋台でお昼にしました。",
          [F("walked", "T", ["EPEN"], "小さな t で止めて、すぐ six へ。"), F("blocks", "S", ["EPEN"], "ks を母音なしで。"),
           F("street", "S", ["EPEN"], "str を一息で。"), F("stand", "D", ["EPEN"], "stand の d で止めて、すぐ for へ。")], 5),
        S("Last night I watched a long film and fell asleep before the end.",
          "昨日の夜、長い映画を見ていて、最後まで見る前に寝てしまいました。",
          [F("watched", "T", ["EPEN"], "ch のすぐあとに小さな t。"), F("long", "NG", ["EPEN"], "舌の奥で止めて「グ」を付けません。"),
           F("film", "L", ["EPEN"], "l と m の間に母音を入れません。")], 4),
        S("Please speak slowly and clearly, because most people in this class are still learning.",
          "この授業の人はまだ学んでいる途中なので、ゆっくりはっきり話してください。",
          [F("speak", "S", ["EPEN"], "sp を一息で。"), F("clearly", "K", ["EPEN"], "k と l の間に母音を入れません。"),
           F("most", "T", ["EPEN"], "st で止めて、すぐ people へ。"), F("still", "L", ["EPEN"], "最後の l は舌先を付けて止めます。")], 5),
    ],
    "長い文の中でも、子音のあとに母音を足さずに言い切る。",
)

# ---------------------------------------------------------------- unit 3
R1 = "くちびるを軽く丸め、舌先を少し奥に引きます。舌先はどこにも付けずに、そのまま声を出します。"
R2 = "最初に口を「ゥ」と丸めてから始めます。舌はどこにも付けません。"
L1_ = "舌先を上の前歯の付け根に、しっかり押し当てます。当てたまま声を出し、それから離します。"
L2_ = "舌先を前歯の付け根に付けてから始めます。"
PR_R = "R は舌をどこにも付けず、口を丸めて始めます。"
PR_L = "L は舌先を前歯の付け根に付けて始めます。"
unit(
    "R と L", "right と light を言い分ける", "r-l",
    "日本語のラ行は、R とも L とも違う音です。"
    "英語では、right と light、road と load のように、この違いで意味が変わる単語がとても多くあります。",
    "R は舌先をどこにも付けず、くちびるを少し丸めて始めます。"
    "L は舌先を上の前歯の付け根に、しっかり付けます。"
    "まずは R の文、L の文で練習し、そのあと両方が入った文で比べます。",
    [
        L("R の音", "舌をどこにも付けない R を、文の中で出す。", [
            S("I like the red one.", "赤いのが好きです。", [F("red", "R", ["L"], R1)], 1),
            S("You're right about that.", "それはあなたの言う通りです。", [F("right", "R", ["L"], R1)], 1),
            S("It might rain today.", "今日は雨が降るかもしれません。", [F("rain", "R", ["L"], R2)], 1),
            S("I read every night.", "毎晩、本を読みます。", [F("read", "R", ["L"], R2)], 1),
            S("I run every morning.", "毎朝走っています。", [F("run", "R", ["L"], R2)], 1),
            S("Is the room ready?", "部屋の準備はできていますか？", [F("room", "R", ["L"], R2), F("ready", "R", ["L"], "ready も同じ R で始めます。")], 2),
            S("I'll have rice, please.", "ごはんをお願いします。", [F("rice", "R", ["L"], R2)], 1),
        ]),
        L("L の音", "舌先を付ける L を、文の中で出す。", [
            S("Turn off the light.", "明かりを消してください。", [F("light", "L", ["R"], L1_)], 1),
            S("Sorry I'm late.", "遅れてごめんなさい。", [F("late", "L", ["R"], L1_)], 1),
            S("Look at this.", "これを見て。", [F("look", "L", ["R"], L2_)], 1),
            S("Let's have lunch.", "お昼にしよう。", [F("lunch", "L", ["R"], L2_), F("let's", "L", ["R"], "Let's も舌先を付けて始めます。")], 1),
            S("Please wait in line.", "列に並んでお待ちください。", [F("line", "L", ["R"], L2_)], 1),
            S("My leg hurts a little.", "脚が少し痛いです。", [F("leg", "L", ["R"], L2_), F("little", "L", ["R"], "little の最初も L です。")], 2),
            S("We live near a lake.", "私たちは湖の近くに住んでいます。", [F("live", "L", ["R"], L2_), F("lake", "L", ["R"], L2_)], 2),
        ]),
        L("R と L をくらべる", "R と L が両方入った文で、意味を言い分ける。", [
            S("Turn right at the light.", "信号を右に曲がってください。", [F("right", "R", ["L"], PR_R), F("light", "L", ["R"], PR_L)], 2, pair="light"),
            S("Something is wrong. It's taking too long.", "何かおかしい。時間がかかりすぎています。",
              [F("wrong", "R", ["L"], "wrong の w は読みません。R から始めます。"), F("long", "L", ["R"], PR_L)], 3, pair="long"),
            S("Don't put your glass on the grass.", "芝生の上に飲み物を置かないでね。",
              [F("glass", "L", ["R"], "glass は g のすぐあと、舌先を付けて l へ。"), F("grass", "R", ["L"], "grass は g のすぐあと、舌を付けずに r へ。")], 3, pair="grass"),
            S("The car carried a heavy load down the road.", "その車は重い荷物を積んで、道を下っていきました。",
              [F("load", "L", ["R"], PR_L), F("road", "R", ["L"], PR_R)], 3, pair="road"),
            S("Please collect the correct forms.", "正しい書類を集めてください。",
              [F("collect", "L", ["R"], "collect は舌先を付けた L。"), F("correct", "ER", ["L", "AO"], "correct の cor は弱く、舌を付けずに奥へ引いた r の響き。")], 3, pair="correct"),
            S("Stay in your lane in the rain.", "雨の日は、車線をはみ出さないで。", [F("lane", "L", ["R"], PR_L), F("rain", "R", ["L"], PR_R)], 3, pair="rain"),
            S("The rate for late payments is high.", "延滞の利率は高いです。", [F("rate", "R", ["L"], PR_R), F("late", "L", ["R"], PR_L)], 3, pair="late"),
        ]),
        L("単語の中の R と L", "単語のまん中でも、R と L を言い分ける。", [
            S("I'm sorry, I forgot.", "ごめんなさい、忘れていました。", [F("sorry", "R", ["L"], "o のあと、舌先を付けずに奥へ引いて r へ。")], 2),
            S("Hello, it's nice to meet you.", "こんにちは、はじめまして。", [F("hello", "L", ["R"], "まん中で舌先を前歯の付け根にしっかり付けます。")], 2),
            S("I really like it.", "すごく気に入っています。", [F("really", "R", ["L"], "最初は R。舌を付けずに口を丸めて。"), F("really", "L", ["R"], "後ろは L。舌先を付けます。")], 3),
            S("I've already eaten lunch.", "もうお昼は食べました。", [F("already", "L", ["R"], "先に L。舌先を付けます。"), F("already", "R", ["L"], "すぐあとに R。舌を離して奥へ引きます。")], 3),
            S("The library closes early on holidays.", "図書館は休日は早く閉まります。",
              [F("library", "L", ["R"], "最初は L。舌先を付けます。"), F("library", "R", ["L"], "brary の r は舌を付けずに。"),
               F("early", "L", ["R"], "early の最後は舌先を付けた L。")], 4),
            S("Please call me later, if you're free.", "手が空いたら、あとで電話してください。",
              [F("call", "L", ["R", "EPEN"], "call の最後は、舌先を付けて止めます。"), F("free", "R", ["L"], "f のすぐあとに、舌を付けない r。")], 3),
        ]),
        L("文の中の R と L", "文の中で、R と L を続けて言い分ける。", [
            S("That's right, I remember.", "そうそう、覚えています。", [F("right", "R", ["L"], PR_R), F("remember", "R", ["L"], "remember も R で始めます。")], 2),
            S("Let me read it later.", "あとで読ませてください。", [F("let", "L", ["R"], "Let は舌先を付けて。"), F("read", "R", ["L"], "read は舌を付けずに。"),
                                                          F("later", "L", ["R"], "later は舌先を付けて。")], 2),
            S("The rice is ready, so let's eat.", "ごはんができたから、食べよう。", [F("rice", "R", ["L"], PR_R), F("ready", "R", ["L"], PR_R)], 2),
            S("I'm always late for my early class.", "朝早い授業には、いつも遅れてしまいます。",
              [F("always", "L", ["R"], "always の l は舌先を付けて。"), F("late", "L", ["R"], PR_L), F("class", "L", ["R"], "k のすぐあとに、舌先を付けて l。")], 3),
            S("I really like the light blue one.", "薄い青のが、すごく気に入っています。",
              [F("really", "R", ["L"], "really は R から。"), F("light", "L", ["R"], PR_L), F("blue", "L", ["R"], "b のすぐあとに、舌先を付けて l。")], 3),
            S("Turn left at the next traffic light.", "次の信号を左に曲がってください。",
              [F("left", "L", ["R"], PR_L), F("traffic", "R", ["L"], "t のすぐあとに、舌を付けない r。"), F("light", "L", ["R"], PR_L)], 3),
        ]),
    ],
    [
        S("I really like living here, because the rent is low and the library is right around the corner.",
          "家賃が安くて、図書館もすぐそこなので、ここでの暮らしがとても気に入っています。",
          [F("really", "R", ["L"], "really は R、L の順です。"), F("rent", "R", ["L"], PR_R), F("low", "L", ["R"], PR_L),
           F("library", "L", ["R"], "library は L から。")], 5),
        S("Let's leave early tomorrow, or we'll be late for the flight and run into traffic.",
          "明日は早めに出よう。でないと飛行機に遅れるし、渋滞にもはまるよ。",
          [F("leave", "L", ["R"], PR_L), F("early", "L", ["R"], "early の最後は L。"),
           F("flight", "L", ["R"], "f のすぐあとに、舌先を付けて l。"), F("run", "R", ["L"], PR_R)], 5),
        S("Could you please tell me where the restroom is? I think I'm lost.",
          "お手洗いはどこか教えてもらえますか？ 迷ってしまったみたいです。",
          [F("please", "L", ["R"], "p のすぐあとに、舌先を付けて l。"), F("restroom", "R", ["L"], "restroom は R が2回。どちらも舌を付けません。"),
           F("lost", "L", ["R"], PR_L)], 4),
    ],
    "長い文の中で、R と L を最後まで言い分ける。",
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
        L("hat の a", "「エ」の口で言う「ア」を、文の中で出す。", [
            S("We have a cat.", "猫を飼っています。", [F("cat", "AE", ["AA", "AH"], AE), F("have", "AE", ["AA", "AH"], "have も同じ音です。")], 1),
            S("That's too bad.", "それは残念です。", [F("bad", "AE", ["AA", "AH"], AE), F("that's", "AE", ["AA", "AH"], "that's も同じ音です。")], 1),
            S("I'll be right back.", "すぐ戻ります。", [F("back", "AE", ["AA", "AH"], AE2)], 1),
            S("Can I see the map?", "地図を見てもいいですか？", [F("map", "AE", ["AA", "AH"], AE2)], 1),
            S("I'm happy to help.", "喜んで手伝います。", [F("happy", "AE", ["AA", "AH"], AE2)], 1),
            S("I ate an apple.", "りんごを1個食べました。", [F("apple", "AE", ["AA", "AH"], AE2)], 1),
            S("I want a black bag.", "黒いかばんがほしいです。", [F("black", "AE", ["AA", "AH"], AE2), F("bag", "AE", ["AA", "AH"], AE2)], 2),
        ]),
        L("hut の u", "小さく短い「ア」を、文の中で出す。", [
            S("Just a cup, please.", "1杯だけお願いします。", [F("cup", "AH", ["AA", "AE"], AH), F("just", "AH", ["AA", "AE"], "just も同じ音です。")], 1),
            S("I love my mother.", "母が大好きです。", [F("love", "AH", ["AA", "AE"], AH), F("mother", "AH", ["AA", "AE"], AH2)], 1),
            S("Thank you so much.", "本当にありがとう。", [F("much", "AH", ["AA", "AE"], AH2)], 1),
            S("That sounds fun.", "楽しそうですね。", [F("fun", "AH", ["AA", "AE"], AH2)], 1),
            S("Come and see us.", "遊びに来てね。", [F("come", "AH", ["AA", "AO"], AH2), F("us", "AH", ["AA"], "us も同じ音です。")], 1),
            S("I don't have much money.", "お金があまりありません。", [F("money", "AH", ["AA", "AO"], AH2), F("much", "AH", ["AA", "AE"], AH2)], 2),
            S("He's young and lucky.", "彼は若くて運がいいです。", [F("young", "AH", ["AA", "AE"], AH2), F("lucky", "AH", ["AA", "AE"], AH2)], 2),
        ]),
        L("hot の o", "縦に大きく開ける「ア」を、文の中で出す。", [
            S("It's really hot today.", "今日は本当に暑いです。", [F("hot", "AA", ["AO", "OW"], AA)], 1),
            S("I'm not sure.", "よくわかりません。", [F("not", "AA", ["AO", "OW"], AA)], 1),
            S("I got a lot of calls.", "電話がたくさんかかってきました。", [F("got", "AA", ["AO", "OW"], AA2), F("lot", "AA", ["AO", "OW"], AA2)], 2),
            S("The shop opens at ten.", "その店は10時に開きます。", [F("shop", "AA", ["AO", "OW"], AA2)], 1),
            S("Put the box on top.", "箱をいちばん上に置いてください。", [F("box", "AA", ["AO", "OW"], AA2), F("top", "AA", ["AO", "OW"], AA2)], 2),
            S("Please stop the car here.", "ここで車を止めてください。", [F("stop", "AA", ["AO", "OW"], AA2)], 2),
            S("My father is a doctor.", "父は医者です。", [F("father", "AA", ["AO", "OW"], AA2), F("doctor", "AA", ["AO", "OW"], "doc は縦に大きく開けます。「オ」にしません。")], 2),
        ]),
        L("3つをくらべる", "2つの「ア」が入った文で、口の開け方を言い分ける。", [
            S("There's a bug on my bag.", "かばんに虫がついています。", [F("bag", "AE", ["AH", "AA"], "bag は「エ」の口で「ア」。"),
                                                                 F("bug", "AH", ["AE", "AA"], "bug は口を小さく、短く。")], 2, pair="bug"),
            S("He spilled a cup of coffee on his cap.", "彼は帽子に珈琲をこぼしました。",
              [F("cup", "AH", ["AE", "AA"], "cup は口を小さく、短く。"), F("cap", "AE", ["AH", "AA"], "cap は「エ」の口で「ア」。")], 3, pair="cap"),
            S("I don't care much about the match.", "その試合には、あまり興味がありません。",
              [F("much", "AH", ["AE", "AA"], "much は小さく短く。"), F("match", "AE", ["AH", "AA"], "match は「エ」の口で「ア」。")], 3, pair="match"),
            S("It's hot, but the sun is nice.", "暑いけど、日差しは気持ちいいです。",
              [F("hot", "AA", ["AH", "AO"], "hot は縦に大きく開けて。"), F("sun", "AH", ["AA"], "sun は小さく短く。")], 3, pair="hut"),
            S("The black car is on the next block.", "黒い車は次の区画にあります。",
              [F("black", "AE", ["AA"], "black は「エ」の口で「ア」。"), F("block", "AA", ["AE", "AO"], "block は縦に大きく開けて。")], 3, pair="block"),
            S("I ran, but you run faster.", "私も走ったけど、あなたの方が速いですね。",
              [F("ran", "AE", ["AH"], "ran は「エ」の口で「ア」。"), F("run", "AH", ["AE"], "run は小さく短く。")], 3, pair="run"),
            S("Lock the door. Good luck!", "扉に鍵をかけてね。がんばって！",
              [F("lock", "AA", ["AH", "AO"], "lock は縦に大きく開けて。"), F("luck", "AH", ["AA"], "luck は小さく短く。")], 3, pair="luck"),
        ]),
        L("文の中の3つの「ア」", "文の中で、3つの「ア」を続けて言い分ける。", [
            S("I have a cat and a dog.", "猫と犬を飼っています。", [F("have", "AE", ["AA", "AH"], AE2), F("cat", "AE", ["AA", "AH"], AE2)], 2),
            S("That's not my bag, it's hers.", "それは私のかばんではなく、彼女のです。",
              [F("not", "AA", ["AO", "OW"], "not は縦に大きく開けて。"), F("bag", "AE", ["AA", "AH"], "bag は「エ」の口で「ア」。")], 2),
            S("It's hot and sunny, so let's go swimming.", "暑くて晴れているから、泳ぎに行こう。",
              [F("hot", "AA", ["AO", "OW"], "hot は縦に大きく。"), F("sunny", "AH", ["AA", "AE"], "sun は小さく短く。")], 3),
            S("I'm hungry. Let's have lunch now.", "おなかがすいた。もうお昼にしよう。",
              [F("hungry", "AH", ["AA", "AE"], "hun は口を小さく、短く。"), F("have", "AE", ["AA", "AH"], "have は「エ」の口で「ア」。"),
               F("lunch", "AH", ["AA", "AE"], "lunch も小さく短く。")], 3),
            S("Let's catch the last train.", "最終電車に乗ろう。", [F("catch", "AE", ["AA", "AH"], "catch は「エ」の口で「ア」。"),
                                                                F("last", "AE", ["AA", "AH"], "last も同じ音です。")], 3),
            S("My mother and father are both doctors.", "母も父も医者です。",
              [F("mother", "AH", ["AA"], "mo は小さく短い「ア」。"), F("father", "AA", ["AO", "OW"], "fa は縦に大きく開けて。"),
               F("doctors", "AA", ["AO", "OW"], "doc も縦に大きく。")], 3),
        ]),
    ],
    [
        S("My younger brother lost his black bag on the train, but luckily someone brought it back.",
          "弟が電車で黒いかばんをなくしたけど、運よく誰かが届けてくれました。",
          [F("younger", "AH", ["AA"], "young は小さく短い「ア」。"), F("black", "AE", ["AA", "AH"], "black は「エ」の口で「ア」。"),
           F("luckily", "AH", ["AA"], "luck も小さく短く。"), F("back", "AE", ["AA", "AH"], "back は「エ」の口で「ア」。")], 5),
        S("It was so hot last month that we stopped running and just sat in the shade.",
          "先月はとても暑かったので、走るのをやめて日陰に座っていました。",
          [F("hot", "AA", ["AO", "OW"], "hot は縦に大きく。"), F("month", "AH", ["AA"], "month は小さく短く。"),
           F("stopped", "AA", ["AO", "OW"], "stop も縦に大きく。"), F("sat", "AE", ["AA", "AH"], "sat は「エ」の口で「ア」。")], 5),
        S("Could you grab a cup of hot coffee for my dad on your way back from the shop?",
          "お店からの帰りに、父に温かい珈琲を1杯買ってきてくれる？",
          [F("grab", "AE", ["AA", "AH"], "grab は「エ」の口で「ア」。"), F("cup", "AH", ["AA", "AE"], "cup は小さく短く。"),
           F("hot", "AA", ["AO", "OW"], "hot は縦に大きく。"), F("dad", "AE", ["AA", "AH"], "dad は「エ」の口で「ア」。")], 5),
    ],
    "長い文の中で、3つの「ア」を最後まで言い分ける。",
)

# ---------------------------------------------------------------- unit 5
ER = "舌先を少し持ち上げて奥へ引き、どこにも付けません。その形のまま、「ア」と「ウ」の間のこもった音を出します。"
ER2 = "舌を奥へ引いたまま、こもった音を響かせます。「アー」と伸ばしません。"
ERW = "最後の er は「アー」と伸ばさず、舌を奥へ引いて短く響かせます。"
RC = "母音のあと、舌を奥へ引いて r の響きで終わります。母音だけで止めないこと。"
unit(
    "ER の音", "bird・work・teacher の響き", "er",
    "米国英語らしさが、いちばんよく出る音のひとつです。"
    "work や bird を「アー」と伸ばして言うと、walk や bad のように聞こえることがあります。"
    "teacher の er のように、単語の最後にもよく出てきます。",
    "R と同じ舌の形で、母音を響かせます。"
    "舌先はどこにも付けずに奥へ引き、くちびるは少し丸めます。"
    "音の最初から最後まで、舌の形を変えません。",
    [
        L("強い ER", "work や bird の ER を、舌の形で響かせる。", [
            S("I prefer tea.", "紅茶のほうが好きです。", [F("prefer", "ER", ["AA", "AH"], ER)], 1),
            S("A bird is singing.", "鳥が鳴いています。", [F("bird", "ER", ["AA", "AH"], ER)], 1),
            S("It's your turn.", "あなたの番です。", [F("turn", "ER", ["AA", "AH"], ER2)], 1),
            S("I work from home.", "在宅で働いています。", [F("work", "ER", ["AA", "AO"], ER2)], 1),
            S("It's my first visit.", "今回が初めての訪問です。", [F("first", "ER", ["AA", "AH"], ER2)], 2),
            S("I want to learn more.", "もっと学びたいです。", [F("learn", "ER", ["AA", "AH"], ER2)], 2),
            S("I heard a noise.", "物音が聞こえました。", [F("heard", "ER", ["AA", "AH"], ER2)], 2),
        ]),
        L("語尾の er", "teacher の er を、伸ばさずに響かせる。", [
            S("She's a great teacher.", "彼女はとてもいい先生です。", [F("teacher", "ER", ["AA", "AH"], ERW)], 1),
            S("Dinner is ready.", "夕ごはんができました。", [F("dinner", "ER", ["AA", "AH"], ERW)], 1),
            S("I need some paper.", "紙が少し要ります。", [F("paper", "ER", ["AA", "AH"], ERW)], 1),
            S("I love the summer.", "夏が大好きです。", [F("summer", "ER", ["AA", "AH"], ERW)], 1),
            S("My sister is older than me.", "姉は私より年上です。", [F("sister", "ER", ["AA", "AH"], ERW), F("older", "ER", ["AA", "AH"], ERW)], 2),
            S("What's your phone number?", "電話番号は何ですか？", [F("number", "ER", ["AA", "AH"], ERW)], 2),
            S("See you after work.", "仕事のあとで会いましょう。", [F("after", "ER", ["AA", "AH"], ERW), F("work", "ER", ["AA", "AO"], ER2)], 2),
        ]),
        L("母音のあとの r", "car や more の最後に、r の響きを付ける。", [
            S("Where did you park the car?", "車をどこに止めましたか？", [F("park", "R", [], RC), F("car", "R", [], RC)], 2),
            S("When does the movie start?", "映画は何時に始まりますか？", [F("start", "R", [], RC)], 2),
            S("Can I have some more?", "もう少しもらえますか？", [F("more", "R", [], RC)], 1),
            S("Please close the door.", "扉を閉めてください。", [F("door", "R", [], RC)], 1),
            S("I've been here before.", "前にもここに来たことがあります。", [F("here", "R", [], RC), F("before", "R", [], RC)], 2),
            S("Your hair looks nice.", "髪、似合っていますね。", [F("hair", "R", [], RC), F("your", "R", [], RC)], 2),
            S("There are four of us.", "4人です。", [F("four", "R", [], RC), F("there", "R", [], RC)], 2),
        ]),
        L("ER と「ア」をくらべる", "ER と「ア」が両方入った文で、意味を言い分ける。", [
            S("I walk to work.", "歩いて仕事に行きます。", [F("walk", "AO", ["ER"], "walk は舌を動かさず、口を縦に開けます。"),
                                                        F("work", "ER", ["AO", "AA"], "work は舌を奥へ引いて、こもった音。")], 2, pair="work"),
            S("It hurts my heart to see that.", "それを見ると胸が痛みます。",
              [F("heart", "AA", ["ER"], "heart は口を縦に大きく開けてから r。"), F("hurts", "ER", ["AA"], "hurts は口をあまり開けず、最初から舌を奥へ。")], 3, pair="hurt"),
            S("Is it far from the first stop?", "最初の停留所から遠いですか？",
              [F("far", "AA", ["ER"], "far は大きく開けてから r。"), F("first", "ER", ["AA"], "first は最初から舌を奥へ。")], 3, pair="fur"),
            S("Don't touch it. It's hot and it will hurt.", "触らないで。熱くて痛いよ。",
              [F("hot", "AA", ["ER"], "hot は縦に大きく開けて、舌は動かしません。"), F("hurt", "ER", ["AA"], "hurt は舌を奥へ引いて。")], 3, pair="hurt"),
            S("Shut the door and change your shirt.", "扉を閉めて、上の服を着替えて。",
              [F("shut", "AH", ["ER"], "shut は短く軽い「ア」。舌は動かしません。"), F("shirt", "ER", ["AH", "AA"], "shirt は舌を奥へ引いて響かせます。")], 3, pair="shirt"),
        ]),
        L("文の中の ER", "文の中でも、ER を響かせる。", [
            S("What's your number?", "電話番号は？", [F("your", "R", [], "your の最後は舌を奥へ引いて。"), F("number", "ER", ["AA", "AH"], "number の er は伸ばさず、短く響かせます。")], 2),
            S("Dinner is at four.", "夕食は4時です。", [F("dinner", "ER", ["AA", "AH"], "dinner の er は短く響かせます。"), F("four", "R", [], "four の最後に r の響きを付けます。")], 2),
            S("Is it far from here?", "ここから遠いですか？", [F("far", "R", [], "far の最後に r の響き。"), F("here", "R", [], "here の最後も r の響き。")], 2),
            S("Her sister works in a big hospital.", "彼女の姉は大きな病院で働いています。",
              [F("her", "ER", ["AA", "AH"], "her は舌を奥へ引いて。"), F("works", "ER", ["AA", "AO"], "works も同じ舌の形で。")], 3),
            S("I learned a new word at work today.", "今日、職場で新しい単語を覚えました。",
              [F("learned", "ER", ["AA", "AH"], "learned の ear は ER の音。"), F("word", "ER", ["AA", "AO"], "word も ER の音。walk にしません。")], 3),
            S("Turn left at the corner, then go straight.", "角を左に曲がって、それからまっすぐ行ってください。",
              [F("turn", "ER", ["AA", "AH"], "turn は舌を奥へ引いて。"), F("corner", "ER", ["AA", "AH"], "corner の最後の er は短く響かせます。")], 3),
        ]),
    ],
    [
        S("My first teacher always told us to learn one new word every morning before work.",
          "最初の先生はいつも、仕事の前に毎朝ひとつ新しい単語を覚えるようにと言っていました。",
          [F("first", "ER", ["AA", "AH"], "first は舌を奥へ引いて。"), F("teacher", "ER", ["AA", "AH"], "teacher の er は短く。"),
           F("learn", "ER", ["AA", "AH"], "learn も ER。"), F("work", "ER", ["AA", "AO"], "work を walk にしません。")], 5),
        S("Her daughter works at a nursery near the river and gets home after dark.",
          "彼女の娘さんは川の近くの保育園で働いていて、暗くなってから帰ってきます。",
          [F("daughter", "ER", ["AA", "AH"], "daughter の er は短く。"), F("nursery", "ER", ["AA", "AH"], "nurse は ER の音。"),
           F("river", "ER", ["AA", "AH"], "river の er も短く響かせます。"), F("dark", "R", [], "dark は大きく開けてから r。")], 5),
        S("Are you sure the store is open? I heard it closes earlier on holidays.",
          "お店は本当に開いていますか？ 休日は早く閉まると聞きました。",
          [F("sure", "R", [], "sure の最後に r の響き。"), F("store", "R", [], "store の最後も r。"),
           F("heard", "ER", ["AA", "AH"], "heard は ER の音。"), F("earlier", "ER", ["AA", "AH"], "earlier は ER で始めます。")], 5),
    ],
    "長い文の中でも、ER と母音のあとの r を響かせる。",
)

# ---------------------------------------------------------------- unit 6
FLAP = "舌先で上の歯ぐきを、ラ行のように一回だけ軽くはじきます。強く「タ」と言わないこと。"
unit(
    "音をつなげる", "つなげる・はじく t・弱い形", "linking-flap-reduction",
    "英語を話す人は、単語を一つずつ区切らずに、つなげて話します。"
    "water の t は、日本語のラ行に近い軽い音になります。"
    "to や and は、短く弱くなります。"
    "ここが変わると、一気に自然に聞こえます。",
    "単語の最後の子音を、次の単語の最初の母音にくっつけます。"
    "母音にはさまれた t は、舌先で一回だけ軽くはじきます。"
    "to、and、of などは、力を抜いて短く言います。",
    [
        L("子音と母音をつなげる", "前の単語の最後の子音を、次の母音にくっつける。", [
            S("Come on in.", "さあ、入って。", [F("come", "M", ["EPEN"], "come の m を、そのまま on にくっつけます。")], 1),
            S("I wake up at six.", "6時に起きます。", [F("wake", "K", ["EPEN"], "wake の k を up にくっつけて、ひと続きに。")], 1),
            S("Take an umbrella.", "傘を持っていって。", [F("take", "K", ["EPEN"], "take の k を an にくっつけます。"),
                                                       F("an", "N", ["EPEN"], "an の n を umbrella の頭にくっつけます。")], 2),
            S("Please turn it off.", "それを消してください。", [F("turn", "N", ["EPEN"], "turn の n を it にくっつけます。"),
                                                            F("it", "T", ["EPEN"], "it の t は軽くはじいて off へ。")], 2),
            S("Hold on a second.", "ちょっと待って。", [F("hold", "D", ["EPEN"], "hold の d を on にくっつけます。"),
                                                     F("on", "N", ["EPEN"], "on の n も a にくっつけます。")], 2),
            S("Check it out.", "見てみて。", [F("check", "K", ["EPEN"], "check の k を it にくっつけます。"),
                                             F("it", "T", ["EPEN"], "it の t は軽くはじいて out へ。")], 2),
        ]),
        L("はじく t", "water の t を、ラ行のように軽くはじく。", [
            S("Some water, please.", "お水をください。", [F("water", "T", [], FLAP)], 1),
            S("I feel better now.", "もうよくなりました。", [F("better", "T", [], FLAP)], 1),
            S("I love this city.", "この街が大好きです。", [F("city", "T", [], "t はラ行のように軽く、強く言いません。")], 1),
            S("Are you coming to the party?", "その集まりに来ますか？", [F("party", "T", [], "r のあとの t も、ラ行のように軽くはじきます。")], 2),
            S("Just a little bit.", "ほんの少しだけ。", [F("little", "T", [], "little の t は軽くはじき、最後は舌先を付けたまま l で止めます。")], 2),
            S("Get up, it's late.", "起きて、もう遅いよ。", [F("get", "T", ["EPEN"], "get の t を up にくっつけて、軽くはじきます。")], 2),
            S("I eat a lot of fruit.", "果物をたくさん食べます。", [F("lot", "T", ["EPEN"], "lot の t を軽くはじいて of へ。of は弱く。")], 2),
        ]),
        L("弱くなる言葉", "and、of、can などを、弱く短く言う。", [
            S("This is for you.", "これ、あなたにです。", [F("for", "ER", ["AO"], "for は伸ばさず、弱く短く。")], 1),
            S("Just you and me.", "あなたと私だけ。", [F("and", "AH", ["AE"], "and は弱く短く、ほとんど「ン」だけ。")], 2),
            S("Pass the salt and pepper, please.", "塩とこしょうを取ってください。", [F("and", "AH", ["AE"], "and は弱く短く。salt と pepper を強く。")], 2),
            S("I see her from time to time.", "彼女とはときどき会います。", [F("from", "AH", ["AO", "OW"], "from は弱く短く。"),
                                                                    F("to", "AH", ["UW"], "to も弱く短く。")], 2),
            S("He's a friend of mine.", "彼は友だちです。", [F("of", "AH", ["AO", "OW"], "of は弱く短く。"),
                                                       F("of", "V", ["B", "EPEN"], "of の最後は、歯を下くちびるに軽く当てるだけ。")], 3),
            S("I can swim, but not very well.", "泳げるけど、あまり上手ではありません。", [F("can", "AH", ["AE"], "can は弱く短く。強いのは swim です。")], 2),
        ]),
        L("gonna と wanna", "くだけた会話の言い方を、まねして言う。", [
            S("I'm going to go.", "もう行きます。", [F("gonna", "AH", ["UW", "OW"], "going to は gonna と短く言います。")], 2, tts="I'm gonna go."),
            S("I want to eat.", "食べたいな。", [F("wanna", "AH", ["UW", "OW"], "want to は wanna と短く言います。")], 2, tts="I wanna eat."),
            S("Let me see.", "ええと。", [F("lemme", "M", ["EPEN"], "Let me は lemme と、t を言わずにつなげます。")], 2, tts="Lemme see."),
            S("Do you want to come?", "一緒に来る？", [F("wanna", "AH", ["UW"], "want to は wanna。do you も軽く短く。")], 3, tts="Do you wanna come?"),
            S("I've got to go.", "もう行かなきゃ。", [F("gotta", "T", ["EPEN"], "got to は gotta。t はラ行のように軽く。")], 3, tts="I've gotta go."),
            S("Give me a minute.", "ちょっと待って。", [F("gimme", "M", ["EPEN"], "Give me は gimme と、v を言わずにつなげます。")], 3, tts="Gimme a minute."),
        ]),
        L("文でつなげる", "つなげる、はじく、弱くするを、文の中でまとめて使う。", [
            S("Not at all.", "どういたしまして。", [F("not", "T", ["EPEN"], "not の t を at にくっつけ、軽くはじきます。"),
                                                  F("at", "T", ["EPEN"], "at の t も軽くはじいて all へ。")], 3),
            S("Put it on the table.", "机の上に置いてください。", [F("put", "T", ["EPEN"], "put と it をつなげ、t は軽くはじきます。"),
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
    [
        S("I'm going to get a bottle of water and a little bit of fruit after the meeting.",
          "会議のあと、水を1本と、果物を少し買ってきます。",
          [F("gonna", "AH", ["UW", "OW"], "going to は gonna。"), F("bottle", "T", [], FLAP),
           F("water", "T", [], FLAP), F("little", "T", [], FLAP)], 5,
          tts="I'm gonna get a bottle of water and a little bit of fruit after the meeting."),
        S("Do you want to come over and watch it with us, or have you got other plans?",
          "うちに来て一緒に見る？ それとも、ほかに予定がある？",
          [F("wanna", "AH", ["UW"], "want to は wanna。"), F("come", "M", ["EPEN"], "come の m を over にくっつけます。"),
           F("watch", "CH", ["EPEN"], "watch の ch を it にくっつけます。"),
           F("got", "T", ["EPEN"], "got の t を other にくっつけ、軽くはじきます。")], 5,
          tts="Do you wanna come over and watch it with us, or have you got other plans?"),
        S("Let me check it out first, and I'll get back to you in an hour or so.",
          "まず確認してみて、1時間くらいで折り返します。",
          [F("lemme", "M", ["EPEN"], "Let me は lemme。"), F("check", "K", ["EPEN"], "check it out は一続きに。"),
           F("get", "T", ["EPEN"], "get の t は小さく止めて、すぐ back へ。"),
           F("an", "N", ["EPEN"], "in an hour は、n を次の母音にくっつけます。")], 5,
          tts="Lemme check it out first, and I'll get back to you in an hour or so."),
    ],
    "長い文を、つなげる・はじく・弱くするを使って一息で言う。",
)

# ---------------------------------------------------------------- unit 7
TH = "舌先を上の前歯の先に軽く当て、そのすき間から息を通します。噛まずに、軽く触れるだけ。"
TH2 = "舌先を前歯に軽く当てて、息だけを通します。"
DH = "舌先を上の前歯の先に軽く当て、声を出しながら息を通します。"
DH2 = "舌先を前歯に軽く当てたまま、声を出します。"
SI = "歯を近づけて「スー」と細い息を出し、そのまま「イ」へ。舌先は前に保ちます。"
SH = "くちびるを前に突き出し、舌を少し奥に引いて「シュ」。"
TI = "舌先を歯ぐきの一点に当てて、はじくように離してから「イ」。舌を広く付けると「チ」になります。"
unit(
    "TH・S・SH", "舌先の位置で決まる音", "th",
    "think の th を s で言うと、sink（流し台）に聞こえます。"
    "TH は the や this のように、とてもよく使う単語に出てきます。"
    "また sea の s を「シ」で言うと、she に聞こえます。"
    "どれも、舌先の位置を少し変えるだけで直せます。",
    "TH は、舌先を上の前歯の先に軽く当てて息を通します。"
    "強く噛まなくて大丈夫です。"
    "S は歯を近づけ、舌先を前に保ったまま細い息を出します。"
    "SH は、くちびるを前に突き出して出します。",
    [
        L("息だけの TH", "舌先を歯に当てて、息だけの TH を出す。", [
            S("Thank you very much.", "どうもありがとうございます。", [F("thank", "TH", ["S"], TH)], 1),
            S("I think so, too.", "私もそう思います。", [F("think", "TH", ["S"], TH)], 1),
            S("One more thing.", "もう一つだけ。", [F("thing", "TH", ["S"], TH2)], 1),
            S("I like them both.", "どちらも好きです。", [F("both", "TH", ["S", "EPEN"], "最後は舌先を前歯に当てて、息だけで終わります。")], 2),
            S("I'll take a bath.", "お風呂に入ります。", [F("bath", "TH", ["S", "EPEN"], "最後は舌先を前歯に当てて、息だけで終わります。")], 2),
            S("There's nothing to eat.", "食べるものが何もありません。", [F("nothing", "TH", ["S"], TH2)], 2),
            S("Happy birthday to you.", "お誕生日おめでとう。", [F("birthday", "TH", ["S"], "ER のあと、舌先を前歯に当てて TH。すぐ d へ。")], 3),
        ]),
        L("声を出す TH", "the や this の TH を、声を出して言う。", [
            S("Is this yours?", "これ、あなたのですか？", [F("this", "DH", ["Z", "D"], DH)], 1),
            S("That's a good idea.", "それはいい考えですね。", [F("that's", "DH", ["Z", "D"], DH)], 1),
            S("They live nearby.", "彼らは近所に住んでいます。", [F("they", "DH", ["Z", "D"], DH2)], 1),
            S("My mother loves cooking.", "母は料理が大好きです。", [F("mother", "DH", ["Z", "D"], DH2)], 2),
            S("Try the other one.", "もう一方を試してみて。", [F("other", "DH", ["Z", "D"], DH2),
                                                         F("the", "DH", ["Z", "D"], "the も舌先を前歯に軽く当てて。")], 2),
            S("The weather is nice.", "いい天気ですね。", [F("weather", "DH", ["Z", "D"], DH2)], 2),
            S("Come with me.", "一緒に来て。", [F("with", "DH", ["Z", "EPEN"], "最後は舌先を前歯に当てたまま止めます。「ズ」にしません。")], 2),
        ]),
        L("TH と S をくらべる", "TH と S が両方入った文で、意味を言い分ける。", [
            S("I think it's in the sink.", "たぶん流し台の中だと思います。", [F("think", "TH", ["S"], "think は舌先を前歯に当てて。"),
                                                                      F("sink", "S", ["TH"], "sink は舌先を歯の内側に置いたまま。")], 2, pair="sink"),
            S("I feel sick, so I'm wearing thick socks.", "具合が悪いので、厚い靴下をはいています。",
              [F("thick", "TH", ["S"], "thick は舌先を前歯に当てて。"), F("sick", "S", ["TH", "SH"], "sick は「シ」にならないよう、細い息で。")], 3, pair="sick"),
            S("Excuse me, can I pass? This path is narrow.", "すみません、通ってもいいですか？ この道は狭いので。",
              [F("path", "TH", ["S"], "path は最後に舌先を前歯に当てます。"), F("pass", "S", ["TH"], "pass は最後まで舌を歯の内側に。")], 3, pair="pass"),
            S("The cat had a mouse in its mouth.", "猫がねずみをくわえていました。",
              [F("mouth", "TH", ["S"], "mouth は最後に舌先を前歯に当てます。"), F("mouse", "S", ["TH"], "mouse は最後まで舌を歯の内側に。")], 3, pair="mouse"),
            S("It's worse than I thought, but it's worth it.", "思ったよりひどいけど、それだけの価値はあります。",
              [F("worth", "TH", ["S"], "worth は最後に舌先を前歯に当てて息を出します。"), F("worse", "S", ["TH"], "worse は最後まで舌を歯の内側に。")], 4, pair="worse"),
            S("Sing something for us.", "何か歌ってください。", [F("sing", "S", ["TH"], "sing は舌を歯の外に出しません。"),
                                                           F("something", "TH", ["S"], "something の th は舌先を前歯に当てて。")], 2, pair="thing"),
        ]),
        L("s と t の「イ」「ウ」", "s や t を、「シ」「チ」「ツ」にしないで言う。", [
            S("Please sit down.", "座ってください。", [F("sit", "S", ["SH"], SI)], 1),
            S("She lives by the sea.", "彼女は海のそばに住んでいます。", [F("sea", "S", ["SH"], SI), F("she", "SH", ["S"], SH)], 2, pair="she"),
            S("We had a sip of tea on the ship.", "船の上で、お茶をひと口飲みました。", [F("sip", "S", ["SH"], SI), F("ship", "SH", ["S"], SH)], 3, pair="ship"),
            S("Our team won the game.", "私たちが試合に勝ちました。", [F("team", "T", ["CH"], TI)], 1),
            S("I lost my ticket.", "切符をなくしました。", [F("ticket", "T", ["CH"], TI)], 1),
            S("Two teas, please.", "紅茶を2つください。", [F("two", "T", ["S", "CH"], "舌先を歯ぐきからすばやく離し、くちびるを丸めて「ウー」。「ツ」のように息をこすりません。"),
                                                       F("teas", "T", ["CH"], TI)], 2),
            S("I listen to music.", "音楽を聴きます。", [F("music", "Z", ["JH"], "si の部分は「ジ」ではありません。舌先を歯ぐきに付けずに、声を響かせた s の音で。")], 2),
        ], feature="s-sh"),
        L("文の中の TH・S・SH", "文の中でも、舌先の位置を保つ。", [
            S("I think so.", "そう思います。", [F("think", "TH", ["S"], TH2)], 1),
            S("Thank you so much for this.", "本当にありがとう。", [F("thank", "TH", ["S"], TH2), F("this", "DH", ["Z", "D"], DH2)], 2),
            S("They're over there by the window.", "彼らは窓のそばにいます。", [F("they're", "DH", ["Z", "D"], DH2),
                                                                     F("there", "DH", ["Z", "D"], DH2)], 2),
            S("This is my seat, I think.", "ここは私の席だと思います。", [F("this", "DH", ["Z", "D"], DH2),
                                                                F("seat", "S", ["SH"], "seat の s は「シ」にしません。")], 2),
            S("Three tickets for the six o'clock show, please.", "6時の回の切符を3枚ください。",
              [F("three", "TH", ["S"], "舌先を前歯に当てて息を出し、すぐ r へ。"), F("tickets", "T", ["CH"], TI),
               F("six", "S", ["SH"], "six の s は「シ」にしません。"), F("show", "SH", ["S"], SH)], 3),
            S("Thanks for everything you did this month.", "今月はいろいろありがとう。",
              [F("thanks", "TH", ["S"], TH2), F("everything", "TH", ["S"], "thing の th も舌先を前歯に。"),
               F("month", "TH", ["S"], "month の最後も th。")], 3),
        ]),
    ],
    [
        S("I think the three of them went south together this month, but I'm not sure.",
          "あの3人は今月一緒に南へ行ったと思うけど、はっきりわかりません。",
          [F("think", "TH", ["S"], TH2), F("three", "TH", ["S"], "three は th のすぐあとに r。"),
           F("south", "TH", ["S"], "south の最後は th。"), F("together", "DH", ["Z", "D"], DH2)], 5),
        S("She sat in the sixth seat, sipping tea and listening to the music from the ship.",
          "彼女は6番目の席に座って、お茶を少しずつ飲みながら、船から流れる音楽を聴いていました。",
          [F("she", "SH", ["S"], SH), F("sixth", "TH", ["S"], "sixth の最後は ks のあとに th。"),
           F("seat", "S", ["SH"], "seat の s は「シ」にしません。"), F("ship", "SH", ["S"], SH)], 5),
        S("Thanks for the birthday gift; it's the nicest thing anyone has given me this year.",
          "誕生日の贈り物をありがとう。今年いちばんうれしいものです。",
          [F("thanks", "TH", ["S"], TH2), F("birthday", "TH", ["S"], "birth の th も舌先を前歯に。"),
           F("thing", "TH", ["S"], TH2), F("this", "DH", ["Z", "D"], DH2)], 5),
    ],
    "長い文の中で、舌先の位置を最後まで保つ。",
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
    "very の v を「ブ」で言うと、berry（小さな果実）に聞こえます。"
    "「フ」につられて、who や woman も崩れやすくなります。",
    "上の前歯を、下くちびるの内側に軽く乗せます。"
    "そのすき間から息だけを出すと F、声を出すと V です。"
    "who は、くちびるをこすらずに、のどから息を出します。"
    "woman は、くちびるを小さくすぼめてから始めます。",
    [
        L("V の音", "歯を下くちびるに当てて、V を出す。", [
            S("It's very good.", "とてもいいです。", [F("very", "V", ["B"], V)], 1),
            S("You have a nice voice.", "いい声ですね。", [F("voice", "V", ["B"], V), F("have", "V", ["B", "EPEN"], "have の v も歯を下くちびるに。")], 1),
            S("Please visit us again.", "また遊びに来てください。", [F("visit", "V", ["B"], V2)], 1),
            S("The game is over.", "試合は終わりました。", [F("over", "V", ["B"], V2)], 1),
            S("I'm here every day.", "毎日ここにいます。", [F("every", "V", ["B"], V2)], 1),
            S("I love it here.", "ここがとても気に入っています。", [F("love", "V", ["B", "EPEN"], "love の v は、歯を下くちびるに当てたまま it へつなげます。")], 2),
            S("Give me five minutes.", "5分ください。", [F("give", "V", ["B", "EPEN"], "give の v は止めずに、そのまま me へ。"),
                                                       F("five", "V", ["B", "EPEN"], "five の最後も v。歯を下くちびるに。")], 2),
        ]),
        L("V と B をくらべる", "V と B が両方入った文で、くちびると歯を使い分ける。", [
            S("Be very careful.", "十分に気をつけてください。", [F("very", "V", ["B"], "very は歯を下くちびるに当てて。"),
                                                            F("be", "B", ["V"], "be は両方のくちびるを閉じてから。")], 2, pair="berry"),
            S("We both voted for him.", "私たちは二人とも彼に投票しました。", [F("voted", "V", ["B"], "voted は歯を下くちびるに当てて。"),
                                                                      F("both", "B", ["V"], "both はくちびるを閉じてから。")], 2),
            S("I bought a van.", "箱型の車を買いました。", [F("van", "V", ["B"], "van は歯を下くちびるに当てて。"),
                                                       F("bought", "B", ["V"], "bought はくちびるを閉じてから。")], 2, pair="ban"),
            S("My vet is the best.", "うちの動物病院の先生はとてもいいです。", [F("vet", "V", ["B"], "vet は歯を下くちびるに当てて。"),
                                                                       F("best", "B", ["V"], "best はくちびるを閉じてから。")], 2, pair="bet"),
            S("I've been busy.", "ずっと忙しかったです。", [F("i've", "V", ["B", "EPEN"], "I've の v は歯を下くちびるに軽く当てるだけ。"),
                                                      F("been", "B", ["V"], "been はくちびるを閉じてから。")], 2),
            S("Slow down before the curve.", "曲がり道の手前で、速度を落としてください。",
              [F("curve", "V", ["B", "EPEN"], "curve の最後は、歯を下くちびるに当てて止めます。"),
               F("before", "B", ["V"], "before はくちびるを閉じてから。")], 3, pair="curb"),
        ]),
        L("F の音", "歯を下くちびるに当てて、F を出す。", [
            S("I'm fine, thank you.", "元気です、ありがとう。", [F("fine", "F", ["HH"], FF)], 1),
            S("Can I use your phone?", "電話を借りてもいいですか？", [F("phone", "F", ["HH"], FF)], 1),
            S("The food here is great.", "ここの料理はおいしいです。", [F("food", "F", ["HH"], "歯を下くちびるに当てて息を出してから「ウー」。")], 2),
            S("It was a lot of fun.", "とても楽しかったです。", [F("fun", "F", ["HH"], FF2)], 1),
            S("I'd like a coffee, please.", "珈琲をください。", [F("coffee", "F", ["HH"], "co のあと、歯を下くちびるに当てて f。のどから息を出す音にしません。")], 2),
            S("I eat fresh fruit for breakfast.", "朝ごはんに新鮮な果物を食べます。", [F("fresh", "F", ["HH"], FF2),
                                                                        F("fruit", "F", ["HH"], "歯を下くちびるに当てて息を出し、すぐ r へ。")], 2),
            S("Turn off your phone, please.", "電話の電源を切ってください。", [F("off", "F", ["HH", "EPEN"], "off の最後は、歯を下くちびるに当てて息だけで。"),
                                                                    F("phone", "F", ["HH"], FF2)], 2),
        ], feature="f-h"),
        L("F・H・W", "「フ」につられずに、F、H、W を言い分ける。", [
            S("Hold it, then fold it in half.", "持ったまま、半分に折ってください。", [F("hold", "HH", ["F"], "hold はくちびるを使わず、のどから息を出します。"),
                                                                          F("fold", "F", ["HH"], "fold は歯を下くちびるに当てて。")], 3, pair="fold"),
            S("My heel hurts, but I feel fine.", "かかとが痛いけど、気分は大丈夫です。", [F("heel", "HH", ["F"], "heel はのどから息を出します。"),
                                                                             F("feel", "F", ["HH"], "feel は歯を下くちびるに当てて。")], 3, pair="feel"),
            S("Who is it?", "どちらさまですか？", [F("who", "HH", ["F"], HU)], 1),
            S("Whose is this?", "これはだれのですか？", [F("whose", "HH", ["F"], HU)], 1),
            S("That woman is my boss.", "あの女性は私の上司です。", [F("woman", "W", [], WU)], 2),
            S("Would you like some?", "少しいかがですか？", [F("would", "W", [], WU)], 2),
            S("I found a hat in the woods.", "林の中で帽子を見つけました。", [F("hat", "HH", ["F"], "hat はのどから息を出します。"),
                                                                    F("found", "F", ["HH"], FF2), F("woods", "W", [], WU)], 3, pair="fat"),
        ], feature="f-h"),
        L("文の中の V・F・H・W", "文の中でも、歯とくちびるを使い分ける。", [
            S("It's very good for you.", "体にとてもいいですよ。", [F("very", "V", ["B"], V2), F("for", "F", ["HH"], FF2)], 1),
            S("I feel fine, but I have a fever.", "気分は大丈夫だけど、熱があります。",
              [F("feel", "F", ["HH"], FF2), F("fever", "V", ["B"], "fever の v は歯を下くちびるに当てて、声を出します。"),
               F("have", "V", ["B", "EPEN"], "have の v も同じです。")], 3),
            S("I love my family very much.", "家族をとても大切に思っています。",
              [F("love", "V", ["B", "EPEN"], "love の v は、歯を下くちびるに当てたまま次へ。"), F("family", "F", ["HH"], FF2), F("very", "V", ["B"], V2)], 2),
            S("Can I have five of these?", "これを5つもらえますか？", [F("have", "V", ["B", "EPEN"], "have の v は、歯を下くちびるに軽く当てるだけ。"),
                                                               F("five", "F", ["HH"], "five の f は息だけ。最後の v は声を出します。")], 2),
            S("Five or seven? I forgot.", "5だっけ、7だっけ？ 忘れちゃいました。",
              [F("five", "V", ["B", "EPEN"], "five の最後は v。歯を下くちびるに当てて。"), F("seven", "V", ["B"], "seven の v も歯を下くちびるに当てて。"),
               F("forgot", "F", ["HH"], FF2)], 2),
            S("Who would like to go first?", "最初に行きたい人はいますか？", [F("who", "HH", ["F"], HU), F("would", "W", [], WU), F("first", "F", ["HH"], FF2)], 2),
        ]),
    ],
    [
        S("We have five very good reasons to move, but my wife would rather stay where we are.",
          "引っ越す理由は5つもあるけど、妻は今のところにいたいと言っています。",
          [F("five", "V", ["B", "EPEN"], "five の v は、歯を下くちびるに当てたまま very へ。"), F("very", "V", ["B"], V2),
           F("move", "V", ["B", "EPEN"], "move の最後も v。"), F("wife", "F", ["HH"], FF2), F("would", "W", [], WU)], 5),
        S("Who wants coffee? I've got fresh fruit and hot water for tea, too.",
          "珈琲がほしい人はいますか？ 新鮮な果物と、お茶用のお湯もありますよ。",
          [F("who", "HH", ["F"], HU), F("coffee", "F", ["HH"], FF2), F("fresh", "F", ["HH"], FF2), F("fruit", "F", ["HH"], FF2)], 4),
        S("The woman at the front desk was very helpful when I left my forms at home.",
          "書類を家に忘れたとき、受付の女性がとても親切に助けてくれました。",
          [F("woman", "W", [], WU), F("front", "F", ["HH"], FF2), F("very", "V", ["B"], V2),
           F("helpful", "F", ["HH"], "helpful の f も歯を下くちびるに。")], 5),
    ],
    "長い文の中で、V・F・H・W を最後まで使い分ける。",
)

# ---------------------------------------------------------------- unit 9
IH = "口の力を抜いた、短くゆるい「イ」。少し「エ」に近い音です。"
IY = "口を横にしっかり引いて、はっきり長い「イー」。"
UH = "くちびるは軽く丸めるだけの、短くゆるい「ウ」。"
UW = "くちびるを小さく丸めて前に突き出す、長い「ウー」。"
EY = "「エー」と伸ばさず、「エイ」と最後に口を閉じていきます。"
OW = "「オー」と伸ばさず、「オウ」と最後にくちびるをすぼめます。"
unit(
    "長い音と短い音", "ship と sheep、full と fool", "vowels-tense-lax",
    "日本語の「イ」と「イー」は、長さだけの違いです。"
    "英語の ship と sheep は、長さだけでなく、口の形も違います。"
    "また make や go は、英語では「エイ」「オウ」と、口が動く音です。",
    "短い方は、口の力を抜いて、少しゆるく言います。"
    "長い方は、口を横にしっかり引くか、くちびるを丸めて突き出します。"
    "「エイ」「オウ」は、最後まで口を動かします。",
    [
        L("イとイー", "ɪ と iː が両方入った文で、口の形を言い分ける。", [
            S("Eat it while it's hot.", "温かいうちに食べてください。", [F("eat", "IY", ["IH"], IY), F("it", "IH", ["IY"], IH)], 1, pair="it"),
            S("Sit in this seat.", "この席に座ってください。", [F("sit", "IH", ["IY"], IH), F("seat", "IY", ["IH"], IY)], 1, pair="seat"),
            S("He's in his room.", "彼は自分の部屋にいます。", [F("he's", "IY", ["IH"], IY), F("his", "IH", ["IY"], IH)], 2, pair="his"),
            S("Turn up the heat a bit.", "暖房を少し強くしてください。", [F("heat", "IY", ["IH"], IY), F("bit", "IH", ["IY"], IH)], 2, pair="hit"),
            S("This is a cheap trip.", "これは安い旅行です。", [F("cheap", "IY", ["IH"], IY), F("trip", "IH", ["IY"], IH)], 2, pair="chip"),
            S("I'll leave in a minute.", "すぐに出ます。", [F("leave", "IY", ["IH"], IY), F("minute", "IH", ["IY"], IH)], 2, pair="live"),
            S("Please fill in this form.", "この用紙に記入してください。", [F("fill", "IH", ["IY"], IH), F("please", "IY", ["IH"], IY)], 2, pair="feel"),
        ]),
        L("ウとウー", "ʊ と uː を、口の形で言い分ける。", [
            S("Don't be a fool.", "ばかなことはしないで。", [F("fool", "UW", ["UH"], UW)], 1, pair="full"),
            S("Push or pull?", "押すの？ 引くの？", [F("pull", "UH", ["UW"], UH), F("push", "UH", ["UW"], UH)], 1, pair="pool"),
            S("Look at the moon.", "月を見て。", [F("look", "UH", ["UW"], UH), F("moon", "UW", ["UH"], UW)], 1),
            S("I cook food every day.", "毎日料理をします。", [F("cook", "UH", ["UW"], UH), F("food", "UW", ["UH"], UW)], 2),
            S("You should come too.", "あなたも来るべきですよ。", [F("should", "UH", ["UW"], UH), F("too", "UW", ["UH"], UW)], 2),
            S("See you soon.", "またね。", [F("soon", "UW", ["UH"], UW)], 1),
            S("Choose a good book.", "いい本を選んでください。", [F("choose", "UW", ["UH"], UW), F("good", "UH", ["UW"], UH), F("book", "UH", ["UW"], UH)], 2),
        ]),
        L("エイとオウ", "「エー」「オー」と伸ばさずに、口を動かす。", [
            S("I'll make some tea.", "お茶を入れます。", [F("make", "EY", ["EH"], EY)], 1),
            S("I have to go now.", "もう行かなくちゃ。", [F("go", "OW", ["AO"], OW)], 1),
            S("Let's go home.", "家に帰ろう。", [F("go", "OW", ["AO"], OW), F("home", "OW", ["AO"], OW)], 1),
            S("Is that okay with you?", "それで大丈夫ですか？", [F("okay", "OW", ["AO"], OW), F("okay", "EY", ["EH"], EY)], 2),
            S("I don't know.", "わかりません。", [F("don't", "OW", ["AO"], "o で「オウ」と口を動かします。"), F("know", "OW", ["AO"], OW)], 2),
            S("Wait, the floor is wet.", "待って、床がぬれていますよ。", [F("wait", "EY", ["EH"], "wait は「エイ」と口を動かします。"),
                                                                F("wet", "EH", ["EY"], "wet は短い「エ」で止めます。")], 2, pair="wet"),
            S("I called to say it's cold outside.", "外は寒いよと伝えようと電話しました。",
              [F("called", "AO", ["OW"], "called は口を縦に開けた「オー」のまま。"), F("cold", "OW", ["AO"], "cold は「オウ」と、くちびるをすぼめていきます。")], 3, pair="cold"),
        ]),
        L("文の中の長い音・短い音", "文の中でも、長い音と短い音を言い分ける。", [
            S("Where do you live now?", "今はどこに住んでいますか？", [F("live", "IH", ["IY"], "live は短くゆるい「イ」。leave にしません。")], 2),
            S("Is this seat free?", "この席は空いていますか？", [F("seat", "IY", ["IH"], IY), F("free", "IY", ["IH"], IY)], 2),
            S("It's a good book.", "いい本です。", [F("good", "UH", ["UW"], UH), F("book", "UH", ["UW"], UH)], 2),
            S("I don't know where she lives.", "彼女がどこに住んでいるか知りません。", [F("know", "OW", ["AO"], OW), F("lives", "IH", ["IY"], IH)], 2),
            S("Let's go home before it rains.", "雨が降る前に家に帰ろう。", [F("home", "OW", ["AO"], OW), F("rains", "EY", ["EH"], EY)], 2),
            S("The room was full of people.", "部屋は人でいっぱいでした。", [F("room", "UW", ["UH"], UW), F("full", "UH", ["UW"], UH),
                                                                 F("people", "IY", ["IH"], IY)], 3),
            S("Please wait a minute; I'll be right back.", "少し待ってください。すぐ戻ります。",
              [F("please", "IY", ["IH"], IY), F("wait", "EY", ["EH"], EY), F("minute", "IH", ["IY"], IH)], 3),
        ]),
    ],
    [
        S("We'll leave at eight, so please eat a big breakfast and bring a book for the trip.",
          "8時に出るから、朝ごはんをしっかり食べて、移動中に読む本を持ってきてね。",
          [F("leave", "IY", ["IH"], IY), F("eight", "EY", ["EH"], EY), F("big", "IH", ["IY"], IH), F("book", "UH", ["UW"], UH)], 5),
        S("I don't know who took my seat, but I'd rather stand than make a scene.",
          "だれが私の席に座ったのか知らないけど、もめるくらいなら立っています。",
          [F("know", "OW", ["AO"], OW), F("who", "UW", ["UH"], UW), F("took", "UH", ["UW"], UH), F("seat", "IY", ["IH"], IY)], 5),
        S("Could you show me how to cook this fish? I'd like to make it at home.",
          "この魚の料理の仕方を教えてもらえますか？ 家で作ってみたいんです。",
          [F("could", "UH", ["UW"], UH), F("show", "OW", ["AO"], OW), F("cook", "UH", ["UW"], UH), F("make", "EY", ["EH"], EY)], 5),
    ],
    "長い文の中で、長い音・短い音・動く音を言い分ける。",
)

# ---------------------------------------------------------------- unit 10
unit(
    "声の上がり下がり", "高さの幅・強調・上げ下げ", "intonation",
    "日本語で話す英語は、声の高さの幅がせまく、平らに聞こえがちです。"
    "英語では、いちばん伝えたい単語で、声が大きく上がって下がります。"
    "気持ちや意味も、この動きで伝わります。",
    "お手本の声の高さの線を、なぞるように言います。"
    "少し大げさかなと思うくらいで、ちょうど自然に聞こえます。"
    "最初は短い文で、高さの幅を広げます。",
    [
        L("高さの幅を広げる", "声の高さを大きく動かして、気持ちを伝える。", [
            S("Oh, really? That's great!", "へえ、本当？ よかったですね！", [F("really", "IH", [], "really で声を大きく上げます。"),
                                                                    F("great", "EY", [], "great は高いところから一気に下げます。")], 1),
            S("That sounds great!", "いいですね！", [F("great", "EY", [], "great で一番高くして、そこから下げます。")], 1),
            S("No problem at all.", "全然大丈夫ですよ。", [F("problem", "AA", [], "pro で高く上げて、そこから下げます。")], 1),
            S("Wow, that's amazing!", "わあ、すごい！", [F("amazing", "EY", [], "ma で大きく上げて、一気に下げます。")], 2),
            S("Thank you so much!", "本当にありがとう！", [F("much", "AH", [], "much で一番高くして、気持ちをこめて下げます。")], 2),
            S("Nice to meet you, too.", "こちらこそ、よろしくお願いします。", [F("too", "UW", [], "最後の too を一番高くして下げます。")], 2),
        ]),
        L("いちばん大事な単語", "伝えたい単語を、高く強く目立たせる。", [
            S("Where are you from?", "出身はどこですか？", [F("from", "AH", [], "この文では from が一番高くなります。where は低めに。")], 2),
            S("What do you do?", "お仕事は何ですか？", [F("do", "UW", [], "最後の do を高くして、そこから下げます。")], 2),
            S("Which one? The red one.", "どれ？ 赤いの。", [F("red", "EH", [], "答えの red だけを高く強く。one は低く。")], 3),
            S("It's my turn, not yours.", "あなたではなく、私の番です。", [F("my", "AY", [], "my と yours を高く目立たせます。"),
                                                                F("yours", "R", [], "yours で下げて終わります。")], 3),
            S("I said coffee, not tea.", "紅茶ではなく、珈琲と言ったんです。", [F("coffee", "AA", [], "coffee と tea を高く強く。ほかは低く軽く。")], 3),
            S("I'm not tired, I'm hungry.", "疲れたのではなく、おなかがすいたんです。", [F("tired", "AY", [], "tired で少し上げます。"),
                                                                             F("hungry", "AH", [], "hungry を一番高くして下げます。")], 3),
        ]),
        L("質問の上げ下げ", "はい・いいえで答える質問は上げ、what や where の質問は下げる。", [
            S("Are you ready?", "準備できた？", [F("ready", "EH", [], "最後の ready で声を上げます。")], 1),
            S("Do you like it?", "気に入った？", [F("like", "AY", [], "like から声を上げていきます。")], 1),
            S("Is this your first time?", "初めてですか？", [F("first", "ER", [], "first time に向けて声を上げていきます。")], 2),
            S("Where do you work?", "どこで働いていますか？", [F("work", "ER", [], "where の質問は、最後の work で下げます。")], 2),
            S("What would you like?", "何にしますか？", [F("like", "AY", [], "like で高くしてから下げます。上げないこと。")], 2),
            S("How was your weekend?", "週末はどうでしたか？", [F("weekend", "IY", [], "week で高くして、そこから下げます。")], 2),
            S("Coffee or tea?", "珈琲と紅茶、どちらにしますか？", [F("coffee", "AA", [], "coffee で上げて、tea で下げます。")], 2),
        ]),
        L("区切りとまとまり", "長い文を区切りながら、声の上がり下がりをつける。", [
            S("Sorry, I didn't catch that.", "すみません、聞き取れませんでした。", [F("catch", "AE", [], "catch を高く強くして、そこから下げます。")], 3),
            S("Could you say that again, please?", "もう一度言ってもらえますか？", [F("again", "EH", [], "again を高くします。please は軽く。")], 3),
            S("I'm not sure, but I think so.", "よくわからないけど、そうだと思います。", [F("sure", "R", [], "sure で少し上げて、ひと区切り。"),
                                                                                F("think", "IH", [], "後半は think を高くして下げます。")], 4),
            S("If you have time, let's get lunch.", "時間があれば、お昼を食べに行こう。", [F("time", "AY", [], "time で少し上げて、ひと区切り。"),
                                                                                F("lunch", "AH", [], "最後の lunch で下げます。")], 4),
            S("When I got home, I was really tired.", "家に帰ったら、すごく疲れていました。", [F("home", "OW", [], "home で少し上げて区切ります。"),
                                                                                    F("tired", "AY", [], "最後の tired で下げます。")], 5),
            S("I'd like rice, some fish, and a glass of water.", "ごはんと魚と、水を1杯ください。",
              [F("rice", "AY", [], "並べるときは、rice と fish で上げます。"), F("water", "AO", [], "最後の water で下げて終わります。")], 5),
        ]),
    ],
    [
        S("Are you free this weekend? If you are, we could go hiking, or just have lunch somewhere.",
          "今週末は空いていますか？ もしよければ、山歩きに行くか、どこかでお昼を食べませんか？",
          [F("free", "IY", [], "free で声を上げて質問にします。"), F("are", "AA", [], "If you are で少し上げて区切ります。"),
           F("hiking", "AY", [], "or の前の hiking は上げます。"), F("somewhere", "AH", [], "最後の somewhere で下げます。")], 5),
        S("I didn't say she took the money; I said she counted it twice before lunch.",
          "彼女がお金を取ったとは言っていません。お昼の前に2回数えたと言ったんです。",
          [F("took", "UH", [], "took を高く強く目立たせます。"), F("counted", "AW", [], "後半は counted を一番高くします。"),
           F("twice", "AY", [], "twice も少し目立たせます。")], 5),
        S("When you get to the station, call me, and I'll come and pick you up by car.",
          "駅に着いたら電話してください。車で迎えに行きます。",
          [F("station", "EY", [], "station で少し上げて区切ります。"), F("call", "AO", [], "call me で区切ります。"),
           F("car", "AA", [], "最後の car で下げて終わります。")], 5),
    ],
    "長い文で、区切り・強調・上げ下げをまとめて使う。",
)
