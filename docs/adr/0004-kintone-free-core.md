# ADR 0004: 判断を kintone 非依存の層に寄せ、そこだけ単体テストする

- 状態: 採用
- 日付: 2026-10-29

## 背景

kintone プラグインのコードは、`kintone.events.on` や `kintone.api`、`kintone.plugin.app.proxy` といったグローバルに依存する。これらはブラウザ上の kintone でしか動かず、Node.js の単体テストから直接は呼べない。

一方で、このプラグインで間違えると困るのは次のような判断で、どれも kintone に依存しない。

- GitHub に送るリクエストの形(空の本文やラベルを送らない、タイトルが空なら送らない)
- GitHub の応答の検証(必要な項目があるか、状態が open / closed か)
- HTTP ステータスごとの利用者向けメッセージ
- レコードの値と Issue の対応(どのフィールドに何を書くか、書き換えが必要か)
- 設定の検証(リポジトリの形式、必須フィールド、書き込み先の重複)

## 決定

`src/lib` に判断を集め、kintone のグローバルを参照しない。HTTP の呼び出しは `ProxyFn` 型の関数として外から渡す。`src/desktop.ts` と `src/config.ts` は、画面の組み立てと kintone API の呼び出しだけを担う。

単体テスト(Vitest)は `src/lib` を対象にし、`ProxyFn` はモックで差し替える。画面側は kintone 開発者環境での手動確認とする。

## 検討した他の案

**kintone のグローバルをテストでモックする。** `global.kintone = {...}` を用意すれば `desktop.ts` もテストできる。しかしモックの形を kintone の仕様に合わせて維持する手間が大きく、画面の DOM 操作の検証は結局ブラウザが要る。

**E2E テスト(Playwright)で kintone の画面ごと確認する。** 最も確実だが、開発者環境へのログインとアプリの準備が要り、CI で回すには環境の秘密情報を扱う必要がある。今回の規模では手動確認で足りると判断した。

## 結果

- `src/lib` のテストは kintone 無しで 1 秒以内に回る。CI で毎回実行する
- 画面側のコードは薄くなり、読む量が減った
- 画面側の不具合はテストでは見つからない。動作確認の記録を `docs/verification.md` に残す

## 追記(2026-11-07)

開発者環境での手動確認を終えたあと、画面側にも kintone のグローバルをモックした jsdom 上のテストを追加した(`test/desktop.test.ts`、`test/config-screen.test.ts`)。

- 理由: 401 / 404 / 部分失敗 / 二重作成といった分岐は、手動では再現の手間が大きく(トークンの差し替えやフィールド権限の変更が要る)、変更のたびに確かめ直せない
- モックの範囲: `kintone.api`、`kintone.plugin.app.proxy / getConfig / getProxyConfig / setProxyConfig / setConfig`、`kintone.events.on`、`kintone.app.record.getHeaderMenuSpaceElement` の 8 つ。「検討した他の案」で懸念した維持の手間は、この範囲なら小さかった
- 限界: モックが本物とずれていても気づけない。proxy 設定の前方一致やフィールドのアクセス権の挙動など、kintone の実物でしか分からないことは手動確認に残す(`docs/verification.md`)

この ADR の決定(判断を `src/lib` に集める)は変えていない。画面側のテストは「`src/lib` を正しい引数で呼び、結果を正しく kintone に渡しているか」を見るもので、判断そのものの検証は引き続き `src/lib` のテストが担う
