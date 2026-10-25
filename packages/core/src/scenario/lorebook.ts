/**
 * 世界书（手机和网页共用的纯逻辑，docs/lorebook.md）：编辑条目时“更多设置”怎么改、条目上的小标、
 * 永远不会被带上的条目、世界书的检查（和服务端 domain/scenario/lorebook.py 的上限一致）、
 * 导入报告列哪几行、剧本里挂的书怎么写成一行。
 *
 * 条目的草稿和卡里的世界书一样（cardEdit.ts 的 EntryDraft）；独立世界书编辑和工作台的草稿一样宽松：
 * 标题、正文、关键词可以暂时空着，只有超过上限才是 error。
 */

import type { Issue, LoreEntry, LorebookReport, LoreRules } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";
import { CARD_LIMITS, charCount, DEFAULT_RULES, splitKeys, type EntryDraft } from "./cardEdit.ts";

export const LOREBOOK_LIMITS = {
  entries: 2000,
  chars: 500_000,
  name: 80,
  description: 2000,
  perScenario: 4,
  fileBytes: 8 * 1024 * 1024,
} as const;

/** 条目上“更多设置”里能改的几项；其余的（顺带扫描、生成方式等）原样保留 */
export const EDITABLE_RULES = [
  "probability",
  "groups",
  "group_weight",
  "sticky",
  "cooldown",
  "delay",
  "exclude_recursion",
  "prevent_recursion",
  "whole_words",
] as const satisfies readonly (keyof LoreRules)[];

const HIDDEN_RULES: (keyof LoreRules)[] = (Object.keys(DEFAULT_RULES) as (keyof LoreRules)[]).filter(
  (key) => !(EDITABLE_RULES as readonly string[]).includes(key),
);

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function rulesOf(entry: Pick<EntryDraft, "rules">): LoreRules {
  return { ...DEFAULT_RULES, ...(entry.rules ?? {}) };
}

/** 改“更多设置”里的几项：全是默认值时存成 null（和服务端一样） */
export function withRules<T extends Pick<EntryDraft, "rules">>(entry: T, patch: Partial<LoreRules>): T {
  const next = { ...rulesOf(entry), ...patch };
  const isDefault = (Object.keys(DEFAULT_RULES) as (keyof LoreRules)[]).every((k) =>
    sameValue(next[k], DEFAULT_RULES[k]),
  );
  return { ...entry, rules: isDefault ? null : next };
}

/** 从 SillyTavern 带来的、界面上不给改的设置里，有几项不是默认值 */
export function hiddenRuleCount(entry: Pick<EntryDraft, "rules">): number {
  const rules = rulesOf(entry);
  return HIDDEN_RULES.filter((k) => !sameValue(rules[k], DEFAULT_RULES[k])).length;
}

/** 输入框里的数字：空的是 null；不是整数的按原样不接受（返回 undefined） */
export function parseWhole(text: string, min: number, max: number): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  if (!/^-?\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n < min || n > max ? undefined : n;
}

/** 正文是空的，或者没有关键词又不是常驻：怎么都不会被带上 */
export function neverTriggers(entry: Pick<EntryDraft, "content" | "keys" | "constant">): boolean {
  return !entry.content.trim() || (!entry.constant && splitKeys(entry.keys).length === 0);
}

/** 条目在列表里的小标：分组、概率、粘滞、冷却、延迟、正则（常驻、停用、有问题另外标） */
export function entryTags(entry: EntryDraft): string[] {
  const rules = rulesOf(entry);
  const tags: string[] = [];
  for (const group of rules.groups.slice(0, 2)) tags.push(i18n.t("loreEdit.tags.group", { name: group }));
  if (rules.probability < 100) tags.push(i18n.t("loreEdit.tags.probability", { n: rules.probability }));
  if (rules.sticky) tags.push(i18n.t("loreEdit.tags.sticky", { n: rules.sticky }));
  if (rules.cooldown) tags.push(i18n.t("loreEdit.tags.cooldown", { n: rules.cooldown }));
  if (rules.delay) tags.push(i18n.t("loreEdit.tags.delay", { n: rules.delay }));
  if ([...splitKeys(entry.keys), ...splitKeys(entry.secondaryKeys)].some((k) => /^\/.+\/[gimsuy]*$/s.test(k))) {
    tags.push(i18n.t("loreEdit.tags.regex"));
  }
  return tags;
}

