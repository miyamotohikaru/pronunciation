#!/usr/bin/env python3
"""Assemble content/phonemes.json (all General American phonemes) and
content/ipa-legend.json (what each dictionary-style IPA symbol means).

  python3 content/build_phonemes.py && python3 content/check_cmudict.py

Per phoneme: arpabet, ipa (dictionary style), category, name_ja, how_ja,
jp_trap_ja, examples (5 listen-only words, position checked against
CMUdict, [letters] that spell the sound), pairs (2-4 listen-only minimal
pairs), practice (6-8 short sentences dense with the sound; focus is
generated from CMUdict). Saved after every group.
"""
import json
import re
from pathlib import Path

import ipa

HERE = Path(__file__).resolve().parent
OUT, LEG = HERE / "phonemes.json", HERE / "ipa-legend.json"
DATA = {"version": 1,
        "style_ja": "発音記号は英和辞典と同じ書き方です。\n"
                    "´ は強く言う音節、` は2番目に強い音節、ː は長くのばす音を表します。",
        "phonemes": []}


def j(s):
    return re.sub(r"([、。])(?!$|\n|[」』）)])", r"\1\n", s.strip())


def has_target(pr, pid, arpa):
    if pid == "DX":
        return bool(ipa.flap_index(pr))
    if pid in ("AH0", "ER0"):
        return pid in pr
    if pid in ("AH", "ER"):
        return any(ipa.base(p) == pid and p[-1] in "12" for p in pr)
    return any(ipa.base(p) == arpa for p in pr)


def focus_for(text, e):
    out = []
    for w in re.findall(r"[A-Za-z']+", text):
        wl = w.lower()
        for pr in ipa.prons(wl):
            if not has_target(pr, e["id"], e["arpabet"]):
                continue
            ph = ipa.base(pr[ipa.flap_index(pr)[0]]) if e["id"] == "DX" else ipa.base(e["arpabet"])
            f = {"word": wl, "phone": ph, "watch_for": e["watch_for"], "tip_ja": e["tip_ja"],
                 "ipa": "/" + ipa.to_ipa(pr) + "/"}
            if e["id"] == "DX":
                f["ipa_note_ja"] = j(ipa.FLAP_NOTE)
            out.append(f)
            break
        if len(out) == 4:
            break
    return out


def E(pid, arpa, category, name, how, trap, watch, tip, examples, pairs, practice, **extra):
    e = {"id": pid, "arpabet": arpa, "ipa": ipa.SYMBOL[pid], "category": category, **extra,
         "name_ja": j(name), "how_ja": j(how), "jp_trap_ja": j(trap), "watch_for": watch, "tip_ja": j(tip)}
    ex = []
    for w, pos, marked in examples:
        x = {"word": w, "position": pos, "marked": marked, "ipa": ipa.word_ipa(w)}
        if ipa.flap_note(w):
            x["ipa_note_ja"] = j(ipa.FLAP_NOTE)
        ex.append(x)
    e["examples"] = ex
    e["pairs"] = []
    for p in pairs:
        a, b = p[0], p[1]
        d = {"a": a, "b": b, "a_ipa": ipa.word_ipa(a), "b_ipa": ipa.word_ipa(b)}
        if len(p) > 2:
            d["kind"], d["note_ja"] = p[2], j(p[3])
        e["pairs"].append(d)
    e["practice"] = [{"id": f"ph-{pid}-{k:02d}", "text": t, "ja": j(ja), "focus": focus_for(t, e),
                      "difficulty": 1 if k <= 3 else 2} for k, (t, ja) in enumerate(practice, 1)]
    DATA["phonemes"].append(e)


