/** 外部服务（搜索、读网页、文生图）的查询：设置里的“外部服务”和工作台的封面面板共用缓存 */

import { useQuery } from "@tanstack/react-query";

import { useApp } from "../state/AppProvider.tsx";

export const toolRoutesKey = ["tool-routes"] as const;

export function useToolRoutes() {
  const { api, status } = useApp();
  return useQuery({ queryKey: toolRoutesKey, queryFn: () => api.tools.list(), enabled: status === "signedIn" });
}

export function useToolProviders() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: ["tool-providers"],
    queryFn: () => api.tools.providers(),
    enabled: status === "signedIn",
    staleTime: 10 * 60_000,
  });
}
