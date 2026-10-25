/**
 * 编辑角色卡（手机和网页共用的纯逻辑）：工作台手动表单里草稿的形状、上限（和服务端 domain/scenario/edit.py 一致）、
 * 保存前的检查（和服务端 domain/scenario/check.py 同一套 code）、“改过没有”的判断，以及世界书条目、备选开场白的增删和移动。
 *
 * - 标签、关键词在界面上各用一个输入框，用逗号、顿号或换行分开；发给服务端时拆成数组，去掉空的和重复的。
 * - 字数按 Unicode 字符数算（和服务端 Python 的 len 一致），不按 JS 的 UTF-16 长度。
 * - 世界书的先后有意义：开局搭建世界时常驻条目优先，其次按这个顺序取，所以可以上下移动。
 * - 草稿可以暂时不完整（名字空着、条目没写内容）：自动保存照样存，检查结果里是 error，保存进仓库时才挡住。
 */

import type {
  CharacterCard,
  CharacterCardInput,
  Draft,
  Issue,
  LoreEntry,
  LoreLogic,
  LoreRules,
} from "../api/types.ts";
import { i18n } from "../i18n/index.ts";

export const CARD_LIMITS = {
  displayName: 80,
  name: 80,
  field: 60_000,
  total: 300_000,
  greetings: 32,
  tags: 32,
  tag: 40,
  entries: 1000,
  entryName: 120,
  keys: 64,
  key: 300,
} as const;

