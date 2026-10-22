# Curriculum: shortest path to native-like General American for Japanese adults

Data (each built by a script and checked by `check_cmudict.py`):

| file | built by | contents |
|---|---|---|
| `curriculum.json` (v2) | `build_curriculum.py` | 10 units, 57 lessons (incl. 10 boss lessons), 341 items, all sentences/phrases; 8 placement sentences |
| `challenge.json` | `build_challenge.py` | 20 long sentences, 6 self-introduction scripts (25 lines), 8 dialogues (50 turns, 25 scored `you` lines) |
| `phonemes.json` | `build_phonemes.py` | 42 entries (all GA phonemes, schwa and ɚ as their own entries, flap ɾ as an allophone note), 252 practice sentences |
| `ipa-legend.json` | `build_phonemes.py` | 53 symbols and marks, with Japanese name and how to read them |
| `alphabet.json` | `build_alphabet.py` | 26 letter names, 11 confusion sets, 32 practice sentences |

`ipa.py` turns CMUdict ARPAbet into dictionary-style IPA (shared by all build scripts and the checker).
Every English token (text, tts_text, pair, focus.word, examples, practice) is in CMUdict, and every `focus.phone` occurs in a CMUdict pronunciation of its word. Acronyms are used only when CMUdict reads them as their letters (FBI, BBC, VIP, PR); otherwise they are written with dots (I.D., G.P.S.).

## 1. Fixed feature tags

| tag | what it covers | typical L1-Japanese pattern | unit / lessons |
|---|---|---|---|
| `rhythm-stress` | word stress, strong/weak syllables, schwa, content vs function words | mora timing: every syllable the same length and loudness, full vowels everywhere ("ba-na-na") | U1 |
| `epenthesis` | consonant clusters, any consonant followed by an inserted vowel | CV syllables: "street" → su-to-rii-to, "good" → gud-do | U2 L1, L2, L5 |
| `final-consonants` | coda details: -s / -ed endings, final N vs NG, final dark L | ending in a vowel or in moraic ん; "feel" → fii-ru; "wing" ≈ "win" | U2 L3, L4 |
| `r-l` | /r/ vs /l/ | one flap ら行 for both; perception relies on F2, not F3 | U3 |
| `vowels-ae-ah-aa` | /æ/ /ʌ/ /ɑ/ | one あ for hat / hut / hot; "hot" said with お | U4 |
| `er` | /ɝ/ /ɚ/ and post-vocalic r (car, more) | long あー: "work" → wāku (≈ walk), "teacher" → tiichā | U5 |
| `linking-flap-reduction` | consonant-to-vowel linking, flap T, weak forms, gonna/wanna | word-by-word delivery, full forms of to/and/of, aspirated T in "water" | U6 |
| `th` | /θ/ /ð/ | TH → S / Z / D: "think" ≈ sink, "this" ≈ zis | U7 L1–L3, L5 |
| `s-sh` | consonant + i/u that kana reshapes: si→shi, ti→chi, tu→tsu, zi/di→ji | "sea" ≈ she, "team" → chiimu, "two" → tsuu, "music" → myuujikku | U7 L4 |
| `v-b` | /v/ vs /b/ | labiodental V → bilabial B: "very" ≈ berry | U8 L1, L2, L5 |
| `f-h` | /f/, /h/ and /w/ before u (all three collapse into ふ ɸ) | "food" with ɸ, "coffee" → koohii, "who" ≈ foo, "woman" → uuman | U8 L3, L4 |
| `vowels-tense-lax` | /ɪ/–/iː/, /ʊ/–/uː/, diphthongs /eɪ/ /oʊ/ | length-only contrast; "make" → meeku, "cold" → kōrudo (≈ called) | U9 |
| `intonation` | pitch range, focus / contrastive stress, question tunes, thought groups | narrow, flat pitch range; rising wh-questions; no de-accenting of given words | U10 |

