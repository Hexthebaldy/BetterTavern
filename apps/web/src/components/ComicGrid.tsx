/**
 * 漫画格子的排版（theme/grid.ts 决定每一项占哪几格）：6 列 × 3 行，格子之间空 14。
 * 三行分掉页头和页码之外的高度，每行至少 200，窗口太矮时整页滚动。窄于 900 时变成一列，格子按内容高。
 * 底下的 Pager 写“共几个 · 这一页几个”“— 01 —”和翻页；← → 也能翻（usePager）。
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { usePrefs } from "../state/PrefsProvider.tsx";
import { pageLabel, turnPage, type Slot } from "../theme/grid.ts";
import { Keycap } from "./comic.tsx";
import { cx } from "./controls.tsx";
import styles from "./ComicGrid.module.css";

/** 格子放在第几列第几行、占几列几行 */
export function slotStyle(slot: Slot): CSSProperties {
  return { gridColumn: `${slot.col} / span ${slot.w}`, gridRow: `${slot.row} / span ${slot.h}` };
}

export function ComicGrid({
  children,
  paged = true,
  className,
  label,
}: {
  children: ReactNode;
  /** 底下有没有页码（没有时格子往下多占 16） */
  paged?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cx(styles.grid, !paged && styles.unpaged, className)} aria-label={label}>
      {children}
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * 当前第几页；列表变了（搜索、筛选）回到第一页，页数变少时夹回最后一页。
 * ← → 翻页：焦点在输入框里、按着修饰键、开着对话框时不响应（轮盘展开时方向键归轮盘，它会先拦下）。
 */
export function usePager(pages: number, resetKey: string): [number, (page: number) => void] {
  const [state, setState] = useState({ page: 0, key: resetKey });
  const page = state.key === resetKey ? Math.min(state.page, Math.max(0, pages - 1)) : 0;
  const setPage = (next: number): void => setState({ page: next, key: resetKey });
  const { singleKeys } = usePrefs();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isTyping(event.target) || document.querySelector("dialog[open]")) return;
      const next = turnPage(page, pages, event.key);
      if (next === page) return;
      event.preventDefault();
      setState({ page: next, key: resetKey });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, pages, resetKey, singleKeys]);
  return [page, setPage];
}

export function Pager({
  page,
  pages,
  onPage,
  summary,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  /** 左边的说明：“共 12 个存档 · 这一页 6 个” */
  summary: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <nav className={styles.pager} aria-label={t("grid.pages")}>
      <span className={styles.summary}>{summary}</span>
      <span className={styles.number} aria-current="page">
        — {pageLabel(page)} —
      </span>
      <span className={styles.turns}>
        {page > 0 ? (
          <button type="button" className={styles.turn} onClick={() => onPage(page - 1)} aria-keyshortcuts="ArrowLeft">
            <Keycap tone="solid">←</Keycap>
            {t("grid.prev")}
          </button>
        ) : null}
        {page < pages - 1 ? (
          <button type="button" className={styles.turn} onClick={() => onPage(page + 1)} aria-keyshortcuts="ArrowRight">
            {t("grid.next")}
            <Keycap tone="solid">→</Keycap>
          </button>
        ) : null}
      </span>
    </nav>
  );
}
