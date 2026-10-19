/**
 * 存档列表的查询：存档页、侧栏“最近的存档”、导航条的封面共用一份缓存。
 * 有故事正在写时每 5 秒重新取一次（标签页在后台时不取），写好后卡片和侧栏自己变过来。
 */

import { useQuery } from "@tanstack/react-query";

import { listRefreshInterval } from "@bettertavern/core/play/storyStatus";

import { useApp } from "../state/AppProvider.tsx";

export const storiesKey = ["playthroughs"] as const;

export function useStories() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: storiesKey,
    queryFn: () => api.playthroughs.list(),
    enabled: status === "signedIn",
    refetchInterval: (query) => listRefreshInterval(query.state.data),
  });
}
