/** 剧本列表的查询：剧本库、故事封面（故事的封面跟着剧本的图片）共用一份缓存 */

import { useQuery } from "@tanstack/react-query";

import { useApp } from "../state/AppProvider.tsx";

export const scenariosKey = ["scenarios"] as const;

export function useScenarios() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: scenariosKey,
    queryFn: () => api.scenarios.list(),
    enabled: status === "signedIn",
  });
}

/** 剧本 ID → 角色卡图片；故事卡片、侧栏的封面用。剧本没加载出来时都是几何封面 */
export function useAvatars(): (scenarioId: string | null) => string | null {
  const scenarios = useScenarios();
  const map = new Map((scenarios.data ?? []).map((s) => [s.id, s.avatar_blob_id]));
  return (scenarioId) => (scenarioId ? (map.get(scenarioId) ?? null) : null);
}
