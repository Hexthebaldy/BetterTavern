/**
 * 导演模型页“能记住多少”的格子图：模型上下文按格子画出，工作窗口里每轮输出占的部分标蓝，
 * 其余是留给前情和世界状态的故事部分；用到 80% 时开始压缩早期剧情，那一格描琥珀色框。
 *
 * 每格默认 4K；上下文很长时每格翻倍，最多 64 格。
 */

export type WindowChoice = "32000" | "64000" | "default" | "256000";

/** 服务端默认的工作窗口上限（params.working_window 不设置时） */
export const DEFAULT_WORKING_WINDOW = 128000;

export const WINDOW_CHOICES: { value: WindowChoice; label: string; tokens: number }[] = [
  { value: "32000", label: "32K", tokens: 32000 },
  { value: "64000", label: "64K", tokens: 64000 },
  { value: "default", label: "128K", tokens: DEFAULT_WORKING_WINDOW },
  { value: "256000", label: "256K", tokens: 256000 },
];

export function windowChoice(workingWindow: number | undefined): WindowChoice {
  if (workingWindow === 32000 || workingWindow === 64000 || workingWindow === 256000) {
    return String(workingWindow) as WindowChoice;
  }
  return "default";
}

export function choiceTokens(choice: WindowChoice): number {
  return WINDOW_CHOICES.find((c) => c.value === choice)?.tokens ?? DEFAULT_WORKING_WINDOW;
}

export type Block = "story" | "output" | "free";

export type WindowBlocks = {
  /** 每格多少 token */
  unit: number;
  blocks: Block[];
  /** 开始压缩的那一格；没有时为 -1 */
  mark: number;
  /** 实际用到的窗口：min(工作窗口, 模型上下文) */
  used: number;
  story: number;
  free: number;
  /** 工作窗口超过了模型的上下文，按模型的上限算 */
  clamped: boolean;
};

export function windowBlocks(modelWindow: number, workingCap: number, maxTokens: number): WindowBlocks {
  let unit = 4096;
  while (modelWindow / unit > 64) unit *= 2;
  const used = Math.min(workingCap, modelWindow);
  const total = Math.max(1, Math.round(modelWindow / unit));
  const usedBlocks = Math.min(total, Math.round(used / unit));
  const outBlocks = Math.min(usedBlocks, Math.max(1, Math.round(maxTokens / unit)));
  const blocks: Block[] = [];
  for (let k = 0; k < total; k += 1) {
    blocks.push(k < usedBlocks - outBlocks ? "story" : k < usedBlocks ? "output" : "free");
  }
  return {
    unit,
    blocks,
    mark: Math.floor((used * 0.8) / unit) - 1,
    used,
    story: Math.max(0, used - maxTokens),
    free: Math.max(0, modelWindow - used),
    clamped: workingCap > modelWindow,
  };
}
