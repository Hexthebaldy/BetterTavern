/**
 * 剧本的菜单和操作：剧本库的网格卡片、列表行、剧本详情的“更多”共用。文案同 App 的 app/(tabs)/library.tsx。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import type { Scenario } from "@bettertavern/core/api/types";

import type { MenuPlace } from "../overlay/Menu.tsx";
import { useOverlay } from "../overlay/OverlayProvider.tsx";
import { useApp } from "../state/AppProvider.tsx";
import { scenariosKey } from "./scenarios.ts";

export function scenarioPath(scenario: Pick<Scenario, "id">): string {
  return `/scenario/${encodeURIComponent(scenario.id)}`;
}

export function useScenarioActions() {
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const patchList = (change: (list: Scenario[]) => Scenario[]): void => {
    queries.setQueryData<Scenario[]>(scenariosKey, (list) => (list ? change(list) : list));
  };

  const rename = async (scenario: Scenario): Promise<void> => {
    const name = await overlay.prompt({
      title: "重命名剧本",
      label: "剧本名",
      initial: scenario.name,
      maxLength: 80,
    });
    if (!name || name === scenario.name) return;
    try {
      const updated = await api.scenarios.rename(scenario.id, name);
      patchList((list) => list.map((s) => (s.id === scenario.id ? updated : s)));
      queries.setQueryData(["scenario", scenario.id], updated);
    } catch (e) {
      overlay.toast(`重命名失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const remove = async (scenario: Scenario): Promise<void> => {
    const ok = await overlay.confirm({
      title: `删除剧本“${scenario.name}”？`,
      message: "已经开始的故事不受影响。",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.scenarios.remove(scenario.id);
      patchList((list) => list.filter((s) => s.id !== scenario.id));
      queries.removeQueries({ queryKey: ["scenario", scenario.id] });
      if (pathname === scenarioPath(scenario)) navigate("/library", { replace: true });
      overlay.toast(`已删除“${scenario.name}”`);
    } catch (e) {
      overlay.toast(`删除失败：${describeError(e)}`, { icon: "alert" });
    }
  };

  const menu = async (
    scenario: Scenario,
    place: MenuPlace,
    options: { newTab?: boolean } = {},
  ): Promise<void> => {
    const key = await overlay.menu({
      label: scenario.name,
      place,
      items: [
        ...(options.newTab === false
          ? []
          : [{ key: "newTab", label: "在新标签页打开", icon: "newTab" as const }]),
        { key: "rename", label: "重命名", icon: "write" },
        { key: "delete", label: "删除", icon: "trash", danger: true, separated: true },
      ],
    });
    if (key === "newTab") window.open(scenarioPath(scenario), "_blank", "noopener");
    if (key === "rename") void rename(scenario);
    if (key === "delete") void remove(scenario);
  };

  return { rename, remove, menu };
}
