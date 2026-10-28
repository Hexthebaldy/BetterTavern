/**
 * 人设库（docs/personas.md）：设置里的人设页、开新故事和剧本设置里选人设、阅读页页头找头像都读它。
 * App 还没有查询缓存（见 hooks/useAsync.ts）：每个页面打开、回到页面时取一次。
 */

import { useAsync } from "../../hooks/useAsync.ts";
import { useApp } from "../../state/AppProvider.tsx";

export function usePersonas() {
  const { api } = useApp();
  return useAsync(() => api.personas.list(), [api]);
}
