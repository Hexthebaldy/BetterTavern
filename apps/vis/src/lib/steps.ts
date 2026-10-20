/**
 * agent 运行里每一步的显示：模型这一步调了哪些工具、把编号换成名字。纯函数。
 *
 * 世界状态 agent 给模型看的是短编号（实体 e1、e2……，事实 f1、f2……），只在一次运行里有效；
 * 这次运行用过的编号对应什么记在 agent_runs.result.refs（只在显示故事内容时返回）。
 */

/** 模型这一步要调的工具名（结果里的 tool_calls）；没有时是空数组 */
export function toolCallNames(result: Record<string, unknown>): string[] {
  const calls = result.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls
    .map((call) => (call && typeof call === "object" ? (call as Record<string, unknown>).name : null))
    .filter((name): name is string => typeof name === "string");
}

/** 模型这一步要调的工具，连同参数（只在显示故事内容时有参数） */
export function toolCalls(result: Record<string, unknown>): { name: string; arguments: string | null }[] {
  const calls = result.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call) => {
    if (!call || typeof call !== "object") return [];
    const { name, arguments: args } = call as Record<string, unknown>;
    if (typeof name !== "string") return [];
    return [{ name, arguments: typeof args === "string" ? args : null }];
  });
}

/** 这次运行的编号对照表；没有时（不显示故事内容、不是世界状态 agent）是 null */
export function refsOf(result: Record<string, unknown> | null): Record<string, string> | null {
  const refs = result?.refs;
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) return null;
  const out: Record<string, string> = {};
  for (const [ref, label] of Object.entries(refs)) {
    if (typeof label === "string") out[ref] = label;
  }
  return out;
}

/** 文字里的 e3、f12 后面括号注上名字：e3（老周） */
export function withRefs(text: string, refs: Record<string, string> | null): string {
  if (!refs) return text;
  return text.replace(/\b([ef]\d+)\b/g, (ref: string) => (refs[ref] ? `${ref}（${refs[ref]}）` : ref));
}
