/**
 * 导入角色卡（工作台首页的“导入角色卡”，以及把文件拖进窗口，任何页面都接收）：一次一张。
 *
 * - 解析成草稿，直接进工作台的手动表单（草稿不在角色卡仓库里，保存才进）；
 * - 这个文件之前导入过（角色卡仓库里已经有）：先问是打开已有的卡接着改，还是另外导入一份；
 * - 不符合的文件（不是 PNG / JSON、超过 16 MB）不上传，工作台首页顶上给出红色提示。拖了几个文件只导第一个。
 */

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import { describeError } from "@bettertavern/core/api/client";
import { i18n } from "@bettertavern/core/i18n/index";

import { draftsKey } from "../data/scenarios.ts";
import { draftPath } from "../data/workbench.ts";
import { useOverlay } from "../overlay/OverlayProvider.tsx";
import { useApp } from "../state/AppProvider.tsx";
import { DropZone } from "./DropZone.tsx";
import { CARD_ACCEPT, checkCardFile, type CardProblem } from "./rules.ts";

export type ImportProgress = { name: string; size: number };

type Importer = {
  /** 正在上传的那一张；没有在导入时是 null */
  progress: ImportProgress | null;
  /** 工作台首页顶上的红色提示 */
  problem: CardProblem | null;
  dismissProblem: () => void;
  /** 打开文件选择框 */
  pick: () => void;
  importFile: (file: File) => Promise<void>;
};

const ImportContext = createContext<Importer | null>(null);

export function useImporter(): Importer {
  const value = useContext(ImportContext);
  if (!value) throw new Error("useImporter must be used inside ImportProvider");
  return value;
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function ImportProvider({ children }: { children: ReactNode }) {
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [problem, setProblem] = useState<CardProblem | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);

  const importFile = useCallback(
    async (file: File): Promise<void> => {
      if (busy.current) return;
      setProblem(null);
      const reason = checkCardFile(file);
      if (reason) {
        setProblem(reason);
        if (window.location.pathname !== "/workbench") navigate("/workbench");
        return;
      }
      busy.current = true;
      setProgress({ name: file.name, size: file.size });
      const language = i18n.language;
      try {
        let result = await api.workbench.importFile(file, { language });
        if (!result.draft && result.existing_card) {
          const card = result.existing_card;
          setProgress(null);
          const again = await overlay.confirm({
            title: i18n.t("workbench.import.duplicateTitle", { name: card.name }),
            message: i18n.t("workbench.import.duplicateMessage"),
            confirmLabel: i18n.t("workbench.import.importAgain"),
            cancelLabel: i18n.t("workbench.import.openExisting"),
            icon: "info",
          });
          if (!again) {
            const opened = await api.workbench.openCard(card.id, language);
            void queries.invalidateQueries({ queryKey: draftsKey });
            navigate(draftPath(opened.draft.id));
            return;
          }
          setProgress({ name: file.name, size: file.size });
          result = await api.workbench.importFile(file, { language, allowDuplicate: true });
        }
        if (result.draft) {
          void queries.invalidateQueries({ queryKey: draftsKey });
          navigate(draftPath(result.draft.draft.id));
        }
      } catch (e) {
        setProblem({ title: i18n.t("workbench.import.failed", { name: file.name }), message: describeError(e) });
        if (window.location.pathname !== "/workbench") navigate("/workbench");
      } finally {
        setProgress(null);
        busy.current = false;
      }
    },
    [api, navigate, overlay, queries],
  );

  // 拖进窗口：只认文件（拖文字、链接不管）；松开时阻止浏览器自己打开文件
  useEffect(() => {
    let depth = 0;
    const onEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      // 草稿页的封面区自己接图片，不当角色卡导入
      if (event.defaultPrevented) {
        depth = 0;
        setDragging(false);
        return;
      }
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const [file] = Array.from(event.dataTransfer?.files ?? []);
      if (file) void importFile(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [importFile]);

  const value = useMemo<Importer>(
    () => ({
      progress,
      problem,
      dismissProblem: () => setProblem(null),
      pick: () => input.current?.click(),
      importFile,
    }),
    [progress, problem, importFile],
  );

  return (
    <ImportContext.Provider value={value}>
      {children}
      <input
        ref={input}
        type="file"
        accept={CARD_ACCEPT}
        hidden
        onChange={(event) => {
          const [file] = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {dragging ? <DropZone /> : null}
    </ImportContext.Provider>
  );
}
