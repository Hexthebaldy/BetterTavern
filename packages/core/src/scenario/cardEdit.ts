/**
 * 编辑角色卡（手机和网页共用的纯逻辑）：草稿的形状、上限（和服务端 domain/scenario/edit.py 一致）、
 * 保存前的检查、“改过没有”的判断，以及世界书条目的增删和上下移动。
 *
 * - 标签、关键词在界面上各用一个输入框，用逗号、顿号或换行分开；保存时拆成数组，去掉空的和重复的。
 * - 字数按 Unicode 字符数算（和服务端 Python 的 len 一致），不按 JS 的 UTF-16 长度。
 * - 世界书的先后有意义：开局搭建世界时常驻条目优先，其次按这个顺序取，所以可以上下移动。
 */

import type { CharacterCard, ScenarioCard, ScenarioCardInput } from "../api/types.ts";

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

export const FIELD_LABELS: Record<TextField | "name" | "display_name" | "tags", string> = {
  display_name: "剧本名",
  name: "角色名",
  description: "描述",
  personality: "性格",
  scenario: "情境",
  first_mes: "开场白",
  mes_example: "对话示例",
  tags: "标签",
};

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
  const displayName = draft.displayName.trim();
  if (!displayName) add("display_name", "剧本名不能为空");
  else if (charCount(displayName) > CARD_LIMITS.displayName)
    add("display_name", `剧本名最多 ${CARD_LIMITS.displayName} 个字`);
  const name = draft.name.trim();
  if (!name) add("name", "角色名不能为空");
  else if (charCount(name) > CARD_LIMITS.name) add("name", `角色名最多 ${CARD_LIMITS.name} 个字`);
  let total = 0;
  for (const field of TEXT_FIELDS) {
    const n = charCount(draft[field].trim());
    total += n;
    if (n > CARD_LIMITS.field)
      add(field, `${FIELD_LABELS[field]}最多 ${CARD_LIMITS.field} 个字，现在有 ${n} 个`);
  }
  const tags = splitList(draft.tags);
  if (tags.length > CARD_LIMITS.tags) add("tags", `标签最多 ${CARD_LIMITS.tags} 个`);
  else if (tags.some((t) => charCount(t) > CARD_LIMITS.tag))
    add("tags", `每个标签最多 ${CARD_LIMITS.tag} 个字`);
  if (draft.book.length > CARD_LIMITS.entries) add("book", `世界书最多 ${CARD_LIMITS.entries} 条`);
  draft.book.forEach((entry, i) => {
    const where = `book.${i}`;
    if (charCount(entry.name.trim()) > CARD_LIMITS.entryName)
      add(`${where}.name`, `条目名称最多 ${CARD_LIMITS.entryName} 个字`);
    const keys = splitList(entry.keys);
    if (keys.length > CARD_LIMITS.keys) add(`${where}.keys`, `关键词最多 ${CARD_LIMITS.keys} 个`);
    else if (keys.some((k) => charCount(k) > CARD_LIMITS.key))
      add(`${where}.keys`, `每个关键词最多 ${CARD_LIMITS.key} 个字`);
    const n = charCount(entry.content.trim());
    total += n;
    if (n === 0) add(`${where}.content`, "条目内容不能为空");
    else if (n > CARD_LIMITS.field) add(`${where}.content`, `条目内容最多 ${CARD_LIMITS.field} 个字`);
  });
  if (total > CARD_LIMITS.total)
    add("card", `角色卡文字总量最多 ${CARD_LIMITS.total} 字，现在有 ${total} 字`);
  return problems;
}

/** 给人看的字段名：book.3.content → 世界书第 4 条的内容 */
export function describeField(field: string): string {
  const entry = /^book\.(\d+)\.(name|keys|content)$/.exec(field);
  if (entry) {
    const part = { name: "名称", keys: "关键词", content: "内容" }[entry[2] as "name" | "keys" | "content"];
    return `世界书第 ${Number(entry[1]) + 1} 条的${part}`;
  }
  if (field === "book") return "世界书";
  if (field === "card") return "整张卡";
  return FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field;
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