Schema extensions (all optional, ignorable by older code):
- `lessons[].feature` — the tag that lesson trains (defaults to the unit's `feature`). It lets placement skip one lesson, not only a whole unit.
- `lessons[].boss: true` — the last lesson of every unit: 3 sentences of 12–20 words that combine the unit's feature with earlier units.
- `placement[].focus[]` — `{word, phone, watch_for, tag}`, so each scored phone can be added to the right tag.
- `focus[].ipa` (dictionary-style transcription of the focus word) and `focus[].ipa_note_ja` (only on flapped t).
- `items[].pair` is now metadata only: the minimal-pair partner of `focus[0].word`, for a listen-only reference. Nothing is recorded as a single word.

Conventions: `phone` / `watch_for` are ARPAbet without stress digits. `"EPEN"` = a vowel inserted after this consonant. An empty `watch_for` means "may be dropped or too weak" (e.g. the r in "car", the w in "woman"), or, in U10, that the target is the pitch movement on that syllable. IDs are positional (`u03-l2-04`); add new items at the end of a lesson.
Curriculum v2 (owner: 「一単語はいらない。文章がいい」): every item is a sentence or phrase.
- Lessons 1–2 use 3–6 words, later lessons 3–12 words, and the boss lesson 12–20 words (the checker enforces this).
- Minimal pairs appear inside one natural sentence, e.g. "Turn right at the light.", "There's a bug on my bag.", "I walk to work."
- IDs kept every v1 lesson's item count, so `u03-l2-04` is still unit 3, lesson 2, item 4.

Difficulty: 1 = 3–4 word sentence with one target, 2 = two targets or a contrast, 3 = cluster-heavy or a longer sentence, 4 = several targets, 5 = boss / long sentence.

Japanese text rules:
- No katakana readings of English words anywhere: a learner who sees ホテル under "hotel" anchors to the habit we fight. Stress is shown as ho·TEL（・●）.
- The checker rejects any katakana run except Japanese sound descriptions like 「アー」「エイ」.
- Names in translations stay in Latin letters (Ken, Aki). Loanword-only meanings use native words (珈琲, 扉, 上着).

IPA rules (owner: 「発音記号が大切」): IPA follows the Japanese learner's-dictionary style (ジーニアス / ウィズダム):
- r is written r; primary stress is ´ and secondary stress is ` over the vowel. Short vowels are i / u, long ones carry ː: think /θíŋk/, seat /síːt/, book /búk/, food /fúːd/.
- r-coloured vowels are ɚ / ɚ́ː (bird /bɚ́ːd/, teacher /tíːtʃɚ/). Vowel + r is car /kɑ́ːr/, here /híɚ/.
- The flap is written t with a note: water /wɔ́ːtɚ/.
- Weak forms are shown in weak-form drills (of /əv/, from /frəm/, to /tə/). Strong forms are shown where the word is stressed (Where are you from? → /frʌ́m/).

## 2. Why this order is the shortest path

Four principles, in priority order:

1. **Fix the shape before the sounds.** Accentedness and comprehensibility depend heavily on prosody (Anderson-Hsieh, Johnson & Koehler 1992; Kang 2010; Kang, Rubin & Pickering 2010). Prosody-focused instruction carried over into spontaneous speech, which segment-focused instruction did not (Derwing, Munro & Wiebe 1998; Gordon & Darcy 2016). For Japanese speakers the biggest timing problems are mora timing, missing vowel reduction (Lee, Guion & Harada 2006) and epenthesis, which adds syllables (Dupoux et al. 1999 show the inserted vowel is a perceptual illusion as well as a production habit). Rhythm and epenthesis show up in every sentence, so fixing them first pays off in every later item.
2. **High functional load before low.** Errors on high-functional-load contrasts hurt comprehensibility far more than low-load ones (Brown 1991; Munro & Derwing 2006). /l/–/r/ and /æ/–/ʌ/–/ɑ/ are at the top of Brown's ranking. /iː/–/ɪ/ is high. /θ/–/s/, /ð/–/z/ and /ʊ/–/uː/ are low.
3. **Start slow-to-learn contrasts early, so later units can keep recycling them.** /r/–/l/ is the classic case: adults improve with many varied exposures over time (Logan, Lively & Pisoni 1991; Bradlow et al. 1997), and Japanese listeners need to learn to use F3 (Iverson et al. 2003). With feedback, instruction on /ɹ/ improves Japanese learners' production (Saito & Lyster 2012). Pronunciation instruction works best with feedback and practice spread over time (Lee, Jang & Plonsky 2015; Thomson & Derwing 2015).
4. **Put sounds that share a mouth position next to each other, and mix in quick wins.** R → ER use the same tongue shape. TH / S / SH depend on where the tongue tip is. F / V / H / W are the sounds that ふ blurs. TH, V, F and the flap are easy to see and feel, so they are placed where motivation tends to dip.

Our goal is native-like speech, not just intelligibility (Derwing & Munro 2015 treat these as related but separate dimensions). So low-load but highly noticeable markers (TH, flap T, weak forms, rhoticity) are kept in, just later. The Lingua Franca Core (Jenkins 2000) would leave them out.

| # | unit (tag) | why it sits here |
|---|---|---|
| 1 | 英語の強弱 (`rhythm-stress`) | Biggest gain per minute: every utterance, largest share of accent ratings; stressed syllables made higher, longer and louder also starts the pitch-range work. |
| 2 | 母音を足さない (`epenthesis` + `final-consonants`) | Inserted vowels change the syllable count, which breaks unit 1's rhythm. Also a prerequisite for linking. |
| 3 | R と L (`r-l`) | Highest-load consonant contrast and the slowest to acquire, so it starts early and every later unit's sentences give spaced review. |
| 4 | 3つの「ア」 (`vowels-ae-ah-aa`) | Highest-load vowel contrasts, in very frequent words (have, can, but, much, not, got). |
| 5 | ER の音 (`er`) | Same tongue shape as unit 3's R. The strongest General American marker; -er/-or endings are everywhere. Its contrasts (walk/work, heart/hurt) need unit 4's vowels. |
| 6 | 音をつなげる (`linking-flap-reduction`) | Builds on units 1 (weak forms) and 2 (clean final consonants). The flap is a quick win because ら行 is already a flap. Huge naturalness gain. |
| 7 | TH・S・SH (`th` + `s-sh`) | Very frequent (the, this, think) and salient, but low load and easy. A midpoint quick win. si/ti/tu use the same tongue-tip control. |
| 8 | V・F・H・W (`v-b` + `f-h`) | Visible, easy labiodentals. f/h has high load but in Japanese speech the problem is mostly before u. |
| 9 | 長い音と短い音 (`vowels-tense-lax`) | /ɪ/–/iː/ moderate load, /ʊ/–/uː/ low. Diphthongs /eɪ/ /oʊ/ are polish ("cold" vs "called"). |
| 10 | 声の上がり下がり (`intonation`) | Capstone: focus, contrast, question tunes and thought groups on the longest sentences. It uses everything above. Pitch range itself has been trained since unit 1. |

Within each unit the path is: short sentence with the sound (3–6 words) → contrast sentence (both sounds in one sentence) → longer sentences (up to 12 words) → boss lesson (12–20 words). Single sounds and words live in `phonemes.json` as listen-only reference.
Before a feature's unit, the app should show its errors only in a neutral color and not count them. Only the current and already-taught features affect the score, so early units never punish TH or flaps the learner hasn't met yet ("fun, never frustrating").

Scoring caveats for the phone model (vocab = CMUdict ARPAbet with stress digits, no DX):
- A flap and an aspirated T are both `T`. For U6 flap items, add a duration / voicing check on the T segment (flap closure ≈ 20–40 ms, voiced). The `EPEN` check still catches "get-to up".
- Stress digits do exist in the model (AH0 vs AH1), so U1 can also score full vowels in weak syllables. Duration and F0 per syllable compared with the model's TTS give the rhythm score.
- U10 focus phones mark where the pitch peak or turn should be. The judgement is the F0 contour compared with the model's, not GOP.

## 3. Two-minute placement test

Eight sentences (`placement` in the JSON). For each one, the model plays once, the learner says it once, and there are no retries and no per-item feedback. That is about 12–15 s per item, so roughly 2 minutes including a 5-second mic check. Every tag gets at least two scored observations:

| id | text | diagnoses |
|---|---|---|
| p1 | Turn right at the light. | r-l, er, th, linking-flap-reduction, rhythm-stress |
| p2 | I think this is very good. | th, v-b, epenthesis, linking-flap-reduction |
| p3 | Please speak slowly. | epenthesis, final-consonants, vowels-tense-lax |
| p4 | Can I have a cup of hot coffee? | vowels-ae-ah-aa, v-b, f-h, rhythm-stress, intonation (yes/no rise) |
| p5 | I'll see you at six. | s-sh, final-consonants, linking-flap-reduction |
| p6 | Her work starts early. | er, final-consonants, epenthesis |
| p7 | Who would like some food? | f-h, vowels-tense-lax, r-l |
| p8 | What are you going to do? (TTS: "…gonna do?") | linking-flap-reduction, intonation (wh fall), rhythm-stress |

Decision per tag, on a 0–100 scale. Segmental tags use the mean GOP score of that tag's `placement.focus` phones, and a `watch_for` hit (e.g. EPEN detected, S heard for TH) caps that phone at 50. `rhythm-stress` uses the vowel-duration ratio and nPVI against the model on p1, p4 and p8 (Grabe & Low 2002). `intonation` uses the F0 contour correlation and pitch-range ratio on p4 and p8.

- **≥ 85 on every observation → skip**: the tag's lessons are skipped and 2 of its sentence items are put into the mixed review queue.
- **70–84 → short course**: only the tag's last lesson (sentence level) is assigned.
- **< 70 → full unit/lessons.**

A unit is skipped only when all its lesson tags are skipped. One bad observation is enough to keep a tag (better to give one extra lesson than to skip a real problem), and a skipped tag is checked again when its review items come up. The unit order never changes; placement only removes or shortens lessons.

## 4. References

- Anderson-Hsieh, J., Johnson, R., & Koehler, K. (1992). The relationship between native speaker judgments of nonnative pronunciation and deviance in segmentals, prosody, and syllable structure. *Language Learning, 42*(4).
- Bradlow, A. R., Pisoni, D. B., Akahane-Yamada, R., & Tohkura, Y. (1997). Training Japanese listeners to identify English /r/ and /l/: IV. *JASA, 101*(4).
- Brown, A. (1991). Functional load and the teaching of pronunciation. In A. Brown (Ed.), *Teaching English Pronunciation: A Book of Readings*. Routledge.
- Derwing, T. M., & Munro, M. J. (1997). Accent, intelligibility, and comprehensibility. *SSLA, 19*(1).
- Derwing, T. M., & Munro, M. J. (2015). *Pronunciation Fundamentals*. John Benjamins.
- Derwing, T. M., Munro, M. J., & Wiebe, G. (1998). Evidence in favor of a broad framework for pronunciation instruction. *Language Learning, 48*(3).
- Dupoux, E., Kakehi, K., Hirose, Y., Pallier, C., & Mehler, J. (1999). Epenthetic vowels in Japanese: A perceptual illusion? *JEP: HPP, 25*(6).
- Gordon, J., & Darcy, I. (2016). The development of comprehensible speech in L2 learners. *Journal of Second Language Pronunciation, 2*(1).
- Grabe, E., & Low, E. L. (2002). Durational variability in speech and the rhythm class hypothesis. *Laboratory Phonology 7*.
- Iverson, P., Kuhl, P. K., Akahane-Yamada, R., et al. (2003). A perceptual interference account of acquisition difficulties for non-native phonemes. *Cognition, 87*(1).
- Jenkins, J. (2000). *The Phonology of English as an International Language*. OUP.
- Kang, O. (2010). Relative salience of suprasegmental features on judgments of L2 comprehensibility and accentedness. *System, 38*(2).
- Kang, O., Rubin, D., & Pickering, L. (2010). Suprasegmental measures of accentedness and judgments of language learner proficiency in oral English. *Modern Language Journal, 94*(4).
- Lee, B., Guion, S. G., & Harada, T. (2006). Acoustic analysis of the production of unstressed English vowels by early and late Korean and Japanese bilinguals. *SSLA, 28*(3).
- Lee, J., Jang, J., & Plonsky, L. (2015). The effectiveness of second language pronunciation instruction: A meta-analysis. *Applied Linguistics, 36*(3).
- Logan, J. S., Lively, S. E., & Pisoni, D. B. (1991). Training Japanese listeners to identify English /r/ and /l/: A first report. *JASA, 89*(2).
- Munro, M. J., & Derwing, T. M. (1995). Foreign accent, comprehensibility, and intelligibility in the speech of second language learners. *Language Learning, 45*(1).
- Munro, M. J., & Derwing, T. M. (2006). The functional load principle in ESL pronunciation instruction: An exploratory study. *System, 34*(4).
- Saito, K., & Lyster, R. (2012). Effects of form-focused instruction and corrective feedback on L2 pronunciation development of /ɹ/ by Japanese learners of English. *Language Learning, 62*(2).
- Thomson, R. I., & Derwing, T. M. (2015). The effectiveness of L2 pronunciation instruction: A narrative review. *Applied Linguistics, 36*(3).
