/**
 * 角色卡的菜单和操作：角色卡仓库的网格卡片、列表行用菜单，角色卡详情用删除、在工作台里改。
 * 有剧本在用的卡不能删（409 CARD_IN_USE，带在用的剧本），这时说明是哪几个剧本。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { CardSummary } from "@bettertavern/core/api/types";

import type { MenuPlace } from "../overlay/Menu.tsx";
import { useOverlay } from "../overlay/OverlayProvider.tsx";
import { useApp } from "../state/AppProvider.tsx";
import { cardsKey, draftsKey } from "./scenarios.ts";
import { cardPath, draftPath } from "./workbench.ts";

export function newScenarioPath(cardId?: string): string {
  return cardId ? `/scenario/new?card=${encodeURIComponent(cardId)}` : "/scenario/new";
}

export function useCardActions() {
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();

  const remove = async (card: Pick<CardSummary, "id" | "name">): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("cards.deleteConfirm", { name: card.name }),
      message: t("cards.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.cards.remove(card.id);
      queries.setQueryData<CardSummary[]>(cardsKey, (list) => list?.filter((c) => c.id !== card.id));
      queries.removeQueries({ queryKey: ["card", card.id] });
      void queries.invalidateQueries({ queryKey: draftsKey });
      if (pathname === cardPath(card.id)) navigate("/characters", { replace: true });
      overlay.toast(t("common.deleted", { name: card.name }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "CARD_IN_USE") {
        const found = e.field("scenarios");
        const names = Array.isArray(found)
          ? found.map((s: { name?: string }) => `“${s.name ?? ""}”`).join(t("common.listSeparator"))
          : "";
        await overlay.confirm({
          title: t("cards.inUseTitle"),
          message: t("cards.inUseMessage", { names }),
          confirmLabel: t("common.ok"),
          tone: "warn",
        });
        return;
      }
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  /** 在工作台里改：这张卡已经有草稿就打开那一份 */
  const edit = async (card: Pick<CardSummary, "id">): Promise<void> => {
    try {
      const draft = await api.workbench.openCard(card.id, i18n.language);
      void queries.invalidateQueries({ queryKey: draftsKey });
      navigate(draftPath(draft.draft.id));
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    }
  };

  const menu = async (card: CardSummary, place: MenuPlace): Promise<void> => {
    const key = await overlay.menu({
      label: card.name,
      place,
      items: [
        { key: "newTab", label: t("common.openInNewTab"), icon: "newTab" },
        { key: "edit", label: t("cards.openInWorkbench"), icon: "workbench" },
        { key: "scenario", label: t("cards.newScenario"), icon: "plus" },
        { key: "delete", label: t("common.delete"), icon: "trash", danger: true, separated: true },
      ],
    });
    if (key === "newTab") window.open(cardPath(card.id), "_blank", "noopener");
    if (key === "edit") void edit(card);
    if (key === "scenario") navigate(newScenarioPath(card.id));
    if (key === "delete") void remove(card);
  };

  return { remove, edit, menu };
}
