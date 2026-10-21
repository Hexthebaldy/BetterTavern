/**
 * “长篇”一节的 agent runtime 架构图：八个状态（全景、1～6 步、回退），每个状态点亮哪些部件，照设计稿 Landing.dc.html 的 ARC。
 * 图里的字和每一步的说明在各语言的文案里（ArcText）。纯函数在这里，测试见 steps.test.ts。
 * 架构以 docs/agent-runtime-architecture.md 为准，架构改了这里跟着改。
 */

/** 框：上排是 api 进程里的四步，下排是 worker 里的三个 agent */
export type ArcPart = "act" | "ctx" | "dir" | "out" | "st" | "ch" | "ol";
/** 上排框之间的箭头 */
export type ArcArrow = "a1" | "a2" | "a3";
/** 层与层之间的连线：rd 读上下文、rc 召回、wr 存回合；s1～s3 后台三个 agent 领任务和写回 */
export type ArcLink = "rd" | "rc" | "wr" | "s1" | "s2" | "s3";
/** PostgreSQL 里的各层数据和任务队列 */
export type ArcChip =
  | "turns"
  | "notes"
  | "world"
  | "threads"
  | "sum"
  | "book"
  | "prof"
  | "outline"
  | "undo"
  | "queue";
export type ArcKey = ArcPart | ArcArrow | ArcLink | ArcChip;

export const ARC_CHIPS: readonly ArcChip[] = [
  "turns",
  "notes",
  "world",
  "threads",
  "sum",
  "book",
  "prof",
  "outline",
  "undo",
  "queue",
];

export type ArcStep = {
  /** 标签和说明条上的号：全景是空的（说明条上写文案里的 all），回退是 ↺ */
  no: string;
  on: readonly ArcKey[];
};

export const ARC_STEPS: readonly ArcStep[] = [
  { no: "", on: [] },
  { no: "1", on: ["act"] },
  { no: "2", on: ["ctx", "a1", "rd", "turns", "sum", "book", "prof", "world", "threads", "outline"] },
  { no: "3", on: ["dir", "a2", "rc", "notes", "turns"] },
  { no: "4", on: ["out", "a3", "wr", "turns", "queue"] },
  { no: "5", on: ["st", "s1", "queue", "turns", "world", "threads", "notes", "undo"] },
  { no: "6", on: ["ch", "ol", "s2", "s3", "queue", "turns", "sum", "book", "prof", "outline"] },
  { no: "↺", on: ["act", "undo", "world", "threads", "notes", "sum", "book", "outline", "turns"] },
];

/** 点图里的框跳到哪一步；章节整理和大纲修订是同一步 */
export const ARC_GO: Record<ArcPart, number> = { act: 1, ctx: 2, dir: 3, out: 4, st: 5, ch: 6, ol: 6 };

export function clampStep(step: number): number {
  return Math.max(0, Math.min(ARC_STEPS.length - 1, Math.trunc(step) || 0));
}

/** 部件在这一步的样子：全景时都不变；其余用到的变蓝（on），没用到的变淡（dim） */
export function arcClass(step: number, key: ArcKey): "" | "on" | "dim" {
  const s = clampStep(step);
  if (s === 0) return "";
  return ARC_STEPS[s]!.on.includes(key) ? "on" : "dim";
}

/** 说明条上的按钮：全景时“走一遍”，中间“下一步”，最后一步“回到全景”；按了以后循环 */
export function nextStep(step: number): number {
  return (clampStep(step) + 1) % ARC_STEPS.length;
}

export function nextLabel(step: number): "start" | "next" | "back" {
  const s = clampStep(step);
  if (s === 0) return "start";
  return s === ARC_STEPS.length - 1 ? "back" : "next";
}
