/**
 * 工作台界面上的几种说明文字（手机和网页共用）：改动在哪、agent 在用什么工具、一轮没做完的原因、写好了哪些字段、
 * 封面的画风。
 */

import type { HunkTarget } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";
import { describeField } from "../scenario/cardEdit.ts";

/** 封面的几种画风（和服务端 providers/image 的 STYLE_HINTS 一致） */
export const STYLE_IDS = new Set(["ink", "oil", "film", "flat"]);
export type StyleId = "ink" | "oil" | "film" | "flat";

/** 改动的位置：备选开场白的编号从 1 起，世界书条目的编号从 0 起（见 docs/api/workbench.md 的 Hunk） */
export function hunkTargetLabel(target: HunkTarget): string {
  if ("field" in target) return describeField(target.field);
  if ("greeting" in target) return i18n.t("workbench.changes.targets.greeting", { n: target.greeting });
  if ("lore" in target) return i18n.t("workbench.changes.targets.lore", { n: target.lore + 1 });
  return i18n.t("workbench.changes.targets.loreNew", { name: target.lore_new.name });
}

const TOOLS = new Set(["web_search", "image_search", "web_fetch", "generate_image", "write_field", "lore_upsert"]);

/** “正在搜索‘林黛玉 判词’” */
export function toolLabel(tool: { name: string; detail: string }): string {
  const name = TOOLS.has(tool.name) ? tool.name : "default";
  return i18n.t(`workbench.chat.tools.${name as "default"}`, { detail: tool.detail });
}

const ERRORS = new Set([
  "ROUTE_MISSING",
  "TOOLS_UNSUPPORTED",
  "RUN_TIMEOUT",
  "PROVIDER_ERROR",
  "CREDENTIAL_INVALID",
  "MODEL_NOT_FOUND",
  "CONTENT_BLOCKED",
  "ENDPOINT_NOT_ALLOWED",
  "CONTEXT_TOO_LARGE",
]);

export function runErrorText(code: string): string {
  return i18n.t(`workbench.errors.${(ERRORS.has(code) ? code : "UNKNOWN") as "UNKNOWN"}`);
}

/** 字段名的列表：“描述、性格、开场白” */
export function fieldList(fields: readonly string[]): string {
  return fields.map(describeField).join(i18n.t("common.listSeparator"));
}

/** 正在写的地方：field:description → 正在写：描述；lore:名字 → 正在写世界书：名字 */
export function writingLabel(target: string): string {
  if (target.startsWith("lore:")) return i18n.t("workbench.chat.writingLore", { name: target.slice(5) });
  return i18n.t("workbench.chat.writingField", { field: describeField(target.replace(/^field:/, "")) });
}

/** 角色卡是怎么来的：导入的写“导入（V2）”（agent 后来改过的写“agent 和你一起写的”），其他写谁写的 */
export function cardOrigin(card: { source: string; made_by: "agent" | "manual" | "mixed" }): string {
  if (card.source.startsWith("card_") && card.made_by === "manual") {
    return i18n.t(`library.sources.${card.source as "card_v2"}`);
  }
  return i18n.t(`library.madeBy.${card.made_by}`);
}
