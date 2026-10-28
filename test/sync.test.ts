import { describe, expect, it } from "vitest";
import { EMPTY_CONFIG, type PluginConfig } from "../src/lib/config";
import type { Issue } from "../src/lib/github";
import {
  linkedIssueNumber,
  needsUpdate,
  toCreateIssueInput,
  toRecordUpdate,
} from "../src/lib/sync";

const config: PluginConfig = {
  ...EMPTY_CONFIG,
  repo: "o/r",
  titleField: "title",
  bodyField: "detail",
  labelsField: "tags",
  issueNumberField: "gh_number",
  issueUrlField: "gh_url",
  issueStateField: "gh_state",
  syncedAtField: "gh_synced",
};

const issue: Issue = {
  number: 7,
  htmlUrl: "https://github.com/o/r/issues/7",
  state: "closed",
  title: "t",
};

describe("linkedIssueNumber", () => {
  it("returns null when the field is empty or missing", () => {
    expect(linkedIssueNumber({}, config)).toBeNull();
    expect(linkedIssueNumber({ gh_number: { value: "" } }, config)).toBeNull();
  });
  it("parses the stored number", () => {
    expect(linkedIssueNumber({ gh_number: { value: "7" } }, config)).toBe(7);
  });
  it("ignores values that are not positive integers", () => {
    expect(
      linkedIssueNumber({ gh_number: { value: "abc" } }, config),
    ).toBeNull();
    expect(linkedIssueNumber({ gh_number: { value: "0" } }, config)).toBeNull();
  });
});

describe("toCreateIssueInput", () => {
  it("maps title, body and labels from the configured fields", () => {
    const record = {
      title: { value: "Login fails" },
      detail: { value: "steps..." },
      tags: { value: ["bug", "p1"] },
    };
    expect(toCreateIssueInput(record, config)).toEqual({
      title: "Login fails",
      body: "steps...",
      labels: ["bug", "p1"],
    });
  });
  it("omits body and labels when those fields are not configured", () => {
    const minimal = { ...config, bodyField: "", labelsField: "" };
    expect(
      toCreateIssueInput(
        { title: { value: "x" }, detail: { value: "y" } },
        minimal,
      ),
    ).toEqual({ title: "x" });
  });
});

describe("toRecordUpdate", () => {
  const now = new Date("2026-11-01T00:00:00Z");
  it("writes every configured field", () => {
    expect(toRecordUpdate(issue, config, now)).toEqual({
      gh_number: { value: "7" },
      gh_url: { value: "https://github.com/o/r/issues/7" },
      gh_state: { value: "closed" },
      gh_synced: { value: "2026-11-01T00:00:00.000Z" },
    });
  });
  it("writes only the number when optional fields are not configured", () => {
    const minimal = {
      ...config,
      issueUrlField: "",
      issueStateField: "",
      syncedAtField: "",
    };
    expect(toRecordUpdate(issue, minimal, now)).toEqual({
      gh_number: { value: "7" },
    });
  });
});

describe("needsUpdate", () => {
  const synced = {
    gh_number: { value: "7" },
    gh_url: { value: "https://github.com/o/r/issues/7" },
    gh_state: { value: "closed" },
  };
  it("is false when the record already matches the issue", () => {
    expect(needsUpdate(synced, issue, config)).toBe(false);
  });
  it("is true when the state changed on GitHub", () => {
    expect(
      needsUpdate({ ...synced, gh_state: { value: "open" } }, issue, config),
    ).toBe(true);
  });
  it("ignores the state when no state field is configured", () => {
    const noState = { ...config, issueStateField: "" };
    expect(
      needsUpdate({ ...synced, gh_state: { value: "open" } }, issue, noState),
    ).toBe(false);
  });
});
