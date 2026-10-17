/**
 * 编辑角色卡（手机和网页共用的纯逻辑）：草稿的形状、上限（和服务端 domain/scenario/edit.py 一致）、
 * 保存前的检查、“改过没有”的判断，以及世界书条目的增删和上下移动。
 *
 * - 标签、关键词在界面上各用一个输入框，用逗号、顿号或换行分开；保存时拆成数组，去掉空的和重复的。
 * - 字数按 Unicode 字符数算（和服务端 Python 的 len 一致），不按 JS 的 UTF-16 长度。
 * - 世界书的先后有意义：开局搭建世界时常驻条目优先，其次按这个顺序取，所以可以上下移动。
 */

import type { CharacterCard, ScenarioCard, ScenarioCardInput } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";

export const CARD_LIMITS = {
  displayName: 80,
  name: 80,
  field: 60_000,
  total: 300_000,
  tags: 32,
  tag: 40,
  entries: 1000,
  entryName: 120,
  keys: 64,
  key: 100,
} as const;

/** 五个文本字段，按编辑页里的顺序 */
export const TEXT_FIELDS = ["description", "personality", "scenario", "first_mes", "mes_example"] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

export type LabeledField = TextField | "name" | "display_name" | "tags";

/** 编辑页上各字段的名字 */
export function fieldLabel(field: LabeledField): string {
  return i18n.t(`cardEdit.fields.${field}`);
}

const LABELED = new Set<string>([...TEXT_FIELDS, "name", "display_name", "tags"]);

/** 世界书条目的草稿：key 只在界面上用来区分条目，不发给服务端 */
export type EntryDraft = {
  key: string;
  name: string;
  keys: string;
  content: string;
  enabled: boolean;
  constant: boolean;
};

export type CardDraft = {
  displayName: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  tags: string;
  book: EntryDraft[];
};

/** field 和服务端 422 的 field 一样：display_name、name、description、tags、book、book.3.content、card 等 */
export type DraftProblem = { field: string; message: string };

let entrySeq = 0;

