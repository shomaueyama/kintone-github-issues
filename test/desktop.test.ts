// @vitest-environment jsdom
/**
 * src/desktop.ts の画面側の確認。kintone のグローバルと proxy をモックし、
 * ボタン押下から kintone REST / GitHub 呼び出し / 画面表示までを通しで確かめる。
 * 「判断」自体の単体テストは src/lib 側(github / sync / config)にある。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: Record<string, unknown>) => unknown;
type RecordValue = Record<string, { value: unknown }>;

let handler: Handler;
const api = vi.fn();
const proxy = vi.fn();
const getConfig = vi.fn();
const space = document.createElement("div");

const CONFIG = {
  repo: "o/r",
  titleField: "title",
  bodyField: "body",
  labelsField: "labels",
  issueNumberField: "issue_number",
  issueUrlField: "issue_url",
  issueStateField: "issue_state",
  syncedAtField: "synced_at",
};

const issueJson = (number: number, state: "open" | "closed") =>
  JSON.stringify({
    number,
    html_url: `https://github.com/o/r/issues/${number}`,
    state,
    title: "Login fails",
  });

const draft: RecordValue = {
  title: { value: "Login fails" },
  body: { value: "steps" },
  labels: { value: ["bug"] },
  issue_number: { value: "" },
  issue_url: { value: "" },
  issue_state: { value: "" },
  synced_at: { value: "" },
};

const linked: RecordValue = {
  ...draft,
  issue_number: { value: "12" },
  issue_url: { value: "https://github.com/o/r/issues/12" },
  issue_state: { value: "open" },
  synced_at: { value: "2026-11-01T00:00:00Z" },
};

/** 詳細画面の表示イベントを起こし、kintone UI Component の描画(非同期)を待つ */
async function show(record: RecordValue): Promise<void> {
  handler({ appId: 1, recordId: 5, record });
  await flush();
}

/** kintone UI Component v1 のタグ名はバージョン付き(kuc-button-1-x-x)なので前方一致で探す */
function kuc(root: ParentNode, name: string): HTMLElement[] {
  return Array.from(root.querySelectorAll("*")).filter((el) =>
    el.tagName.toLowerCase().startsWith(`kuc-${name}`),
  ) as HTMLElement[];
}

function button(text: string): HTMLElement {
  const el = kuc(space, "button").find((b) =>
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

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  vi.stubGlobal("kintone", {
    $PLUGIN_ID: "pid",
    events: {
      on: (_: string, h: Handler) => {
        handler = h;
      },
    },
    api: Object.assign(api, {
      url: (path: string) => `https://example.cybozu.com${path}`,
    }),
    plugin: { app: { getConfig, proxy } },
    app: { record: { getHeaderMenuSpaceElement: () => space } },
  });
  // jsdom は location.reload を実装していない(警告だけ出る)ので、呼ばれたことを数える
  vi.spyOn(console, "error").mockImplementation(vi.fn());
  document.body.append(space); // 文書に繋がないと custom element が描画されない
  await import("../src/desktop");
});

beforeEach(() => {
  api.mockReset();
  proxy.mockReset();
  getConfig.mockReset().mockReturnValue(CONFIG);
  space.innerHTML = "";
  kuc(document, "notification").forEach((n) => n.remove());
});

describe("設定が未完了のとき", () => {
  it("何も表示せず、event をそのまま返す", () => {
    getConfig.mockReturnValue({ ...CONFIG, issueNumberField: "" });
    const event = { appId: 1, recordId: 5, record: draft };
    expect(handler(event)).toBe(event);
    expect(space.children.length).toBe(0);
  });
});

