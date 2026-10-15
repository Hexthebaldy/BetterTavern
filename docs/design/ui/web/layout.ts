/**
 * 电脑 Web 端的布局常量和纯函数，取自 docs/design/ui/web/（source/WebSystem.dc.html）。
 *
 * 这是平板响应式（src/theme/layout.ts，原稿在 docs/design/ui/tablet/layout.ts）上面多出来的一档：
 * - 窗口 ≥ 1280 时，左边是常驻的侧栏（268）；用户收起后是导航条（76）；
 * - 900–1279 是导航条，和平板宽屏那条相同；
 * - < 900 沿用平板中屏和手机的布局，这里返回 "tabbar"。
 *
 * 只依赖窗口宽度和“用户有没有收起侧栏”，不判断设备。这里只有数据和纯函数，不依赖 React、DOM 或 React Native，
 * 可以和 layout.ts 一样用 node --test 测。
 *
 * 放进网页端的 theme/。readableColumn、actionPanelFrame、popoverFrame、libraryColumns 直接从
 * apps/mobile/src/theme/layout.ts 引入；下面的 640、672 和那边的 pane 相同，放进去以后改成从那边导入。
 */

/** 断点 */
export const desktop = {
  /** ≥ 900：左边是导航条（平板宽屏的 expanded） */
  rail: 900,
  /** ≥ 1280：侧栏展开（用户没有收起时） */
  sidebar: 1280,
  /** 阅读页：窗口减去左边导航 ≥ 1100 时，世界停靠在右边（和平板的停靠门槛同一个数） */
  worldDock: 1100,
} as const;

/** 栏宽与浮层尺寸 */
export const shell = {
  /** 浮起的面板（侧栏、导航条、世界、设置右栏）离窗口边 */
  edge: 12,
  /** 侧栏 */
  sidebar: 268,
  /** 导航条（和平板相同） */
  rail: 76,
  /** 一级页的内容离侧栏、离窗口右边 */
  gutter: 40,
  /** 故事、剧本列表的内容最宽，超出后居中 */
  contentMax: 1200,
  /** 阅读栏（= pane.readable） */
  readable: 640,
  /** 底部操作栏的内容（= pane.actionPanel） */
  actionPanel: 672,
  /** 世界面板：停靠和滑出 */
  world: 400,
  /** 设置左栏 */
  settingsList: 340,
  /** 设置左栏和右栏之间 */
  settingsGap: 24,
  /** 设置右栏宽于这个值时，模型详情、添加模型、连接测试分成两栏 */
  paneTwoColumns: 720,
  /** 剧本详情左栏 */
  scenarioInfo: 420,
  /** 居中对话框；键盘快捷键对话框宽一些 */
  dialog: 480,
  shortcutsDialog: 600,
  /** 贴着按钮弹出的菜单（阅读页“更多”） */
  popover: 340,
  /** 右键菜单，以及卡片上“…”打开的菜单 */
  contextMenu: 240,
  /** 提示浮条最大宽度 */
  toast: 480,
} as const;

/** 时长（毫秒） */
export const timing = {
  /** 悬停多久出现提示 */
  tooltipDelay: 500,
  /** 提示浮条停留多久；鼠标停在浮条上时不消失 */
  toast: 4000,
} as const;

export type NavMode = "tabbar" | "rail" | "sidebar";

/**
 * 左边导航的形态。collapsed 是用户自己收起了侧栏（存在浏览器里）。
 * < 900 返回 "tabbar"：交给平板、手机的布局（底部胶囊 Tab 栏）。
 */
export function navMode(width: number, collapsed: boolean): NavMode {
  if (width < desktop.rail) return "tabbar";
  if (width < desktop.sidebar || collapsed) return "rail";
  return "sidebar";
}

/** 导航占掉的宽度（含离窗口左边的 12）：侧栏 280，导航条 88，底部 Tab 栏 0 */
export function navWidth(mode: NavMode): number {
  if (mode === "sidebar") return shell.edge + shell.sidebar;
  if (mode === "rail") return shell.edge + shell.rail;
  return 0;
}

/**
 * 窄于 1280 时，导航条上的“展开”按钮打开的侧栏不推开内容，而是盖在上面（带遮罩）。
 * 只有窗口 ≥ 1280 时侧栏才占位。
 */
