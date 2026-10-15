/**
 * 故事的菜单和操作：故事卡、侧栏的故事行、导航条的封面共用。文案同 App 的 app/(tabs)/playthroughs.tsx。
 * 菜单第一项是“在新标签页打开”（补上被替换掉的浏览器右键菜单），然后是重命名，一条分隔线，删除（红色，先确认）。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { Playthrough } from "@bettertavern/core/api/types";

import type { MenuPlace } from "../overlay/Menu.tsx";
import { useOverlay } from "../overlay/OverlayProvider.tsx";
import { openStoryId } from "../shell/nav.ts";
import { useApp } from "../state/AppProvider.tsx";
import { storiesKey } from "./stories.ts";

export function storyPath(story: Pick<Playthrough, "id">): string {
  return `/play/${encodeURIComponent(story.id)}`;
}

export function useStoryActions() {
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const patchList = (change: (list: Playthrough[]) => Playthrough[]): void => {
    queries.setQueryData<Playthrough[]>(storiesKey, (list) => (list ? change(list) : list));
  };

  const rename = async (story: Playthrough): Promise<void> => {
    const title = await overlay.prompt({
      title: "重命名故事",
      label: "故事标题",
      initial: story.title,
      maxLength: 80,
    });
    if (!title || title === story.title) return;
    try {
      const updated = await api.playthroughs.rename(story.id, title);
      patchList((list) => list.map((s) => (s.id === story.id ? { ...s, ...updated } : s)));
      void queries.invalidateQueries({ queryKey: ["playthrough", story.id] });
    } catch (e) {
      overlay.toast(`重命名失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const remove = async (story: Pick<Playthrough, "id" | "title">): Promise<void> => {
    const ok = await overlay.confirm({
      title: `删除“${story.title}”？`,
      message: "删除后故事和世界状态都无法恢复。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.playthroughs.remove(story.id);
      patchList((list) => list.filter((s) => s.id !== story.id));
      queries.removeQueries({ queryKey: ["playthrough", story.id] });
      if (openStoryId(pathname) === story.id) navigate("/playthroughs", { replace: true });
      overlay.toast(`已删除“${story.title}”`);
    } catch (e) {
      overlay.toast(`删除失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const menu = async (story: Playthrough, place: MenuPlace): Promise<void> => {
    const key = await overlay.menu({
      label: story.title,
      place,
      items: [
        { key: "newTab", label: "在新标签页打开", icon: "newTab" },
        { key: "rename", label: "重命名", icon: "write" },
        { key: "delete", label: "删除", icon: "trash", danger: true, separated: true },
      ],
    });
    if (key === "newTab") window.open(storyPath(story), "_blank", "noopener");
    if (key === "rename") void rename(story);
    if (key === "delete") void remove(story);
  };

  return { rename, remove, menu };
}
