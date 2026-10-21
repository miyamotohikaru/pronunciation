# Curriculum: shortest path to native-like General American for Japanese adults

Data: `curriculum.json` (built by `build_curriculum.py`, checked by `check_cmudict.py`).
10 units, 47 lessons, 311 items, 8 placement sentences.
Every word in `text`, `tts_text`, `pair` and `focus.word` is in CMUdict, and every `focus.phone` occurs in a CMUdict pronunciation of its word.

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

Two small schema extensions (both optional, ignorable by older code):
- `lessons[].feature` — the tag that lesson trains (defaults to the unit's `feature`). It lets placement skip one lesson, not only a whole unit.
- `placement[].focus[]` — `{word, phone, watch_for, tag}`, so each scored phone can be added to the right tag.

Conventions: `phone` / `watch_for` are ARPAbet without stress digits. `"EPEN"` = a vowel inserted after this consonant. An empty `watch_for` means "may be dropped or too weak" (e.g. the r in "car", the w in "woman"), or, in U10, that the target is the pitch movement on that syllable. IDs are positional (`u03-l2-04`); add new items at the end of a lesson.
Difficulty: 1 = one short word, 2 = longer word / pair / short phrase, 3 = cluster or two targets, 4 = sentence with several targets, 5 = long sentence (≤ 10 words). Sentences are ≤ 6 words in U1–U5 and ≤ 10 words after that (the checker enforces this).

## 2. Why this order is the shortest path

Four principles, in priority order:

1. **Fix the shape before the sounds.** Accentedness and comprehensibility depend heavily on prosody (Anderson-Hsieh, Johnson & Koehler 1992; Kang 2010; Kang, Rubin & Pickering 2010). Prosody-focused instruction carried over into spontaneous speech, which segment-focused instruction did not (Derwing, Munro & Wiebe 1998; Gordon & Darcy 2016). For Japanese speakers the biggest timing problems are mora timing, missing vowel reduction (Lee, Guion & Harada 2006) and epenthesis, which adds syllables (Dupoux et al. 1999 show the inserted vowel is a perceptual illusion as well as a production habit). Rhythm and epenthesis show up in every sentence, so fixing them first pays off in every later item.
2. **High functional load before low.** Errors on high-functional-load contrasts hurt comprehensibility far more than low-load ones (Brown 1991; Munro & Derwing 2006). /l/–/r/ and /æ/–/ʌ/–/ɑ/ are at the top of Brown's ranking. /iː/–/ɪ/ is high. /θ/–/s/, /ð/–/z/ and /ʊ/–/uː/ are low.
3. **Start slow-to-learn contrasts early, so later units can keep recycling them.** /r/–/l/ is the classic case: adults improve with many varied exposures over time (Logan, Lively & Pisoni 1991; Bradlow et al. 1997), and Japanese listeners need to learn to use F3 (Iverson et al. 2003). With feedback, instruction on /ɹ/ improves Japanese learners' production (Saito & Lyster 2012). Pronunciation instruction works best with feedback and practice spread over time (Lee, Jang & Plonsky 2015; Thomson & Derwing 2015).
4. **Put sounds that share a mouth position next to each other, and mix in quick wins.** R → ER use the same tongue shape. TH / S / SH depend on where the tongue tip is. F / V / H / W are the sounds that ふ blurs. TH, V, F and the flap are easy to see and feel, so they are placed where motivation tends to dip.

Our goal is native-like speech, not just intelligibility (Derwing & Munro 2015 treat these as related but separate dimensions). So low-load but highly noticeable markers (TH, flap T, weak forms, rhoticity) are kept in, just later. The Lingua Franca Core (Jenkins 2000) would leave them out.

| # | unit (tag) | why it sits here |
|---|---|---|
| 1 | 英語のリズム (`rhythm-stress`) | Biggest gain per minute: every utterance, largest share of accent ratings; stressed syllables made higher, longer and louder also starts the pitch-range work. |
| 2 | 母音を足さない (`epenthesis` + `final-consonants`) | Inserted vowels change the syllable count, which breaks unit 1's rhythm. Also a prerequisite for linking. |
| 3 | R と L (`r-l`) | Highest-load consonant contrast and the slowest to acquire, so it starts early and every later unit's sentences give spaced review. |
| 4 | 3つの「ア」 (`vowels-ae-ah-aa`) | Highest-load vowel contrasts, in very frequent words (have, can, but, much, not, got). |
| 5 | ER の音 (`er`) | Same tongue shape as unit 3's R. The strongest General American marker; -er/-or endings are everywhere. Its contrasts (walk/work, heart/hurt) need unit 4's vowels. |
| 6 | 音をつなげる (`linking-flap-reduction`) | Builds on units 1 (weak forms) and 2 (clean final consonants). The flap is a quick win because ら行 is already a flap. Huge naturalness gain. |
| 7 | TH・S・SH (`th` + `s-sh`) | Very frequent (the, this, think) and salient, but low load and easy. A midpoint quick win. si/ti/tu use the same tongue-tip control. |
| 8 | V・F・H・W (`v-b` + `f-h`) | Visible, easy labiodentals. f/h has high load but in Japanese speech the problem is mostly before u. |
| 9 | 長い音と短い音 (`vowels-tense-lax`) | /ɪ/–/iː/ moderate load, /ʊ/–/uː/ low. Diphthongs /eɪ/ /oʊ/ are polish ("cold" vs "called"). |
| 10 | 声のメロディー (`intonation`) | Capstone: focus, contrast, question tunes and thought groups on the longest sentences. It uses everything above. Pitch range itself has been trained since unit 1. |

Within each unit the path is: sound alone (word) → contrast (minimal pair) → in context (phrase) → short sentence.
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
