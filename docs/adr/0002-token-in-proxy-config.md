# ADR 0002: トークンは proxy 設定に保存し、プラグイン設定には入れない

- 状態: 採用
- 日付: 2026-10-29

## 背景

GitHub API の呼び出しにはトークンが要る。kintone プラグインには設定値の置き場が2つある。

- `kintone.plugin.app.setConfig` / `getConfig`: プラグインの JavaScript から読める。アプリの管理者なら画面から値を見られる
- `kintone.plugin.app.setProxyConfig` / `kintone.plugin.app.proxy`: kintone 側に保存し、`proxy` で外部へリクエストするときに kintone がヘッダーやボディを付け足す。プラグインの JavaScript からは値を取り出せない

## 決定

トークンは `setProxyConfig` で保存する。URL は `https://api.github.com/repos/{owner}/{repo}/`、メソッドは `GET` と `POST` の2件を登録し、`Authorization: Bearer <token>` と GitHub が求める `Accept` / `X-GitHub-Api-Version` をヘッダーとして持たせる。

`setConfig` に入れるのはリポジトリ名とフィールドの割り当てだけ。設定画面は、保存済みのトークンを表示せず、「保存済み。変更するときだけ入力」とだけ示す。

## 検討した他の案

**`setConfig` にトークンを入れる。** 実装はいちばん単純。しかしレコードを見られる全ユーザーの画面でトークンが JavaScript から読める状態になる。GitHub の Issue 書き込み権限を持つトークンをそこに置くのは、漏れたときの影響が kintone の外(GitHub のリポジトリ)に及ぶので避けた。

**Cloudflare Workers などの中継サーバーを立て、トークンはそちらに置く。** 秘匿性は同等以上で、GET/POST の2件登録も不要になる。しかし運用するサーバーが1つ増え、「プラグインだけで完結する」利点が消える。kintone が proxy の仕組みを用意している以上、まずそれを使う。

## 結果

- トークンがブラウザに降りてこない。設定画面でも再表示しない
- proxy 設定は URL の前方一致 + メソッドで適用されるため、リポジトリを変えたらトークンの再登録が要る。設定画面はこれを検出して再入力を求める
- `PATCH` など別のメソッドを使う機能を足すときは、登録するメソッドも足す必要がある(忘れると 401 になる)。`src/config.ts` の保存処理に集約してある
