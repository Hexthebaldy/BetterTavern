/**
 * 导入一张角色卡（同网页端 import/ImportProvider.tsx）：选一个 PNG 或 JSON（最大 16 MB），原样上传，服务端解析完
 * 建一份草稿，进手动表单。之前导入过同一张：问“打开已有的”还是“另外导入一份”。
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";

import { useOverlay } from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";

const MAX_BYTES = 16 * 1024 * 1024;

export type ImportProblem = { title: string; message: string };

export function useCardImport() {
  const { api } = useApp();
  const router = useRouter();
  const overlay = useOverlay();
  const { t, i18n } = useTranslation();
  const [importing, setImporting] = useState<string | null>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);

  const openDraft = (id: string): void => router.push({ pathname: "/workbench/[id]", params: { id } });

  const pick = async (): Promise<void> => {
    setProblem(null);
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    const file = picked.canceled ? undefined : picked.assets[0];
    if (!file) return;
    if (!/\.(png|json)$/i.test(file.name)) {
      setProblem({
        title: t("workbench.import.notCard", { name: file.name }),
        message: t("workbench.import.notCardMessage"),
      });
      return;
    }
    if (file.size !== undefined && file.size > MAX_BYTES) {
      setProblem({
        title: t("workbench.import.tooLarge", { name: file.name }),
        message: t("workbench.import.tooLargeMessage"),
      });
      return;
    }
    setImporting(file.name);
    try {
      const upload = (allowDuplicate: boolean) =>
        api.workbench.importFile(new File(file.uri), { language: i18n.language, allowDuplicate });
      let result = await upload(false);
      if (!result.draft && result.existing_card) {
        const existing = result.existing_card;
        const again = await overlay.confirm({
          title: t("workbench.import.duplicateTitle", { name: existing.name }),
          message: t("workbench.import.duplicateMessage"),
          confirmLabel: t("workbench.import.importAgain"),
          cancelLabel: t("workbench.import.openExisting"),
        });
        if (!again) {
          const draft = await api.workbench.openCard(existing.id, i18n.language);
          openDraft(draft.draft.id);
          return;
        }
        result = await upload(true);
      }
      if (result.draft) openDraft(result.draft.draft.id);
    } catch (e) {
      setProblem({ title: t("workbench.import.failed", { name: file.name }), message: describeError(e) });
    } finally {
      setImporting(null);
    }
  };

  return { importing, problem, pick, dismiss: () => setProblem(null) };
}
