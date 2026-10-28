# コードを読む順番

面接で「ここはなぜこう書いたか」を自分の言葉で説明できるようにするための読解ガイド。所要時間は合計 1 時間程度。

## 1. `manifest.json`(5分)

- `desktop.js` と `config.js` の2本だけ。モバイルは外した
- `required_params` の3つが、設定画面で必須にしている項目と一致している

## 2. `src/lib/config.ts`(10分)

- `PluginConfig` の各項目が「何に使うか」をコメントで言えるか
- `validateConfig` の4つのチェック。特に「書き込み先の重複」をなぜ弾くか
- `repoApiBaseUrl`: proxy 設定の鍵になる URL。末尾の `/` がある理由(前方一致で `issues` と `issues/{n}` の両方に当てる)

## 3. `src/lib/github.ts`(15分)

- `ProxyFn`: HTTP を外から渡す形にした理由(ADR 0004)
- `buildCreateIssueBody`: 空の本文・ラベルを送らない理由(GitHub 側の既定に任せる)
- `classifyStatus`: 401 / 403 / 404 / 422 / 5xx の違いと、利用者への案内がどう違うか
- `call`: proxy 自体の失敗(network)と、HTTP エラーをどう分けているか

## 4. `src/lib/sync.ts`(10分)

- `linkedIssueNumber`: 「作成済み」の唯一の判定(ADR 0003)
- `toRecordUpdate`: 設定で空のフィールドには書かない
- `needsUpdate`: 同期日時だけの差で書かない理由

## 5. `src/desktop.ts`(15分)

- `handleCreate`: 押下直後にレコードを取り直す行(ADR 0003)。`issue` 変数を try の外で持つ理由(部分失敗の復旧)
- `renderWriteRetry`: GitHub には作れたがレコードに書けなかったときの画面
- `handleSync`: `needsUpdate` が false なら書かない

## 6. `src/config.ts`(10分)

- `FIELD_ROLES`: 役割ごとに選べるフィールド種別を絞っている
- 保存処理: `setProxyConfig` を GET と POST の2回呼ぶ理由(ADR 0002)。トークン未入力でも保存できる条件
- リポジトリを変えたときにトークンの再入力を求める理由

## 7. `test/*.test.ts`(5分)

- 各テストが上の「理由」のどれを守っているかを対応づける

## 面接で聞かれそうなこと

- AI にどこまで書かせ、自分で何を決めたか → 要件、ADR の4つの判断、テスト項目、動作確認
- トークンの扱い → ADR 0002
- 同時に押されたら → ADR 0003(完全同時は防げない、その場合の運用)
- 自動作成にしなかった理由 → ADR 0001
- 規模が大きくなったら → 同期を一覧の一括処理や定期処理に広げるなら、proxy の呼び出し回数とレート制限の制御が要る