def save():
    OUT.write_text(json.dumps(DATA, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ================================================================ vowels
E("IY", "IY", "vowel", "口を横に引く長い iː",
  "口の両端を横に強く引き、舌の前の方を上あごに近づけます。日本語の「イー」より少し力を入れて、長めに出します。",
  "日本語の「イ」と「イー」は長さだけの違いなので、ship の短い i と区別がつきにくくなります。口の端を横に引いて、頬に力が入る感じがあれば iː です。",
  ["IH"], "口を横にしっかり引いて、長く。",
  [("eat", "initial", "[ea]t"), ("meet", "medial", "m[ee]t"), ("clean", "medial", "cl[ea]n"), ("see", "final", "s[ee]"), ("key", "final", "k[ey]")],
  [("sheep", "ship"), ("seat", "sit"), ("leave", "live"), ("feel", "fill")],
  [("Please eat your peas.", "豆を食べてください。"), ("We need three seats.", "席が3つ必要です。"),
   ("Keep the key with you.", "鍵を持っておいてください。"), ("Meet me at the beach.", "海辺で会いましょう。"),
   ("These sheets are clean.", "この敷布はきれいです。"), ("I need sleep this week.", "今週は睡眠が必要です。")])
E("IH", "IH", "vowel", "力を抜いた短い i",
  "口の力を抜いて、少しだけ開けます。日本語の「イ」と「エ」の間くらいの、短くゆるい音です。頬に力を入れません。",
  "日本語の「イ」で言うと口に力が入り、eat の長い音に近づきます。ship が sheep に聞こえることがあります。口の力を抜いて、少し「エ」寄りにすると近づきます。",
  ["IY"], "口の力を抜いた、短くゆるい音。",
  [("it", "initial", "[i]t"), ("in", "initial", "[i]n"), ("sit", "medial", "s[i]t"), ("big", "medial", "b[i]g"), ("milk", "medial", "m[i]lk")],
  [("ship", "sheep"), ("sit", "seat"), ("live", "leave"), ("fill", "feel")],
  [("It is in the bin.", "ごみ箱に入っています。"), ("This fish is big.", "この魚は大きいです。"), ("Sit with him.", "彼と一緒に座って。"),
   ("Is it six?", "6時ですか？"), ("I will fix it.", "私が直します。"), ("His sister is still sick.", "彼の姉はまだ具合が悪いです。")])
E("EH", "EH", "vowel", "日本語に近い e",
  "日本語の「エ」とほぼ同じです。口を少し縦に開け、舌は前に置いて、短く言います。",
  "日本語の「エ」でほぼ通じます。気をつけたいのは、つづりが a でも e の音になる語（any、many、said）と、make の eɪ を「エ」や「エー」で言ってしまうことです。",
  ["EY", "AE"], "日本語の「エ」に近い、短い音。",
  [("egg", "initial", "[e]gg"), ("end", "initial", "[e]nd"), ("bed", "medial", "b[e]d"), ("red", "medial", "r[e]d"), ("said", "medial", "s[ai]d")],
  [("bed", "bad"), ("men", "man"), ("wet", "wait"), ("get", "gate")],
  [("Let's get ready.", "準備しよう。"), ("I said yes.", "はいと言いました。"), ("Ten men left.", "10人の男性が帰りました。"),
   ("Tell me again.", "もう一度教えて。"), ("Any help is welcome.", "どんな手助けも歓迎です。"), ("My best friend went west.", "親友は西へ行きました。")])
E("AE", "AE", "vowel", "エの口で言う æ",
  "「エ」の口の形から、あごを下げて「ア」と言います。口の両端を横に引いたまま、少し長めに出します。",
  "日本語の「ア」で言うと、hut や hot に聞こえやすくなります。「エ」と「ア」を同時に言うつもりで、口を横にも縦にも開けると近づきます。",
  ["AA", "AH", "EH"], "「エ」の口のまま「ア」。",
  [("apple", "initial", "[a]pple"), ("ask", "initial", "[a]sk"), ("cat", "medial", "c[a]t"), ("black", "medial", "bl[a]ck"), ("happy", "medial", "h[a]ppy")],
  [("hat", "hut"), ("cap", "cup"), ("bag", "bug"), ("black", "block")],
  [("That cat is fat.", "あの猫は太っています。"), ("I have a black bag.", "黒いかばんを持っています。"), ("Pass me the map.", "地図を取ってください。"),
   ("Ask your dad.", "お父さんに聞いて。"), ("The man is happy.", "その男性はうれしそうです。"), ("Can I have a snack?", "軽く何か食べてもいいですか？")])
E("AA", "AA", "vowel", "あくびの口の ɑ",
  "あくびをするように、口を縦に大きく開けます。舌は低く、奥の方に置きます。のどの奥から「ア」と出します。",
  "つづりが o の語（hot、stop）を、日本語の「オ」で言いがちです。英語では「オ」ではなく、口を大きく開けた「ア」に近い音です。",
  ["AO", "OW", "AH"], "口を縦に大きく開けた「ア」。",
  [("on", "initial", "[o]n"), ("odd", "initial", "[o]dd"), ("hot", "medial", "h[o]t"), ("stop", "medial", "st[o]p"), ("spa", "final", "sp[a]")],
  [("hot", "hut"), ("lock", "luck"), ("cop", "cup"), ("not", "nut")],
  [("It's hot on top.", "上は暑いです。"), ("Stop the clock.", "時計を止めて。"), ("The shop is not open.", "その店は開いていません。"),
   ("Put the box on top.", "箱を上に置いて。"), ("I got a lot.", "たくさんもらいました。"), ("My father is calm.", "父は落ち着いています。")])
E("AO", "AO", "vowel", "丸めた口の長い ɔː",
  "口を縦に開けて、くちびるを少し丸めます。日本語の「オ」より口を大きく開け、長めに出します。米国では ɑ と同じに言う人も多い音です。",
  "日本語の「オー」で言うと口が小さすぎて、go の oʊ のように聞こえることがあります。口をもっと縦に開けます。walk と work、called と cold の区別に注意します。",
  ["OW", "AA"], "口を縦に開けて、少し丸めた長い音。",
  [("all", "initial", "[a]ll"), ("always", "initial", "[a]lways"), ("walk", "medial", "w[a]lk"), ("call", "medial", "c[a]ll"), ("law", "final", "l[aw]")],
  [("called", "cold"), ("law", "low"), ("bought", "boat"), ("walk", "work")],
  [("We always walk there.", "私たちはいつもそこまで歩きます。"), ("I bought it at the store.", "それはお店で買いました。"),
   ("Call me in the fall.", "秋に電話してください。"), ("The dog is small.", "その犬は小さいです。"),
   ("I thought it was all wrong.", "全部間違っていると思いました。"), ("Don't talk so long.", "そんなに長く話さないで。")])
E("UH", "UH", "vowel", "力を抜いた短い u",
  "くちびるを軽く丸めるだけで、突き出しません。口の力を抜いて、短く言います。日本語の「ウ」より少し口が開きます。",
  "日本語の「ウー」と長く言うと、food のような長い音に近づきます。good、book、could は、短くゆるく言います。",
  ["UW"], "くちびるを軽く丸めるだけの、短い音。",
  [("good", "medial", "g[oo]d"), ("book", "medial", "b[oo]k"), ("put", "medial", "p[u]t"), ("could", "medial", "c[ou]ld"), ("woman", "medial", "w[o]man")],
  [("full", "fool"), ("pull", "pool"), ("soot", "suit")],
  [("Look at this book.", "この本を見て。"), ("It looks good.", "よさそうですね。"), ("Could you put it here?", "ここに置いてもらえますか？"),
   ("You should cook more.", "もっと料理をしたほうがいいですよ。"), ("I took a good look.", "よく見てみました。"), ("The woman stood up.", "その女性は立ち上がりました。")])
E("UW", "UW", "vowel", "くちびるを突き出す長い uː",
  "くちびるを小さく丸めて、前に突き出します。舌の奥を持ち上げ、長く出します。日本語の「ウー」より、くちびるをしっかり使います。",
  "日本語の「ウ」は、くちびるをあまり丸めない平たい音です。そのまま言うと弱く聞こえます。ろうそくを吹き消すくらい、くちびるを前に出します。",
  ["UH"], "くちびるを小さく丸めて突き出した、長い音。",
  [("food", "medial", "f[oo]d"), ("soon", "medial", "s[oo]n"), ("school", "medial", "sch[oo]l"), ("too", "final", "t[oo]"), ("blue", "final", "bl[ue]")],
  [("fool", "full"), ("pool", "pull"), ("suit", "soot")],
  [("Do you want some soup?", "温かい汁物はいかがですか？"), ("The room is too cool.", "部屋が涼しすぎます。"),
   ("We moved to a new school.", "新しい学校に移りました。"), ("Who drew the moon?", "だれが月を描いたの？"),
   ("See you soon at school.", "またすぐ学校で会おうね。"), ("Choose two blue shoes.", "青い靴を2足選んで。")])
E("AH", "AH", "vowel", "短く軽い ʌ",
  "口をあまり開けず、舌を自然な位置に置いたまま、短く「ア」と言います。日本語の「ア」より少し小さく、軽い音です。",
  "日本語の「ア」にいちばん近い母音ですが、大きく開けすぎると hot の音に近づきます。つづりが o の語（love、come、money）にも出るので、「オ」と読まないようにします。",
  ["AA", "AE", "AO"], "口を小さく、短く軽い「ア」。",
  [("up", "initial", "[u]p"), ("us", "initial", "[u]s"), ("cup", "medial", "c[u]p"), ("love", "medial", "l[o]ve"), ("money", "medial", "m[o]ney")],
  [("hut", "hot"), ("cup", "cap"), ("luck", "lock"), ("bug", "bag")],
  [("Come up for lunch.", "お昼を食べに上がっておいで。"), ("I love my mother.", "母が大好きです。"), ("Just a cup of tea.", "お茶を1杯だけ。"),
   ("We had fun in the sun.", "日なたで楽しく過ごしました。"), ("Is it enough money?", "お金は足りますか？"),
   ("My son comes home once a month.", "息子は月に1回帰ってきます。")])
E("AH0", "AH", "vowel", "あいまいな弱い ə",
  "口も舌も、力を完全に抜きます。ごく短く、小さく出します。強い音節のまえやあとに、軽く添えるように言います。",
  "日本語にはこの弱い母音がないため、つづりどおり「ア」「オ」「エ」とはっきり言いがちです。英語でいちばん多い母音です。強いところだけを大きく言い、ほかはこの音で短く流すと、強弱が出ます。",
  ["AA", "AO", "EH"], "力を抜いた、ごく短い弱い音。",
  [("about", "initial", "[a]bout"), ("again", "initial", "[a]gain"), ("banana", "medial", "b[a]nana"), ("lemon", "medial", "lem[o]n"), ("sofa", "final", "sof[a]")],
  [("to", "two", "weak-strong", "to の弱い形 /tə/ と、two /túː/ の違いです。"),
   ("desert", "dessert", "stress", "強く言う場所が入れかわり、弱いほうの母音が ə になります。")],
  [("Wait a minute.", "ちょっと待って。"), ("Let's talk about it again.", "そのことは、また話しましょう。"),
   ("I'll be back in a second.", "すぐ戻ります。"), ("Today is a holiday.", "今日は休日です。"),
   ("Seven of us came along.", "7人で一緒に来ました。"), ("Call the police again.", "もう一度警察を呼んでください。")],
  stress="weak")
E("ER", "ER", "r-colored vowel", "舌を引いてこもらせる ɚː",
  "舌先を少し持ち上げて奥へ引き、どこにも付けません。くちびるは軽く丸めます。その形のまま、こもった音を長めに響かせます。",
  "「アー」と伸ばすと、work が walk に、heard が hard に聞こえます。音の始まりから終わりまで、舌を奥に引いたままにするのがこつです。",
  ["AA", "AH", "AO"], "舌を奥へ引いたまま、こもった音を響かせます。",
  [("early", "initial", "[ear]ly"), ("earn", "initial", "[ear]n"), ("bird", "medial", "b[ir]d"), ("work", "medial", "w[or]k"), ("her", "final", "h[er]")],
  [("hurt", "hot"), ("work", "walk"), ("bird", "bud"), ("heard", "hard")],
  [("Her first word was clear.", "彼女の最初の言葉ははっきりしていました。"), ("I work early.", "朝早くから働いています。"),
   ("Turn left at the church.", "教会のところを左に曲がって。"), ("I learned a new word.", "新しい単語を覚えました。"),
   ("The nurse was hurt.", "その看護師はけがをしました。"), ("Were you first in line?", "あなたが列の先頭でしたか？")],
  stress="strong")
E("ER0", "ER", "r-colored vowel", "弱く短い ɚ",
  "ɚː と同じ舌の形で、短く弱く出します。舌先を奥へ引き、どこにも付けません。teacher や doctor の最後など、強くない音節に出ます。",
  "単語の終わりの er、or、ar を「アー」と伸ばしがちです。伸ばさずに、舌を奥に引く動きだけを短く添えます。",
  ["AA", "AH"], "伸ばさずに、舌を奥へ引いて短く。",
  [("forget", "medial", "f[or]get"), ("perhaps", "medial", "p[er]haps"), ("teacher", "final", "teach[er]"), ("doctor", "final", "doct[or]"), ("water", "final", "wat[er]")],
  [("tuner", "tuna"), ("cheater", "cheetah")],
  [("My sister is a teacher.", "姉は先生です。"), ("The water is colder here.", "ここの水のほうが冷たいです。"),
   ("Remember to call the doctor.", "医者に電話するのを忘れないで。"), ("Our daughter is older now.", "うちの娘も大きくなりました。"),
   ("After dinner, we'll talk.", "夕食のあとで話しましょう。"), ("Never forget your number.", "自分の番号を忘れないでね。")],
  stress="weak")
save()

# ================================================================ diphthongs
E("EY", "EY", "diphthong", "エからイへ動く eɪ",
  "「エ」から始めて、最後に「イ」の方へ口を閉じていきます。2つの音を、ひとつながりで言います。最初の「エ」を強めに。",
  "日本語では「エー」と伸ばして言う語が多いため、英語でも「エー」になりがちです。最後に「イ」へ動かすだけで、ぐっと自然になります。",
  ["EH"], "「エー」ではなく、「エイ」と動かします。",
  [("eight", "initial", "[eigh]t"), ("able", "initial", "[a]ble"), ("make", "medial", "m[a]ke"), ("rain", "medial", "r[ai]n"), ("day", "final", "d[ay]")],
  [("wait", "wet"), ("gate", "get"), ("late", "let"), ("pain", "pen")],
  [("Take the train today.", "今日は電車に乗ってください。"), ("Wait, it's late.", "待って、もう遅いよ。"), ("I made a cake.", "洋菓子を作りました。"),
   ("Stay safe in the rain.", "雨の日は気をつけてね。"), ("They play every day.", "彼らは毎日遊んでいます。"), ("Okay, I'll pay.", "わかった、私が払います。")])
E("AY", "AY", "diphthong", "アからイへ動く aɪ",
  "口を大きく開けた「ア」から、「イ」へなめらかに動かします。ひとつの音として一息で言います。「ア」を強く長めに、「イ」は軽く。",
  "日本語の「アイ」は、「ア」と「イ」を同じ強さで2拍に分けて言います。英語では1つの音なので、「イ」を短く軽く添えるだけにします。",
  ["AA", "EY"], "「ア」を強く、「イ」は軽く添える。",
  [("ice", "initial", "[i]ce"), ("idea", "initial", "[i]dea"), ("time", "medial", "t[i]me"), ("right", "medial", "r[igh]t"), ("my", "final", "m[y]")],
  [("like", "lock"), ("ride", "rod"), ("tie", "toy")],
  [("I like my bike.", "自分の自転車が気に入っています。"), ("What time is it? Nine?", "何時？ 9時？"), ("Turn right at the light.", "信号を右に曲がって。"),
   ("Try it one more time.", "もう一回やってみて。"), ("I'd like some ice.", "氷をください。"), ("Five nights is fine.", "5泊で大丈夫です。")])
E("OY", "OY", "diphthong", "オからイへ動く ɔɪ",
  "口を縦に開けた「オ」から、「イ」へ動かします。ひとつの音として一息で言い、「オ」を強めに、「イ」を軽く添えます。",
  "日本語の「オイ」に近く、通じやすい音です。「オ」と「イ」を2拍に分けず、ひとつながりにします。",
  ["OW", "AY"], "「オ」から「イ」へ、ひとつながりに。",
  [("oil", "initial", "[oi]l"), ("coin", "medial", "c[oi]n"), ("voice", "medial", "v[oi]ce"), ("boy", "final", "b[oy]"), ("enjoy", "final", "enj[oy]")],
  [("toy", "tie"), ("coin", "cane"), ("boy", "bay")],
  [("The boy has a toy.", "その男の子はおもちゃを持っています。"), ("Enjoy your choice.", "選んだものを楽しんでね。"), ("Avoid the noise.", "騒音を避けてください。"),
   ("Point to the coin.", "その硬貨を指さして。"), ("The boys enjoyed it.", "男の子たちは楽しんでいました。"), ("Join the boys.", "男の子たちに加わって。")])
E("AW", "AW", "diphthong", "アからウへ動く aʊ",
  "口を大きく開けた「ア」から、くちびるを丸めて「ウ」へ動かします。ひとつの音として一息で言い、「ア」を強めに。",
  "日本語の「アウ」のように2拍に分けたり、「アー」と伸ばしたりしがちです。最後にくちびるを丸める動きを入れると、自然に聞こえます。",
  ["AA", "OW"], "「ア」から「ウ」へ、くちびるを丸めて。",
  [("out", "initial", "[ou]t"), ("our", "initial", "[ou]r"), ("house", "medial", "h[ou]se"), ("down", "medial", "d[ow]n"), ("now", "final", "n[ow]")],
  [("now", "no"), ("town", "tone"), ("found", "fond")],
  [("How about now?", "今はどうですか？"), ("Sit down on the couch.", "長いすに座って。"), ("Our house is downtown.", "うちは街の中心にあります。"),
   ("I found it in town.", "それは町で見つけました。"), ("The crowd was loud.", "人混みがうるさかったです。"), ("Count out loud.", "声に出して数えて。")])
E("OW", "OW", "diphthong", "オからウへ動く oʊ",
  "「オ」から始めて、最後にくちびるをすぼめて「ウ」の方へ動かします。ひとつながりで言い、「オー」と伸ばしません。",
  "日本語で「オー」と伸ばす語をそのまま伸ばすと、口が開いた caught のような音になります。最後にくちびるをすぼめる動きを入れます。",
  ["AO"], "「オー」ではなく、「オウ」とすぼめます。",
  [("old", "initial", "[o]ld"), ("open", "initial", "[o]pen"), ("home", "medial", "h[o]me"), ("phone", "medial", "ph[o]ne"), ("go", "final", "g[o]")],
  [("coat", "caught"), ("cold", "called"), ("low", "law"), ("boat", "bought")],
  [("Go home slowly.", "ゆっくり家に帰って。"), ("I don't know.", "わかりません。"), ("Open the window.", "窓を開けて。"),
   ("It's cold, so wear a coat.", "寒いから、上着を着てね。"), ("Show me your phone.", "電話を見せて。"), ("I hope it snows.", "雪が降るといいな。")])
save()

# ================================================================ consonants
E("P", "P", "stop", "息を強く出す p",
  "くちびるを閉じて息をため、強く破裂させます。強い音節の最初では、手のひらに息が当たるくらい強く出します。声は出しません。",
  "日本語のパ行は息が弱めなので、英語の p が b に聞こえることがあります。口の前に紙を置いて、揺れるくらい息を出します。最後の p のあとに母音を足さないことも大切です。",
  ["B", "EPEN"], "息を強く出して破裂させます。",
  [("park", "initial", "[p]ark"), ("pen", "initial", "[p]en"), ("happy", "medial", "ha[pp]y"), ("people", "medial", "peo[p]le"), ("stop", "final", "sto[p]")],
  [("pea", "bee"), ("pie", "buy"), ("pack", "back"), ("cup", "cub")],
  [("Please pass the pepper.", "こしょうを取ってください。"), ("Pick up the paper.", "その紙を拾って。"), ("We stopped at the park.", "公園に寄りました。"),
   ("Help me open it.", "開けるのを手伝って。"), ("The plan is perfect.", "その計画は完璧です。"), ("Prices are up this spring.", "この春は値段が上がっています。")],
  voiced=False)
E("B", "B", "stop", "声を出す b",
  "くちびるを閉じてから、声を出しながら開きます。上の歯はくちびるに当てません。",
  "日本語のバ行とほぼ同じで、通じやすい音です。問題は、v の語を b で言ってしまうことです。くちびる同士を閉じるのが b、歯を下くちびるに当てるのが v、と確かめます。",
  ["V", "P"], "両方のくちびるを閉じてから、声を出して開きます。",
  [("big", "initial", "[b]ig"), ("book", "initial", "[b]ook"), ("baby", "medial", "ba[b]y"), ("table", "medial", "ta[b]le"), ("job", "final", "jo[b]")],
  [("berry", "very"), ("best", "vest"), ("boat", "vote"), ("ban", "van")],
  [("The baby is in bed.", "赤ちゃんは寝床にいます。"), ("Bring a big bag.", "大きなかばんを持ってきて。"),
   ("Both books are on the table.", "本は2冊とも机の上にあります。"), ("I'll be back by nine.", "9時までに戻ります。"),
   ("My brother bought a bike.", "兄は自転車を買いました。"), ("Begin at the beginning.", "最初から始めましょう。")],
  voiced=True)
E("T", "T", "stop", "舌先ではじく t",
  "舌先を上の歯ぐきに付けて息をため、強く離します。強い音節の最初では、息をはっきり出します。母音にはさまれると、軽くはじく音（ɾ）になります。",
  "ti や tu を、日本語の「チ」「ツ」で言いがちです（team、two）。舌先を歯ぐきの一点に当てて、すばやく離します。最後の t のあとに母音を足さないことにも注意します。",
  ["CH", "EPEN"], "舌先を歯ぐきの一点に当てて、すばやく離します。",
  [("time", "initial", "[t]ime"), ("team", "initial", "[t]eam"), ("until", "medial", "un[t]il"), ("night", "final", "nigh[t]"), ("eat", "final", "ea[t]")],
  [("tip", "chip"), ("tease", "cheese"), ("two", "do")],
  [("Turn at the next street.", "次の通りで曲がってください。"), ("It's time for tea.", "お茶の時間です。"), ("Two tickets, please.", "切符を2枚ください。"),
   ("Sit tight and wait.", "じっと待っていてください。"), ("I want to try it.", "やってみたいです。"), ("Don't touch the top.", "てっぺんに触らないで。")],
  voiced=False)
E("D", "D", "stop", "声を出す d",
  "舌先を上の歯ぐきに付けて、声を出しながら離します。最後の d は、舌先を付けたところで止めます。",
  "di や du を、日本語の「ジ」「ズ」で言いがちです（radio、during）。また、最後の d のあとに母音を足しやすい音です。舌先を付けたら、そこで止めます。",
  ["JH", "Z", "EPEN"], "舌先を歯ぐきに付けて、声を出して離します。",
  [("day", "initial", "[d]ay"), ("dog", "initial", "[d]og"), ("window", "medial", "win[d]ow"), ("good", "final", "goo[d]"), ("red", "final", "re[d]")],
  [("deep", "jeep"), ("dip", "zip"), ("do", "two")],
  [("Did you do it?", "あなたがやったの？"), ("I need a good bed.", "いい寝床が必要です。"), ("My dad drives a red car.", "父は赤い車を運転します。"),
   ("Don't be sad.", "悲しまないで。"), ("The dog had food.", "犬は食べ物をもらいました。"), ("Hold the door, please.", "扉を押さえていてください。")],
  voiced=True)
E("K", "K", "stop", "舌の奥で出す k",
  "舌の奥を上あごの奥に付けて息をため、強く離します。声は出しません。最後の k は、付けたところで止めます。",
  "日本語のカ行とほぼ同じで、通じやすい音です。最後の k のあとに母音を足しやすいので、舌の奥を付けたまま止めます。",
  ["G", "EPEN"], "舌の奥を上あごに付けて、息で離します。",
  [("cat", "initial", "[c]at"), ("key", "initial", "[k]ey"), ("because", "medial", "be[c]ause"), ("book", "final", "boo[k]"), ("back", "final", "ba[ck]")],
  [("coat", "goat"), ("back", "bag"), ("cold", "gold")],
  [("Can I keep the key?", "鍵を持っていてもいいですか？"), ("Look at the clock.", "時計を見て。"), ("I like black coffee.", "何も入れない珈琲が好きです。"),
   ("Come back quickly.", "早く戻ってきて。"), ("Pick a color.", "色を選んで。"), ("Check the kitchen.", "台所を確認して。")],
  voiced=False)
E("G", "G", "stop", "声を出す g",
  "舌の奥を上あごの奥に付けて、声を出しながら離します。最後の g は、付けたところで止めます。",
  "日本語のガ行とほぼ同じです。単語のまん中の g を鼻にかけた音にしないこと、最後の g のあとに母音を足さないことに注意します。",
  ["K", "EPEN"], "舌の奥を付けて、声を出して離します。",
  [("go", "initial", "[g]o"), ("good", "initial", "[g]ood"), ("again", "medial", "a[g]ain"), ("big", "final", "bi[g]"), ("dog", "final", "do[g]")],
  [("goat", "coat"), ("bag", "back"), ("gold", "cold")],
  [("Go get the bag.", "かばんを取ってきて。"), ("It's a big dog.", "大きな犬ですね。"), ("That was a good game.", "いい試合でした。"),
   ("Give me a hug.", "ぎゅっとして。"), ("I forgot again.", "また忘れてしまいました。"), ("The girl is eager to begin.", "その女の子は始めるのを楽しみにしています。")],
  voiced=True)
E("CH", "CH", "affricate", "くちびるを突き出す tʃ",
  "舌先を歯ぐきに付けてから、くちびるを少し突き出して、息で離します。声は出しません。",
  "日本語の「チ」とほぼ同じで、通じやすい音です。ただし、t の語（team、ticket）までこの音で言ってしまいがちです。t は舌先の一点、tʃ はくちびるを突き出す、と区別します。",
  ["SH", "T"], "舌先を付けてから、くちびるを突き出して息を出します。",
  [("cheap", "initial", "[ch]eap"), ("check", "initial", "[ch]eck"), ("kitchen", "medial", "ki[tch]en"), ("much", "final", "mu[ch]"), ("watch", "final", "wa[tch]")],
  [("chip", "ship"), ("cheap", "sheep"), ("watch", "wash"), ("chip", "tip")],
  [("Each child chose a chair.", "子どもたちはそれぞれ椅子を選びました。"), ("Watch the children.", "子どもたちを見ていてください。"),
   ("Thanks so much for lunch.", "お昼をありがとうございました。"), ("Which one is cheaper?", "どちらが安いですか？"),
   ("Let's chat at lunch.", "お昼に話しましょう。"), ("I watched the match.", "その試合を見ました。")],
  voiced=False)
E("JH", "JH", "affricate", "声を出す dʒ",
  "舌先を歯ぐきに付けてから、くちびるを少し突き出して、声を出しながら離します。",
  "日本語の「ジ」に近く、通じやすい音です。z の語（zero、zoo）や、ʒ の語（usually）まで、この音で言ってしまいがちです。dʒ は舌先をいったん付ける、z と ʒ は付けない、と区別します。",
  ["Z", "ZH", "Y"], "舌先をいったん付けてから、声を出して離します。",
  [("job", "initial", "[j]ob"), ("just", "initial", "[j]ust"), ("major", "medial", "ma[j]or"), ("page", "final", "pa[ge]"), ("large", "final", "lar[ge]")],
  [("jet", "yet"), ("jam", "yam"), ("gin", "chin")],
  [("Just a joke.", "ほんの冗談です。"), ("I enjoy my job.", "仕事を楽しんでいます。"), ("I just changed jobs.", "仕事を変えたばかりです。"),
   ("The bridge is large.", "その橋は大きいです。"), ("Imagine a huge garden.", "大きな庭を想像してみて。"), ("Enjoy your journey.", "よい旅を。")],
  voiced=True)
save()

E("F", "F", "fricative", "歯を下くちびるに当てる f",
  "上の前歯を、下くちびるの内側に軽く乗せます。そのすき間から息だけを通します。くちびる同士は付けません。",
  "日本語の「フ」は、両方のくちびるで息をこする音です。そのまま言うと、弱い h のように聞こえます。鏡で、上の歯が下くちびるに乗っているか確かめます。",
  ["HH"], "上の歯を下くちびるに乗せて、息だけを通します。",
  [("fine", "initial", "[f]ine"), ("phone", "initial", "[ph]one"), ("coffee", "medial", "co[ff]ee"), ("after", "medial", "a[f]ter"), ("half", "final", "hal[f]")],
  [("fat", "hat"), ("feel", "heel"), ("fold", "hold"), ("fair", "hair")],
  [("I feel fine.", "元気です。"), ("Five friends came for coffee.", "友だちが5人、珈琲を飲みに来ました。"), ("Fill out this form.", "この用紙に記入してください。"),
   ("Fresh fruit is my favorite.", "新鮮な果物が大好きです。"), ("I left my phone on the floor.", "電話を床に置いてきてしまいました。"),
   ("Half of my family is far away.", "家族の半分は遠くに住んでいます。")],
  voiced=False)
E("V", "V", "fricative", "歯を下くちびるに当てて声を出す v",
  "上の前歯を下くちびるの内側に軽く乗せ、声を出しながら息を通します。くちびるが少し震えるのを感じます。",
  "日本語の「ブ」で言うと b になり、very が berry、vote が boat に聞こえます。歯を下くちびるに当てたまま、声を響かせてから次の母音へ移ります。",
  ["B"], "上の歯を下くちびるに乗せて、声を出します。",
  [("very", "initial", "[v]ery"), ("visit", "initial", "[v]isit"), ("seven", "medial", "se[v]en"), ("over", "medial", "o[v]er"), ("love", "final", "lo[v]e")],
  [("very", "berry"), ("vote", "boat"), ("van", "ban"), ("vest", "best")],
  [("I have a very nice view.", "とても眺めがいいです。"), ("Seven of them voted.", "そのうち7人が投票しました。"), ("I love this video.", "この動画が大好きです。"),
   ("We arrived in the evening.", "夕方に着きました。"), ("Give it over here.", "それをこっちに渡して。"), ("It's never very heavy.", "全然重くありません。")],
  voiced=True)
E("TH", "TH", "fricative", "舌先を歯に当てる息の θ",
  "舌先を上の前歯の先に軽く当て、そのすき間から息だけを通します。強く噛んだり、舌を長く出したりしなくて大丈夫です。",
  "日本語の「ス」や「シ」で言うと、think が sink、thank が sank に聞こえます。舌先が歯に触れて、冷たい息が通るのを感じれば θ です。",
  ["S", "F"], "舌先を前歯に軽く当てて、息だけを通します。",
  [("think", "initial", "[th]ink"), ("three", "initial", "[th]ree"), ("nothing", "medial", "no[th]ing"), ("birthday", "medial", "bir[th]day"), ("mouth", "final", "mou[th]")],
  [("think", "sink"), ("thick", "sick"), ("mouth", "mouse"), ("path", "pass")],
  [("Thank you for everything.", "いろいろありがとう。"), ("I think three is enough.", "3つで足りると思います。"), ("Both of them are healthy.", "二人とも元気です。"),
   ("Nothing is worth that much.", "それほどの価値があるものはありません。"), ("Brush your teeth after a bath.", "お風呂のあとに歯をみがいて。"),
   ("My birthday is on the third.", "誕生日は3日です。")],
  voiced=False)
E("DH", "DH", "fricative", "舌先を歯に当てる声の ð",
  "θ と同じく、舌先を上の前歯の先に軽く当てます。今度は声を出しながら息を通します。the や this のような短い語では、ごく軽く触れるだけです。",
  "日本語のザ行やダ行で言うと、this が別の音に聞こえます。舌先が歯に触れたまま、声が響いているのを感じます。",
  ["Z", "D"], "舌先を前歯に軽く当てたまま、声を出します。",
  [("this", "initial", "[th]is"), ("they", "initial", "[th]ey"), ("mother", "medial", "mo[th]er"), ("weather", "medial", "wea[th]er"), ("with", "final", "wi[th]")],
  [("they", "day"), ("those", "doze"), ("breathe", "breeze"), ("then", "den")],
  [("This is their house.", "これが彼らの家です。"), ("Is that the one?", "それがそうですか？"), ("They're over there.", "彼らはあそこにいます。"),
   ("My mother and father are together.", "母と父は一緒にいます。"), ("The weather is better than that.", "天気はそれよりいいです。"),
   ("I'll go with them.", "彼らと一緒に行きます。")],
  voiced=True)
E("S", "S", "fricative", "細い息の s",
  "上下の歯を近づけ、舌先を上の歯ぐきの近くに置いて、細く強い息を出します。くちびるは横に引き、突き出しません。",
  "si を日本語の「シ」で言うと、sea が she に聞こえます。「スー」と細い息を出したまま、そのまま「イ」へつなげます。th の語（think）を s で言ってしまうことにも注意します。",
  ["SH", "TH"], "歯を近づけて、細く強い息を出します。",
  [("see", "initial", "[s]ee"), ("sit", "initial", "[s]it"), ("city", "initial", "[c]ity"), ("lesson", "medial", "le[ss]on"), ("bus", "final", "bu[s]")],
  [("sea", "she"), ("sip", "ship"), ("sort", "short"), ("sink", "think")],
  [("See you soon.", "またね。"), ("Sit in this seat.", "この席に座ってください。"), ("I miss the city.", "あの街が恋しいです。"),
   ("Let's start a new lesson.", "新しい授業を始めましょう。"), ("Say it slowly, please.", "ゆっくり言ってください。"),
   ("Sorry, it's sold out.", "すみません、売り切れです。")],
  voiced=False)
E("Z", "Z", "fricative", "声を出す z",
  "s と同じ口と舌の形で、声を出します。舌先はどこにも付けません。歯のすき間で、声と息が震えるのを感じます。",
  "日本語の「ズ」「ジ」は舌先をいったん付けるので、dz や dʒ に近くなります。zero や music の s は、舌先を付けずに声を響かせます。最後の z のあとに母音を足さないことも大切です。",
  ["JH", "S", "EPEN"], "舌先を付けずに、声を響かせて。",
  [("zero", "initial", "[z]ero"), ("zoo", "initial", "[z]oo"), ("busy", "medial", "bu[s]y"), ("music", "medial", "mu[s]ic"), ("rise", "final", "ri[s]e")],
  [("rise", "rice"), ("eyes", "ice"), ("peas", "peace"), ("zip", "dip")],
  [("It's easy, isn't it?", "かんたんでしょう？"), ("I'm busy these days.", "最近忙しいです。"), ("Close your eyes.", "目を閉じて。"),
   ("Please choose a size.", "大きさを選んでください。"), ("The zoo is closed.", "動物園は閉まっています。"), ("These are his shoes.", "これは彼の靴です。")],
  voiced=True)
E("SH", "SH", "fricative", "くちびるを突き出す ʃ",
  "くちびるを前に丸く突き出し、舌を s より少し奥に引きます。広く強い息を出します。声は出しません。",
  "日本語の「シ」に近く、通じやすい音です。ただし、s の語（see、sit）までこの音で言ってしまいがちです。くちびるを突き出すのが ʃ、横に引くのが s、と区別します。",
  ["S"], "くちびるを前に突き出して、広い息を出します。",
  [("she", "initial", "[sh]e"), ("shop", "initial", "[sh]op"), ("sugar", "initial", "[s]ugar"), ("station", "medial", "sta[ti]on"), ("wash", "final", "wa[sh]")],
  [("she", "sea"), ("ship", "sip"), ("short", "sort"), ("shell", "sell")],
  [("She is sure of it.", "彼女はそう確信しています。"), ("Wash the dishes.", "お皿を洗って。"), ("Show me the shop.", "そのお店を案内してください。"),
   ("I wish I could fish.", "釣りができたらいいのに。"), ("Should I push it?", "押したほうがいいですか？"), ("Fresh fish, please.", "新鮮な魚をください。")],
  voiced=False)
E("ZH", "ZH", "fricative", "声を出す ʒ",
  "ʃ と同じ口の形で、くちびるを突き出したまま声を出します。舌先はどこにも付けません。",
  "日本語の「ジ」は舌をいったん付けるので、dʒ に近くなります。usually や measure の s は、舌を付けずに、声のこもった「シュ」を出します。",
  ["JH", "SH"], "くちびるを突き出し、舌を付けずに声を出します。",
  [("genre", "initial", "[g]enre"), ("usually", "medial", "u[s]ually"), ("measure", "medial", "mea[s]ure"), ("beige", "final", "bei[ge]"), ("garage", "final", "gara[ge]")],
  [("leisure", "ledger"), ("pleasure", "pledger"), ("delusion", "dilution")],
  [("Measure it at your leisure.", "時間のあるときに測ってください。"), ("It's a pleasure, as usual.", "いつものとおり、どういたしまして。"),
   ("Usually, the decision is mine.", "たいてい、決めるのは私です。"), ("I measure with precision.", "正確に測ります。"),
   ("It was a pleasure to see the treasure.", "その宝物を見られてうれしかったです。"), ("No confusion, as usual.", "いつもどおり、混乱はありません。")],
  voiced=True)
E("HH", "HH", "fricative", "のどから息を出す h",
  "口を次の母音の形にしたまま、のどの奥から息だけを出します。くちびるや舌で、息をこすりません。",
  "日本語の「フ」は両方のくちびるで、「ヒ」は舌で息をこすります。who や he をそのまま言うと、f や ʃ に近く聞こえます。寒い日に手を温める「ハー」の息で言うと近づきます。",
  ["F", "SH"], "のどの奥から、息だけを出します。",
  [("hat", "initial", "[h]at"), ("who", "initial", "[wh]o"), ("he", "initial", "[h]e"), ("behind", "medial", "be[h]ind"), ("perhaps", "medial", "per[h]aps")],
  [("hat", "fat"), ("heel", "feel"), ("he", "she"), ("hold", "fold")],
  [("He's at home.", "彼は家にいます。"), ("Who has the key?", "だれが鍵を持っていますか？"), ("How are you holding up?", "調子はどうですか？"),
   ("Help me with my homework.", "宿題を手伝って。"), ("Her hair is long.", "彼女の髪は長いです。"), ("I hope you're happy here.", "ここで楽しく過ごせるといいですね。")],
  voiced=False)
save()

E("M", "M", "nasal", "くちびるを閉じる m",
  "くちびるを閉じたまま、鼻から声を出します。最後の m も、くちびるを閉じたまま止めます。",
  "日本語のマ行とほぼ同じです。最後の m のあとに母音を足したり、口を開けて「ン」にしたりしないよう、くちびるを閉じて終わります。",
  ["N", "EPEN"], "くちびるを閉じたまま、鼻に響かせます。",
  [("money", "initial", "[m]oney"), ("make", "initial", "[m]ake"), ("summer", "medial", "su[mm]er"), ("home", "final", "ho[m]e"), ("time", "final", "ti[m]e")],
  [("some", "sun"), ("team", "teen"), ("same", "sane")],
  [("Come home early.", "早く帰ってきて。"), ("My mom made lunch.", "母がお昼を作ってくれました。"), ("Let me make some time.", "時間を作ります。"),
   ("I'm from a small town.", "小さな町の出身です。"), ("Summer is my favorite time.", "夏がいちばん好きな季節です。"), ("Many members came.", "たくさんの会員が来ました。")],
  voiced=True)
E("N", "N", "nasal", "舌先を付ける n",
  "舌先を上の歯ぐきにしっかり付けて、鼻から声を出します。最後の n も、舌先を付けたまま止めます。",
  "日本語の最後の「ン」は、舌がどこにも付かない音です。そのまま言うと、sun が sung のように聞こえます。英語の n は、最後まで舌先を歯ぐきに付けておきます。",
  ["NG", "EPEN"], "舌先を歯ぐきに付けたまま、鼻に響かせます。",
  [("name", "initial", "[n]ame"), ("night", "initial", "[n]ight"), ("dinner", "medial", "di[nn]er"), ("sun", "final", "su[n]"), ("clean", "final", "clea[n]")],
  [("sun", "sung"), ("win", "wing"), ("thin", "thing"), ("ran", "rang")],
  [("Not now, maybe next time.", "今はやめて、また今度にしよう。"), ("I need a new one.", "新しいのが必要です。"), ("Turn it on again.", "もう一度つけてください。"),
   ("Nine is fine.", "9時で大丈夫です。"), ("Dinner is in an hour.", "夕食は1時間後です。"), ("Can I clean the kitchen?", "台所を掃除してもいいですか？")],
  voiced=True)
E("NG", "NG", "nasal", "舌の奥で鼻に抜ける ŋ",
  "舌の奥を上あごの奥に付けて、鼻から声を出します。最後に g をはっきり言わず、付けたまま止めます。",
  "つづりの g につられて、sing の最後に g と母音を足して言いがちです。日本語で「ン」のあとにガ行が来るときの、鼻に抜ける音に近い感覚です。",
  ["N", "G", "EPEN"], "舌の奥を付けて鼻に響かせ、g は言いません。",
  [("singer", "medial", "si[ng]er"), ("english", "medial", "e[n]glish"), ("long", "final", "lo[ng]"), ("sing", "final", "si[ng]"), ("morning", "final", "morni[ng]")],
  [("sing", "sin"), ("wing", "win"), ("thing", "thin"), ("rang", "ran")],
  [("I'm going shopping.", "買い物に行きます。"), ("Sing a long song.", "長い歌を歌って。"), ("Thanks for coming this morning.", "今朝は来てくれてありがとう。"),
   ("Bring something to drink.", "何か飲み物を持ってきて。"), ("The king is young.", "王様は若いです。"), ("Are you doing anything?", "何かしていますか？")],
  voiced=True)
E("L", "L", "liquid", "舌先を付ける l",
  "舌先を上の前歯の付け根に、しっかり押し当てます。当てたまま声を出し、舌の両わきから声を流します。単語の最後の l は、舌先を付けたまま止めます。",
  "日本語のラ行は、舌先で一瞬はじくだけの音です。そのまま言うと、l とも r とも聞こえる音になります。舌先を付けたまま「ンー」と声を出す感覚を覚えると、l が安定します。",
  ["R", "EPEN"], "舌先を前歯の付け根に付けたまま、声を出します。",
  [("light", "initial", "[l]ight"), ("late", "initial", "[l]ate"), ("hello", "medial", "he[ll]o"), ("feel", "final", "fee[l]"), ("school", "final", "schoo[l]")],
  [("light", "right"), ("lock", "rock"), ("glass", "grass"), ("load", "road")],
  [("Let's eat lunch.", "お昼を食べよう。"), ("I'd like a little milk.", "牛乳を少しください。"), ("Leave the light on.", "明かりはつけたままにして。"),
   ("Please call me later.", "あとで電話してください。"), ("Hello, I'm a little lost.", "こんにちは、少し道に迷ってしまって。"), ("I feel lucky.", "運がいい気がします。")],
  voiced=True)
E("R", "R", "liquid", "舌をどこにも付けない r",
  "くちびるを軽く丸め、舌先を少し持ち上げて奥へ引きます。舌先はどこにも付けずに、声を出します。始める前に、口を小さく「ゥ」の形にすると出しやすくなります。",
  "日本語のラ行は、舌先で上あごを一瞬はじきます。英語の r では、舌は最後までどこにも触れません。舌先が触れた感じがしたら、l やラ行になっています。",
  ["L"], "舌をどこにも付けず、くちびるを丸めて。",
  [("red", "initial", "[r]ed"), ("right", "initial", "[r]ight"), ("sorry", "medial", "so[rr]y"), ("very", "medial", "ve[r]y"), ("car", "final", "ca[r]")],
  [("right", "light"), ("rice", "lice"), ("road", "load"), ("wrong", "long")],
  [("The room is ready.", "部屋の準備ができました。"), ("Read it right now.", "今すぐ読んでください。"), ("Sorry, I'm really tired.", "ごめんなさい、すごく疲れているんです。"),
   ("It might rain tomorrow.", "明日は雨かもしれません。"), ("Drive carefully on the road.", "道路では気をつけて運転して。"),
   ("Three friends arrived early.", "友だちが3人、早めに着きました。")],
  voiced=True)
E("W", "W", "glide", "くちびるをすぼめる w",
  "くちびるを小さく丸めてすぼめ、そこから次の母音へ、ゆるめながら移ります。声を出したまま、くちびるの動きで作る音です。",
  "日本語には「ウ」の前のワ行がないため、woman、would、wood の w が消えがちです。「ウ」の前でも、いったんくちびるをすぼめてから始めます。",
  [], "くちびるをすぼめてから、ゆるめて次の母音へ。",
  [("water", "initial", "[w]ater"), ("woman", "initial", "[w]oman"), ("would", "initial", "[w]ould"), ("away", "medial", "a[w]ay"), ("quick", "medial", "q[u]ick")],
  [("wine", "vine"), ("west", "vest"), ("wet", "vet")],
  [("We want water.", "水がほしいです。"), ("Would you wait a while?", "少し待ってもらえますか？"), ("The woman went west.", "その女性は西へ向かいました。"),
   ("What a wonderful week!", "なんてすてきな一週間！"), ("I walk with my wife.", "妻と一緒に歩きます。"), ("Which way is the window?", "窓はどちらですか？")],
  voiced=True)
E("Y", "Y", "glide", "舌を上あごに近づける j",
  "舌の中ほどを上あごに近づけて、「イ」の形から次の母音へすべらせます。year や yes では、最初にこの動きをはっきり入れます。",
  "日本語には「イ」の前のヤ行がないため、year が ear、yeast が east に聞こえがちです。舌を上あごに近づけたまま、軽く押し出すように始めます。",
  [], "舌を上あごに近づけてから、次の母音へすべらせます。",
  [("yes", "initial", "[y]es"), ("year", "initial", "[y]ear"), ("young", "initial", "[y]oung"), ("onion", "medial", "on[i]on"), ("music", "medial", "m[u]sic")],
  [("yet", "jet"), ("yam", "jam"), ("year", "ear", "near", "year は ear の前に j が付いた語です。日本人がいちばん落としやすい音です。")],
  [("Yes, you're right.", "はい、その通りです。"), ("Are you ready yet?", "もう準備できた？"), ("See you next year.", "また来年。"),
   ("Is this your yellow umbrella?", "これはあなたの黄色い傘ですか？"), ("Young people use it.", "若い人が使っています。"), ("Do you need a few more?", "もう少し要りますか？")],
  voiced=True)
save()

# ================================================================ allophone
E("DX", "T", "allophone", "はじく t（ɾ）",
  "舌先で上の歯ぐきを、一回だけ軽くはじきます。日本語のラ行の舌の動きとほぼ同じです。強い音節のあとで、t や d が母音にはさまれたときに出ます。",
  "つづりどおり、はっきりした t で言うと、丁寧すぎる発音に聞こえます。ここは、日本語のラ行がそのまま役に立つ音です。辞書では t と書かれていますが、米国英語ではこの音になります。",
  [], "ラ行のように、舌先で一回だけ軽くはじきます。",
  [("water", "medial", "wa[t]er"), ("better", "medial", "be[tt]er"), ("city", "medial", "ci[t]y"), ("party", "medial", "par[t]y"), ("little", "medial", "li[tt]le")],
  [("latter", "ladder", "same-in-GA", "米国英語では、どちらもほぼ同じはじく音になります。"),
   ("writer", "rider", "same-in-GA", "はじく音は同じで、前の母音の長さが少し違います。")],
  [("Get a bottle of water.", "水を1本買ってきて。"), ("A little bit better.", "少しよくなりました。"), ("I'm waiting for my daughter.", "娘を待っています。"),
   ("Is it a pretty city?", "きれいな街ですか？"), ("The letter came later.", "手紙はあとから届きました。"), ("Forty or eighty?", "40ですか、80ですか？")],
  allophone_of=["T", "D"], voiced=True)
save()

# ================================================================ legend
L = [
    ("iː", "vowel", "長い i", "口を横に強く引いた、長い「イー」。", ["see", "eat"]),
    ("i", "vowel", "短い i", "力を抜いた短い「イ」。少し「エ」寄り。弱い音節では、happy の最後の軽い「イ」も表します。", ["sit", "happy"]),
    ("e", "vowel", "e", "日本語の「エ」に近い、短い音。", ["bed", "said"]),
    ("æ", "vowel", "エの口の a", "「エ」の口のまま「ア」と言う音。", ["cat", "apple"]),
    ("ɑ", "vowel", "あくびの a", "口を縦に大きく開けた「ア」。", ["hot", "stop"]),
    ("ɑːr", "vowel", "a と r", "口を大きく開けた「アー」のあと、舌を奥へ引いて r の響きで終わります。", ["car", "park"]),
    ("ɔː", "vowel", "長い o", "口を縦に開け、少し丸めた長い音。", ["walk", "call"]),
    ("ɔːr", "vowel", "o と r", "口を開けた「オー」のあと、舌を奥へ引いて r の響きで終わります。", ["more", "door"]),
    ("u", "vowel", "短い u", "くちびるを軽く丸めるだけの、短くゆるい「ウ」。", ["book", "good"]),
    ("uː", "vowel", "長い u", "くちびるを突き出した、長い「ウー」。", ["food", "too"]),
    ("ʌ", "vowel", "短く軽い a", "口を小さく開けた、短く軽い「ア」。強い音節に出ます。", ["cup", "love"]),
    ("ə", "vowel", "あいまい母音", "力を抜いた、ごく短い弱い音。強くない音節に出ます。", ["about", "lemon"]),
    ("ɚ", "vowel", "弱い r の母音", "舌を奥へ引いて、短く響かせる弱い音。", ["teacher", "water"]),
    ("ɚː", "vowel", "強い r の母音", "舌を奥へ引いたまま、こもった音を長めに響かせます。強い音節では ɚ́ː と書きます。", ["bird", "work"]),
    ("iɚ", "vowel", "i と r", "「イ」から、舌を奥へ引いて r の響きへ。", ["here", "near"]),
    ("eɚ", "vowel", "e と r", "「エ」から、舌を奥へ引いて r の響きへ。", ["hair", "there"]),
    ("uɚ", "vowel", "u と r", "「ウ」から、舌を奥へ引いて r の響きへ。", ["sure", "tour"]),
    ("eɪ", "diphthong", "エイ", "「エ」から「イ」へ動く音。「エー」と伸ばしません。", ["make", "day"]),
    ("aɪ", "diphthong", "アイ", "「ア」を強く、「イ」を軽く添える1つの音。", ["time", "my"]),
    ("ɔɪ", "diphthong", "オイ", "「オ」から「イ」へ動く1つの音。", ["boy", "voice"]),
    ("aʊ", "diphthong", "アウ", "「ア」から、くちびるを丸めて「ウ」へ動く音。", ["now", "house"]),
    ("oʊ", "diphthong", "オウ", "「オ」から、くちびるをすぼめて「ウ」へ動く音。「オー」と伸ばしません。", ["go", "home"]),
    ("aɪɚ", "diphthong", "アイと r", "aɪ のあと、舌を奥へ引いて r の響きへ。", ["fire", "tired"]),
    ("aʊɚ", "diphthong", "アウと r", "aʊ のあと、舌を奥へ引いて r の響きへ。", ["hour", "our"]),
    ("p", "consonant", "p", "くちびるを閉じて、息を強く破裂させます。", ["park", "stop"]),
    ("b", "consonant", "b", "くちびるを閉じて、声を出して開きます。", ["big", "job"]),
    ("t", "consonant", "t", "舌先を歯ぐきの一点に当てて離します。米国英語では、母音にはさまれると ɾ（はじく音）になります。", ["time", "eat"]),
    ("d", "consonant", "d", "舌先を歯ぐきに当てて、声を出して離します。", ["day", "good"]),
    ("k", "consonant", "k", "舌の奥を上あごに付けて、息で離します。", ["key", "book"]),
    ("g", "consonant", "g", "舌の奥を上あごに付けて、声を出して離します。", ["go", "big"]),
    ("tʃ", "consonant", "ch", "舌先を付けてから、くちびるを突き出して息を出します。", ["check", "much"]),
    ("dʒ", "consonant", "j", "舌先を付けてから、くちびるを突き出して声を出します。", ["job", "page"]),
    ("f", "consonant", "f", "上の歯を下くちびるに乗せて、息だけを通します。", ["fine", "half"]),
    ("v", "consonant", "v", "上の歯を下くちびるに乗せて、声を出します。", ["very", "love"]),
    ("θ", "consonant", "息の th", "舌先を前歯に軽く当てて、息だけを通します。", ["think", "mouth"]),
    ("ð", "consonant", "声の th", "舌先を前歯に軽く当てて、声を出します。", ["this", "mother"]),
    ("s", "consonant", "s", "歯を近づけて、細く強い息を出します。", ["see", "bus"]),
    ("z", "consonant", "z", "s の形のまま、声を出します。舌先は付けません。", ["zoo", "busy"]),
    ("ʃ", "consonant", "sh", "くちびるを突き出して、広い息を出します。", ["she", "wash"]),
    ("ʒ", "consonant", "声の sh", "ʃ の形のまま、声を出します。舌先は付けません。", ["usually", "measure"]),
    ("h", "consonant", "h", "のどの奥から、息だけを出します。", ["hat", "who"]),
    ("m", "consonant", "m", "くちびるを閉じたまま、鼻に響かせます。", ["make", "home"]),
    ("n", "consonant", "n", "舌先を歯ぐきに付けたまま、鼻に響かせます。", ["name", "sun"]),
    ("ŋ", "consonant", "ng", "舌の奥を付けて、鼻に響かせます。g は言いません。", ["sing", "long"]),
    ("l", "consonant", "l", "舌先を前歯の付け根に付けたまま、声を出します。", ["light", "feel"]),
    ("r", "consonant", "r", "舌をどこにも付けず、くちびるを丸めて声を出します。", ["red", "car"]),
    ("w", "consonant", "w", "くちびるをすぼめてから、ゆるめて次の母音へ。", ["water", "woman"]),
    ("j", "consonant", "y の音", "舌を上あごに近づけてから、次の母音へすべらせます。y のつづりでも j と書きます。", ["yes", "year"]),
    ("ɾ", "consonant", "はじく t", "舌先で一回だけ軽くはじく音。辞書では t と書かれ、米国英語で母音にはさまれた t がこの音になります。", ["water", "city"]),
    ("´", "mark", "第1強勢", "この記号が付いた母音の音節を、いちばん強く、高く、長く言います。", ["about", "hotel"]),
    ("`", "mark", "第2強勢", "この記号が付いた母音の音節を、2番目に強く言います。", ["okay", "everything"]),
    ("ː", "mark", "長音", "前の母音を長くのばします。", ["see", "food"]),
    ("/ /", "mark", "発音記号のくくり", "/ と / の間が、その単語の発音です。", ["rice"]),
]
LEGEND = {"version": 1, "style_ja": DATA["style_ja"],
          "symbols": [{"symbol": s, "kind": k, "name_ja": j(n), "how_ja": j(h), "examples": ex,
                       "example_ipa": [ipa.word_ipa(w) for w in ex]} for s, k, n, h, ex in L]}
LEG.write_text(json.dumps(LEGEND, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
