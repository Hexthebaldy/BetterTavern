/**
 * “开始新的故事”表单的内置选项，以及把选择拼回接口字段的规则。
 *
 * 选择控件最终仍拼成原来的字段：主角名、主角简介（≤400 字）、篇幅、文风（≤200 字）、内容边界（≤300 字）。
 * 还没有导演模型时，表单上面先提示（needsDirector），不等点了“开始故事”才由服务端报 ROUTE_MISSING。
 */

import type { ModelRoute, Preferences } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";

export const NAME_MAX = 40;
export const SUMMARY_MAX = 400;
export const STYLE_MAX = 200;
export const BOUNDARIES_MAX = 300;

/** 一份用 | 分开的选项表（名字建议、文风、不想看到的内容），随界面语言 */
function list(key: "start.names" | "start.styles" | "start.boundaries"): string[] {
  return i18n.t(key).split("|");
}

/** 名字建议的候选：中文界面是中文名，英文界面是英文名 */
export function namePool(): string[] {
  return list("start.names");
}

/** 从名字池里取几个建议；random 返回 [0, 1)，测试时可以换成固定序列 */
export function suggestNames(count: number, random: () => number = Math.random): string[] {
  const pool = namePool();
  const picked: string[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(random() * pool.length);
    picked.push(...pool.splice(index, 1));
  }
  return picked;
}

/** 随机一个和当前不同的名字 */
export function randomName(current: string, random: () => number = Math.random): string {
  const all = namePool();
  const pool = all.filter((n) => n !== current);
  return pool[Math.floor(random() * pool.length)] ?? all[0] ?? "";
}

/** 内置的文风标签 */
export function styleTags(): string[] {
  return list("start.styles");
}

/** 内置的“不想看到的内容” */
export function boundaryItems(): string[] {
  return list("start.boundaries");
}

export function lengthLabel(length: Preferences["length"]): string {
  return i18n.t(`start.length.${length}`);
}

/** 用界面语言的分隔符连起来（中文是顿号，英文是逗号）；放不下的项整项丢掉，不截断半个词 */
export function joinWithin(items: string[], max: number): string {
  const separator = i18n.t("common.listSeparator");
  let text = "";
  for (const item of items) {
    const value = item.trim();
    if (!value) continue;
    const next = text ? `${text}${separator}${value}` : value;
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

/** 表单底部的摘要，每段一个小胶囊：林川 / 适中 / 克制 · 白描 / 避开 2 项 */
export function summaryParts(form: {
  name: string;
  length: Preferences["length"];
  styles: string[];
  boundaries: number;
}): string[] {
  const parts = [form.name.trim() || i18n.t("start.noName"), lengthLabel(form.length)];
  if (form.styles.length > 0) parts.push(form.styles.join(" · "));
  if (form.boundaries > 0) parts.push(i18n.t("start.avoid", { count: form.boundaries }));
  return parts;
}

/**
 * 剧本页要不要提前提示“还没有导演模型”：取到了模型列表、里面没有导演时才提示。
 * 取不到列表（undefined）时不提示，仍靠服务端的 ROUTE_MISSING 兜底。
 */
export function needsDirector(routes: readonly Pick<ModelRoute, "is_director">[] | undefined): boolean {
  return routes !== undefined && !routes.some((route) => route.is_director);
}
