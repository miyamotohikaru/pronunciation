#!/usr/bin/env python3
"""Assemble content/challenge.json: long sentences, self-introductions, dialogues.

  python3 content/build_challenge.py && python3 content/check_cmudict.py

Every line: id, text, ja, focus (word, phone, watch_for, tip_ja, ipa),
difficulty, optional tts_text. Dialogues alternate partner / you; only
`you` lines are scored (partner focus = what to listen for).
Same rules as the curriculum: CMUdict words, no katakana readings,
"\n" after 、。 in Japanese. Saved after each section.
"""
import json
import re
from pathlib import Path

import ipa

OUT = Path(__file__).resolve().parent / "challenge.json"
DATA = {"version": 1, "long": [], "intro": [], "dialogues": []}


def j(s):
    return re.sub(r"([、。])(?!$|\n|[」』）)])", r"\1\n", s.strip())


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


def line(lid, text, ja, focus, d, tts=None, **extra):
    it = {"id": lid, "text": text, "ja": j(ja)}
    if tts:
        it["tts_text"] = tts
    it.update(extra)
    it["focus"] = focus
    it["difficulty"] = d
    return it


def save():
    OUT.write_text(json.dumps(DATA, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- long
LONG = [
    ("I usually take the train to work, but today I walked because the weather was nice.",
     "いつもは電車で通勤していますが、今日は天気がよかったので歩きました。",
     [F("usually", "ZH", ["JH"], "usu の s は、声を出した「シュ」。舌をどこにも付けません。"), F("train", "R", ["L"], "t のすぐあとに、舌を付けない r。"),
      F("walked", "T", ["EPEN"], "walked の最後は小さな t だけ。"), F("weather", "DH", ["Z", "D"], "舌先を前歯に軽く当てたまま声を出します。")], 3),
    ("Could you tell me how long it takes to get to the station from here?",
     "ここから駅まで、どのくらいかかるか教えてもらえますか？",
     [F("tell", "L", ["R"], "tell の l は舌先を前歯の付け根に。"), F("long", "NG", ["EPEN"], "long は舌の奥で止めます。"),
      F("get", "T", ["EPEN"], "get to は t を一つにつなげます。"), F("here", "R", [], "here の最後に r の響き。")], 3),
    ("We're having a small party this weekend, and we'd love it if you could come.",
     "今週末に小さな集まりを開くので、来てもらえたらうれしいです。",
     [F("party", "T", [], "party の t はラ行のように軽く。"), F("this", "DH", ["Z", "D"], "this は舌先を前歯に。"),
      F("love", "V", ["B", "EPEN"], "love の v は歯を下くちびるに当てたまま it へ。"), F("could", "UH", ["UW"], "could は短くゆるい「ウ」。")], 3),
    ("I'm sorry I'm late; the traffic was terrible and I couldn't find a place to park.",
     "遅れてすみません。渋滞がひどくて、車を止める場所が見つかりませんでした。",
     [F("sorry", "R", ["L"], "sorry の r は舌を付けずに。"), F("late", "L", ["R"], "late は舌先を付けて。"),
      F("traffic", "R", ["L"], "traffic の r も舌を付けずに。"), F("place", "L", ["R"], "p のすぐあとに、舌先を付けて l。")], 3),
    ("Thank you for your help this week; I really couldn't have finished it without you.",
     "今週は手伝ってくれてありがとう。あなたがいなかったら、本当に終わらせられませんでした。",
     [F("thank", "TH", ["S"], "舌先を前歯に軽く当てて、息だけ。"), F("help", "L", ["EPEN"], "help の l のあとに母音を入れず、すぐ p へ。"),
      F("really", "R", ["L"], "really は R、L の順です。"), F("finished", "F", ["HH"], "finished は歯を下くちびるに当てて。")], 3),
    ("My brother lives in a big city, but he visits our parents every summer.",
     "兄は大都市に住んでいますが、毎年夏には両親に会いに来ます。",
     [F("brother", "DH", ["Z", "D"], "brother の th は声を出す th。"), F("city", "T", [], "city の t は軽くはじきます。"),
      F("visits", "V", ["B"], "visits は歯を下くちびるに当てて。"), F("summer", "ER", ["AA", "AH"], "summer の er は短く響かせます。")], 4),
    ("If it rains tomorrow, we'll stay home and watch a movie instead of going to the beach.",
     "明日雨が降ったら、海に行くのはやめて、家で映画を見ます。",
     [F("rains", "EY", ["EH"], "rains は「エイ」と口を動かします。"), F("home", "OW", ["AO"], "home は「オウ」と最後にすぼめます。"),
      F("movie", "V", ["B"], "movie の v は歯を下くちびるに。"), F("beach", "IY", ["IH"], "beach は口を横に引いた長い「イー」。")], 4),
    ("The doctor said I should get more sleep and drink less coffee during the week.",
     "医者に、平日はもっと睡眠をとって、珈琲を減らすように言われました。",
     [F("doctor", "AA", ["AO", "OW"], "doc は縦に大きく開けて。"), F("should", "UH", ["UW"], "should は短くゆるい「ウ」。"),
      F("sleep", "S", ["EPEN"], "sl を母音なしで。"), F("coffee", "F", ["HH"], "coffee の f は歯を下くちびるに。")], 4),
    ("I've been learning English for three years, and I still find the pronunciation hard.",
     "英語を3年間勉強していますが、まだ発音が難しいと感じます。",
     [F("learning", "ER", ["AA", "AH"], "learn は ER の音。"), F("three", "TH", ["S"], "three は th のすぐあとに r。"),
      F("years", "Y", [], "years は「イ」の前に、舌を上あごに近づけた y を入れます。"), F("still", "L", ["EPEN"], "still の最後は舌先を付けて止めます。")], 4),
    ("Let's meet in front of the bookstore at a quarter to seven, and then grab dinner.",
     "7時15分前に本屋の前で会って、それから夕食にしましょう。",
     [F("front", "F", ["HH"], "front は歯を下くちびるに当ててから r。"), F("bookstore", "UH", ["UW"], "book は短くゆるい「ウ」。"),
      F("quarter", "T", [], "quarter の t は軽くはじきます。"), F("grab", "AE", ["AA", "AH"], "grab は「エ」の口で「ア」。")], 4),
    ("Would you mind turning the music down a little? I'm trying to finish this report.",
     "音楽を少し小さくしてもらえますか？ この報告書を仕上げようとしているんです。",
     [F("would", "W", [], "would はくちびるをすぼめてから。"), F("turning", "ER", ["AA", "AH"], "turn は ER の音。"),
      F("music", "Z", ["JH"], "music の s は声を出す s。「ジ」にしません。"), F("little", "T", [], "little の t は軽くはじきます。")], 4),
    ("She asked whether we wanted to sit outside, but it was a little too cold for that.",
     "外の席がいいか聞かれましたが、それには少し寒すぎました。",
     [F("she", "SH", ["S"], "she はくちびるを突き出して。"), F("asked", "T", ["EPEN"], "asked は skt を母音なしで。"),
      F("sit", "S", ["SH"], "sit の s は「シ」にしません。"), F("cold", "OW", ["AO"], "cold は「オウ」と動かします。")], 4),
    ("Honestly, I thought the first half of the movie was boring, but the ending was wonderful.",
     "正直、映画の前半は退屈だと思いましたが、結末はすばらしかったです。",
     [F("thought", "TH", ["S"], "thought は舌先を前歯に当てて息だけ。"), F("first", "ER", ["AA", "AH"], "first は ER の音。"),
      F("half", "F", ["HH", "EPEN"], "half の最後は歯を下くちびるに当てて息だけ。"), F("wonderful", "W", [], "wonderful はくちびるをすぼめてから。")], 5),
    ("We should probably leave a little earlier than usual, because the roads get crowded around five.",
     "5時ごろは道が混むので、いつもより少し早めに出たほうがよさそうです。",
     [F("probably", "R", ["L"], "probably は r、l の順です。"), F("earlier", "ER", ["AA", "AH"], "earlier は ER で始めます。"),
      F("usual", "ZH", ["JH"], "usual の s は声を出した「シュ」。"), F("crowded", "R", ["L"], "k のすぐあとに、舌を付けない r。")], 5),
    ("I wasn't sure which train to take, so I asked a woman at the ticket gate for help.",
     "どの電車に乗ればいいかわからなかったので、改札の女性に助けを求めました。",
     [F("sure", "SH", ["S"], "sure はくちびるを突き出した sh。"), F("train", "R", ["L"], "train の r は舌を付けずに。"),
      F("woman", "W", [], "woman はくちびるをすぼめてから。"), F("ticket", "T", ["CH"], "ticket は「チ」にしません。")], 5),
    ("There are three things I always check before a big meeting: the time, the room, and the slides.",
     "大事な会議の前に、必ず確かめることが3つあります。時間と、部屋と、資料です。",
     [F("three", "TH", ["S"], "three は舌先を前歯に当ててから r。"), F("things", "TH", ["S"], "things も th。"),
      F("room", "R", ["L"], "room の r は舌を付けずに。"), F("slides", "L", ["R"], "slides は並べる最後なので下げて終わります。")], 5),
    ("Thanks to everyone who worked so hard this year; we couldn't have reached our goal without you.",
     "今年がんばってくれた皆さん、ありがとうございます。皆さんがいなければ、目標には届きませんでした。",
     [F("thanks", "TH", ["S"], "thanks は舌先を前歯に当てて。"), F("worked", "ER", ["AA", "AO"], "worked は ER の音。walked にしません。"),
      F("year", "Y", [], "year は y から始めます。ear にしません。"), F("goal", "L", ["EPEN"], "goal の最後は舌先を付けて止めます。")], 5),
    ("If I had known the store closed at nine, I would have gone there right after work.",
     "お店が9時に閉まると知っていたら、仕事のあとすぐに行ったのに。",
     [F("known", "OW", ["AO"], "known は「オウ」と動かします。"), F("closed", "Z", ["EPEN"], "closed の最後は zd を母音なしで。"),
      F("would", "W", [], "would はくちびるをすぼめてから。"), F("right", "R", ["L"], "right の r は舌を付けずに。")], 5),
    ("I'd like to change my reservation from the twelfth to the fifteenth, if there's still a room available.",
     "まだ部屋が空いていれば、予約を12日から15日に変更したいのですが。",
     [F("twelfth", "TH", ["S", "EPEN"], "twelfth は lfth を母音なしで。最後は舌先を前歯に。"), F("fifteenth", "TH", ["S"], "fifteenth の最後も th。"),
      F("there's", "DH", ["Z", "D"], "there's は舌先を前歯に軽く当てて。"), F("available", "V", ["B"], "available の v は歯を下くちびるに。")], 5),
    ("Whether you're working from home or at the office, try to stand up, stretch, and walk around every hour.",
     "在宅でも職場でも、1時間ごとに立ち上がって、体を伸ばして、少し歩きましょう。",
     [F("whether", "DH", ["Z", "D"], "whether の th は声を出す th。"), F("working", "ER", ["AA", "AO"], "work は ER の音。"),
      F("office", "F", ["HH"], "office の f は歯を下くちびるに。"), F("stretch", "S", ["EPEN"], "str を一息で。")], 5),
]
for i, (t, ja, fo, d) in enumerate(LONG, 1):
    DATA["long"].append(line(f"long-{i:02d}", t, ja, fo, d))
save()

# ---------------------------------------------------------------- intro
SW_NAME = {"word": "Ken", "note_ja": "自分の名前に変えます。"}


def intro(iid, title, situation, note, lines):
    DATA["intro"].append({"id": iid, "title_ja": j(title), "situation_ja": j(situation), "note_ja": j(note),
                          "lines": [line(f"{iid}-{k:02d}", *ln[:4], **(ln[4] if len(ln) > 4 else {}))
                                    for k, ln in enumerate(lines, 1)]})
    save()


intro("intro-1", "はじめて会う人に", "初対面のあいさつで、名前、出身、仕事、趣味を伝えます。",
      "Ken は自分の名前に、Osaka と Tokyo は自分の出身地と住んでいる町に、仕事と趣味の部分も自分のことに変えて使えます。", [
          ("Hi, I'm Ken. It's nice to meet you.", "こんにちは、Ken です。はじめまして。",
           [F("nice", "AY", [], "nice と meet を強く、to は弱く。"), F("meet", "IY", ["IH"], "meet は長い「イー」。")], 1, {"swap": [SW_NAME]}),
          ("I'm from Osaka, but I live in Tokyo now.", "出身は大阪ですが、今は東京に住んでいます。",
           [F("from", "AH", ["AO"], "from は弱く短く。"), F("live", "IH", ["IY"], "live は短くゆるい「イ」。leave にしません。")], 2,
           {"swap": [{"word": "Osaka", "note_ja": "出身地に変えます。"}, {"word": "Tokyo", "note_ja": "住んでいる町に変えます。"}]}),
          ("I work for a small company that makes kitchen tools.", "台所用品を作る小さな会社で働いています。",
           [F("work", "ER", ["AA", "AO"], "work は ER の音。walk にしません。"), F("company", "AH", ["AA"], "com は小さく短い「ア」。")], 2,
           {"swap": [{"word": "kitchen tools", "note_ja": "自分の会社が作っているものに変えます。"}]}),
          ("In my free time, I like cooking and walking by the river.", "時間があるときは、料理や川沿いの散歩を楽しんでいます。",
           [F("free", "R", ["L"], "f のすぐあとに、舌を付けない r。"), F("river", "R", ["L"], "river は r で始めて、最後の er を響かせます。")], 3,
           {"swap": [{"word": "cooking and walking by the river", "note_ja": "自分の趣味に変えます。"}]}),
          ("I'm still learning English, so please speak slowly if I miss something.", "まだ英語を勉強中なので、聞き取れなかったらゆっくり話してください。",
           [F("learning", "ER", ["AA", "AH"], "learn は ER の音。"), F("slowly", "L", ["R"], "sl を母音なしで、l は舌先を付けて。")], 3),
      ])

intro("intro-2", "新しい職場の仲間に", "新しい部署に入った日に、みんなの前であいさつします。",
      "Aki は自分の名前に、sales team と bank は自分の部署と前の職場に変えて使えます。", [
          ("Good morning, everyone. I'm Aki, and I just joined the sales team.", "皆さん、おはようございます。Aki です。営業部に入りました。",
           [F("everyone", "V", ["B"], "everyone の v は歯を下くちびるに。"), F("joined", "D", ["EPEN"], "joined の最後は d で止めます。")], 2,
           {"swap": [{"word": "Aki", "note_ja": "自分の名前に変えます。"}, {"word": "sales team", "note_ja": "自分の部署に変えます。"}]}),
          ("Before this, I worked at a bank for five years.", "以前は銀行で5年間働いていました。",
           [F("worked", "ER", ["AA", "AO"], "worked は ER の音。"), F("five", "V", ["B", "EPEN"], "five の最後は v。"),
            F("years", "Y", [], "years は y から始めます。")], 2, {"swap": [{"word": "a bank", "note_ja": "前の職場に変えます。"}]}),
          ("I'm really looking forward to working with all of you.", "皆さんと一緒に働けるのを、とても楽しみにしています。",
           [F("really", "R", ["L"], "really は R、L の順。"), F("forward", "F", ["HH"], "forward は歯を下くちびるに当てて。"),
            F("all", "L", ["EPEN"], "all of you は l を of にくっつけます。")], 3),
          ("If you have any questions about the numbers, feel free to ask me.", "数字のことで質問があれば、気軽に聞いてください。",
           [F("numbers", "ER", ["AA", "AH"], "numbers の er は短く響かせます。"), F("feel", "F", ["HH"], "feel free は f が2つ。歯を下くちびるに。")], 3),
      ])

intro("intro-3", "web 会議で", "画面越しの会議で、最初に音の確認とあいさつをします。",
      "Ken は自分の名前に、last month's survey は今日話す内容に変えて使えます。", [
          ("Hi, can everyone hear me okay?", "こんにちは、皆さん聞こえていますか？",
           [F("hear", "R", [], "hear の最後に r の響き。"), F("okay", "EY", ["EH"], "okay は質問なので、最後を上げます。")], 1),
          ("My name is Ken, and I'm calling in from our office in Japan.", "Ken です。日本の事務所から参加しています。",
           [F("calling", "L", ["R"], "calling の l は舌先を付けて。"), F("office", "F", ["HH"], "office の f は歯を下くちびるに。")], 2,
           {"swap": [SW_NAME]}),
          ("I'll be sharing the results of last month's survey today.", "今日は先月の調査の結果をお伝えします。",
           [F("sharing", "SH", ["S"], "sharing はくちびるを突き出して。"), F("results", "Z", ["S", "EPEN"], "results は ts ではなく、lts を母音なしで。"),
            F("survey", "ER", ["AA", "AH"], "sur は ER の音。")], 3, {"swap": [{"word": "last month's survey", "note_ja": "今日話す内容に変えます。"}]}),
          ("If my voice cuts out, please let me know in the chat.", "声が途切れたら、書き込み欄で知らせてください。",
           [F("voice", "V", ["B"], "voice の v は歯を下くちびるに。"), F("cuts", "AH", ["AA"], "cuts は小さく短い「ア」。")], 3),
      ])

intro("intro-4", "面接のはじめに", "就職の面接で、最初に自己紹介をします。",
      "Aki は自分の名前に、engineer と six years は自分の職種と年数に、team of four people は自分の仕事内容に変えて使えます。", [
          ("Thank you for taking the time to meet with me today.", "本日はお時間をいただき、ありがとうございます。",
           [F("thank", "TH", ["S"], "thank は舌先を前歯に当てて。"), F("time", "AY", [], "time と meet と today を強く。")], 2),
          ("My name is Aki, and I've worked as an engineer for six years.", "Aki と申します。技術者として6年間働いてきました。",
           [F("worked", "ER", ["AA", "AO"], "worked は ER の音。"), F("engineer", "R", [], "engineer の最後に r の響き。"),
            F("six", "S", ["SH"], "six の s は「シ」にしません。")], 3,
           {"swap": [{"word": "Aki", "note_ja": "自分の名前に変えます。"}, {"word": "engineer", "note_ja": "自分の職種に変えます。"}]}),
          ("In my current job, I lead a team of four people.", "今の仕事では、4人の組をまとめています。",
           [F("current", "ER", ["AA", "AH"], "cur は ER の音。"), F("lead", "L", ["R"], "lead は舌先を付けた L。read にしません。"),
            F("four", "R", [], "four の最後に r の響き。")], 3),
          ("I'm especially interested in this role because I enjoy solving problems with others.", "人と一緒に問題を解決するのが好きなので、特にこの職に関心があります。",
           [F("role", "R", ["L"], "role は r で始めて、l で終わります。"), F("solving", "L", ["R"], "solving の l は舌先を付けて。"),
            F("others", "DH", ["Z", "D"], "others の th は声を出す th。")], 4),
      ])

intro("intro-5", "趣味の話", "雑談で、休みの日の過ごし方を話します。",
      "fishing with my father の部分を、自分の趣味と一緒にする人に変えて使えます。", [
          ("On weekends, I usually go fishing with my father.", "週末はたいてい、父と釣りに行きます。",
           [F("usually", "ZH", ["JH"], "usually の s は声を出した「シュ」。"), F("fishing", "F", ["HH"], "fishing の f は歯を下くちびるに。"),
            F("father", "DH", ["Z", "D"], "father の th は声を出す th。")], 2,
           {"swap": [{"word": "go fishing with my father", "note_ja": "自分の趣味に変えます。"}]}),
          ("We leave early in the morning, before the sun comes up.", "日がのぼる前、朝早くに出かけます。",
           [F("leave", "IY", ["IH"], "leave は長い「イー」。"), F("early", "ER", ["AA", "AH"], "early は ER の音。"),
            F("sun", "AH", ["AA"], "sun は小さく短い「ア」。")], 2),
          ("Last month, I caught a really big fish and took a picture of it.", "先月はとても大きな魚が釣れて、写真を撮りました。",
           [F("caught", "AA", ["OW"], "caught は口を縦に大きく開けた音。「オ」にしません。"), F("really", "R", ["L"], "really は R、L の順。"),
            F("picture", "ER", ["AA", "AH"], "picture の最後の er は短く響かせます。")], 3),
          ("Do you have any hobbies you enjoy?", "楽しんでいる趣味はありますか？",
           [F("hobbies", "AA", ["AO", "OW"], "hob は縦に大きく開けて。"), F("enjoy", "OY", [], "最後の enjoy で声を上げて質問にします。")], 2),
      ])

intro("intro-6", "旅先で", "旅行先で出会った人に、自分のことを話して、おすすめを聞きます。",
      "Ken は自分の名前に、Japan は自分の国に、a week は滞在する長さに変えて使えます。", [
          ("Hello! I'm Ken, and I'm visiting from Japan.", "こんにちは！ Ken です。日本から旅行で来ています。",
           [F("hello", "L", ["R"], "hello の l は舌先を付けて。"), F("visiting", "V", ["B"], "visiting の v は歯を下くちびるに。")], 1,
           {"swap": [SW_NAME, {"word": "Japan", "note_ja": "自分の国に変えます。"}]}),
          ("This is my first time here, and I'm staying for a week.", "ここに来るのは初めてで、1週間滞在します。",
           [F("first", "ER", ["AA", "AH"], "first は ER の音。"), F("staying", "S", ["EPEN"], "st を母音なしで。"),
            F("week", "IY", ["IH"], "week は長い「イー」。")], 2, {"swap": [{"word": "a week", "note_ja": "滞在する長さに変えます。"}]}),
          ("I'd love to try some local food while I'm here.", "滞在中に、地元の料理を食べてみたいです。",
           [F("love", "V", ["B", "EPEN"], "love の v は歯を下くちびるに。"), F("local", "L", ["R"], "local は l で始めて l で終わります。"),
            F("food", "F", ["HH"], "food の f は歯を下くちびるに。")], 2),
          ("Do you know a good place that's not too expensive?", "あまり高くない、いいお店を知っていますか？",
           [F("place", "L", ["R"], "p のすぐあとに、舌先を付けて l。"), F("expensive", "V", ["B", "EPEN"], "expensive の最後は v。")], 3),
      ])

# ---------------------------------------------------------------- dialogues
def dialogue(did, title, situation, turns):
    DATA["dialogues"].append({"id": did, "title_ja": j(title), "situation_ja": j(situation),
                              "turns": [line(f"{did}-{k:02d}", *t[1:5], speaker=t[0], **(t[5] if len(t) > 5 else {}))
                                        for k, t in enumerate(turns, 1)]})
    save()


P, Y = "partner", "you"
dialogue("dlg-cafe", "喫茶店で注文する", "店員に飲み物と食べ物を注文して、支払いをします。", [
    (P, "Hi, what can I get for you today?", "いらっしゃいませ。何になさいますか？",
     [F("can", "AH", ["AE"], "相手の can I は弱く短く、つながって聞こえます。")], 1),
    (Y, "Can I have a medium coffee with milk, please?", "中くらいの大きさの珈琲を、牛乳入りでお願いします。",
     [F("have", "V", ["B", "EPEN"], "have の v は歯を下くちびるに軽く。"), F("coffee", "F", ["HH"], "coffee の f は歯を下くちびるに。"),
      F("milk", "L", ["EPEN"], "milk は l のあとに母音を入れず、すぐ k へ。")], 2),
    (P, "Sure. For here or to go?", "かしこまりました。店内でお召し上がりですか、お持ち帰りですか？",
     [F("for", "ER", ["AO"], "相手の for は弱く短く聞こえます。")], 1),
    (Y, "To go, please. And one of those cookies, too.", "持ち帰りでお願いします。それと、その焼き菓子を1つください。",
     [F("go", "OW", ["AO"], "go は「オウ」と動かします。"), F("those", "DH", ["Z", "D"], "those は舌先を前歯に当てて。"),
      F("cookies", "UH", ["UW"], "cook は短くゆるい「ウ」。")], 2),
    (P, "That'll be six fifty.", "6.50 になります。", [F("fifty", "F", ["HH"], "相手の fifty は f が2つ。数字をよく聞きます。")], 1),
    (Y, "Here you are. Thank you.", "はい、どうぞ。ありがとう。",
     [F("here", "R", [], "here の最後に r の響き。"), F("thank", "TH", ["S"], "thank は舌先を前歯に当てて。")], 1),
])

dialogue("dlg-directions", "道をたずねる", "駅への行き方を、通りがかりの人に聞きます。", [
    (Y, "Excuse me, could you tell me how to get to the station?", "すみません、駅への行き方を教えてもらえますか？",
     [F("could", "UH", ["UW"], "could は短くゆるい「ウ」。"), F("tell", "L", ["R"], "tell の l は舌先を付けて。"),
      F("get", "T", ["EPEN"], "get to は t を一つにつなげます。")], 2),
    (P, "Sure. Go straight and turn left at the second light.", "いいですよ。まっすぐ行って、2つ目の信号を左です。",
     [F("left", "L", ["R"], "左（left）か右（right）か、l と r をよく聞きます。")], 2),
    (Y, "Is it far from here?", "ここから遠いですか？",
     [F("far", "R", [], "far の最後に r の響き。"), F("here", "R", [], "here の最後も r の響き。質問なので上げます。")], 1),
    (P, "Not really. It's about a five-minute walk.", "それほどでも。歩いて5分くらいです。",
     [F("five", "V", ["B"], "相手の five minute は数字をよく聞きます。")], 2),
    (Y, "Great, thank you so much for your help.", "よかった、助かりました。ありがとうございます。",
     [F("great", "R", ["L"], "g のすぐあとに、舌を付けない r。"), F("thank", "TH", ["S"], "thank は舌先を前歯に。"),
      F("help", "L", ["EPEN"], "help の l のあとに母音を入れません。")], 2),
    (P, "You're welcome. Have a nice day.", "どういたしまして。よい一日を。",
     [F("welcome", "L", ["R"], "相手の welcome の l を聞き取ります。")], 1),
])

dialogue("dlg-work", "職場で雑談する", "週明けに、同僚と週末の話をします。", [
    (P, "Hey, how was your weekend?", "ねえ、週末はどうだった？",
     [F("weekend", "IY", [], "相手の weekend は week が高くなります。")], 1),
    (Y, "It was really nice. I went hiking with some friends.", "すごくよかったです。友だちと山歩きに行きました。",
     [F("really", "R", ["L"], "really は R、L の順。"), F("hiking", "HH", ["F"], "hiking はのどから息を出します。"),
      F("friends", "Z", ["EPEN"], "friends の最後は ndz を母音なしで。")], 2),
    (P, "Oh, that sounds fun. Where did you go?", "へえ、楽しそう。どこに行ったの？",
     [F("fun", "F", ["HH"], "相手の fun の f を聞き取ります。")], 1),
    (Y, "We went to a mountain about an hour from the city.", "街から1時間くらいの山に行きました。",
     [F("mountain", "AW", [], "moun は「アウ」と口を動かします。"), F("hour", "R", [], "hour の最後に r の響き。"),
      F("city", "T", [], "city の t は軽くはじきます。")], 3),
    (P, "Wow. Was the weather okay?", "へえ。天気はよかった？",
     [F("weather", "DH", ["Z", "D"], "相手の weather の th を聞き取ります。")], 1),
    (Y, "Yes, it was perfect. A little cold in the morning, though.", "はい、最高でした。朝は少し寒かったですけど。",
     [F("perfect", "ER", ["AA", "AH"], "per は ER の音。"), F("little", "T", [], "little の t は軽くはじきます。"),
      F("though", "DH", ["Z", "D"], "though の th は声を出す th。")], 3),
])

dialogue("dlg-hotel", "宿で手続きをする", "宿の受付で、到着の手続きをして、朝食の時間を聞きます。", [
    (P, "Good evening. How can I help you?", "こんばんは。ご用件をうかがいます。",
     [F("evening", "V", ["B"], "相手の evening の v を聞き取ります。")], 1),
    (Y, "Hi, I'd like to check in. My name is Ken.", "こんにちは、到着の手続きをお願いします。Ken です。",
     [F("like", "L", ["R"], "like は舌先を付けて。"), F("check", "K", ["EPEN"], "check in は k を in にくっつけます。")], 2, {"swap": [SW_NAME]}),
    (P, "Thank you. Could I see your passport, please?", "ありがとうございます。旅券を見せていただけますか？",
     [F("passport", "R", [], "相手の passport を聞き取ります。")], 1),
    (Y, "Sure, here it is.", "はい、どうぞ。",
     [F("sure", "SH", ["S"], "sure はくちびるを突き出した sh。"), F("here", "R", [], "here it is は r を it にくっつけます。")], 1),
    (P, "You're in room four twelve, on the fourth floor.", "お部屋は4階の412号室です。",
     [F("fourth", "TH", ["S"], "相手の fourth の最後の th を聞き取ります。")], 2),
    (Y, "Thank you. What time is breakfast served?", "ありがとう。朝食は何時からですか？",
     [F("breakfast", "AH", ["AA"], "BREAK·fast（●・）。fast は弱く。"), F("served", "ER", ["AA", "AH"], "served は ER の音。")], 2),
    (P, "From seven to ten, in the restaurant on the first floor.", "7時から10時まで、1階の食堂でお召し上がりいただけます。",
     [F("seven", "V", ["B"], "相手の時間の数字をよく聞きます。")], 2),
    (Y, "Perfect. Thanks for your help.", "わかりました。ありがとうございます。",
     [F("perfect", "F", ["HH"], "perfect の f は歯を下くちびるに。"), F("thanks", "TH", ["S"], "thanks は舌先を前歯に。")], 1),
])

dialogue("dlg-phone", "電話で予約する", "電話で、来週の予約を取ります。", [
    (P, "Hello, thank you for calling. How may I help you?", "お電話ありがとうございます。ご用件をうかがいます。",
     [F("calling", "L", ["R"], "相手の calling の l を聞き取ります。")], 1),
    (Y, "Hi, I'd like to make an appointment for next week.", "こんにちは、来週の予約を取りたいのですが。",
     [F("make", "EY", ["EH"], "make は「エイ」と口を動かします。"), F("appointment", "OY", [], "ap·POINT·ment（・●・）。"),
      F("next", "T", ["EPEN"], "next の最後は kst を母音なしで。")], 2),
    (P, "Sure. What day works best for you?", "かしこまりました。何曜日がご都合よろしいですか？",
     [F("works", "ER", [], "相手の works の ER を聞き取ります。")], 1),
    (Y, "Do you have anything in the afternoon?", "午後に空いている時間はありますか？",
     [F("have", "V", ["B", "EPEN"], "have の v は歯を下くちびるに。"), F("anything", "TH", ["S"], "thing の th は舌先を前歯に。"),
      F("afternoon", "UW", ["UH"], "noon は長い「ウー」。")], 2),
    (P, "We have an opening at three thirty.", "3時半に空きがあります。",
     [F("three", "TH", ["S"], "相手の three と thirty を聞き取ります。")], 2),
    (Y, "Three thirty is fine. My name is Ken, K, E, N.", "3時半で大丈夫です。名前は Ken、K、E、N です。",
     [F("three", "TH", ["S"], "three は舌先を前歯に当ててから r。"), F("thirty", "TH", ["S"], "thirty も th で始めます。"),
      F("fine", "F", ["HH"], "fine の f は歯を下くちびるに。")], 3, {"swap": [{"word": "Ken, K, E, N", "note_ja": "自分の名前と、そのつづりに変えます。"}]}),
])

dialogue("dlg-shop", "お店で上着を買う", "店員に声をかけられて、上着を試着して買います。", [
    (P, "Hi there. Are you looking for anything special?", "いらっしゃいませ。何かお探しですか？",
     [F("special", "SH", ["S"], "相手の special の sh を聞き取ります。")], 1),
    (Y, "Yes, I'm looking for a warm jacket for the winter.", "はい、冬用の暖かい上着を探しています。",
     [F("looking", "L", ["R"], "looking は舌先を付けて。"), F("warm", "R", [], "warm の最後に r の響き。"),
      F("winter", "ER", ["AA", "AH"], "winter の最後の er は短く響かせます。")], 2),
    (P, "These are on sale this week. What size are you?", "こちらは今週安くなっています。大きさはどれくらいですか？",
     [F("size", "Z", ["S"], "相手の size を聞き取ります。")], 2),
    (Y, "Medium, I think. Can I try this one on?", "中くらいだと思います。これを試着してもいいですか？",
     [F("think", "TH", ["S"], "think は舌先を前歯に当てて。"), F("try", "R", ["L"], "t のすぐあとに、舌を付けない r。"),
      F("one", "N", ["EPEN"], "one on は n を on にくっつけます。")], 2),
    (P, "Of course. The fitting room is over there.", "もちろんです。試着室はあちらです。",
     [F("over", "V", ["B"], "相手の over there を聞き取ります。")], 1),
    (Y, "It fits well. I'll take it.", "ぴったりです。これにします。",
     [F("fits", "F", ["HH"], "fits の f は歯を下くちびるに。"), F("well", "L", ["EPEN"], "well の最後は舌先を付けて止めます。"),
      F("take", "K", ["EPEN"], "take it は k を it にくっつけます。")], 2),
])

dialogue("dlg-doctor", "病院で症状を伝える", "医者に、のどの痛みと熱のことを伝えます。", [
    (P, "What seems to be the problem today?", "今日はどうされましたか？",
     [F("problem", "AA", [], "相手の problem の pro は強く聞こえます。")], 1),
    (Y, "I've had a sore throat and a fever since yesterday.", "昨日から、のどが痛くて熱があります。",
     [F("sore", "R", [], "sore の最後に r の響き。"), F("throat", "TH", ["S"], "throat は th のすぐあとに r。"),
      F("fever", "F", ["HH"], "fever の f は歯を下くちびるに。最後の v も同じ。")], 3),
    (P, "I see. Do you have a cough, too?", "なるほど。せきも出ますか？",
     [F("cough", "F", ["HH"], "相手の cough の最後の f を聞き取ります。")], 1),
    (Y, "Yes, a little, and I feel very tired.", "はい、少し。それに、とても疲れています。",
     [F("little", "T", [], "little の t は軽くはじきます。"), F("feel", "F", ["HH"], "feel の f は歯を下くちびるに。"),
      F("very", "V", ["B"], "very の v は歯を下くちびるに。")], 2),
    (P, "Let me check your throat. Please open your mouth.", "のどを見ますね。口を開けてください。",
     [F("mouth", "TH", ["S"], "相手の mouth の th を聞き取ります。")], 1),
    (Y, "Okay. Should I stay home from work?", "わかりました。仕事は休んだほうがいいですか？",
     [F("should", "UH", ["UW"], "should は短くゆるい「ウ」。"), F("home", "OW", ["AO"], "home は「オウ」と動かします。"),
      F("work", "ER", ["AA", "AO"], "work は ER の音。walk にしません。")], 2),
])

dialogue("dlg-airport", "空港で手続きする", "空港の窓口で、荷物を預けて、搭乗口を確かめます。", [
    (P, "Good morning. Where are you flying to today?", "おはようございます。今日はどちらまでですか？",
     [F("flying", "L", ["R"], "相手の flying の l を聞き取ります。")], 1),
    (Y, "I'm on the ten fifteen flight. Here's my passport.", "10時15分の便です。旅券はこちらです。",
     [F("fifteen", "F", ["HH"], "fifteen の f は歯を下くちびるに。"), F("flight", "L", ["R"], "f のすぐあとに、舌先を付けて l。"),
      F("passport", "AE", ["AA"], "pass は「エ」の口で「ア」。")], 2),
    (P, "Thank you. Do you have any bags to check?", "ありがとうございます。預ける荷物はありますか？",
     [F("bags", "AE", ["AA"], "相手の bags を聞き取ります。")], 1),
    (Y, "Just one. Can I take this small bag on the plane?", "1つだけです。この小さなかばんは機内に持ち込めますか？",
     [F("small", "L", ["EPEN"], "small の最後は舌先を付けて止めます。"), F("bag", "AE", ["AA", "AH"], "bag は「エ」の口で「ア」。"),
      F("plane", "L", ["R"], "p のすぐあとに、舌先を付けて l。")], 2),
    (P, "Yes, that's fine. Your gate is thirty-four, and boarding starts at nine forty.", "はい、大丈夫です。搭乗口は34番で、搭乗は9時40分に始まります。",
     [F("thirty", "TH", ["S"], "相手の thirty-four と nine forty、数字をよく聞きます。")], 3),
    (Y, "Thanks. Is there somewhere to get coffee near the gate?", "ありがとう。搭乗口の近くに、珈琲が買える所はありますか？",
     [F("there", "DH", ["Z", "D"], "there は舌先を前歯に当てて。"), F("coffee", "F", ["HH"], "coffee の f は歯を下くちびるに。"),
      F("near", "R", [], "near の最後に r の響き。")], 3),
])
