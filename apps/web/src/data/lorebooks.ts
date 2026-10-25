/**
 * 世界书仓库的查询和操作（docs/lorebook.md 第 9.1 节）：列表、导入（导入过同一个文件时问打开已有的还是
 * 另外导入一份）、新建、改名、删除（挂着它的剧本会把它摘掉）、右键菜单。
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { LorebookSummary } from "@bettertavern/core/api/types";
import { checkLorebookFile, LOREBOOK_LIMITS } from "@bettertavern/core/scenario/lorebook";

import type { MenuPlace } from "../overlay/Menu.tsx";
import { useOverlay } from "../overlay/OverlayProvider.tsx";
import { useApp } from "../state/AppProvider.tsx";
import { scenariosKey } from "./scenarios.ts";

export const lorebooksKey = ["lorebooks"] as const;

export function lorebookKey(id: string) {
  return ["lorebook", id] as const;
}

export function lorebookPath(id: string): string {
  return `/lorebook/${encodeURIComponent(id)}`;
}

export function useLorebooks() {
  const { api, status } = useApp();
  return useQuery({
    queryKey: lorebooksKey,
    queryFn: () => api.lorebooks.list(),
    enabled: status === "signedIn",
  });
}

export type LorebookProblem = { title: string; message: string; toWorkbench?: boolean };

/** 导入世界书：一次一个文件。成功时把新的那本交给 onImported（列表页打开它，剧本表单把它挂上） */
export function useLorebookImport(onImported: (book: LorebookSummary) => void) {
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<LorebookProblem | null>(null);
  const busy = useRef(false);

  const importFile = useCallback(
    async (file: File): Promise<void> => {
      if (busy.current) return;
      setProblem(null);
      const reason = checkLorebookFile(file);
      if (reason) {
        setProblem(reason);
        return;
      }
      busy.current = true;
      setProgress(file.name);
      try {
        let result = await api.lorebooks.importFile(file, { allowDuplicate: false, filename: file.name });
        if (!result.lorebook && result.existing) {
          const existing = result.existing;
          setProgress(null);
          const again = await overlay.confirm({
            title: t("lorebook.duplicateTitle"),
            message: t("lorebook.duplicateMessage", { name: existing.name }),
            confirmLabel: t("lorebook.importAnother"),
            cancelLabel: t("lorebook.openExisting"),
            icon: "info",
          });
          if (!again) {
            navigate(lorebookPath(existing.id));
            return;
          }
          setProgress(file.name);
          result = await api.lorebooks.importFile(file, { allowDuplicate: true, filename: file.name });
        }
        if (result.lorebook) {
          const detail = result.lorebook;
          queries.setQueryData(lorebookKey(detail.lorebook.id), detail);
          void queries.invalidateQueries({ queryKey: lorebooksKey });
          overlay.toast(t("lorebook.imported", { name: detail.lorebook.name }));
          onImported(detail.lorebook);
        }
      } catch (e) {
        setProblem({
          title: t("workbench.import.failed", { name: file.name }),
          message: describeError(e),
          toWorkbench: e instanceof ApiError && e.code === "LOREBOOK_IS_CARD",
        });
      } finally {
        setProgress(null);
        busy.current = false;
      }
    },
    [api, navigate, onImported, overlay, queries, t],
  );

  return { importFile, progress, problem, dismiss: () => setProblem(null) };
}

export function useLorebookActions() {
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();

  const create = async (): Promise<void> => {
    const name = await overlay.prompt({
      title: t("lorebook.createTitle"),
      label: t("lorebook.nameLabel"),
      placeholder: t("lorebook.namePlaceholder"),
      maxLength: LOREBOOK_LIMITS.name,
      confirmLabel: t("lorebook.create"),
    });
    if (!name?.trim()) return;
    try {
      const detail = await api.lorebooks.create(name.trim());
      queries.setQueryData(lorebookKey(detail.lorebook.id), detail);
      void queries.invalidateQueries({ queryKey: lorebooksKey });
      navigate(lorebookPath(detail.lorebook.id));
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    }
  };

  const rename = async (book: Pick<LorebookSummary, "id" | "name" | "version">): Promise<void> => {
    const name = await overlay.prompt({
      title: t("lorebook.renameTitle"),
      label: t("lorebook.nameLabel"),
      initial: book.name,
      maxLength: LOREBOOK_LIMITS.name,
    });
    if (!name?.trim() || name.trim() === book.name) return;
    try {
      const detail = await api.lorebooks.update(book.id, { name: name.trim() });
      queries.setQueryData(lorebookKey(book.id), detail);
      void queries.invalidateQueries({ queryKey: lorebooksKey });
      void queries.invalidateQueries({ queryKey: scenariosKey });
    } catch (e) {
      overlay.toast(t("common.saveFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const remove = async (book: Pick<LorebookSummary, "id" | "name" | "scenario_count">): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("lorebook.deleteConfirm", { name: book.name }),
      message: book.scenario_count
        ? t("lorebook.deleteUsed", { count: book.scenario_count })
        : t("lorebook.deleteUnused"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.lorebooks.remove(book.id);
      queries.setQueryData<LorebookSummary[]>(lorebooksKey, (list) => list?.filter((b) => b.id !== book.id));
      queries.removeQueries({ queryKey: lorebookKey(book.id) });
      void queries.invalidateQueries({ queryKey: scenariosKey });
      if (pathname === lorebookPath(book.id)) navigate("/lorebooks", { replace: true });
      overlay.toast(t("lorebook.deleted", { name: book.name }));
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
    }
  };

  const menu = async (book: LorebookSummary, place: MenuPlace): Promise<void> => {
    const key = await overlay.menu({
      label: book.name,
      place,
      items: [
        { key: "newTab", label: t("common.openInNewTab"), icon: "newTab" },
        { key: "rename", label: t("lorebook.rename"), icon: "write" },
        { key: "delete", label: t("common.delete"), icon: "trash", danger: true, separated: true },
      ],
    });
    if (key === "newTab") window.open(lorebookPath(book.id), "_blank", "noopener");
    if (key === "rename") void rename(book);
    if (key === "delete") void remove(book);
  };

  return { create, rename, remove, menu };
}
