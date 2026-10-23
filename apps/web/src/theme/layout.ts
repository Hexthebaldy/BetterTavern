/**
 * 电脑 Web 端的布局常量和纯函数。
 *
 * 窗口 ≥ 900 是漫画分镜版（docs/design/comic）：没有顶栏和侧栏，导航收进一只轮盘（theme/wheel.ts、shell/NavWheel.tsx），
 * 页面左右留边跟着轮盘贴的那一边走（wheel.ts 的 pageInsets）。< 900 沿用平板中屏和手机的布局（底部 Tab 栏）。
 * 只依赖窗口宽度，不判断设备。这里只有数据和纯函数，不依赖 React 或 DOM，用 node --test 测。
 * 阅读栏、贴着按钮的菜单直接用平板的 readableColumn、popoverFrame。
 */

import { pane } from "@bettertavern/design/layout";

/** 断点 */
export const desktop = {
  /** ≥ 900：轮盘导航和漫画格子；更窄时是底部 Tab 栏 */
  wheel: 900,
} as const;

/** 栏宽与浮层尺寸 */
export const shell = {
  /** 浮起的面板（世界）离窗口边 */
  edge: 12,
  /** 一级页的内容最宽，超出后居中 */
  contentMax: 1600,
  /** 阅读栏 */
  readable: pane.readable,
  /** 世界面板（滑出） */
  world: pane.world,
  /** 剧本详情左栏 */
  scenarioInfo: pane.scenarioInfo,
  /** 居中对话框；键盘快捷键对话框宽一些 */
  dialog: pane.dialog,
  shortcutsDialog: 600,
  /** 贴着按钮弹出的菜单（阅读页“更多”） */
  popover: pane.popover,
  /** 右键菜单，以及卡片上“…”打开的菜单 */
  contextMenu: pane.cardMenu,
  /** 提示浮条最大宽度 */
  toast: pane.toast,
} as const;

/** 时长（毫秒） */
export const timing = {
  /** 悬停多久出现提示 */
  tooltipDelay: 500,
  /** 提示浮条停留多久；鼠标停在浮条上时不消失 */
  toast: 4000,
} as const;

/** 窗口 ≥ 900 时用轮盘，更窄时是底部 Tab 栏 */
export function usesWheel(width: number): boolean {
  return width >= desktop.wheel;
}

export type WorldMode = "slideOver" | "sheet";

/** 阅读页的世界面板：从右侧滑出；手机宽度（< 600）是底部面板 */
export function worldMode(width: number): WorldMode {
  return width < 600 ? "sheet" : "slideOver";
}

/**
 * 右键菜单的位置：左上角在鼠标处；右边或下边放不下时，翻到鼠标的左边或上边。离窗口边至少 8。
 * menuHeight 先给估计值（每项 44 + 上下内边距 12，分隔线 9），量到后再修正。
 */
export function contextMenuFrame(
  point: { x: number; y: number },
  window: { width: number; height: number },
  menuHeight: number,
  menuWidth: number = shell.contextMenu,
): { left: number; top: number } {
  const margin = 8;
  const left = point.x + menuWidth + margin > window.width ? point.x - menuWidth : point.x;
  const top = point.y + menuHeight + margin > window.height ? point.y - menuHeight : point.y;
  return {
    left: Math.min(Math.max(margin, left), window.width - margin - menuWidth),
    top: Math.min(Math.max(margin, top), window.height - margin - menuHeight),
  };
}

/** 提示（tooltip）的位置：默认在元素上方 8，水平居中；上面放不下就放到下方 8；左右不出窗口 */
export function tooltipFrame(
  anchor: { x: number; y: number; width: number; height: number },
  tip: { width: number; height: number },
  window: { width: number },
): { left: number; top: number; above: boolean } {
  const above = anchor.y - 8 - tip.height >= 8;
  const top = above ? anchor.y - 8 - tip.height : anchor.y + anchor.height + 8;
  const center = anchor.x + anchor.width / 2 - tip.width / 2;
  return { left: Math.min(Math.max(8, center), window.width - 8 - tip.width), top, above };
}

/**
 * 键盘快捷键，W12 对话框和“更多”菜单里的键帽都从这里取。single 表示单键快捷键（可以在对话框里关掉）。
 * 说明文字在 i18n 资源里：shortcuts.items.<id>。
 */
export type ShortcutId =
  | "pick"
  | "write"
  | "send"
  | "newline"
  | "collapse"
  | "latest"
  | "world"
  | "recap"
  | "wheel"
  | "wheelJump"
  | "help"
  | "close";

export type Shortcut = { id: ShortcutId; keys: string[]; scope: "reading" | "app"; single: boolean };

export const SHORTCUTS: Shortcut[] = [
  { id: "pick", keys: ["A", "B", "C", "D"], scope: "reading", single: true },
  { id: "write", keys: ["/"], scope: "reading", single: true },
  { id: "send", keys: ["Enter"], scope: "reading", single: false },
  { id: "newline", keys: ["Shift", "Enter"], scope: "reading", single: false },
  { id: "collapse", keys: ["Esc"], scope: "reading", single: false },
  { id: "latest", keys: ["End"], scope: "reading", single: false },
  { id: "world", keys: ["W"], scope: "reading", single: true },
  { id: "recap", keys: ["L"], scope: "reading", single: true },
  { id: "wheel", keys: ["Q"], scope: "app", single: true },
  { id: "wheelJump", keys: ["1–6"], scope: "app", single: true },
  { id: "help", keys: ["?"], scope: "app", single: true },
  { id: "close", keys: ["Esc"], scope: "app", single: false },
];

/**
 * 单键快捷键要不要响应：开关打开、没有按住修饰键、焦点不在可以输入文字的地方、没有正在组字（输入法）。
 * typing 由调用方根据 document.activeElement 判断（input、textarea、contenteditable 都算）。
 */
export function acceptsSingleKey(event: {
  enabled: boolean;
  typing: boolean;
  composing: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
}): boolean {
  return event.enabled && !event.typing && !event.composing && !event.meta && !event.ctrl && !event.alt;
}

/** 选项的字母键对应第几个选项；不是 A–D 或者超出选项个数时返回 null */
export function optionIndexForKey(key: string, optionCount: number): number | null {
  const index = ["a", "b", "c", "d"].indexOf(key.toLowerCase());
  return index >= 0 && index < optionCount ? index : null;
}

/** 标签页标题：生成中在前面加一个“●”，切到别的标签页也能看见故事还在写 */
export function documentTitle(storyTitle: string | null, generating: boolean): string {
  const base = storyTitle ? `${storyTitle} · BetterTavern` : "BetterTavern";
  return generating ? `● ${base}` : base;
}
