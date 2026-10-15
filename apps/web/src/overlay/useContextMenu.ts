/**
 * 卡片和列表行上的右键菜单：右键在鼠标处打开；键盘焦点在卡片上时按 Shift + F10 或菜单键打开。
 * 正文和输入框不用它，保留浏览器自己的右键菜单。
 */

import type { KeyboardEvent, MouseEvent } from "react";

import type { MenuPlace } from "./Menu.tsx";

export function useContextMenu(open: (place: MenuPlace) => void) {
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      open({ point: { x: event.clientX, y: event.clientY }, from: event.currentTarget });
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>): void => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        open({ point: { x: rect.left + 16, y: rect.top + 16 }, from: event.currentTarget });
      }
    },
  };
}
