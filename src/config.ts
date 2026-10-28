/**
 * プラグイン設定画面。
 * - フィールドの割り当ては、アプリのフィールド一覧を取得してドロップダウンで選ばせる(フィールドコードの手入力をさせない)
 * - トークンは kintone.plugin.app.setProxyConfig で保存し、setConfig には入れない(ADR 0002)
 * - proxy 設定は URL の前方一致 + メソッドで適用されるため、GET と POST の両方を登録する
 */
import { Button } from "kintone-ui-component/lib/button";
import { Dropdown } from "kintone-ui-component/lib/dropdown";
import { Notification } from "kintone-ui-component/lib/notification";
import { Text } from "kintone-ui-component/lib/text";
import {
  EMPTY_CONFIG,
  parseConfig,
  repoApiBaseUrl,
  serializeConfig,
  validateConfig,
  type PluginConfig,
} from "./lib/config";
import { GITHUB_HEADERS } from "./lib/github";

const PLUGIN_ID: string = kintone.$PLUGIN_ID;

type FieldInfo = { code: string; label: string; type: string };

/** 役割ごとに選べるフィールド種別 */
const FIELD_ROLES: Array<{
  key: keyof PluginConfig;
  label: string;
  types: string[];
  required: boolean;
  help: string;
}> = [
  {
    key: "titleField",
    label: "Issue のタイトル",
    types: ["SINGLE_LINE_TEXT"],
    required: true,
    help: "文字列(1行)",
  },
  {
    key: "bodyField",
    label: "Issue の本文",
    types: ["MULTI_LINE_TEXT", "SINGLE_LINE_TEXT"],
    required: false,
    help: "文字列(複数行)",
  },
  {
    key: "labelsField",
    label: "ラベル",
    types: ["CHECK_BOX", "MULTI_SELECT"],
    required: false,
    help: "チェックボックス・複数選択。選択肢名がそのままラベル名になります",
  },
  {
    key: "issueNumberField",
    label: "Issue 番号の保存先",
    types: ["NUMBER", "SINGLE_LINE_TEXT"],
    required: true,
    help: "数値。作成済みかどうかの判定に使います",
  },
  {
    key: "issueUrlField",
    label: "Issue URL の保存先",
    types: ["LINK", "SINGLE_LINE_TEXT"],
    required: false,
    help: "リンク",
  },
  {
    key: "issueStateField",
    label: "Issue 状態の保存先",
    types: ["SINGLE_LINE_TEXT", "DROP_DOWN", "RADIO_BUTTON"],
    required: false,
    help: "open / closed を書き込みます。ドロップダウンの場合は選択肢に open と closed を用意してください",
  },
  {
    key: "syncedAtField",
    label: "最終同期日時の保存先",
    types: ["DATETIME"],
    required: false,
    help: "日時",
  },
];

async function fetchFields(appId: number): Promise<FieldInfo[]> {
  const res = await kintone.api(
    kintone.api.url("/k/v1/preview/app/form/fields.json", true),
    "GET",
    { app: appId },
  );
  const props = res.properties as Record<
    string,
    { code: string; label: string; type: string }
  >;
  return Object.values(props)
    .map((p) => ({ code: p.code, label: p.label, type: p.type }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));
}

function mount(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`設定画面の要素 #${id} がありません`);
  return el;
}

function notify(type: "success" | "danger" | "info", text: string): void {
  new Notification({
    text,
    type,
    duration: type === "danger" ? -1 : 4000,
  }).open();
}

/** setProxyConfig はコールバック形式なので Promise に包む */
function setProxyConfig(
  url: string,
  method: string,
  headers: Record<string, string>,
): Promise<void> {
  return new Promise((resolve) =>
    kintone.plugin.app.setProxyConfig(url, method, headers, {}, resolve),
  );
}

function setConfig(config: Record<string, string>): Promise<void> {
  return new Promise((resolve) =>
    kintone.plugin.app.setConfig(config, resolve),
  );
}

function hasSavedToken(repo: string): boolean {
  if (!repo) return false;
  const saved = kintone.plugin.app.getProxyConfig(repoApiBaseUrl(repo), "GET");
  return !!(saved && saved.headers && saved.headers.Authorization);
}

async function main(): Promise<void> {
  const appId = kintone.app.getId();
  if (appId === null) throw new Error("アプリ ID を取得できません");
  const saved = parseConfig(kintone.plugin.app.getConfig(PLUGIN_ID));
  const fields = await fetchFields(appId);

  const repoInput = new Text({
    label: "リポジトリ",
    placeholder: "owner/repo(例: octocat/hello-world)",
    value: saved.repo,
    requiredIcon: true,
  });
  mount("ghi-repo").append(repoInput);

  const tokenInput = document.getElementById("ghi-token") as HTMLInputElement;
  const tokenHelp = document.getElementById("ghi-token-help") as HTMLElement;
  if (hasSavedToken(saved.repo)) {
    tokenInput.placeholder = "保存済み。変更するときだけ入力";
    tokenHelp.textContent =
      "トークンは kintone 側に保存されており、この画面には表示されません。";
  }

  const dropdowns = new Map<keyof PluginConfig, Dropdown>();
  for (const role of FIELD_ROLES) {
    const candidates = fields.filter((f) => role.types.includes(f.type));
    const items = [
      ...(role.required ? [] : [{ label: "(使わない)", value: "" }]),
      ...candidates.map((f) => ({
        label: `${f.label}(${f.code})`,
        value: f.code,
      })),
    ];
    const current = saved[role.key];
    const value = items.some((i) => i.value === current) ? current : "";
    const dd = new Dropdown({
      label: role.label,
      items,
      value,
      requiredIcon: role.required,
    });
    const row = document.createElement("div");
    row.className = "kintoneplugin-row";
    const help = document.createElement("p");
    help.className = "ghi-help";
    help.textContent = role.help;
    row.append(dd, help);
    mount("ghi-fields").append(row);
    dropdowns.set(role.key, dd);
  }

  const save = new Button({ text: "保存", type: "submit" });
  const cancel = new Button({ text: "キャンセル", type: "normal" });
  mount("ghi-buttons").append(cancel, save);

  cancel.addEventListener("click", () => {
    window.location.href = `../../${appId}/plugin/`;
  });

  save.addEventListener("click", async () => {
    const config: PluginConfig = {
      ...EMPTY_CONFIG,
      repo: repoInput.value.trim(),
    };
    for (const [key, dd] of dropdowns) config[key] = dd.value;

    const errors = validateConfig(config);
    const token = tokenInput.value.trim();
    const repoChanged = config.repo !== saved.repo;
    if (!token && !(hasSavedToken(config.repo) && !repoChanged)) {
      errors.push({
        field: "repo",
        message:
          "GitHub のトークンを入力してください(リポジトリを変えた場合も再入力が必要です)",
      });
    }
    if (errors.length > 0) {
      notify("danger", errors.map((e) => e.message).join("\n"));
      return;
    }

    save.disabled = true;
    try {
      if (token) {
        const base = repoApiBaseUrl(config.repo);
        const headers = { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` };
        await setProxyConfig(base, "GET", headers);
        await setProxyConfig(base, "POST", headers);
      }
      await setConfig(serializeConfig(config));
      notify("success", "設定を保存しました。アプリを更新すると反映されます");
      window.location.href = `../../flow?app=${appId}`;
    } catch (e) {
      save.disabled = false;
      notify(
        "danger",
        `保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
}

main().catch((e: unknown) => {
  notify(
    "danger",
    `設定画面の初期化に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
  );
});
