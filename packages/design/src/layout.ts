/**
 * 平板响应式布局的常量和纯函数，取自 docs/design/ui/tablet/（layout.ts 与 source/TabletSystem.dc.html）。
 * 只依赖窗口宽度（useWindowDimensions().width），不判断设备型号或横竖屏，分屏、台前调度同样适用。
 * 这里只有数据和纯函数，不依赖 React Native，和 themes.ts 一样用 node --test 测。
 * 手机端的页面经 apps/mobile/src/hooks/useLayout.ts 取当前布局；网页端在这上面再加电脑的一档（apps/web 的 theme/layout.ts）。
 */

/** 窄：手机布局；中：居中单栏 + 底部胶囊；宽：左侧导航栏 + 两栏 */
export type SizeClass = "compact" | "medium" | "expanded";

export const breakpoint = {
  /** ≥ 600 进入“中” */
  medium: 600,
  /** ≥ 900 进入“宽” */
  expanded: 900,
  /** 阅读页宽度 ≥ 1100 时，世界状态停靠在右侧 */
  worldDock: 1100,
} as const;

export function sizeClass(width: number): SizeClass {
  if (width >= breakpoint.expanded) return "expanded";
  if (width >= breakpoint.medium) return "medium";
  return "compact";
}

/** 栏宽与浮层尺寸 */
export const pane = {
  /** 阅读栏、表单、单栏页面的最大宽度 */
  readable: 640,
  /** 阅读页底部操作栏的内容：阅读栏两侧各多 16 */
  actionPanel: 672,
  /** 两栏页面的左栏（设置列表） */
  list: 340,
  /** 剧本详情左侧的信息栏 */
  scenarioInfo: 420,
  /** 世界状态：停靠面板与滑出面板 */
  world: 400,
  /** 居中对话框最大宽度 */
  dialog: 480,
  /** 贴着按钮弹出的菜单 */
  popover: 340,
  /** 长按卡片弹出的菜单 */
  cardMenu: 240,
  /** 提示浮条最大宽度 */
  toast: 480,
} as const;

/** 左侧导航栏（宽屏） */
export const rail = {
  width: 76,
  left: 16,
  top: 32,
  /** 选中项 60×64，圆角 30 */
  item: { width: 60, height: 64 },
  /** 一级页正文的起始 x：16 + 76 + 32 */
  contentLeft: 124,
} as const;

/** 中屏的底部胶囊 Tab 栏：固定宽度、水平居中 */
export const bottomBar = { width: 392 } as const;

/** 页面左右边距：中屏两侧 32；宽屏左侧从导航栏右边算起，右侧 40；两栏页面的详情区四周 16、内边距 24 */
export const gutter = { medium: 32, expandedRight: 40, detail: 24, detailEdge: 16 } as const;

/** 网格间距 */
export const gap = { card: 12, library: 16 } as const;

/** 故事列表列数；最近一个故事（列表第一项）在中屏占满一行，宽屏占两列两行 */
export function storyColumns(size: SizeClass): number {
  return size === "expanded" ? 3 : size === "medium" ? 2 : 1;
}

/** 剧本网格列数：窄屏 2，中屏 3，宽屏按内容宽度 ÷ 240 取整，至少 2、最多 5 */
export function libraryColumns(size: SizeClass, contentWidth: number): number {
  if (size === "compact") return 2;
  if (size === "medium") return 3;
  return Math.max(2, Math.min(5, Math.floor(contentWidth / 240)));
}

/** 阅读页末尾的选项排几列：宽屏两列，其他一列（奇数个时最后一项占满一行） */
export function optionColumns(size: SizeClass): 1 | 2 {
  return size === "expanded" ? 2 : 1;
}

/** 世界状态怎么出现：手机底部面板；平板默认右侧滑出；阅读页够宽时停靠 */
export type WorldPresentation = "sheet" | "slideOver" | "dock";

export function worldPresentation(width: number): WorldPresentation {
  if (width >= breakpoint.worldDock) return "dock";
  if (width >= breakpoint.medium) return "slideOver";
  return "sheet";
}

/**
 * 底部面板在平板上换成什么。
 * - choice：服务器、外观、重命名、确认删除、揭示秘密 → 居中对话框
 * - menu：阅读页“更多”、卡片长按 → 贴着触发的按钮或卡片弹出
 */
export type OverlayKind = "choice" | "menu";
export type OverlayPresentation = "sheet" | "dialog" | "popover";

export function overlayPresentation(kind: OverlayKind, size: SizeClass): OverlayPresentation {
  if (size === "compact") return "sheet";
  return kind === "menu" ? "popover" : "dialog";
}

/**
 * 阅读栏的位置：宽度不超过 640，两侧至少留 24（和手机的阅读页边距一致），在可用区域里居中。
 * available：阅读页宽度；世界状态停靠时传 width - pane.world - 8（面板离右边 8）。
 */
export function readableColumn(available: number): { left: number; width: number } {
  const width = Math.min(pane.readable, Math.max(0, available - 48));
  return { left: (available - width) / 2, width };
}

/** 世界状态停靠时，阅读区剩下的宽度（面板 400，离右边 8） */
export function readingWidth(width: number, docked: boolean): number {
  return docked ? width - pane.world - 8 : width;
}

