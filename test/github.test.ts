import { describe, expect, it, vi } from "vitest";
import {
  buildCreateIssueBody,
  classifyStatus,
  createIssue,
  getIssue,
  GitHubError,
  issueUrl,
  issuesUrl,
  parseIssue,
  type ProxyFn,
} from "../src/lib/github";

const issueJson = JSON.stringify({
  number: 12,
  html_url: "https://github.com/o/r/issues/12",
  state: "open",
  title: "Login fails",
  extra: "ignored",
});

describe("buildCreateIssueBody", () => {
  it("sends only title when body and labels are empty", () => {
    expect(
      buildCreateIssueBody({
        title: " Login fails ",
        body: "  ",
        labels: [" ", ""],
      }),
    ).toEqual({
      title: "Login fails",
    });
  });
  it("keeps body and trimmed labels", () => {
    expect(
      buildCreateIssueBody({
        title: "t",
        body: "detail",
        labels: [" bug ", "p1"],
      }),
    ).toEqual({
      title: "t",
      body: "detail",
      labels: ["bug", "p1"],
    });
  });
  it("rejects an empty title before calling GitHub", () => {
    expect(() => buildCreateIssueBody({ title: "   " })).toThrowError(
      GitHubError,
    );
  });
});

describe("parseIssue", () => {
  it("picks the fields the plugin needs", () => {
    expect(parseIssue(issueJson)).toEqual({
      number: 12,
      htmlUrl: "https://github.com/o/r/issues/12",
      state: "open",
      title: "Login fails",
    });
  });
  it("fails on non-JSON", () => {
    expect(() => parseIssue("<html>")).toThrowError(/JSON/);
  });
  it("fails when state is not open/closed", () => {
    const bad = JSON.stringify({
      number: 1,
      html_url: "u",
      state: "weird",
      title: "t",
    });
    expect(() => parseIssue(bad)).toThrowError(GitHubError);
  });
});

describe("classifyStatus", () => {
  it("returns null for 2xx", () => {
    expect(classifyStatus(201, "{}")).toBeNull();
  });
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [422, "validation"],
    [502, "server"],
    [418, "bad_response"],
  ])("maps HTTP %i to %s", (status, kind) => {
    expect(classifyStatus(status, "{}")?.kind).toBe(kind);
  });
  it("includes GitHub's message for validation errors", () => {
    const e = classifyStatus(
      422,
      JSON.stringify({ message: "Validation Failed" }),
    );
    expect(e?.message).toContain("Validation Failed");
  });
});

describe("createIssue / getIssue", () => {
  it("POSTs to the issues endpoint with GitHub headers and parses the result", async () => {
    const proxy = vi.fn<ProxyFn>().mockResolvedValue([issueJson, 201, {}]);
    const issue = await createIssue(proxy, "o/r", { title: "Login fails" });
    expect(issue.number).toBe(12);
    const [url, method, headers, data] = proxy.mock.calls[0];
    expect(url).toBe(issuesUrl("o/r"));
    expect(method).toBe("POST");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(data).toEqual({ title: "Login fails" });
  });
  it("GETs a single issue without a body", async () => {
    const proxy = vi.fn<ProxyFn>().mockResolvedValue([issueJson, 200, {}]);
    await getIssue(proxy, "o/r", 12);
    const [url, method, , data] = proxy.mock.calls[0];
    expect(url).toBe(issueUrl("o/r", 12));
    expect(method).toBe("GET");
    expect(data).toBe("");
  });
  it("turns a non-2xx status into a GitHubError", async () => {
    const proxy = vi
      .fn<ProxyFn>()
      .mockResolvedValue(['{"message":"Bad credentials"}', 401, {}]);
    await expect(
      createIssue(proxy, "o/r", { title: "t" }),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });
  it("turns a rejected proxy call into a network error", async () => {
    const proxy = vi.fn<ProxyFn>().mockRejectedValue(new Error("boom"));
    await expect(getIssue(proxy, "o/r", 1)).rejects.toMatchObject({
      kind: "network",
    });
  });
});
