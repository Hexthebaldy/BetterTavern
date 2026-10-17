/** 存档列表的查询：存档页、侧栏“最近的存档”、导航条的封面共用一份缓存 */

import { useQuery } from "@tanstack/react-query";

import { useApp } from "../state/AppProvider.tsx";

export const storiesKey = ["playthroughs"] as const;

export function useStories() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: storiesKey,
    queryFn: () => api.playthroughs.list(),
    enabled: status === "signedIn",
  });
}
