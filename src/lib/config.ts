/**
 * プラグイン設定の型と、kintone.plugin.app.getConfig が返す
 * 「値がすべて文字列のオブジェクト」との相互変換。
 *
 * トークンはここには含めない。トークンは kintone.plugin.app.setProxyConfig で
 * kintone 側に保存し、プラグインの JavaScript からは読めないようにする(ADR 0002)。
 */

export type PluginConfig = {
  /** "owner/repo" 形式 */
  repo: string;
  /** Issue のタイトルにするフィールド(文字列1行) */
  titleField: string;
  /** Issue の本文にするフィールド(文字列複数行)。空なら本文なし */
  bodyField: string;
  /** ラベルにするフィールド(チェックボックス・複数選択)。空ならラベルなし */
  labelsField: string;
  /** 作成した Issue 番号を書き込むフィールド(数値)。二重作成防止の鍵 */
  issueNumberField: string;
  /** Issue の URL を書き込むフィールド(リンク)。空なら書かない */
  issueUrlField: string;
  /** Issue の状態(open / closed)を書き込むフィールド(文字列1行・ドロップダウン)。空なら書かない */
  issueStateField: string;
  /** 最終同期日時を書き込むフィールド(日時)。空なら書かない */
  syncedAtField: string;
};

export const EMPTY_CONFIG: PluginConfig = {
  repo: "",
  titleField: "",
  bodyField: "",
  labelsField: "",
  issueNumberField: "",
  issueUrlField: "",
  issueStateField: "",
  syncedAtField: "",
};

const CONFIG_KEYS = Object.keys(EMPTY_CONFIG) as Array<keyof PluginConfig>;

/** getConfig の戻り値(任意のオブジェクト)から設定を組み立てる。未知のキーは捨てる */
export function parseConfig(
  raw: Record<string, unknown> | null | undefined,
): PluginConfig {
  const config: PluginConfig = { ...EMPTY_CONFIG };
  if (!raw) return config;
  for (const key of CONFIG_KEYS) {
    const value = raw[key];
    config[key] = typeof value === "string" ? value.trim() : "";
  }
  return config;
}

/** setConfig に渡す形(文字列のみ) */
export function serializeConfig(config: PluginConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CONFIG_KEYS) out[key] = config[key].trim();
  return out;
}

export type ConfigError = { field: keyof PluginConfig; message: string };

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** 保存前の検証。エラーが無ければ空配列 */
export function validateConfig(config: PluginConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  if (!config.repo) {
    errors.push({
      field: "repo",
      message: "リポジトリを owner/repo の形式で入力してください",
    });
  } else if (!REPO_PATTERN.test(config.repo)) {
    errors.push({
      field: "repo",
      message:
        "リポジトリは owner/repo の形式で入力してください(例: octocat/hello-world)",
    });
  }
  if (!config.titleField) {
    errors.push({
      field: "titleField",
      message: "タイトルにするフィールドを選んでください",
    });
  }
  if (!config.issueNumberField) {
    errors.push({
      field: "issueNumberField",
      message: "Issue 番号を保存するフィールドを選んでください",
    });
  }
  // 同じフィールドを複数の役割に割り当てると、書き込みで値が上書きし合う
  const writable = [
    config.issueNumberField,
    config.issueUrlField,
    config.issueStateField,
    config.syncedAtField,
  ].filter(Boolean);
  if (new Set(writable).size !== writable.length) {
    errors.push({
      field: "issueNumberField",
      message: "書き込み先のフィールドが重複しています",
    });
  }
  return errors;
}

/** GitHub API のベース URL。proxy 設定(トークン)はこの URL の前方一致で適用される */
export function repoApiBaseUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/`;
}