/** 能编辑的文本字段，按表单里的顺序 */
export const TEXT_FIELDS = [
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "system_prompt",
  "creator_notes",
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export type LabeledField = TextField | "name" | "display_name" | "tags" | "alternate_greetings";

/** 表单上各字段的名字 */
export function fieldLabel(field: LabeledField): string {
  return i18n.t(`cardEdit.fields.${field}`);
}

const LABELED = new Set<string>([...TEXT_FIELDS, "name", "display_name", "tags", "alternate_greetings"]);

/** 世界书条目的草稿：key 只在界面上用来区分条目，不发给服务端。
 * 次要关键词和关键词一样是一串用逗号分开的文字；优先级、其余触发设置原样带着（保存时不丢）。 */
export type EntryDraft = {
  key: string;
  name: string;
  keys: string;
  content: string;
  enabled: boolean;
  constant: boolean;
  secondaryKeys: string;
  logic: LoreLogic;
  priority: number | null;
  rules: LoreRules | null;
};

/** 触发设置的默认值（SillyTavern 新装时的），和服务端 LoreRules 的默认一致 */
export const DEFAULT_RULES: LoreRules = {
  whole_words: null,
  case_sensitive: null,
  scan_depth: null,
  match: [],
  exclude_recursion: false,
  prevent_recursion: false,
  delay_until_recursion: 0,
  probability: 100,
  groups: [],
  group_override: false,
  group_weight: 100,
  group_scoring: null,
  sticky: 0,
  cooldown: 0,
  delay: 0,
  triggers: [],
  ignore_budget: false,
};

export type GreetingDraft = { key: string; text: string };

export type CardDraft = {
  displayName: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  creator_notes: string;
  greetings: GreetingDraft[];
  tags: string;
  book: EntryDraft[];
};

let entrySeq = 0;

function nextKey(prefix: string): string {
  entrySeq += 1;
  return `${prefix}${entrySeq}`;
}

/** 按 Unicode 字符数算长度 */
export function charCount(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/** 用逗号、顿号或换行分开的一串，拆成去掉空项和重复项的数组 */
export function splitList(text: string): string[] {
  const result: string[] = [];
  for (const part of text.split(/[,，、\n]/)) {
    const item = part.trim();
    if (item && !result.includes(item)) result.push(item);
  }
  return result;
}

export function joinList(items: readonly string[]): string {
  return items.join("，");
}

const CLOSED_REGEX = /^\/[\s\S]+\/[gimsuy]*$/;
const REGEX_END = /\/[gimsuy]*$/;

/** 关键词：和 splitList 一样用逗号、顿号或换行分开，但写成 /……/flags 的正则里的逗号不算分隔
 * （SillyTavern 的正则关键词，比如 /x{1,3}/）。只有后面真有收尾的 /flags 时才连起来，免得把以 / 开头的
 * 普通关键词和后面的连成一个。 */
export function splitKeys(text: string): string[] {
  const parts = text.split(/([,，、\n])/);
  const result: string[] = [];
  const push = (value: string): void => {
    const item = value.trim();
    if (item && !result.includes(item)) result.push(item);
  };
  let i = 0;
  while (i < parts.length) {
    const part = parts[i] ?? "";
    const trimmed = part.trim();
    if (trimmed.startsWith("/") && !CLOSED_REGEX.test(trimmed)) {
      let end = -1;
      for (let j = i + 2; j < parts.length; j += 2) {
        if (REGEX_END.test((parts[j] ?? "").trim())) {
          end = j;
          break;
        }
      }
      if (end > 0) {
        push(parts.slice(i, end + 1).join(""));
        i = end + 2;
        continue;
      }
    }
    push(part);
    i += 2;
  }
  return result;
}

export function newEntry(): EntryDraft {
  return {
    key: nextKey("e"),
    name: "",
    keys: "",
    content: "",
    enabled: true,
    constant: false,
    secondaryKeys: "",
    logic: "any",
    priority: null,
    rules: null,
  };
}

export function newGreeting(text = ""): GreetingDraft {
  return { key: nextKey("g"), text };
}

/** 卡片内容（加上显示名）→ 表单的草稿 */
export function draftOf(card: CharacterCard, displayName: string): CardDraft {
  return {
    displayName,
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.first_mes,
    mes_example: card.mes_example,
    system_prompt: card.system_prompt,
    creator_notes: card.creator_notes,
    greetings: card.alternate_greetings.map((text) => newGreeting(text)),
    tags: joinList(card.tags),
    book: card.book.map(entryDraftOf),
  };
}

/** 一条世界书 → 表单里的草稿（卡里的世界书和独立世界书共用） */
export function entryDraftOf(e: LoreEntry): EntryDraft {
  return {
    key: nextKey("e"),
    name: e.name,
    keys: joinList(e.keys),
    content: e.content,
    enabled: e.enabled,
    constant: e.constant,
    secondaryKeys: joinList(e.secondary_keys ?? []),
    logic: e.logic ?? "any",
    priority: e.priority ?? null,
    rules: e.rules ?? null,
  };
}

/** 表单里的一条 → 发给服务端的条目 */
export function entryInput(e: EntryDraft): LoreEntry {
  return {
    name: e.name.trim(),
    keys: splitKeys(e.keys),
    content: e.content,
    enabled: e.enabled,
    constant: e.constant,
    secondary_keys: splitKeys(e.secondaryKeys),
    logic: e.logic,
    priority: e.priority,
    rules: e.rules,
  };
}

export function draftFrom(draft: Draft): CardDraft {
  return draftOf(draft.card, draft.draft.name);
}

export function cardOf(draft: CardDraft): CharacterCardInput {
  return {
    name: draft.name.trim(),
    description: draft.description,
    personality: draft.personality,
    scenario: draft.scenario,
    first_mes: draft.first_mes,
    mes_example: draft.mes_example,
    system_prompt: draft.system_prompt,
    creator_notes: draft.creator_notes,
    alternate_greetings: draft.greetings.map((g) => g.text),
    tags: splitList(draft.tags),
    book: draft.book.map(entryInput),
  };
}

/** 自动保存的请求体：显示名和卡片 */
export function toInput(draft: CardDraft): { name: string; card: CharacterCardInput } {
  return { name: draft.displayName.trim(), card: cardOf(draft) };
}

/** 草稿和原来的比有没有实质改动（首尾空白、分隔符写法、条目的界面编号不算） */
export function isDirty(original: CardDraft, draft: CardDraft): boolean {
  const norm = (d: CardDraft) => {
    const card = cardOf(d);
    const trim = (t: string) => t.replace(/\r\n/g, "\n").trim();
    return JSON.stringify({
      displayName: d.displayName.trim(),
      ...card,
      ...Object.fromEntries(TEXT_FIELDS.map((f) => [f, trim(card[f])])),
      alternate_greetings: card.alternate_greetings.map(trim),
      book: card.book.map((e) => ({ ...e, content: trim(e.content) })),
    });
  };
  return norm(original) !== norm(draft);
}

// ---- 检查（和服务端 domain/scenario/check.py 同一套 code） ---------------------------------

const MACRO = /\{\{\s*([^{}]{0,40}?)\s*\}\}/g;
const HALF_MACRO = /(?<!\{)\{\s*(user|char)\s*\}\}|\{\{\s*(user|char)\s*\}(?!\})/i;

function macroIssues(field: string, text: string): Issue[] {
  const issues: Issue[] = [];
  for (const match of text.matchAll(MACRO)) {
    const name = (match[1] ?? "").trim().toLowerCase();
    if (name !== "user" && name !== "char") {
      issues.push({ field, code: "macro_unknown", level: "warning", params: { macro: match[0] } });
      break;
    }
  }
  const half = HALF_MACRO.exec(text);
  if (half) issues.push({ field, code: "macro_broken", level: "warning", params: { macro: half[0] } });
  return issues;
}

/** 按保存的规则检查草稿；没有 error 才能保存进角色卡仓库 */
export function checkCard(draft: CardDraft): Issue[] {
  const issues: Issue[] = [];
  const L = CARD_LIMITS;
  const error = (field: string, code: string, params: Issue["params"] = {}) =>
    issues.push({ field, code, level: "error", params });
  const warn = (field: string, code: string, params: Issue["params"] = {}) =>
    issues.push({ field, code, level: "warning", params });
  const card = cardOf(draft);

  const shown = draft.displayName.trim() || card.name;
  if (!shown) error("display_name", "display_name_empty");
  else if (charCount(shown) > L.displayName) error("display_name", "display_name_too_long", { max: L.displayName });
  if (!card.name) error("name", "name_empty");
  else if (charCount(card.name) > L.name) error("name", "name_too_long", { max: L.name });

  let total = 0;
  for (const field of TEXT_FIELDS) {
    const text = card[field].trim();
    const n = charCount(text);
    total += n;
    if (n > L.field) error(field, "field_too_long", { max: L.field, n });
    issues.push(...macroIssues(field, text));
  }
  if (!card.description.trim()) warn("description", "description_empty");
  if (!card.first_mes.trim()) warn("first_mes", "opening_empty");

  if (card.alternate_greetings.length > L.greetings) error("alternate_greetings", "too_many_greetings", { max: L.greetings });
  card.alternate_greetings.forEach((text, i) => {
    const where = `alternate_greetings.${i}`;
    const n = charCount(text.trim());
    total += n;
    if (n === 0) error(where, "greeting_empty");
    else if (n > L.field) error(where, "field_too_long", { max: L.field, n });
    issues.push(...macroIssues(where, text));
  });

  if (card.tags.length > L.tags) error("tags", "too_many_tags", { max: L.tags });
  else if (card.tags.some((t) => charCount(t) > L.tag)) error("tags", "tag_too_long", { max: L.tag });

  if (card.book.length > L.entries) error("book", "too_many_entries", { max: L.entries });
  const seen = new Map<string, number>();
  card.book.forEach((entry, i) => {
    const where = `book.${i}`;
    if (charCount(entry.name) > L.entryName) error(`${where}.name`, "entry_name_too_long", { max: L.entryName });
    if (entry.keys.length > L.keys) error(`${where}.keys`, "too_many_keys", { max: L.keys });
    else if (entry.keys.some((k) => charCount(k) > L.key)) error(`${where}.keys`, "key_too_long", { max: L.key });
    const n = charCount(entry.content.trim());
    total += n;
    if (n === 0) error(`${where}.content`, "entry_empty");
    else if (n > L.field) error(`${where}.content`, "field_too_long", { max: L.field, n });
    if (entry.enabled && !entry.constant && entry.keys.length === 0) warn(`${where}.keys`, "entry_unreachable");
    for (const key of entry.keys) {
      const folded = key.toLocaleLowerCase();
      const other = seen.get(folded);
      if (other !== undefined && other !== i) {
        warn(`${where}.keys`, "key_duplicate", { key, other: other + 1 });
        break;
      }
      if (other === undefined) seen.set(folded, i);
    }
  });
  if (total > L.total) error("card", "total_too_long", { max: L.total, n: total });
  return issues;
}

export function blocking(issues: readonly Issue[]): Issue[] {
  return issues.filter((i) => i.level === "error");
}

/** 问题本身（不带字段名，写在输入框下面）：“角色名不能为空” */
export function issueProblem(issue: Issue): string {
  return i18n.t(`cardEdit.issues.${issue.code}` as "cardEdit.issues.name_empty", {
    ...issue.params,
    user: "{{user}}",
    char: "{{char}}",
    defaultValue: issue.code,
  });
}

/** 一个问题给人看的说明：“开场白：没写开场白” */
export function describeIssue(issue: Issue): string {
  const text = issueProblem(issue);
  return issue.field === "card" ? text : i18n.t("cardEdit.fieldProblem", { field: describeField(issue.field), problem: text });
}

/** 新草稿本来就是空的：这几种“没填”的问题，保存之前不在输入框下面标红 */
export const EMPTY_CODES: ReadonlySet<string> = new Set([
  "name_empty",
  "display_name_empty",
  "entry_empty",
  "greeting_empty",
]);

/** 给人看的字段名：book.3.content → 世界书第 4 条的内容；alternate_greetings.1 → 第 2 条备选开场白 */
export function describeField(field: string): string {
  const entry = /^book\.(\d+)\.(name|keys|content|secondary_keys)$/.exec(field);
  if (entry) {
    const part = i18n.t(`cardEdit.entryParts.${entry[2] as "name" | "keys" | "content" | "secondary_keys"}`);
    return i18n.t("cardEdit.entryField", { n: Number(entry[1]) + 1, part });
  }
  const greeting = /^alternate_greetings\.(\d+)$/.exec(field);
  if (greeting) return i18n.t("cardEdit.greetingField", { n: Number(greeting[1]) + 1 });
  if (field === "book") return i18n.t("cardEdit.book");
  if (field === "card") return i18n.t("cardEdit.card");
  return LABELED.has(field) ? fieldLabel(field as LabeledField) : field;
}

/** 把第 index 项往前（-1）或往后（1）挪一位；到头了就原样返回 */
export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

export const moveEntry = (book: EntryDraft[], index: number, delta: -1 | 1): EntryDraft[] =>
  moveItem(book, index, delta);
