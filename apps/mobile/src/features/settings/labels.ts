/** 设置页共用的文字 */

import type { Credential, Provider, RouteWindow } from "../../api/types.ts";
import { formatTokens } from "../../utils/format.ts";

export const CREDENTIAL_STATUS: Record<Credential["status"], string> = {
  ok: "可用",
  unverified: "还没测试",
  invalid: "Key 无效",
};

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
