/**
 * 故事列表里一个故事的状态（故事卡、侧栏的故事行、导航条的封面共用）：
 * 正在生成时是“正在写开场 / 正在写下一段”（蓝字带圆点）；开场没写成又没有在写时是“开场还没有写好”（琥珀色）；
 * 写完结局的是“已完结”（灰字）；其余时候没有状态，界面显示更新时间。
 * 列表里有故事正在写时，存档页定时重新取列表（listRefreshInterval），写好后卡片自己变过来。
 */

import type { Playthrough } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";

export type StoryStatus =
  | { kind: "writing"; label: string }
  | { kind: "noOpening"; label: string }
  | { kind: "ended"; label: string }
  | null;

export function storyStatus(
  story: Pick<Playthrough, "status" | "active_turn_id" | "head_turn_id" | "head_excerpt">,
): StoryStatus {
  if (story.status === "ended") return { kind: "ended", label: i18n.t("stories.status.ended") };
  const opening = story.head_turn_id === null;
  if (story.active_turn_id !== null)
    return {
      kind: "writing",
      label: i18n.t(opening ? "stories.status.writingOpening" : "stories.status.writingNext"),
    };
  if (opening && !story.head_excerpt) return { kind: "noOpening", label: i18n.t("stories.status.noOpening") };
  return null;
}

/** 有故事正在写时，存档列表多久重新取一次 */
export const WRITING_REFRESH_MS = 5000;

/** 存档列表的定时刷新间隔：有故事正在生成（写开场或下一段）时 5 秒，没有时不刷新（false） */
export function listRefreshInterval(
  stories: readonly Pick<Playthrough, "active_turn_id">[] | undefined,
): number | false {
  return stories?.some((story) => story.active_turn_id !== null) ? WRITING_REFRESH_MS : false;
}
