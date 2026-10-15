/**
 * 菜单（右键菜单、卡片上“…”打开的菜单）：宽 240，圆角 24，菜单项高 44。
 * 左上角在鼠标处，放不下时往左、往上翻（theme/layout.ts 的 contextMenuFrame）；贴着按钮时出现在按钮下方。
 * 键盘：打开后焦点在第一项，↑↓ 移动，Home / End，Enter 选中，Esc 或 Tab 关闭；点外面关闭。
 */

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import type { IconName } from "@bettertavern/design/icons";

import { cx } from "../components/controls.tsx";
import { Icon } from "../components/Icon.tsx";
import { contextMenuFrame, shell } from "../theme/layout.ts";
import styles from "./overlay.module.css";

export type MenuItem = {
  key: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  /** 这一项上面画一条分隔线 */
  separated?: boolean;
  /** 右边的键帽（“更多”菜单里的 W、?） */
  kbd?: string;
};

/** 在鼠标处（from 是右键点到的卡片，关闭后焦点回到它上面），或者贴着一个元素（按钮）的下边 */
export type MenuPlace = { point: { x: number; y: number }; from?: HTMLElement } | { anchor: HTMLElement };

function startPoint(place: MenuPlace): { x: number; y: number } {
  if ("point" in place) return place.point;
  const rect = place.anchor.getBoundingClientRect();
  return { x: rect.right - shell.contextMenu, y: rect.bottom + 6 };
}

export function Menu({
  label,
  items,
  place,
  onSettle,
}: {
  label: string;
  items: MenuItem[];
  place: MenuPlace;
  onSettle: (key: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ left: number; top: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    opener.current = "anchor" in place ? place.anchor : (place.from ?? focused);
    const height = box.current?.offsetHeight ?? items.length * 44 + 12;
    setFrame(
      contextMenuFrame(startPoint(place), { width: window.innerWidth, height: window.innerHeight }, height),
    );
    // 只在打开时量一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!frame) return;
    box.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [frame]);

  const finish = (key: string | null): void => {
    onSettle(key);
    opener.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(box.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(buttons.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      finish(null);
    }
  };

  return createPortal(
    <div
      className={styles.menuLayer}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) finish(null);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (event.target === event.currentTarget) finish(null);
      }}
    >
      <div
        ref={box}
        role="menu"
        aria-label={label}
        className={cx(styles.menu, "surface-sheet")}
        style={frame ? { left: frame.left, top: frame.top } : { visibility: "hidden", left: 0, top: 0 }}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <div key={item.key}>
            {item.separated ? <div className={styles.menuRule} role="separator" /> : null}
            <button
              type="button"
              role="menuitem"
              className={cx(styles.menuItem, item.danger && styles.menuDanger)}
              onClick={() => finish(item.key)}
            >
              <Icon name={item.icon} size={20} />
              <span className={styles.menuLabel}>{item.label}</span>
              {item.kbd ? <kbd className={styles.kbd}>{item.kbd}</kbd> : null}
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
