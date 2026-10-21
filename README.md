# 発音カラオケ（仮）

日本語を話す人のための、アメリカ英語の発音練習サイト。
お手本を聞いて、話して、どこが違うかをカラオケの採点のように確かめる。
採点はブラウザの中だけで行い、声は外に送らない。

## 開発

```sh
npm ci
npm run dev   # http://localhost:3016
```

- 録音・再生・音程の確認用ページ: `/lab`
- 設計の方針: `docs/design-brief.md`
- 練習メニュー: `content/`（`curriculum.md` に順番の理由）
- お手本音声の作り方: `tools/tts/README.md`
- 採点のしくみ: `src/engine/scoring/README.md`
