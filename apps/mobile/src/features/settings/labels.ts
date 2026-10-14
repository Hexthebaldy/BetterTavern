/** 设置页共用的文字 */

import type { Credential, ProbeCheck, Provider, RouteWindow } from "../../api/types.ts";
import { formatTokens } from "../../utils/format.ts";

export const CREDENTIAL_STATUS: Record<Credential["status"], string> = {
  ok: "可用",
  unverified: "还没测试",
  invalid: "Key 无效",
};

/** 状态图标：可用 = 对勾，还没测试 = 虚线方框，Key 无效 = 叉 */
export function statusKind(status: Credential["status"]): "ok" | "untested" | "invalid" {
  return status === "ok" ? "ok" : status === "invalid" ? "invalid" : "untested";
}

/** 服务商的两字母标记，自定义端点用 { } */
export function providerMark(id: string): string {
  if (id === "deepseek") return "DS";
  if (id === "huggingface") return "HF";
  return "{ }";
}

export function providerName(id: string, providers: Provider[] | undefined): string {
  return providers?.find((p) => p.id === id)?.display_name ?? id;
}

export function credentialTitle(c: Credential, providers: Provider[] | undefined): string {
  return c.label || providerName(c.provider, providers);
}

/** 窗口校验结果的说明 */
export function describeWindow(window: RouteWindow): string[] {
  const lines = [
    `模型上下文 ${formatTokens(window.model_window)}，工作窗口上限 ${formatTokens(window.working_cap)}`,
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
