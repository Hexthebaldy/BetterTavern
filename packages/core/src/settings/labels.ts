/** 设置页共用的文字和小规则（模型列表、添加模型、模型详情）。纯逻辑，node --test 可测。 */

import type { ModelInfo, ModelRoute, ProbeCheck, Provider, RouteWindow, WindowSource } from "../api/types.ts";
import { formatTokens } from "../utils/format.ts";

export const MODEL_STATUS: Record<ModelRoute["status"], string> = {
  ok: "可用",
  unverified: "还没确认",
  invalid: "Key 无效",
};

/** 状态图标：可用 = 对勾，还没确认 = 虚线方框，Key 无效 = 叉 */
export function statusKind(status: ModelRoute["status"]): "ok" | "untested" | "invalid" {
  return status === "ok" ? "ok" : status === "invalid" ? "invalid" : "untested";
}

export function providerName(id: string, providers: Provider[] | undefined): string {
  return providers?.find((p) => p.id === id)?.display_name ?? id;
}

/** 列表和标题里显示的名字：备注名，没有就是模型名 */
export function modelTitle(route: Pick<ModelRoute, "label" | "model">): string {
  return route.label || route.model;
}

/** 窗口来源的短说明，放在“上下文 128K”后面 */
export const WINDOW_SOURCE: Record<WindowSource, string> = {
  listed: "服务商提供",
  table: "内置资料",
  manual: "你填的",
  learned: "按服务商报错纠正",
  default: "估计值",
};

/** 窗口来源的完整说明；null 表示不用特别说明 */
export function windowNote(window: RouteWindow): string | null {
  const k = formatTokens(window.model_window);
  switch (window.source) {
    case "default":
      return `服务商没告诉我们这个模型能读多少，先按 ${k} 估计。知道的话可以填一下；之后服务商要是报“超长”，会自动改成它说的上限。`;
    case "learned":
      return `服务商报“上下文超长”时说这个模型最多 ${k}，已经自动按它算。`;
    case "manual":
      return `上下文 ${k} 是你填的。服务商的模型列表里没有这个模型的长度。`;
    default:
      return null;
  }
}

/** 手填窗口的选项；“不知道”就是不填，按 32K 估计 */
export const MANUAL_WINDOW_CHOICES: { value: string; label: string; tokens: number | null }[] = [
  { value: "unknown", label: "不知道", tokens: null },
  { value: "8192", label: "8K", tokens: 8192 },
  { value: "32768", label: "32K", tokens: 32768 },
  { value: "131072", label: "128K", tokens: 131072 },
  { value: "1000000", label: "1M", tokens: 1_000_000 },
];

export function manualWindowChoice(tokens: number | null): string {
  return MANUAL_WINDOW_CHOICES.find((c) => c.tokens === tokens)?.value ?? "unknown";
}

/**
 * 选中的模型要不要让玩家填窗口：服务商的列表或内置资料知道窗口就不用填。
 * 手输的名字不在列表里（列表还没拉、或者是带后缀的名字）时也要填，服务端保存时还会再查一次列表。
 */
export function needsManualWindow(models: ModelInfo[] | null, chosen: string): boolean {
  const name = chosen.trim();
  if (!name) return false;
  const exact = models?.find((m) => m.id === name);
  if (exact) return exact.context_window === null;
  // Hugging Face 的 org/model:后端 后缀：基础模型在列表里有窗口就够了
  const base = name.split(":")[0];
  const viaBase = models?.find((m) => m.id === base);
  return viaBase ? viaBase.context_window === null : true;
}

/** 窗口校验结果的说明 */
export function describeWindow(window: RouteWindow): string[] {
  const lines = [
    `模型上下文 ${formatTokens(window.model_window)}（${WINDOW_SOURCE[window.source]}），工作窗口上限 ${formatTokens(window.working_cap)}`,
    `每轮最多输出 ${formatTokens(window.max_tokens)}，留给故事的上下文 ${formatTokens(window.effective_window)}`,
  ];
  if (window.warnings.includes("WINDOW_CLAMPED")) {
    lines.push("工作窗口超过了模型的上下文长度，按模型的上限计算");
  }
  return lines;
}

/** 探测各项检查的中文名 */
export const CHECK_NAMES: Record<string, string> = {
  stream: "流式输出",
  stream_usage: "流式用量统计",
  json_object: "结构化输出（JSON）",
  json_schema: "结构化输出（JSON Schema）",
  tool_call: "工具调用",
  reasoning_toggle: "关闭思考",
};

/** 一次探测里通过、失败、跳过各几项 */
export function checkCounts(checks: ProbeCheck[]): { passed: number; failed: number; skipped: number } {
  return {
    passed: checks.filter((c) => c.ok === true).length,
    failed: checks.filter((c) => c.ok === false).length,
    skipped: checks.filter((c) => c.ok === null).length,
  };
}
