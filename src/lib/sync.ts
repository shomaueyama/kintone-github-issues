/**
 * kintone のレコードと GitHub Issue の対応づけ。
 * 「レコードのどの値を Issue に送るか」「Issue のどの値をレコードに書くか」をここで決める。
 * kintone の API は呼ばない(呼び出し側が行う)。
 */
import type { PluginConfig } from "./config";
import type { CreateIssueInput, Issue } from "./github";

/** kintone のレコード。フィールドコード → { value } */
export type KintoneRecord = Record<string, { value: unknown } | undefined>;

/** レコード更新に渡す形。フィールドコード → { value } */
export type RecordUpdate = Record<string, { value: string }>;

function text(record: KintoneRecord, fieldCode: string): string {
  if (!fieldCode) return "";
  const v = record[fieldCode]?.value;
  if (typeof v === "string") return v;
  return v == null ? "" : String(v);
}

/** レコードに保存済みの Issue 番号。未設定なら null */
export function linkedIssueNumber(
  record: KintoneRecord,
  config: PluginConfig,
): number | null {
  const raw = text(record, config.issueNumberField);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** レコードの値から Issue 作成の入力を作る */
export function toCreateIssueInput(
  record: KintoneRecord,
  config: PluginConfig,
): CreateIssueInput {
  const input: CreateIssueInput = { title: text(record, config.titleField) };
  if (config.bodyField) input.body = text(record, config.bodyField);
  if (config.labelsField) {
    const v = record[config.labelsField]?.value;
    if (Array.isArray(v)) input.labels = v.map(String);
  }
  return input;
}

/**
 * Issue の内容をレコードに書く更新内容。設定で空にしたフィールドには書かない。
 * `now` は同期日時。テストしやすいように引数で受け取る。
 */
export function toRecordUpdate(
  issue: Issue,
  config: PluginConfig,
  now: Date,
): RecordUpdate {
  const update: RecordUpdate = {
    [config.issueNumberField]: { value: String(issue.number) },
  };
  if (config.issueUrlField)
    update[config.issueUrlField] = { value: issue.htmlUrl };
  if (config.issueStateField)
    update[config.issueStateField] = { value: issue.state };
  if (config.syncedAtField)
    update[config.syncedAtField] = { value: now.toISOString() };
  return update;
}

/**
 * 同期で書き換えが必要か。番号・URL・状態のどれかがレコードと違えば true。
 * 同期日時だけが違う場合は書かない(毎回の表示で更新履歴を汚さないため)。
 */
export function needsUpdate(
  record: KintoneRecord,
  issue: Issue,
  config: PluginConfig,
): boolean {
  if (text(record, config.issueNumberField) !== String(issue.number))
    return true;
  if (
    config.issueUrlField &&
    text(record, config.issueUrlField) !== issue.htmlUrl
  )
    return true;
  if (
    config.issueStateField &&
    text(record, config.issueStateField) !== issue.state
  )
    return true;
  return false;
}
