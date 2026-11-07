// @vitest-environment jsdom
/**
 * src/config.ts(プラグイン設定画面)の確認。
 * kintone のグローバルをモックし、フィールドの絞り込みと保存の分岐(トークンの扱い)を確かめる。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getConfig = vi.fn();
const getProxyConfig = vi.fn();
const setProxyConfig = vi.fn();
const setConfig = vi.fn();
const api = vi.fn();

const FIELDS = {
  properties: {
    title: { code: "title", label: "タイトル", type: "SINGLE_LINE_TEXT" },
    body: { code: "body", label: "内容", type: "MULTI_LINE_TEXT" },
    labels: { code: "labels", label: "種別", type: "CHECK_BOX" },
    issue_number: { code: "issue_number", label: "Issue 番号", type: "NUMBER" },
    issue_url: { code: "issue_url", label: "Issue URL", type: "LINK" },
    issue_state: {
      code: "issue_state",
      label: "Issue 状態",
      type: "DROP_DOWN",
    },
    synced_at: { code: "synced_at", label: "同期日時", type: "DATETIME" },
    created: { code: "created", label: "作成日時", type: "CREATED_TIME" },
  },
};

const SAVED = {
  repo: "o/r",
  titleField: "title",
  bodyField: "body",
  labelsField: "labels",
  issueNumberField: "issue_number",
  issueUrlField: "issue_url",
  issueStateField: "issue_state",
  syncedAtField: "synced_at",
};

type Kuc = HTMLElement & { value: string };

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} がありません`);
  return el;
}

/** kintone UI Component v1 のタグ名はバージョン付き(kuc-dropdown-1-x-x)なので前方一致で探す */
function kuc(root: ParentNode, name: string): HTMLElement[] {
  return Array.from(root.querySelectorAll("*")).filter((el) =>
    el.tagName.toLowerCase().startsWith(`kuc-${name}`),
  ) as HTMLElement[];
}
function dropdowns(): Kuc[] {
  return kuc(byId("ghi-fields"), "dropdown") as Kuc[];
}
function repoInput(): Kuc {
  return kuc(byId("ghi-repo"), "text")[0] as Kuc;
}
function tokenInput(): HTMLInputElement {
  return document.getElementById("ghi-token") as HTMLInputElement;
}
function button(text: string): HTMLElement {
  const el = kuc(byId("ghi-buttons"), "button").find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!el) throw new Error(`ボタン「${text}」がありません`);
  return el as HTMLElement;
}
function notifications(): string {
  return kuc(document, "notification")
    .map((n) => n.textContent ?? "")
    .join("\n");
}

/** 画面を初期化する。config.ts は読み込み時に main() を走らせるので、毎回モジュールを読み直す */
async function open(
  opts: { saved?: Record<string, string>; savedToken?: boolean } = {},
) {
  document.body.innerHTML = `
    <div id="ghi-repo"></div>
    <input type="password" id="ghi-token">
    <p id="ghi-token-help">初期の説明</p>
    <div id="ghi-fields"></div>
    <div id="ghi-buttons"></div>`;
  getConfig.mockReturnValue(opts.saved ?? {});
  getProxyConfig.mockImplementation((url: string, method: string) =>
    opts.savedToken &&
    url === "https://api.github.com/repos/o/r/" &&
    method === "GET"
      ? { headers: { Authorization: "Bearer saved" }, data: {} }
      : null,
  );
  vi.resetModules();
  await import("../src/config");
  await vi.waitFor(() =>
    expect(kuc(byId("ghi-buttons"), "button").length).toBe(2),
  );
}

beforeEach(() => {
  vi.stubGlobal("kintone", {
    $PLUGIN_ID: "pid",
    app: { getId: () => 1 },
    api: Object.assign(api, {
      url: (path: string) => `https://example.cybozu.com${path}`,
    }),
    plugin: {
      app: {
        getConfig,
        getProxyConfig,
        setProxyConfig: setProxyConfig.mockImplementation(
          (_u: string, _m: string, _h: unknown, _d: unknown, cb: () => void) =>
            cb(),
        ),
        setConfig: setConfig.mockImplementation((_c: unknown, cb: () => void) =>
          cb(),
        ),
      },
    },
  });
  vi.spyOn(console, "error").mockImplementation(vi.fn());
  api.mockReset().mockResolvedValue(FIELDS);
  setProxyConfig.mockClear();
  setConfig.mockClear();
});