export function sidebarOverlays(width: number): boolean {
  return width >= desktop.rail && width < desktop.sidebar;
}

/** 一级页（故事、剧本）内容区：侧栏右边 40 起，右边 40，最宽 1200，多出来的居中 */
export function pageFrame(width: number, nav: NavMode): { left: number; width: number } {
  const left = navWidth(nav) + shell.gutter;
  const room = Math.max(0, width - left - shell.gutter);
  const w = Math.min(shell.contentMax, room);
  return { left: left + (room - w) / 2, width: w };
}

export type WorldMode = "dock" | "slideOver" | "sheet";

/**
 * 阅读页的导航和世界面板。worldOpen 是用户有没有打开世界。
 * - 窗口 − 导航 ≥ 1100：世界停靠；
 * - 侧栏展开放不下，但收成导航条就放得下（1188 ≤ 窗口 < 1380）：导航临时收成导航条，世界停靠，关掉世界后侧栏回来；
 * - 其余：从右侧滑出（< 600 是底部面板）。
 * 返回的 nav 是这一刻实际画出来的导航；用户的“收起”设置不因此改变。
 */
export function readingLayout(
  width: number,
  collapsed: boolean,
  worldOpen: boolean,
): { nav: NavMode; world: WorldMode | null } {
  const nav = navMode(width, collapsed);
  if (!worldOpen) return { nav, world: null };
  if (width < 600) return { nav, world: "sheet" };
  if (width - navWidth(nav) >= desktop.worldDock) return { nav, world: "dock" };
  if (nav === "sidebar" && width - navWidth("rail") >= desktop.worldDock) return { nav: "rail", world: "dock" };
  return { nav, world: "slideOver" };
}

/**
 * 阅读区（导航和停靠的世界之间）的位置。阅读栏、底部操作栏都在这一块里居中：
 * readableColumn(area.width)、actionPanelFrame(area.width) 的 left 再加上 area.left。
 */
export function readingArea(width: number, nav: NavMode, world: WorldMode | null): { left: number; width: number } {
  const left = navWidth(nav);
  const right = world === "dock" ? shell.world + shell.edge : 0;
  return { left, width: Math.max(0, width - left - right) };
}

/** 设置：左栏和右栏的位置；右栏够宽时，模型详情、添加模型、连接测试分两栏 */
export function settingsFrame(
  width: number,
  nav: NavMode,
): { listLeft: number; paneLeft: number; paneWidth: number; twoColumns: boolean } {
  const listLeft = navWidth(nav) + shell.gutter;
  const paneLeft = listLeft + shell.settingsList + shell.settingsGap;
  const paneWidth = Math.max(0, width - shell.edge - paneLeft);
  return { listLeft, paneLeft, paneWidth, twoColumns: paneWidth >= shell.paneTwoColumns };
}

/** 故事列表的列数：桌面和平板宽屏一样是三列，最近一个故事占两列两行 */
export function storyColumnsDesktop(): 3 {
  return 3;
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

/** 键盘快捷键，W12 对话框和“更多”菜单里的键帽都从这里取。single 表示单键快捷键（可以在对话框里关掉） */
export type Shortcut = { keys: string[]; label: string; scope: "reading" | "app"; single: boolean };

export const SHORTCUTS: Shortcut[] = [
  { keys: ["A", "B", "C", "D"], label: "选一个选项", scope: "reading", single: true },
  { keys: ["/"], label: "自己写", scope: "reading", single: true },
  { keys: ["Enter"], label: "发送", scope: "reading", single: false },
  { keys: ["Shift", "Enter"], label: "换行", scope: "reading", single: false },
  { keys: ["Esc"], label: "收起输入框，草稿留着", scope: "reading", single: false },
  { keys: ["End"], label: "回到最新", scope: "reading", single: false },
  { keys: ["W"], label: "打开或收起世界状态", scope: "reading", single: true },
  { keys: ["["], label: "展开或收起侧栏", scope: "app", single: true },
  { keys: ["?"], label: "显示这张表", scope: "app", single: true },
  { keys: ["Esc"], label: "关闭菜单、对话框和滑出的面板", scope: "app", single: false },
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