/**
 * 阅读页底部操作栏内容的左右位置：宽 672，和阅读栏中线对齐；放不下时左右各离边 8（手机上就是这样）。
 */
export function actionPanelFrame(available: number): { left: number; width: number } {
  const width = Math.min(pane.actionPanel, Math.max(0, available - 16));
  return { left: (available - width) / 2, width };
}

export type Insets = { left: number; right: number };

/**
 * 一级页（带导航栏的故事、剧本、设置）内容区的左右留白。
 * 窄屏返回 null：沿用手机页面自己的边距；中屏两侧 32；宽屏左边让出导航栏（x = 124），右边 40。
 */
export function tabInsets(size: SizeClass): Insets | null {
  if (size === "compact") return null;
  if (size === "medium") return { left: gutter.medium, right: gutter.medium };
  return { left: rail.contentLeft, right: gutter.expandedRight };
}

/** 在两侧留白之间居中放一条最宽 max 的栏，返回新的两侧留白 */
export function centerColumn(width: number, insets: Insets, max: number = pane.readable): Insets {
  const room = width - insets.left - insets.right;
  const extra = Math.max(0, room - max) / 2;
  return { left: insets.left + extra, right: insets.right + extra };
}

/** 二级页（剧本详情、设置子页、连接测试）在中屏和宽屏的单栏：最宽 640，居中，两侧至少 32 */
export function pageColumn(size: SizeClass, width: number): Insets | null {
  if (size === "compact") return null;
  return centerColumn(width, { left: gutter.medium, right: gutter.medium });
}

/** 设置两栏（宽屏）的详情区：从左栏右边 24 开始，到屏幕右边留 16 */
export function settingsDetailLeft(): number {
  return rail.contentLeft + pane.list + gutter.detail;
}

/**
 * 网格里每格的宽度：总宽减掉列间距后平分。
 * 列表项里用 Math.floor，避免几个小数宽加起来超出一行而换行。
 */
export function cellWidth(contentWidth: number, columns: number, spacing: number): number {
  return Math.floor((contentWidth - spacing * (columns - 1)) / columns);
}

/** 屏幕短边 < 600 是手机：锁竖屏；平板（包括分屏时）支持所有方向。看的是整块屏幕，不是窗口 */
export function locksPortrait(screen: { width: number; height: number }): boolean {
  return Math.min(screen.width, screen.height) < breakpoint.medium;
}

/** 提示浮条的位置：宽度不超过 480；中屏贴在底部 Tab 栏上方，宽屏在内容区（x ≥ 124）底部居中 */
export function toastFrame(
  size: SizeClass,
  width: number,
): { left: number; width: number; aboveTabBar: boolean } | null {
  if (size === "compact") return null;
  const areaLeft = size === "expanded" ? rail.contentLeft : 0;
  const area = width - areaLeft - (size === "expanded" ? gutter.expandedRight : 0);
  const w = Math.min(pane.toast, area - gutter.medium * 2);
  return { left: areaLeft + (area - w) / 2, width: w, aboveTabBar: size === "medium" };
}

/**
 * 贴着触发按钮弹出的菜单：右边缘和按钮右边缘对齐，底边在 bottom 上方 8；上面放不下（比如按钮在屏幕上半部）
 * 就放到按钮下方 8。trigger 是按钮在窗口里的位置，bottom 是菜单底边不能低于的 y（通常是按钮的顶边），
 * menuHeight 是菜单的高度（还没量出来时给个估计），topLimit 是菜单顶边不能高于的 y（状态栏下方）。
 * 返回菜单的 left、top 和宽度（以窗口为准）。
 */
export function popoverFrame(
  trigger: { x: number; y: number; width: number; height: number },
  window: { width: number; height: number },
  bottom: number,
  menuHeight: number,
  topLimit: number,
  menuWidth: number = pane.popover,
): { left: number; top: number; width: number } {
  const width = Math.min(menuWidth, window.width - 32);
  const right = trigger.x + trigger.width;
  const left = Math.min(Math.max(16, right - width), window.width - 16 - width);
  const above = bottom - 8 - menuHeight;
  const top =
    above >= topLimit ? above : Math.min(trigger.y + trigger.height + 8, window.height - 16 - menuHeight);
  return { left, top: Math.max(topLimit, top), width };
}

/**
 * 长按卡片弹出的菜单：卡片下方 8，和卡片左边对齐；下面放不下就放到卡片上方。
 * 返回菜单的 left、top 和宽度（top 以窗口为准）。
 */
export function cardMenuFrame(
  card: { x: number; y: number; width: number; height: number },
  window: { width: number; height: number },
  menuHeight: number,
  bottomSafe: number,
  menuWidth: number = pane.cardMenu,
): { left: number; top: number; width: number } {
  const width = Math.min(menuWidth, window.width - 32);
  const left = Math.min(Math.max(16, card.x), window.width - 16 - width);
  const below = card.y + card.height + 8;
  const fitsBelow = below + menuHeight <= window.height - bottomSafe - 16;
  const top = fitsBelow ? below : Math.max(16, card.y - 8 - menuHeight);
  return { left, top, width };
}
