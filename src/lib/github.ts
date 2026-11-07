/**
 * GitHub REST API との境界。
 * ここには「HTTP を呼ぶ」以外の判断を集める: リクエストの組み立て、レスポンスの検証、エラーの分類。
 * HTTP 自体は呼び出し側から渡される `ProxyFn`(kintone.plugin.app.proxy の薄い包み)で行う。
 * こうしておくと、この層は kintone のグローバル無しでテストできる。
 */

/** kintone.plugin.app.proxy と同じ形。戻りは [body, status, headers] */
export type ProxyFn = (
  url: string,
  method: "GET" | "POST" | "PATCH",
  headers: Record<string, string>,
  data: Record<string, unknown> | string,
) => Promise<[string, number, Record<string, string>]>;

export type IssueState = "open" | "closed";

export type Issue = {
  number: number;
  htmlUrl: string;
  state: IssueState;
  title: string;
};

export type CreateIssueInput = {
  title: string;
  body?: string;
  labels?: string[];
};

/** 利用者に見せる失敗。`kind` は対処が違うものだけ分けている */
export class GitHubError extends Error {
  constructor(
    public readonly kind:
      | "unauthorized" // トークンが無効、または未設定
      | "forbidden" // 権限不足、またはレート制限
      | "not_found" // リポジトリ・Issue が無い、または private で見えない
      | "validation" // 422: 入力が不正(タイトル空など)
      | "server" // 5xx
      | "bad_response" // 2xx だが本文が想定と違う
      | "network", // proxy 自体の失敗
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** GitHub REST API が要求する共通ヘッダー。Authorization は proxy 設定側で付く */
export const GITHUB_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

export function issuesUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/issues`;
}

export function issueUrl(repo: string, number: number): string {
  return `https://api.github.com/repos/${repo}/issues/${number}`;
}

/** 作成リクエストの本文。空の body / labels は送らない(GitHub 側の既定に任せる) */
export function buildCreateIssueBody(
  input: CreateIssueInput,
): Record<string, unknown> {
  const title = input.title.trim();
  if (!title) {
    throw new GitHubError(
      "validation",
      "タイトルが空のため Issue を作成できません",
    );
  }
  const body: Record<string, unknown> = { title };
  if (input.body && input.body.trim()) body.body = input.body;
  const labels = (input.labels ?? []).map((l) => l.trim()).filter(Boolean);
  if (labels.length > 0) body.labels = labels;
  return body;
}

/** レスポンス本文(JSON 文字列)を Issue に変換する。足りない項目があれば bad_response */
export function parseIssue(bodyText: string): Issue {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new GitHubError(
      "bad_response",
      "GitHub の応答を JSON として読めませんでした",
    );
  }
  const o = json as Record<string, unknown>;
  const number = o.number;
  const htmlUrl = o.html_url;
  const state = o.state;
  const title = o.title;
  if (
    typeof number !== "number" ||
    typeof htmlUrl !== "string" ||
    (state !== "open" && state !== "closed") ||
    typeof title !== "string"
  ) {
    throw new GitHubError(
      "bad_response",
      "GitHub の応答に必要な項目(number, html_url, state, title)がありません",
    );
  }
  return { number, htmlUrl, state, title };
}

/** ステータスコードを利用者向けの失敗に変換する。2xx なら null */
export function classifyStatus(
  status: number,
  bodyText: string,
): GitHubError | null {
  if (status >= 200 && status < 300) return null;
  const detail = extractMessage(bodyText);
  switch (status) {
    case 401:
      return new GitHubError(
        "unauthorized",
        "GitHub の認証に失敗しました。プラグイン設定のトークンを確認してください",
        status,
      );
    case 403:
      return new GitHubError(
        "forbidden",
        `GitHub に拒否されました(権限不足またはレート制限)${detail ? ": " + detail : ""}`,
        status,
      );
    case 404:
      return new GitHubError(
        "not_found",
        "リポジトリまたは Issue が見つかりません。リポジトリ名と、トークンにそのリポジトリへの権限があるか確認してください",
        status,
      );
    case 422:
      return new GitHubError(
        "validation",
        `GitHub が入力を受け付けませんでした${detail ? ": " + detail : ""}`,
        status,
      );
    default:
      if (status >= 500) {
        return new GitHubError(
          "server",
          `GitHub 側のエラーです(HTTP ${status})。時間をおいて再試行してください`,
          status,
        );
      }
      return new GitHubError(
        "bad_response",
        `想定外の応答です(HTTP ${status})${detail ? ": " + detail : ""}`,
        status,
      );
  }
}

function extractMessage(bodyText: string): string {
  try {
    const o = JSON.parse(bodyText) as { message?: unknown };
    return typeof o.message === "string" ? o.message : "";
  } catch {
    return "";
  }
}

async function call(
  proxy: ProxyFn,
  url: string,
  method: "GET" | "POST" | "PATCH",
  data: Record<string, unknown> | string,
): Promise<string> {
  let result: [string, number, Record<string, string>];
  try {
    result = await proxy(url, method, GITHUB_HEADERS, data);
  } catch (e) {
    throw new GitHubError(
      "network",
      "GitHub への通信に失敗しました。ネットワーク、またはプラグイン設定が保存されているかを確認してください",
    );
  }
  const [bodyText, status] = result;
  const error = classifyStatus(status, bodyText);
  if (error) throw error;
  return bodyText;
}

export async function createIssue(
  proxy: ProxyFn,
  repo: string,
  input: CreateIssueInput,
): Promise<Issue> {
  const body = buildCreateIssueBody(input);
  const text = await call(proxy, issuesUrl(repo), "POST", body);
  return parseIssue(text);
}

export async function getIssue(
  proxy: ProxyFn,
  repo: string,
  number: number,
): Promise<Issue> {
  // GET では本文を送らない。proxy の data は空文字で渡す
  const text = await call(proxy, issueUrl(repo, number), "GET", "");
  return parseIssue(text);
}