describe("Issue 未作成のレコード", () => {
  it("作成ボタンだけを出す", async () => {
    await show(draft);
    expect(kuc(space, "button").length).toBe(1);
    expect(space.textContent).toContain("GitHub Issue を作成");
    expect(space.querySelector("a")).toBeNull();
  });

  it("作成: レコードを取り直し、GitHub に POST し、番号・URL・状態・同期日時を書き込む", async () => {
    api.mockImplementation(async (_url: string, method: string) =>
      method === "GET" ? { record: draft } : {},
    );
    proxy.mockResolvedValue([issueJson(12, "open"), 201, {}]);
    await show(draft);
    button("GitHub Issue を作成").click();
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2));

    expect(api.mock.calls[0]).toEqual([
      "https://example.cybozu.com/k/v1/record.json",
      "GET",
      { app: 1, id: 5 },
    ]);
    expect(proxy).toHaveBeenCalledTimes(1);
    const [pluginId, url, method, headers, data] = proxy.mock.calls[0];
    expect(pluginId).toBe("pid");
    expect(url).toBe("https://api.github.com/repos/o/r/issues");
    expect(method).toBe("POST");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers.Authorization).toBeUndefined(); // トークンは proxy 設定側で付く
    expect(data).toEqual({
      title: "Login fails",
      body: "steps",
      labels: ["bug"],
    });

    const [putUrl, putMethod, putParams] = api.mock.calls[1];
    expect(putUrl).toBe("https://example.cybozu.com/k/v1/record.json");
    expect(putMethod).toBe("PUT");
    expect(putParams.app).toBe(1);
    expect(putParams.id).toBe(5);
    expect(putParams.record.issue_number).toEqual({ value: "12" });
    expect(putParams.record.issue_url).toEqual({
      value: "https://github.com/o/r/issues/12",
    });
    expect(putParams.record.issue_state).toEqual({ value: "open" });
    expect(putParams.record.synced_at.value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await vi.waitFor(() =>
      expect(notifications()).toContain("Issue #12 を作成しました"),
    );
  });

  it("二重作成防止: 取り直したレコードに番号が入っていたら GitHub を呼ばない(ADR 0003)", async () => {
    api.mockResolvedValue({ record: linked });
    await show(draft);
    button("GitHub Issue を作成").click();
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    await flush();
    expect(proxy).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1); // PUT もしない
    expect(notifications()).toContain("既に Issue が作成されています");
  });

  it("タイトルが空なら GitHub を呼ばずにエラーを出す", async () => {
    api.mockResolvedValue({ record: { ...draft, title: { value: "  " } } });
    await show(draft);
    button("GitHub Issue を作成").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain("タイトルが空のため"),
    );
    expect(proxy).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("401 なら認証の案内を出し、レコードは書かない", async () => {
    api.mockResolvedValue({ record: draft });
    proxy.mockResolvedValue([
      JSON.stringify({ message: "Bad credentials" }),
      401,
      {},
    ]);
    await show(draft);
    button("GitHub Issue を作成").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain("GitHub の認証に失敗しました"),
    );
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("404 ならリポジトリ名と権限の案内を出す", async () => {
    api.mockResolvedValue({ record: draft });
    proxy.mockResolvedValue([
      JSON.stringify({ message: "Not Found" }),
      404,
      {},
    ]);
    await show(draft);
    button("GitHub Issue を作成").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain(
        "リポジトリまたは Issue が見つかりません",
      ),
    );
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("proxy 自体が失敗したら通信エラーの案内を出す", async () => {
    api.mockResolvedValue({ record: draft });
    proxy.mockRejectedValue(new Error("boom"));
    await show(draft);
    button("GitHub Issue を作成").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain("GitHub への通信に失敗しました"),
    );
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("部分失敗: GitHub には作れたがレコードに書けなかったら、URL と再試行ボタンを出す(ADR 0003)", async () => {
    api.mockImplementation(async (_url: string, method: string) => {
      if (method === "GET") return { record: draft };
      throw new Error("GAIA_XX01 forbidden");
    });
    proxy.mockResolvedValue([issueJson(13, "open"), 201, {}]);
    await show(draft);
    button("GitHub Issue を作成").click();
    await vi.waitFor(() =>
      expect(space.textContent).toContain("Issue #13 を作成しましたが"),
    );
    expect(space.textContent).toContain("GAIA_XX01 forbidden");
    const link = space.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://github.com/o/r/issues/13");
    expect(kuc(space, "button")[0]?.textContent).toContain("再試行");
    expect(api).toHaveBeenCalledTimes(2);

    // 権限を直した後の再試行: GitHub は呼ばず、書き込みだけやり直す
    api.mockResolvedValue({});
    proxy.mockClear();
    await flush();
    button("再試行").click();
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    const [, method, params] = api.mock.calls[2];
    expect(method).toBe("PUT");
    expect(params.record.issue_number).toEqual({ value: "13" });
    expect(proxy).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(notifications()).toContain("Issue #13 をレコードに記録しました"),
    );
  });
});

describe("Issue 作成済みのレコード", () => {
  it("リンク・状態バッジ・同期ボタンを出す", async () => {
    await show(linked);
    const link = space.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://github.com/o/r/issues/12");
    expect(link?.textContent).toBe("GitHub Issue #12");
    expect(space.querySelector(".ghi-state")?.textContent).toBe("open");
    expect(kuc(space, "button").length).toBe(1);
    expect(space.textContent).toContain("状態を同期");
  });

  it("URL フィールドが空でも、リポジトリと番号からリンクを組み立てる", async () => {
    await show({ ...linked, issue_url: { value: "" } });
    expect(space.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/o/r/issues/12",
    );
  });

  it("同期(変更なし): GET だけ行い、レコードは書かない", async () => {
    proxy.mockResolvedValue([issueJson(12, "open"), 200, {}]);
    await show(linked);
    button("状態を同期").click();
    await vi.waitFor(() =>
      expect(notifications()).toContain("Issue #12 は最新です(open)"),
    );
    const [, url, method, , data] = proxy.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/o/r/issues/12");
    expect(method).toBe("GET");
    expect(data).toBe("");
    expect(api).not.toHaveBeenCalled();
  });

  it("同期(変更あり): 状態が変わっていればレコードを更新する", async () => {
    proxy.mockResolvedValue([issueJson(12, "closed"), 200, {}]);
    api.mockResolvedValue({});
    await show(linked);
    button("状態を同期").click();
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const [, method, params] = api.mock.calls[0];
    expect(method).toBe("PUT");
    expect(params.record.issue_state).toEqual({ value: "closed" });
    expect(params.record.issue_number).toEqual({ value: "12" });
    await vi.waitFor(() =>
      expect(notifications()).toContain("状態(closed)をレコードに反映しました"),
    );
  });

  it("同期で 404 なら案内を出し、レコードは書かない", async () => {
    proxy.mockResolvedValue(["{}", 404, {}]);
    await show(linked);
    button("状態を同期").click();
    await vi.waitFor(() => expect(notifications()).toContain("見つかりません"));
    expect(api).not.toHaveBeenCalled();
  });
});
