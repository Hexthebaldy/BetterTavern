/**
 * 轮盘上每一块下面的数量：存档、剧本、角色、草稿、模型五个列表的长度（设置不写）。
 * 和各页共用同一份缓存（键和取法一样）；轮盘第一次展开时才去取还没取过的，没取到时不显示数字。
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { routesKey } from "../data/models.ts";
import { cardsKey, draftsKey, scenariosKey } from "../data/scenarios.ts";
import { storiesKey } from "../data/stories.ts";
import { useApp } from "../state/AppProvider.tsx";
import type { NavItem } from "./nav.ts";

export type WheelCount = { short: string; long: string } | null;

export function useWheelCounts(active: boolean): Record<NavItem["name"], WheelCount> {
  const { api, status } = useApp();
  const { t } = useTranslation();
  const enabled = active && status === "signedIn";
  const stories = useQuery({ queryKey: storiesKey, queryFn: () => api.playthroughs.list(), enabled });
  const scenarios = useQuery({ queryKey: scenariosKey, queryFn: () => api.scenarios.list(), enabled });
  const cards = useQuery({ queryKey: cardsKey, queryFn: () => api.cards.list(), enabled });
  const drafts = useQuery({ queryKey: draftsKey, queryFn: () => api.workbench.list(), enabled });
  const models = useQuery({ queryKey: routesKey, queryFn: () => api.models.list(), enabled });
  const plain = (list: readonly unknown[] | undefined): WheelCount =>
    list ? { short: String(list.length), long: t("nav.count", { count: list.length }) } : null;
  const counted = (list: readonly unknown[] | undefined, key: "nav.drafts" | "nav.count"): WheelCount =>
    list ? { short: t(key, { count: list.length }), long: t(key, { count: list.length }) } : null;
  return {
    saves: plain(stories.data),
    scenarios: plain(scenarios.data),
    characters: plain(cards.data),
    workbench: counted(drafts.data, "nav.drafts"),
    models: counted(models.data, "nav.count"),
    settings: null,
  };
}
