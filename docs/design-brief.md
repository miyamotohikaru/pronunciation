# 発音カラオケ — design brief (v0, 2026-10-21)

Working name: **発音カラオケ** (English: Pronunciation Karaoke). Provisional — confirm with the owner.

## Who / what / why
- **Audience**: Japanese adults (beginner → intermediate) who want genuinely native-like American English pronunciation. Many have tried apps and felt judged by arbitrary scores, or bored.
- **Primary job**: get them speaking within seconds, and show *exactly where* they differ from a native model — in a way they can hear, not only read.
- **Shortest path**: a 2-minute placement test finds the weak points with the biggest impact; the route skips what they already do well.
- **Mood**: a karaoke box, not a classroom. You sing English. The score is a game, never a verdict.

## The one bold thing: the pitch lane
English is shown as **melody**. Each syllable of the native model is a bar (vertical position = pitch, length = duration, thickness/brightness = stress), like the 音程バー of DAM 精密採点. While you speak, your own pitch line is drawn over the bars in real time. After you stop, your line is time-warped onto the native timeline so the two melodies sit on top of each other. Everything else on screen stays quiet and disciplined so the lane can carry the personality.

## Core loop (one item)
1. See the line ("lyrics"): big English text, small Japanese meaning. The lane shows the native melody.
2. Tap **お手本** — the native audio plays; the words wipe left→right in sync (karaoke lyric wipe); a cursor travels along the lane. **ゆっくり** plays the slow version.
3. Tap the mic and speak. The lane draws your pitch live; a level ring shows you are being heard. Recording stops by itself after you finish (VAD) — or tap again.
4. **Result in under a second**: score count-up (≈1.2 s, tap to skip) with a judgement word; three meters — 音 (sounds), リズム (rhythm/stress), 抑揚 (intonation); the sentence with every word coloured, wrong sounds underlined. Tap any word → a card: what we heard ("r が l に聞こえました"), a 2-line mouth tip, ▶ the native word, ▶ your word (segment playback), ⇄ alternate them.
5. **もう一回** is one tap and keeps your best. **次へ** advances. No hearts, no lives, no fail screen.

## Information architecture
- `/` — today's route (map of units with stars), streak (gentle), "ネイティブ度" trend, continue button.
- `/check` — placement test (≈6 sentences) → "あなたの伸びしろ トップ3" → route.
- `/learn/[unit]/[lesson]` — lesson: intro card (how to make the sound) → ear training (which did you hear? multiple voices) → speak drills (word → phrase → sentence) → boss sentence.
- `/free` — say anything from a list / your own sentence (later).
- `/lab` — engineering test bench (noindex).

## Game layer (fun without frustration)
- Stars per item: ★ ≥ 60, ★★ ≥ 75, ★★★ ≥ 90; PERFECT effect ≥ 95.
- Combo for consecutive ★★+; breaking a combo is silent.
- XP → level; personal best per item; mastery per feature (R/L, TH, リズム …).
- Sounds: short, soft, optional (mute toggle). Haptics where supported.
- Copy never scolds. Low scores get a concrete next step, not a verdict.

## v1 revision after the competitor teardown (.benchmarks/README.md)
- **ELSA, BoldVoice and Google all use dark navy→purple gradients.** A dark violet stage would read as "another ELSA". So the app is NOT dark overall.
- New direction — **karaoke telop on flat colour**: each unit owns one flat, saturated colour field (no gradients). The lyric line is the hero: huge karaoke-telop type (white fill, thick dark outline, wiping to the accent colour as it is sung — the classic Japanese karaoke caption). The pitch lane lives in a dark rounded "monitor" panel (the DAM 精密採点 feeling) — the only dark element on the screen.
- No pronunciation app gives live feedback while you speak, overlays your melody on the native's, or lets you compare sound by sound. Those three are our signature; make them unmissable.
- Result: DAM-style big score with decimals (87.352 — invites "one more"), a JOYSOUND-style breakdown whose parts visibly add up to the total (no opaque %), a per-word judgement list (PERFECT / GREAT / GOOD / もう一息 counts) for sentences, and DAM-style directional sliders that say which way you were off (ゆっくり ↔ 早口, 平坦 ↔ 大げさ).
- **Replay** (JOYSOUND): ▶ 自分の声 plays your take while the lane redraws your line in sync. **Ghost**: your previous best line shown faintly while you speak.
- Per-sound detail: better than BoldVoice's cards — every flagged sound has ▶ お手本 / ▶ あなた / ⇄ 交互に, the word's own mouth tip in Japanese, and "どっちに聞こえたか" (heard as).
- Borrow Duolingo's juice only: pressable 3D buttons, short sounds, combo pops, streak celebration.

## Visual tokens (v0 proposal — superseded by the v1 revision above where they conflict)
| token | value | role |
|---|---|---|
| stage | `#17123F` deep violet-indigo | page background (karaoke room at night, not near-black) |
| stage-raised | `#241D5C` | panels, lane background |
| lane-guide | `#62CBFF` | native melody bars (glow) |
| voice | `#FFD23F` | your live pitch line, your playback |
| hit | `#FF5CA8` | perfect/hit sparks, combo |
| good / near / miss | `#6EF0A0` / `#FFB648` / `#FF6F5B` | per-sound judgement colours |
| ink | `#F6F3FF` / muted `#ABA5D8` | text |

- Type: **M PLUS Rounded 1c** for Japanese and the English "lyrics" (rounded, friendly, karaoke-like; heavy weight with a soft stroke for the lyric wipe). Tabular heavy numerals for scores. IPA only on demand (Noto Sans fallback for ɹ θ æ ʌ).
- Layout: single column, centred lyrics and lane (it's a stage); everything else left-aligned. Mobile first (360–430 px), desktop is the same stage, larger, never a multi-column dashboard. Big thumb-zone mic button at the bottom.
- Motion: only where it answers the user (lyric wipe, live line, score reveal, card open). One orchestrated moment: the score reveal. Respect `prefers-reduced-motion`.
- House rules: Japanese copy breaks at 句点/読点 (◆ = break on mobile only, ◇ = always — BreakText). og:title = the site's name as the owner calls it. Favicon fills the canvas edge to edge.

## Quality bars (must-beat)
- Tap → native audio starts < 100 ms. Stop speaking → full result < 1 s on a recent phone (sounds may refine a moment later; rhythm/intonation instantly).
- Every red mark is playable in both voices.
- Native reference audio itself scores ≥ 95 in our own scorer.
- Works on iOS Safari and Android Chrome with no install; loudspeaker playback after recording (no earpiece trap).
