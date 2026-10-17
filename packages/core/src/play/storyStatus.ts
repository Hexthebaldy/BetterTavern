/**
 * 故事列表里一个故事的状态（故事卡、侧栏的故事行、导航条的封面共用）：
 * 正在生成时是“正在写开场 / 正在写下一段”（蓝字带圆点）；开场没写成又没有在写时是“开场还没有写好”（琥珀色）；
 * 写完结局的是“已完结”（灰字）；其余时候没有状态，界面显示更新时间。
 */

import type { Playthrough } from "../api/types.ts";

export type StoryStatus =
  | { kind: "writing"; label: string }
  | { kind: "noOpening"; label: string }
  | { kind: "ended"; label: string }
  | null;

export function storyStatus(
  story: Pick<Playthrough, "status" | "active_turn_id" | "head_turn_id" | "head_excerpt">,
): StoryStatus {
  if (story.status === "ended") return { kind: "ended", label: "已完结" };
  const opening = story.head_turn_id === null;
  if (story.active_turn_id !== null)
    return { kind: "writing", label: opening ? "正在写开场" : "正在写下一段" };
  if (opening && !story.head_excerpt) return { kind: "noOpening", label: "开场还没有写好" };
  return null;
}
