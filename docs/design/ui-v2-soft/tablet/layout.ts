/**
 * 平板响应式布局的常量和纯函数，取自 docs/design/ui-v2-soft/tablet/source/TabletSystem.dc.html。
 * 只依赖窗口宽度（useWindowDimensions().width），不判断设备型号或横竖屏，分屏、台前调度同样适用。
 * 这里只有数据和纯函数，不依赖 React Native，可以像 theme/themes.ts 一样用 node --test 测。
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
  /** 阅读页行动面板：阅读栏两侧各多 16 */
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

/** 页面左右边距：中屏两侧 32；宽屏左侧从导航栏右边算起，右侧 40 */
export const gutter = { medium: 32, expandedRight: 40, detail: 24 } as const;

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

/** 阅读页行动面板里的选项排几列：宽屏两列，其他一列（奇数个时最后一项占满一行） */
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
 * - menu：阅读页“更多” → 贴着触发按钮弹出
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
