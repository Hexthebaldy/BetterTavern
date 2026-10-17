/**
 * 导入角色卡：剧本库的“导入角色卡”按钮，以及把文件拖进窗口（任何页面都接收）。
 *
 * - 拖进窗口时内容区盖上一层接收区（W04）：“松开就导入”；拖出窗口或松开后消失。
 * - 逐个上传（原样上传，服务端识别 PNG 或 JSON），剧本库的网格里“正在导入”那一格显示当前这一张和“2 / 3”。
 * - 只有一张：成功直接进剧本详情；之前导入过时浮条“‘xxx’之前已经导入过了”，带“打开”。
 * - 多张：全部完成后留在剧本库，浮条“导入了 3 张角色卡”，失败的在页面顶上的红色提示里列出。
 * 不符合的文件（不是 PNG / JSON、超过 16 MB）不上传，给出和 App 一样的红色提示。
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

import { scenariosKey } from "../data/scenarios.ts";
import { useOverlay } from "../overlay/OverlayProvider.tsx";
import { useApp } from "../state/AppProvider.tsx";
import { DropZone } from "./DropZone.tsx";
import {
  CARD_ACCEPT,
  checkCardFile,
  failureNotice,
  importSummary,
  type CardProblem,
  type ImportOutcome,
} from "./rules.ts";

export type ImportProgress = { name: string; size: number; index: number; total: number };

type Importer = {
  /** 正在上传的那一张；没有在导入时是 null */
  progress: ImportProgress | null;
  /** 页面顶上的红色提示 */
  problem: CardProblem | null;
  dismissProblem: () => void;
  /** 打开文件选择框（可以多选） */
  pick: () => void;
  importFiles: (files: File[]) => Promise<void>;
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

  const importFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0 || busy.current) return;
      busy.current = true;
      setProblem(null);
      const outcomes: ImportOutcome[] = [];
      const valid: File[] = [];
      for (const file of files) {
        const reason = checkCardFile(file);
        if (reason) outcomes.push({ kind: "failed", problem: reason });
        else valid.push(file);
      }
      for (const [index, file] of valid.entries()) {
        setProgress({ name: file.name, size: file.size, index: index + 1, total: valid.length });
        try {
          const scenario = await api.scenarios.importFile(file);
          outcomes.push({
            kind: scenario.duplicate ? "duplicate" : "imported",
            id: scenario.id,
            name: scenario.name,
          });
        } catch (e) {
          outcomes.push({
            kind: "failed",
            problem: {
              title: i18n.t("library.importFailed", { name: file.name }),
              message: describeError(e),
            },
          });
        }
      }
      setProgress(null);
      busy.current = false;
      if (valid.length > 0) void queries.invalidateQueries({ queryKey: scenariosKey });
      setProblem(failureNotice(outcomes));

      const [only] = outcomes;
      if (outcomes.length === 1 && only?.kind === "imported") {
        navigate(`/scenario/${encodeURIComponent(only.id)}`);
        return;
      }
      if (window.location.pathname !== "/library") navigate("/library");
      if (outcomes.length === 1 && only?.kind === "duplicate") {
        overlay.toast(i18n.t("library.duplicate", { name: only.name }), {
          icon: "info",
          actionLabel: i18n.t("common.open"),
          onAction: () => navigate(`/scenario/${encodeURIComponent(only.id)}`),
        });
        return;
      }
      const summary = importSummary(outcomes);
      if (summary) overlay.toast(summary);
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
      event.preventDefault();
      depth = 0;
      setDragging(false);
      void importFiles(Array.from(event.dataTransfer?.files ?? []));
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
  }, [importFiles]);

  const value = useMemo<Importer>(
    () => ({
      progress,
      problem,
      dismissProblem: () => setProblem(null),
      pick: () => input.current?.click(),
      importFiles,
    }),
    [progress, problem, importFiles],
  );

  return (
    <ImportContext.Provider value={value}>
      {children}
      <input
        ref={input}
        type="file"
        accept={CARD_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void importFiles(files);
        }}
      />
      {dragging ? <DropZone /> : null}
    </ImportContext.Provider>
  );
}
