import { describe, expect, it } from "vitest";
import {
  EMPTY_CONFIG,
  parseConfig,
  repoApiBaseUrl,
  serializeConfig,
  validateConfig,
} from "../src/lib/config";

describe("parseConfig", () => {
  it("returns empty config for null", () => {
    expect(parseConfig(null)).toEqual(EMPTY_CONFIG);
  });
  it("trims strings and drops unknown keys and non-strings", () => {
    const parsed = parseConfig({ repo: " o/r ", titleField: 1, junk: "x" });
    expect(parsed.repo).toBe("o/r");
    expect(parsed.titleField).toBe("");
    expect("junk" in parsed).toBe(false);
  });
});

describe("serializeConfig", () => {
  it("round-trips through parseConfig", () => {
    const config = {
      ...EMPTY_CONFIG,
      repo: "o/r",
      titleField: "t",
      issueNumberField: "n",
    };
    expect(parseConfig(serializeConfig(config))).toEqual(config);
  });
});

describe("validateConfig", () => {
  const valid = {
    ...EMPTY_CONFIG,
    repo: "octocat/hello-world",
    titleField: "t",
    issueNumberField: "n",
  };
  it("accepts a minimal valid config", () => {
    expect(validateConfig(valid)).toEqual([]);
  });
  it("rejects a repo that is not owner/repo", () => {
    expect(
      validateConfig({ ...valid, repo: "https://github.com/o/r" }).map(
        (e) => e.field,
      ),
    ).toEqual(["repo"]);
  });
  it("requires title and issue number fields", () => {
    const fields = validateConfig({
      ...valid,
      titleField: "",
      issueNumberField: "",
    }).map((e) => e.field);
    expect(fields).toContain("titleField");
    expect(fields).toContain("issueNumberField");
  });
  it("rejects the same field used for two write targets", () => {
    const errors = validateConfig({ ...valid, issueUrlField: "n" });
    expect(errors.some((e) => e.message.includes("重複"))).toBe(true);
  });
});

describe("repoApiBaseUrl", () => {
  it("builds the prefix that the proxy config is keyed by", () => {
    expect(repoApiBaseUrl("o/r")).toBe("https://api.github.com/repos/o/r/");
  });
});
