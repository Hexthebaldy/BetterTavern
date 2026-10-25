/**
 * 世界书的操作（同网页端 data/lorebooks.ts，docs/lorebook.md 第 9.2 节）：导入（系统的文件选择，只收 .json、
 * 最大 8 MB；导入过同一个文件时问“打开已有的”还是“另外导入一份”）、新建（输入书名）、改名、删除
 * （挂着它的剧本会把它摘掉）、长按菜单的几项。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { LorebookDetail, LorebookSummary } from "@bettertavern/core/api/types";
import { checkLorebookFile, LOREBOOK_LIMITS } from "@bettertavern/core/scenario/lorebook";

import { useOverlay, type IconName } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";

export type LorebookProblem = { title: string; message: string; toWorkbench?: boolean };

export function useOpenLorebook() {
  const router = useRouter();
  return useCallback((id: string) => router.push({ pathname: "/lorebook/[id]", params: { id } }), [router]);
}

/**
 * 导入世界书：成功时把新的那本交给 onImported（库页打开它，剧本表单把它挂上）。
 * 导入过同一个文件时默认可以去打开已有的那本；剧本表单传 attachExisting，改成把已有的挂上。
 */
export function useLorebookImport(
  onImported: (book: LorebookSummary) => void,
  attachExisting?: (book: LorebookSummary) => void,
) {
  const { api } = useApp();
  const overlay = useOverlay();
  const open = useOpenLorebook();
  const { t } = useTranslation();
  const [importing, setImporting] = useState<string | null>(null);
  const [problem, setProblem] = useState<LorebookProblem | null>(null);

  const pick = async (): Promise<void> => {
    setProblem(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    const file = picked.canceled ? undefined : picked.assets[0];
    if (!file) return;
    const reason = checkLorebookFile({ name: file.name, size: file.size ?? 0 });
    if (reason) {
      setProblem(reason);
      return;
    }
    setImporting(file.name);
    try {
      // 书名取文件里的名字，没有就用文件名（expo 的 File 带着文件名）
      const upload = (allowDuplicate: boolean) =>
        api.lorebooks.importFile(new File(file.uri), { allowDuplicate, filename: file.name });
      let result = await upload(false);
      if (!result.lorebook && result.existing) {
        const existing = result.existing;
        setImporting(null);
        const again = await overlay.confirm({
          title: t("lorebook.duplicateTitle"),
          message: t("lorebook.duplicateMessage", { name: existing.name }),
          confirmLabel: t("lorebook.importAnother"),
          cancelLabel: attachExisting ? t("lorebook.attachExisting") : t("lorebook.openExisting"),
        });
        if (!again) {
          if (attachExisting) attachExisting(existing);
          else open(existing.id);
          return;
        }
        setImporting(file.name);
        result = await upload(true);
      }
      if (result.lorebook) {
        overlay.toast(t("lorebook.imported", { name: result.lorebook.lorebook.name }));
        onImported(result.lorebook.lorebook);
      }
    } catch (e) {
      setProblem({
        title: t("workbench.import.failed", { name: file.name }),
        message: describeError(e),
        toWorkbench: e instanceof ApiError && e.code === "LOREBOOK_IS_CARD",
      });
    } finally {
      setImporting(null);
    }
  };

  return { importing, problem, pick, dismiss: () => setProblem(null) };
}

export function useLorebookActions() {
  const { api } = useApp();
  const overlay = useOverlay();
  const open = useOpenLorebook();
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
      open(detail.lorebook.id);
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    }
  };

  /** 改了返回新的详情 */
  const rename = async (book: Pick<LorebookSummary, "id" | "name">): Promise<LorebookDetail | null> => {
    const name = await overlay.prompt({
      title: t("lorebook.renameTitle"),
      label: t("lorebook.nameLabel"),
      initial: book.name,
      maxLength: LOREBOOK_LIMITS.name,
    });
    if (!name?.trim() || name.trim() === book.name) return null;
    try {
      return await api.lorebooks.update(book.id, { name: name.trim() });
    } catch (e) {
      overlay.toast(t("common.renameFailed", { error: describeError(e) }), { icon: "alert" });
      return null;
    }
  };

  /** 删掉了返回 true */
  const remove = async (book: Pick<LorebookSummary, "id" | "name" | "scenario_count">): Promise<boolean> => {
    const ok = await overlay.confirm({
      title: t("lorebook.deleteConfirm", { name: book.name }),
      message: book.scenario_count
        ? t("lorebook.deleteUsed", { count: book.scenario_count })
        : t("lorebook.deleteUnused"),
      confirmLabel: t("common.delete"),
      tone: "danger",
    });
    if (!ok) return false;
    try {
      await api.lorebooks.remove(book.id);
      overlay.toast(t("lorebook.deleted", { name: book.name }));
      return true;
    } catch (e) {
      overlay.toast(t("common.deleteFailed", { error: describeError(e) }), { icon: "alert" });
      return false;
    }
  };

  const menuItems = (): { key: string; label: string; icon: IconName; danger?: boolean }[] => [
    { key: "rename", label: t("lorebook.rename"), icon: "write" },
    { key: "delete", label: t("common.delete"), icon: "trash", danger: true },
  ];

  return { create, rename, remove, menuItems };
}