describe("初期表示", () => {
  it("アプリのフィールドを種類で絞ってドロップダウンに出す", async () => {
    await open();
    expect(api).toHaveBeenCalledWith(
      "https://example.cybozu.com/k/v1/preview/app/form/fields.json",
      "GET",
      { app: 1 },
    );
    const dds = dropdowns();
    expect(dds.length).toBe(7);
    const items = (dd: Kuc) =>
      (dd as unknown as { items: Array<{ value: string }> }).items.map(
        (i) => i.value,
      );
    const sorted = (dd: Kuc) => [...items(dd)].sort();
    expect(sorted(dds[0])).toEqual(["title"]); // タイトル: 必須なので「(使わない)」なし
    expect(sorted(dds[1])).toEqual(["", "body", "title"]); // 本文: 複数行と1行
    expect(sorted(dds[2])).toEqual(["", "labels"]);
    expect(sorted(dds[3])).toEqual(["issue_number", "title"]);
    expect(sorted(dds[4])).toEqual(["", "issue_url", "title"]);
    expect(sorted(dds[5])).toEqual(["", "issue_state", "title"]);
    expect(sorted(dds[6])).toEqual(["", "synced_at"]); // 作成日時(CREATED_TIME)は候補に入らない
    expect(items(dds[1])[0]).toBe(""); // 「(使わない)」は先頭
  });

  it("保存済みの設定を復元し、トークン欄は「保存済み」の案内にする", async () => {
    await open({ saved: SAVED, savedToken: true });
    expect(repoInput().value).toBe("o/r");
    expect(dropdowns().map((d) => d.value)).toEqual([
      "title",
      "body",
      "labels",
      "issue_number",
      "issue_url",
      "issue_state",
      "synced_at",
    ]);
    expect(tokenInput().value).toBe(""); // トークンは画面に戻さない(ADR 0002)
    expect(tokenInput().placeholder).toContain("保存済み");
    expect(document.getElementById("ghi-token-help")?.textContent).toContain(
      "表示されません",
    );
  });

  it("トークン未保存なら案内は初期のまま", async () => {
    await open({ saved: SAVED, savedToken: false });
    expect(tokenInput().placeholder).not.toContain("保存済み");
    expect(document.getElementById("ghi-token-help")?.textContent).toBe(
      "初期の説明",
    );
  });
});

describe("保存", () => {
  it("トークンあり: proxy 設定を GET と POST の2回登録してから設定を保存する(ADR 0002)", async () => {
    await open();
    repoInput().value = "o/r";
    tokenInput().value = " tok ";
    const dds = dropdowns();
    dds[0].value = "title";
    dds[3].value = "issue_number";
    button("保存").click();
    await vi.waitFor(() => expect(setConfig).toHaveBeenCalledTimes(1));

    expect(setProxyConfig).toHaveBeenCalledTimes(2);
    const methods = setProxyConfig.mock.calls.map((c) => c[1]).sort();
    expect(methods).toEqual(["GET", "POST"]);
    for (const [url, , headers, data] of setProxyConfig.mock.calls) {
      expect(url).toBe("https://api.github.com/repos/o/r/");
      expect(headers.Authorization).toBe("Bearer tok");
      expect(headers.Accept).toBe("application/vnd.github+json");
      expect(data).toEqual({});
    }
    expect(setConfig.mock.calls[0][0]).toEqual({
      repo: "o/r",
      titleField: "title",
      bodyField: "",
      labelsField: "",
      issueNumberField: "issue_number",
      issueUrlField: "",
      issueStateField: "",
      syncedAtField: "",
    });
    expect(setConfig.mock.calls[0][0]).not.toHaveProperty("token");
    expect(notifications()).toContain("設定を保存しました");
  });

  it("トークンなし・未保存: エラーで止まり、何も保存しない", async () => {
    await open();
    repoInput().value = "o/r";
    dropdowns()[0].value = "title";
    dropdowns()[3].value = "issue_number";
    button("保存").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain("GitHub のトークンを入力してください"),
    );
    expect(setProxyConfig).not.toHaveBeenCalled();
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("トークンなし・保存済み・同じリポジトリ: proxy 設定は触らず設定だけ保存する", async () => {
    await open({ saved: SAVED, savedToken: true });
    dropdowns()[1].value = ""; // 本文を使わない、に変更
    button("保存").click();
    await vi.waitFor(() => expect(setConfig).toHaveBeenCalledTimes(1));
    expect(setProxyConfig).not.toHaveBeenCalled();
    expect(setConfig.mock.calls[0][0]).toEqual({ ...SAVED, bodyField: "" });
  });

  it("リポジトリを変えたときはトークンの再入力を求める", async () => {
    await open({ saved: SAVED, savedToken: true });
    repoInput().value = "o/other";
    button("保存").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain(
        "リポジトリを変えた場合も再入力が必要です",
      ),
    );
    expect(setProxyConfig).not.toHaveBeenCalled();
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("検証エラー(書き込み先の重複)は保存前に止める", async () => {
    await open({ saved: SAVED, savedToken: true });
    dropdowns()[4].value = "title";
    dropdowns()[5].value = "title";
    button("保存").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain(
        "書き込み先のフィールドが重複しています",
      ),
    );
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("保存に失敗したらボタンを戻してエラーを出す", async () => {
    await open({ saved: SAVED, savedToken: true });
    setConfig.mockImplementation(() => {
      throw new Error("save failed");
    });
    button("保存").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain("保存に失敗しました: save failed"),
    );
    expect((button("保存") as unknown as { disabled: boolean }).disabled).toBe(
      false,
    );
  });
});
