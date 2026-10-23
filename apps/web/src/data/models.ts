/** 模型相关的查询：设置首页的导演卡片、模型列表、模型详情共用缓存 */

import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { ModelRoute } from "@bettertavern/core/api/types";

import { useApp } from "../state/AppProvider.tsx";

export const routesKey = ["model-routes"] as const;
export const creditsKey = ["credits"] as const;

export function useModelRoutes() {
  const { api, status } = useApp();
  return useQuery({ queryKey: routesKey, queryFn: () => api.models.list(), enabled: status === "signedIn" });
}

export function useProviders() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => api.models.providers(),
    enabled: status === "signedIn",
    staleTime: 10 * 60_000,
  });
}

export function useModelRoute(id: string) {
  const { api } = useApp();
  return useQuery({ queryKey: ["model-route", id], queryFn: () => api.models.get(id) });
}

/** 官方模型的点数余额（服务器没有官方模型时 platform 为 false） */
export function useCredits() {
  const { api, status } = useApp();
  return useQuery({ queryKey: creditsKey, queryFn: () => api.auth.credits(), enabled: status === "signedIn" });
}

/** 改了一个模型：详情和列表都换成新的（设为导演会影响别的模型，列表重新取；导演换了，余额卡片也要重新看） */
export function useRouteUpdater() {
  const queries = useQueryClient();
  return (route: ModelRoute): void => {
    queries.setQueryData(["model-route", route.id], route);
    void queries.invalidateQueries({ queryKey: routesKey });
    void queries.invalidateQueries({ queryKey: creditsKey });
  };
}
