/** 剧本、角色卡、草稿的列表查询：剧本仓库、角色卡仓库、工作台、故事封面（故事的封面跟着剧本的主角色卡）共用缓存 */

import { useQuery } from "@tanstack/react-query";

import { useApp } from "../state/AppProvider.tsx";

export const scenariosKey = ["scenarios"] as const;
export const cardsKey = ["cards"] as const;
export const draftsKey = ["drafts"] as const;

export function useScenarios() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: scenariosKey,
    queryFn: () => api.scenarios.list(),
    enabled: status === "signedIn",
  });
}

export function useCards() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: cardsKey,
    queryFn: () => api.cards.list(),
    enabled: status === "signedIn",
  });
}

export function useDrafts() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: draftsKey,
    queryFn: () => api.workbench.list(),
    enabled: status === "signedIn",
  });
}

/** 剧本 ID → 封面图片；故事卡片、侧栏的封面用。剧本没加载出来时都是几何封面 */
export function useAvatars(): (scenarioId: string | null) => string | null {
  const scenarios = useScenarios();
  const map = new Map((scenarios.data ?? []).map((s) => [s.id, s.cover_blob_id]));
  return (scenarioId) => (scenarioId ? (map.get(scenarioId) ?? null) : null);
}