/** 搜索条目：标题或关键词里有这几个字（不分大小写）；空的搜索都算 */
export function matchesEntry(entry: Pick<EntryDraft, "name" | "keys" | "secondaryKeys">, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [entry.name, entry.keys, entry.secondaryKeys].some((text) => text.toLocaleLowerCase().includes(q));
}

/** 编辑世界书前的检查：超过上限的是 error（服务端会拒绝），永远不会被带上的是 warning */
export function checkBook(book: readonly EntryDraft[]): Issue[] {
  const issues: Issue[] = [];
  const error = (field: string, code: string, params: Issue["params"] = {}) =>
    issues.push({ field, code, level: "error", params });
  if (book.length > LOREBOOK_LIMITS.entries) error("book", "too_many_entries", { max: LOREBOOK_LIMITS.entries });
  let total = 0;
  book.forEach((entry, i) => {
    const where = `book.${i}`;
    if (charCount(entry.name.trim()) > CARD_LIMITS.entryName) {
      error(`${where}.name`, "entry_name_too_long", { max: CARD_LIMITS.entryName });
    }
    for (const part of ["keys", "secondary_keys"] as const) {
      const keys = splitKeys(part === "keys" ? entry.keys : entry.secondaryKeys);
      if (keys.length > CARD_LIMITS.keys) error(`${where}.${part}`, "too_many_keys", { max: CARD_LIMITS.keys });
      else if (keys.some((k) => charCount(k) > CARD_LIMITS.key)) {
        error(`${where}.${part}`, "key_too_long", { max: CARD_LIMITS.key });
      }
    }
    const n = charCount(entry.content.trim());
    total += n;
    if (n > CARD_LIMITS.field) error(`${where}.content`, "field_too_long", { max: CARD_LIMITS.field, n });
    if (entry.enabled && neverTriggers(entry)) {
      issues.push({ field: `${where}.keys`, code: "entry_unreachable", level: "warning", params: {} });
    }
  });
  if (total > LOREBOOK_LIMITS.chars) error("book", "book_too_long", { max: LOREBOOK_LIMITS.chars, n: total });
  return issues;
}

/** 世界书的三个数：条目、常驻、停用 */
export function bookStats(book: readonly Pick<LoreEntry, "constant" | "enabled">[]): {
  entries: number;
  constant: number;
  disabled: number;
} {
  return {
    entries: book.length,
    constant: book.filter((e) => e.constant).length,
    disabled: book.filter((e) => !e.enabled).length,
  };
}

const REPORT_KEYS = [
  "dropped_empty",
  "dropped_unreachable",
  "dropped_over_limit",
  "vectorized",
  "character_filter",
  "bad_regex",
  "other_macros",
] as const;

/** 导入报告里要给人看的几行（不是 0 的）：丢掉的条目和不支持的设置 */
export function reportLines(report: LorebookReport | null): string[] {
  if (!report) return [];
  return REPORT_KEYS.filter((key) => report[key] > 0).map((key) =>
    i18n.t(`lorebook.report.${key}`, { count: report[key], user: "{{user}}", char: "{{char}}" }),
  );
}

/** 导入报告里有没有不支持的设置（列表上标一个小标） */
export function hasUnsupported(report: LorebookReport | null): boolean {
  return !!report && report.vectorized + report.character_filter + report.bad_regex + report.other_macros > 0;
}

/** 剧本里挂的书写成一行：一两本写全名，再多写“甲、乙 等 3 本” */
export function lorebookSummary(names: readonly string[]): string {
  if (names.length === 0) return i18n.t("lorebook.scenarioNone");
  const separator = i18n.t("common.listSeparator");
  if (names.length <= 2) return names.join(separator);
  return i18n.t("lorebook.scenarioMore", { names: names.slice(0, 2).join(separator), count: names.length });
}

/** 导入前在本地先看一眼：只收 .json，最大 8 MB；不能导入时给出提示（标题和说明），能导入返回 null */
export function checkLorebookFile(file: { name: string; size: number }): { title: string; message: string } | null {
  if (!/\.json$/i.test(file.name)) {
    return {
      title: i18n.t("lorebook.notJson", { name: file.name }),
      message: i18n.t("lorebook.notJsonMessage"),
    };
  }
  if (file.size > LOREBOOK_LIMITS.fileBytes) {
    return {
      title: i18n.t("lorebook.tooLarge", { name: file.name }),
      message: i18n.t("lorebook.tooLargeMessage"),
    };
  }
  return null;
}
