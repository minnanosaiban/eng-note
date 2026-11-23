# eng-note(英語ノート)

英語学習アプリ。3つのタブだけの小さなアプリです。

- **英文**: eng-sentence の「英文」タブと同じ。パート・難易度・グループ・ラベル・解説の有無・検索で絞り込み、シャッフル、行ごとの 1.0/0.8/0.5 で読み上げ(間・繰り返し)、訳・文(S V O C M)の表示、文型・態時制相・助動詞などの枠、ラベル付け、.txt 保存、「＋ 英文」での追加
- **解説**: Markdown を貼り付けて(または .md ファイルを読み込んで)追加。編集画面にプレビューつき。見出し・箇条書き・表・コード・引用・リンクに対応(貼った内容でスクリプトは動きません)
- **同期**: 英文と解説を、端末で暗号化して Cloudflare(D1)に保存。QR コードでスマホに接続。パスフレーズを忘れると復元できません。同じタブに、データの読み込み(.json / .csv / .txt。eng-sentence のバックアップも可)とバックアップ保存があります

データは端末の IndexedDB に保存されます。

## 試す

```bash
python -m http.server 8630 -d public
```

同期も試すとき:

```bash
npx wrangler d1 migrations apply eng-note-db --local
npx wrangler dev --var SETUP_CODE:localtest
```

## 公開(Cloudflare)

1. `npx wrangler d1 create eng-note-db` で D1 を作り、表示された `database_id` を `wrangler.jsonc` に書く
2. `npx wrangler d1 migrations apply eng-note-db --remote`
3. `npx wrangler secret put SETUP_CODE`(保管庫を作るときのセットアップコード)
4. `npx wrangler deploy`

## フォルダ

```
public/   アプリ本体(index.html、style.css、js/、vendor/qrcode.js)。js/clean.js・practice.js・style.css は eng-sentence から引き継いだもの
src/      同期 API(Cloudflare Worker。暗号文の保存・取得だけ)
migrations/  D1 のテーブル定義
```

元は eng-sentence の同期の仕組み(暗号化・QR 接続)を引き継いでいます。保存先の名前・同期の種類(sentence / note)が別なので、eng-sentence のデータとは混ざりません。
