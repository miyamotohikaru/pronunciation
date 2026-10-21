# tools/tts — お手本音声のビルド（Kokoro-82M）

ネイティブのお手本音声と、アプリが使う単語タイミングを
ビルド時に作る。
モデルは [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)（Apache-2.0）、
発音記号は misaki（アメリカ英語 G2P、未知語は espeak-ng `en-us`）。

## 準備（初回だけ）

```sh
~/.pyenv/versions/3.10.9/bin/python3 -m venv .venv-tts
.venv-tts/bin/pip install --timeout 120 --retries 10 "kokoro>=0.9.4" soundfile lameenc pyloudnorm
.venv-tts/bin/pip install --timeout 120 --retries 10 \
  "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
```

モデル本体と声は `.work/tts/models/Kokoro-82M/` に置く
（無ければ初回実行時に huggingface_hub で自動取得）。
`kokoro-v1_0.pth` と `voices/*.pt` の SHA256 は VOICES.md の値と一致を確認済み。

## 使い方

```sh
# 教材から作る（全項目 + プレースメント8文 + 対の相手の単語、2声 × 普通/ゆっくり）
.venv-tts/bin/python tools/tts/jobs_from_curriculum.py                  # -> .work/tts/jobs.json
.venv-tts/bin/python tools/tts/synth.py .work/tts/jobs.json             # 既定: af_heart, am_michael
.venv-tts/bin/python tools/tts/check.py                                 # 検品（聞かずに確認できる項目）
.venv-tts/bin/python tools/tts/check_focus.py                           # 教材の狙いの音が発音に入っているか

.venv-tts/bin/python tools/tts/synth.py tools/tts/samples.json          # 試験用の13文
.venv-tts/bin/python tools/tts/synth.py items.json --voices af_heart --only t01_rice --force
```

- 出力が揃っていて入力も変わっていなければ飛ばす（`source_hash`）。
  `--force` で作り直す。
  処理を変えたら `synth.py` の `PIPELINE_VERSION` を上げる。
- 1件ごとに秒数・合成時間・RTF・mp3 サイズ・音量・タイミング検品・OOV を表示する。
- 速さは3種類: ネイティブ（1.0）、`.slow`（0.8）、`.slower`（0.65）。
  項目ごとに `speed` / `slow_speed` / `slower_speed` で変えられる。
- 主なオプション: `--no-slow` `--slow-speed 0.8` `--no-slower` `--slower-speed 0.65` `--kbps 48` `--pad-ms 80`
  `--lufs -18` `--ceiling -1` `--out public/audio` `--work .work/tts` `--device cpu` `--seed 0`。
- `jobs_from_curriculum.py` は `content/curriculum.json` の
  `units[].lessons[].items[]` と `placement[]` をそのままの id で並べる。
  `tts_text` は**ただの綴り替え**として渡す（アプリは言い方の方を表示するので、
  タイミングの単語も綴り替えた単語になる）。
  `[` `]` が入っていたら、発音記号の指定と取り違えないようにエラーで止める。
- `pair` のある項目は、相手の単語も `<項目id>-pair` として作る（聞き分け用）。
- 発音の直しは `content/` ではなく `tools/tts/overrides.json` に書く
  （項目 id → `[for](/fəɹ/) you` のような指定）。
  括弧を外すと画面の文と同じになることを確かめてから使うので、
  タイミングの単語は画面の単語のまま。
  今入っているのは弱形の for / can / and、`live`（/lɪv/）、`catch`（/kæʧ/）。
- `check_focus.py`: 教材の focus（単語と ARPAbet の音）が、
  実際に読ませた misaki の発音記号に入っているかを照合する。
  coffee /kɔfi/、chocolate /ɑ/、really /iᵊ/ は方言の差として残している。
- `check.py` の印: 単語に入る割合（coverage）が 0.9 未満、
  最初の単語の開始のずれが 60 ms 超、
  misaki の辞書に無く espeak に回った単語（OOV）。

## 入力

JSON の配列。

```json
[
  {"id": "t05_want", "text": "What do you want to do?"},
  {"id": "t05_wanna", "text": "What do you want to do?", "tts_text": "What do you [want to](wanna) do?"},
  {"id": "t06_linked", "text": "I'm gonna check it out.", "tts_text": "I'm [gonna](/ɡˈʌnə/) [check it out](/ʧˌɛkɪTˈWt/)."},
  {"id": "x", "text": "...", "voice": "af_heart", "speed": 0.9, "slow_speed": 0.7}
]
```

- `id`: 英数字と `_` `-` だけ（`.` は不可。`.slow` `.16k` と区別するため）。
- `text`: 画面に出す文。
  `tts_text` が無ければこれを読む。
- `tts_text` の書き方は3通り。
  - 綴り替え: `What do you wanna do?`
    （単語タイミングも `wanna` になる）
  - 発音記号の指定: `[gonna](/ɡˈʌnə/)`（misaki の記法）
  - 綴り替えを括弧で: `[want to](wanna)`（このツールの拡張）。
    `wanna` を misaki で発音記号にしてから指定する。
    タイミングの単語は画面の文と同じ `want to` のまま。
