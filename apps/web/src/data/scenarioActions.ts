/**
 * 剧本的菜单和操作：剧本库的网格卡片、列表行用菜单，剧本详情用删除。文案同 App 的 app/(tabs)/library.tsx。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  const patchList = (change: (list: Scenario[]) => Scenario[]): void => {
    queries.setQueryData<Scenario[]>(scenariosKey, (list) => (list ? change(list) : list));
  };

  const rename = async (scenario: Scenario): Promise<void> => {
    const name = await overlay.prompt({
      title: t("library.renameTitle"),
      label: t("library.nameLabel"),
      initial: scenario.name,
      maxLength: 80,
    });
    if (!name || name === scenario.name) return;
    try {
      const updated = await api.scenarios.update(scenario.id, { name });
      patchList((list) => list.map((s) => (s.id === scenario.id ? updated : s)));
      queries.setQueryData(["scenario", scenario.id], updated);
    } catch (e) {
      overlay.toast(t("common.renameFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const remove = async (scenario: Scenario): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("library.deleteConfirm", { name: scenario.name }),
      message: t("library.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.scenarios.remove(scenario.id);
      patchList((list) => list.filter((s) => s.id !== scenario.id));
      queries.removeQueries({ queryKey: ["scenario", scenario.id] });
      if (pathname === scenarioPath(scenario)) navigate("/scenarios", { replace: true });
      overlay.toast(t("common.deleted", { name: scenario.name }));
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const menu = async (scenario: Scenario, place: MenuPlace): Promise<void> => {
    const key = await overlay.menu({
      label: scenario.name,
      place,
      items: [
        { key: "newTab", label: t("common.openInNewTab"), icon: "newTab" },
        { key: "rename", label: t("common.rename"), icon: "write" },
        { key: "delete", label: t("common.delete"), icon: "trash", danger: true, separated: true },
      ],
    });
    if (key === "newTab") window.open(scenarioPath(scenario), "_blank", "noopener");
    if (key === "rename") void rename(scenario);
    if (key === "delete") void remove(scenario);
  };

  return { rename, remove, menu };
}
