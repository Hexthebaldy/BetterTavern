/**
 * “开始新的故事”表单的内置选项，以及把选择拼回接口字段的规则。
 *
 * 选择控件最终仍拼成原来的字段：主角名、主角简介（≤400 字）、篇幅、文风（≤200 字）、内容边界（≤300 字）。
 */

import type { Preferences } from "../../api/types.ts";

export const NAME_MAX = 40;
export const SUMMARY_MAX = 400;
export const STYLE_MAX = 200;
export const BOUNDARIES_MAX = 300;

export const NAME_POOL = [
  "林川",
  "沈舟",
  "顾长安",
  "阿柏",
  "陆鸣",
  "许知远",
  "周遥",
  "江离",
  "叶青",
  "唐棠",
  "苏白",
  "程野",
  "温言",
  "方晓",
  "韩松",
  "秦岚",
] as const;

/** 从名字池里取几个建议；random 返回 [0, 1)，测试时可以换成固定序列 */
export function suggestNames(count: number, random: () => number = Math.random): string[] {
  const pool: string[] = [...NAME_POOL];
  const picked: string[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(random() * pool.length);
    picked.push(...pool.splice(index, 1));
  }
  return picked;
}

/** 随机一个和当前不同的名字 */
export function randomName(current: string, random: () => number = Math.random): string {
  const pool = NAME_POOL.filter((n) => n !== current);
  return pool[Math.floor(random() * pool.length)] ?? NAME_POOL[0];
}

export type IdentityIcon = "traveler" | "pair" | "lens";

export type Identity = { key: string; label: string; icon: IdentityIcon; draft: (card: string) => string };

/** 身份图块：选中后自动填一句底稿，可以接着改 */
export const IDENTITIES: Identity[] = [
  {
    key: "traveler",
    label: "过路的旅人",
    icon: "traveler",
    draft: (card) => `一个过路的旅人，第一次来到这里，和${card}素不相识。`,
  },
  {
    key: "acquaintance",
    label: "旧相识",
    icon: "pair",
    draft: (card) => `${card}多年前的旧相识，很久没有见面，这次是专程来找的。`,
  },
  {
    key: "seeker",
    label: "查访的人",
    icon: "lens",
    draft: (card) => `为了一件没弄清楚的事而来，想从${card}这里问出些线索。`,
  },
];

export const STYLE_TAGS = ["克制", "白描", "古典", "悬疑感", "诗意", "轻快", "冷幽默"] as const;

export const BOUNDARY_ITEMS = [
  "血腥描写",
  "主要角色死亡",
  "突然的惊吓",
  "露骨的亲密描写",
  "粗口",
  "伤害动物",
] as const;

export const LENGTH_LABELS: Record<Preferences["length"], string> = {
  short: "短",
  medium: "适中",
  long: "长",
};

/** 用顿号连起来；放不下的项整项丢掉，不截断半个词 */
export function joinWithin(items: string[], max: number): string {
  let text = "";
  for (const item of items) {
    const value = item.trim();
    if (!value) continue;
    const next = text ? `${text}、${value}` : value;
    if (next.length > max) break;
    text = next;
  }
  return text;
}

export function composeStyle(tags: string[]): string {
  return joinWithin(tags, STYLE_MAX);
}

export function composeBoundaries(items: string[]): string {
  return joinWithin(items, BOUNDARIES_MAX);
}

/** 表单底部的一行摘要：林川 · 过路的旅人 · 适中 · 克制 / 白描 · 避开 2 项 */
export function summaryLine(form: {
  name: string;
  identity: string | null;
  length: Preferences["length"];
  styles: string[];
  boundaries: number;
}): string {
  const parts = [form.name.trim() || "还没起名"];
  if (form.identity) parts.push(form.identity);
  parts.push(LENGTH_LABELS[form.length]);
  if (form.styles.length > 0) parts.push(form.styles.join(" / "));
  if (form.boundaries > 0) parts.push(`避开 ${form.boundaries} 项`);
  return parts.join(" · ");
}
