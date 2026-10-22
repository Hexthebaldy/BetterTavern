/**
 * 角色卡图片要带访问令牌才能取：用 fetch 带上令牌，转成 blob: 地址给 <img> 用，按图片 ID 缓存（同一张图只下载一次）。
 */

import { useQuery } from "@tanstack/react-query";

import { useApp } from "../state/AppProvider.tsx";

export function useBlobUrl(blobId: string | null | undefined) {
  const { api, authHeaders } = useApp();
  return useQuery({
    queryKey: ["blob", blobId],
    enabled: !!blobId,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const response = await fetch(api.blobPath(blobId ?? ""), { headers: await authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return URL.createObjectURL(await response.blob());
    },
  });
}