- 発音記号は misaki / Kokoro v1.0 の記号。
  たたき音の T は `T`、g は `ɡ`（U+0261）、
  二重母音は `A`(eɪ) `I`(aɪ) `W`(aʊ) `Y`(ɔɪ) `O`(oʊ)、弱い母音は `ᵊ`。
  Kokoro が知らない記号は黙って捨てられるので、
  その場合はエラーで止める。
  読めない単語（発音記号が空）もエラーで止める。
- `voice`（文字列か配列）があれば、その項目だけ `--voices` の代わりに使う。
- `speed` の既定は 1.0。
  `.slow` 版は `slow_speed`（既定 0.8、普通版の倍率ではなく絶対値）。

## 出力（1項目 × 声 × 普通/ゆっくり/もっとゆっくり）

| ファイル | 中身 |
| --- | --- |
| `public/audio/<voice>/<id>[.slow|.slower].mp3` | モノラル 24 kHz、48 kbps CBR。前後の無音は 80 ms。-18 LUFS |
| `.work/tts/<voice>/<id>[.slow|.slower].wav` | 24 kHz・16bit。mp3 の元 |
| `.work/tts/<voice>/<id>[.slow|.slower].16k.wav` | 16 kHz・16bit・モノラル（解析用） |
| `.work/tts/<voice>/<id>[.slow|.slower].json` | 下記 |

wav・16k.wav・json は**同じ時間軸**（無音を詰めた後）。
mp3 も macOS の afconvert（CoreAudio）で復号すると 0 サンプルのずれで一致した。
音量も全ファイル同じ処理（同じ倍率）をかけてあるので、解析と再生の音が一致する。

```jsonc
{
  "id", "variant": "normal|slow", "text", "tts_text",
  "tts_input",      // 実際に Kokoro に渡した文（括弧の綴り替えを発音記号に置き換え済み）
  "voice", "speed", "sample_rate": 24000, "duration",
  "phonemes",       // 文全体の misaki 発音記号
  "words": [{"text", "start", "end", "phonemes"}],  // 秒。句読点は含まない
  "oov": [],        // misaki の辞書に無く espeak-ng で読んだ単語
  "audio": {"file", "bytes", "peak_dbfs", "clipped_samples"},
  "loudness": {"lufs", "true_peak_dbtp", "gain_db", "limiter_gr_db", "lufs_raw", "true_peak_raw_dbtp"},
  "trim": {"raw_duration", "offset", "pad"},  // 元の時刻 = 時刻 + offset
  "qa": {"onset_ms", "offset_ms", "coverage", "gaps", "edge_snap_ms"},  // edge_snap_ms: {start, end} 動かした量（+ は後ろへ）
  "timing": {"synth_s", "rtf"}, "generator", "source_hash"
}
```

## 単語タイミングについて

- KPipeline の `start_ts` / `end_ts`（発音記号ごとの予測長から出す推定値）を、
  無音を詰めた分だけずらしている。
  ずらさないと、話している区間のうち単語に入る割合は 0.70 前後、
  ずらすと 0.97〜0.98（`check.py` の `cov` と `cov_unshifted`）。
- 端の2か所は、音から測った位置に合わせ直している（`edge_snap_ms`）。
  最初の単語の開始 → 音の立ち上がり、最後の単語の終わり → 音の終わり
  （80 ms の余白を決めたのと同じ検出）。
  Kokoro のままだと、開始は中央値で普通の速さ 13 ms、ゆっくり版 95 ms 遅い。
  終わりは最後の音の予測長のせいで、中央値で 0.12 s（ゆっくり版 0.2 s）無音の中まではみ出す。
  逆に語末の破裂の前で切れることもある。
  1語の項目は、これで単語の区間がそのまま話している区間になる。
  文の中の境目は Kokoro の推定のまま。
- 文の途中、読点の間（ポーズ）の境目は 40〜60 ms ほど早めに出ることがある。
  厳密な音素の境目が要るなら、16k.wav で強制アラインメントをかけ直す。

## 既知の注意点

- lameenc は Xing/LAME タグを書かない。
  そこで、エンコーダの遅延分（576 サンプル、無音部分）を先に削って合わせている。
  Chrome / Firefox（ffmpeg 系）では復号器の遅延 529 サンプル（約 22 ms）だけ遅れる可能性がある。
- 音量: 全クリップ（2声・普通/ゆっくり）を ITU-R BS.1770-4 の
  integrated loudness -18 LUFS にそろえる（pyloudnorm）。
  真のピーク（4倍オーバーサンプリング）は -1 dBTP を超えさせない。
  超える分は倍率を下げずに、20 ms 窓のなめらかなリミッターで山だけ抑える
  （下げると、そのクリップだけ小さくなってしまうため）。
  抑えた量は json の `limiter_gr_db`。
  抑えすぎが気になる場合は `--lufs -20` にすると減る（`check.py` が試算を出す）。
- Kokoro の声は短い発話（10〜20 トークン未満。例: `Street.`）が弱いと
  VOICES.md に書かれている。
  耳での確認は短い項目から行う。
- Kokoro の音声には乱数のノイズが入る。
  `--seed`（既定 0）で毎回同じ音になる（同じ機械・同じ版の場合）。
