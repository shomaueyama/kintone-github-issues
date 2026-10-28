/**
 * レコード詳細画面。
 * - Issue 未作成: 「GitHub Issue を作成」ボタン
 * - 作成済み: Issue へのリンク、状態、「状態を同期」ボタン
 *
 * 判断はすべて src/lib に置き、このファイルは kintone の画面と API をつなぐだけにする。
 */
import { Button } from "kintone-ui-component/lib/button";
import { Notification } from "kintone-ui-component/lib/notification";
import { Spinner } from "kintone-ui-component/lib/spinner";
import { parseConfig, type PluginConfig } from "./lib/config";
import {
  createIssue,
  getIssue,
  GitHubError,
  type Issue,
  type ProxyFn,
} from "./lib/github";
import {
  linkedIssueNumber,
  needsUpdate,
  toCreateIssueInput,
  toRecordUpdate,
  type KintoneRecord,
  type RecordUpdate,
} from "./lib/sync";

const PLUGIN_ID: string = kintone.$PLUGIN_ID;

const proxy: ProxyFn = (url, method, headers, data) =>
  kintone.plugin.app.proxy(PLUGIN_ID, url, method, headers, data) as Promise<
    [string, number, Record<string, string>]
  >;

const recordApiUrl = () => kintone.api.url("/k/v1/record.json", true);

async function fetchRecord(app: number, id: number): Promise<KintoneRecord> {
  const res = await kintone.api(recordApiUrl(), "GET", { app, id });
  return res.record as KintoneRecord;
}

async function updateRecord(
  app: number,
  id: number,
  record: RecordUpdate,
): Promise<void> {
  await kintone.api(recordApiUrl(), "PUT", { app, id, record });
}

function notify(type: "success" | "danger" | "info", text: string): void {
  const n = new Notification({
    text,
    type,
    duration: type === "danger" ? -1 : 5000,
  });
  n.open();
}

function errorMessage(e: unknown): string {
  if (e instanceof GitHubError) return e.message;
  if (
    e &&
    typeof e === "object" &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  ) {
    return `kintone の処理に失敗しました: ${(e as { message: string }).message}`;
  }
  return "不明なエラーが発生しました";
}

type Context = {
  app: number;
  recordId: number;
  config: PluginConfig;
  record: KintoneRecord;
};

/** 作成: 二重作成を防ぐため、押下直後にレコードを取り直して番号が空のままか確かめる(ADR 0003) */
async function handleCreate(ctx: Context, spinner: Spinner): Promise<void> {
  spinner.open();
  let issue: Issue | null = null;
  try {
    const fresh = await fetchRecord(ctx.app, ctx.recordId);
    if (linkedIssueNumber(fresh, ctx.config) !== null) {
      notify(
        "info",
        "この レコードには既に Issue が作成されています。画面を再読み込みします",
      );
      location.reload();
      return;
    }
    issue = await createIssue(
      proxy,
      ctx.config.repo,
      toCreateIssueInput(fresh, ctx.config),
    );
    await updateRecord(
      ctx.app,
      ctx.recordId,
      toRecordUpdate(issue, ctx.config, new Date()),
    );
    notify("success", `Issue #${issue.number} を作成しました`);
    location.reload();
  } catch (e) {
    spinner.close();
    if (issue) {
      // GitHub 側には作成できたが、レコードに書けなかった。番号を失わないように URL を出し、書き込みだけ再試行できるようにする
      renderWriteRetry(ctx, issue, errorMessage(e));
    } else {
      notify("danger", errorMessage(e));
    }
  }
}

/** 同期: GitHub の状態を読み、レコードと違うときだけ書く */
async function handleSync(
  ctx: Context,
  number: number,
  spinner: Spinner,
): Promise<void> {
  spinner.open();
  try {
    const issue = await getIssue(proxy, ctx.config.repo, number);
    if (!needsUpdate(ctx.record, issue, ctx.config)) {
      spinner.close();
      notify("info", `Issue #${issue.number} は最新です(${issue.state})`);
      return;
    }
    await updateRecord(
      ctx.app,
      ctx.recordId,
      toRecordUpdate(issue, ctx.config, new Date()),
    );
    notify(
      "success",
      `Issue #${issue.number} の状態(${issue.state})をレコードに反映しました`,
    );
    location.reload();
  } catch (e) {
    spinner.close();
    notify("danger", errorMessage(e));
  }
}

function renderWriteRetry(ctx: Context, issue: Issue, reason: string): void {
  const space = kintone.app.record.getHeaderMenuSpaceElement();
  if (!space) return;
  space.innerHTML = "";
  const box = document.createElement("div");
  box.className = "ghi-box ghi-box--warn";
  const p = document.createElement("p");
  p.textContent = `GitHub には Issue #${issue.number} を作成しましたが、レコードへの書き込みに失敗しました(${reason})。`;
  const a = document.createElement("a");
  a.href = issue.htmlUrl;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = issue.htmlUrl;
  box.append(p, a);
  const spinner = new Spinner();
  const retry = new Button({
    text: "レコードへの書き込みを再試行",
    type: "submit",
  });
  retry.addEventListener("click", async () => {
    spinner.open();
    try {
      await updateRecord(
        ctx.app,
        ctx.recordId,
        toRecordUpdate(issue, ctx.config, new Date()),
      );
      notify("success", `Issue #${issue.number} をレコードに記録しました`);
      location.reload();
    } catch (e) {
      spinner.close();
      notify("danger", errorMessage(e));
    }
  });
  box.append(retry);
  space.append(box);
}

function render(ctx: Context): void {
  const space = kintone.app.record.getHeaderMenuSpaceElement();
  if (!space) return;
  space.innerHTML = "";
  const box = document.createElement("div");
  box.className = "ghi-box";
  const spinner = new Spinner();
  const number = linkedIssueNumber(ctx.record, ctx.config);

  if (number === null) {
    const create = new Button({ text: "GitHub Issue を作成", type: "submit" });
    create.addEventListener("click", () => handleCreate(ctx, spinner));
    box.append(create);
  } else {
    const link = document.createElement("a");
    const storedUrl = ctx.config.issueUrlField
      ? String(ctx.record[ctx.config.issueUrlField]?.value ?? "")
      : "";
    link.href =
      storedUrl || `https://github.com/${ctx.config.repo}/issues/${number}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "ghi-link";
    link.textContent = `GitHub Issue #${number}`;
    box.append(link);
    if (ctx.config.issueStateField) {
      const state = String(ctx.record[ctx.config.issueStateField]?.value ?? "");
      if (state) {
        const badge = document.createElement("span");
        badge.className = `ghi-state ghi-state--${state}`;
        badge.textContent = state;
        box.append(badge);
      }
    }
    const sync = new Button({ text: "状態を同期", type: "normal" });
    sync.addEventListener("click", () => handleSync(ctx, number, spinner));
    box.append(sync);
  }
  space.append(box);
}

kintone.events.on("app.record.detail.show", (event) => {
  const config = parseConfig(kintone.plugin.app.getConfig(PLUGIN_ID));
  if (!config.repo || !config.titleField || !config.issueNumberField) {
    // 設定が未完了のときは何も出さない(管理者向けの案内は設定画面側で行う)
    return event;
  }
  render({
    app: event.appId,
    recordId: event.recordId,
    config,
    record: event.record as KintoneRecord,
  });
  return event;
});