function entryKey(): string {
  entrySeq += 1;
  return `e${entrySeq}`;
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

export function newEntry(): EntryDraft {
  return { key: entryKey(), name: "", keys: "", content: "", enabled: true, constant: false };
}

export function draftFrom(detail: ScenarioCard): CardDraft {
  const card = detail.card;
  return {
    displayName: detail.display_name,
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    first_mes: card.first_mes,
    mes_example: card.mes_example,
    tags: joinList(card.tags),
    book: card.book.map((e) => ({
      key: entryKey(),
      name: e.name,
      keys: joinList(e.keys),
      content: e.content,
      enabled: e.enabled,
      constant: e.constant,
    })),
  };
}

function cardOf(draft: CardDraft): CharacterCard {
  return {
    name: draft.name.trim(),
    description: draft.description,
    personality: draft.personality,
    scenario: draft.scenario,
    first_mes: draft.first_mes,
    mes_example: draft.mes_example,
    tags: splitList(draft.tags),
    book: draft.book.map((e) => ({
      name: e.name.trim(),
      keys: splitList(e.keys),
      content: e.content,
      enabled: e.enabled,
      constant: e.constant,
    })),
  };
}

export function toInput(draft: CardDraft, version: number): ScenarioCardInput {
  return { version, display_name: draft.displayName.trim(), card: cardOf(draft) };
}

/** 草稿和原来的比有没有实质改动（首尾空白、分隔符写法、条目的界面编号不算） */
export function isDirty(original: CardDraft, draft: CardDraft): boolean {
  const norm = (d: CardDraft) => {
    const card = cardOf(d);
    const trim = (t: string) => t.replace(/\r\n/g, "\n").trim();
    return JSON.stringify({
      displayName: d.displayName.trim(),
      ...card,
      description: trim(card.description),
      personality: trim(card.personality),
      scenario: trim(card.scenario),
      first_mes: trim(card.first_mes),
      mes_example: trim(card.mes_example),
      book: card.book.map((e) => ({ ...e, content: trim(e.content) })),
    });
  };
  return norm(original) !== norm(draft);
}

/** 保存前的检查（和服务端同样的规则）；没问题返回空数组。文字总量只算能编辑的部分，其余由服务端兜底 */
export function checkDraft(draft: CardDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const add = (field: string, message: string) => problems.push({ field, message });
  const L = CARD_LIMITS;
  const displayName = draft.displayName.trim();
  if (!displayName) add("display_name", i18n.t("cardEdit.problems.displayNameEmpty"));
  else if (charCount(displayName) > L.displayName)
    add("display_name", i18n.t("cardEdit.problems.displayNameTooLong", { max: L.displayName }));
  const name = draft.name.trim();
  if (!name) add("name", i18n.t("cardEdit.problems.nameEmpty"));
  else if (charCount(name) > L.name) add("name", i18n.t("cardEdit.problems.nameTooLong", { max: L.name }));
  let total = 0;
  for (const field of TEXT_FIELDS) {
    const n = charCount(draft[field].trim());
    total += n;
    if (n > L.field)
      add(field, i18n.t("cardEdit.problems.fieldTooLong", { field: fieldLabel(field), max: L.field, n }));
  }
  const tags = splitList(draft.tags);
  if (tags.length > L.tags) add("tags", i18n.t("cardEdit.problems.tooManyTags", { max: L.tags }));
  else if (tags.some((t) => charCount(t) > L.tag))
    add("tags", i18n.t("cardEdit.problems.tagTooLong", { max: L.tag }));
  if (draft.book.length > L.entries)
    add("book", i18n.t("cardEdit.problems.tooManyEntries", { max: L.entries }));
  draft.book.forEach((entry, i) => {
    const where = `book.${i}`;
    if (charCount(entry.name.trim()) > L.entryName)
      add(`${where}.name`, i18n.t("cardEdit.problems.entryNameTooLong", { max: L.entryName }));
    const keys = splitList(entry.keys);
    if (keys.length > L.keys) add(`${where}.keys`, i18n.t("cardEdit.problems.tooManyKeys", { max: L.keys }));
    else if (keys.some((k) => charCount(k) > L.key))
      add(`${where}.keys`, i18n.t("cardEdit.problems.keyTooLong", { max: L.key }));
    const n = charCount(entry.content.trim());
    total += n;
    if (n === 0) add(`${where}.content`, i18n.t("cardEdit.problems.contentEmpty"));
    else if (n > L.field)
      add(`${where}.content`, i18n.t("cardEdit.problems.contentTooLong", { max: L.field }));
  });
  if (total > L.total) add("card", i18n.t("cardEdit.problems.totalTooLong", { max: L.total, n: total }));
  return problems;
}

/** 给人看的字段名：book.3.content → 世界书第 4 条的内容 */
export function describeField(field: string): string {
  const entry = /^book\.(\d+)\.(name|keys|content)$/.exec(field);
  if (entry) {
    const part = i18n.t(`cardEdit.entryParts.${entry[2] as "name" | "keys" | "content"}`);
    return i18n.t("cardEdit.entryField", { n: Number(entry[1]) + 1, part });
  }
  if (field === "book") return i18n.t("cardEdit.book");
  if (field === "card") return i18n.t("cardEdit.card");
  return LABELED.has(field) ? fieldLabel(field as LabeledField) : field;
}

/** 把第 index 条往前（-1）或往后（1）挪一位；到头了就原样返回 */
export function moveEntry(book: EntryDraft[], index: number, delta: -1 | 1): EntryDraft[] {
  const target = index + delta;
  if (index < 0 || index >= book.length || target < 0 || target >= book.length) return book;
  const next = [...book];
  const [item] = next.splice(index, 1);
  if (item) next.splice(target, 0, item);
  return next;
}
