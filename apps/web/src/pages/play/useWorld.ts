/**
 * 世界状态（GET /v1/playthroughs/{id}/world）：阅读页右栏的人物和“刚记下的”、W 打开的世界面板共用一份缓存。
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { i18n } from "@bettertavern/core/i18n/index";
import { worldRefreshDelay } from "@bettertavern/core/play/worldStatus";

import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";

/**
 * 取世界状态、揭示秘密。version 变了（写完新的一段、回退）就重新取；
 * 后台还没整理到最新一段（headSeq）时每隔一会儿再取，整理到了就停（worldRefreshDelay）。
 */
export type Head = { version: string | null; headSeq: number | null };

export function useWorld(playthroughId: string, { version, headSeq }: Head) {
  const { api } = useApp();
  const overlay = useOverlay();
  const [revealed, setRevealed] = useState(false);
  const query = useQuery({
    queryKey: ["world", playthroughId, revealed, version],
    queryFn: () => api.playthroughs.world(playthroughId, revealed),
    placeholderData: (previous) => previous,
    refetchInterval: (q) => worldRefreshDelay(q.state.data, headSeq) ?? false,
  });
  const reveal = async (): Promise<void> => {
    const count = query.data?.hidden_facts ?? 0;
    const ok = await overlay.confirm({
      title: count > 1 ? i18n.t("world.revealMany", { count }) : i18n.t("world.revealOne"),
      message: i18n.t("world.revealMessage"),
      confirmLabel: i18n.t("world.reveal"),
      tone: "warn",
      icon: "lock",
    });
    if (ok) setRevealed(true);
  };
  return { query, reveal };
}

