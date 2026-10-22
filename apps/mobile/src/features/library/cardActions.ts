/**
 * 角色卡的操作（同网页端 data/cardActions.ts）：删除（有剧本在用时不能删，说明是哪几个剧本）、在工作台里改
 * （这张卡已经有草稿就打开那一份）、用这张卡新建剧本。
 */

import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { CardSummary } from "@bettertavern/core/api/types";

import { useOverlay } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";

export function useCardActions() {
  const { api } = useApp();
  const overlay = useOverlay();
  const router = useRouter();
  const { t, i18n } = useTranslation();

  /** 删掉了返回 true */
  const remove = async (card: Pick<CardSummary, "id" | "name">): Promise<boolean> => {
    const ok = await overlay.confirm({
      title: t("cards.deleteConfirm", { name: card.name }),
      message: t("cards.deleteMessage"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return false;
    try {
      await api.cards.remove(card.id);
      overlay.toast(t("common.deleted", { name: card.name }));
      return true;
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
        return false;
      }
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
      return false;
    }
  };

  const edit = async (card: Pick<CardSummary, "id">): Promise<void> => {
    try {
      const draft = await api.workbench.openCard(card.id, i18n.language);
      router.push({ pathname: "/workbench/[id]", params: { id: draft.draft.id } });
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    }
  };

  const newScenario = (card: Pick<CardSummary, "id">): void =>
    router.push({ pathname: "/scenario/form", params: { card: card.id } });

  return { remove, edit, newScenario };
}
