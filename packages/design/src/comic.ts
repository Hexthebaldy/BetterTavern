/**
 * 漫画风（docs/design/comic）的数值：颜色、描边、圆角、硬投影、按下的位移、网点。手机端用；
 * 网页端同一套值写在 apps/web/src/theme/tokens.css 的“漫画分镜版”一段。
 *
 * 颜色单独一张表，不放进色板（palettes.ts）：网页端把 Palette 的每个字段写成同名的 CSS 变量，
 * 和 tokens.css 里的漫画变量（--page、--grey、--sky…）重名时会把它们盖掉。
 * 浅色、夜间各一套，取自 docs/design/comic/mobile/source/MobNight.dc.html 的 :root 和 .N；
 * 夜间是墨和纸对调，硬投影跟着墨走（夜间是浅色的）。
 *
 * 只有纯数据和纯函数，不依赖 React Native，用 node --test 测。
 */

import type { ThemeId } from "./themes.ts";

export type ComicColors = {
  /** 页面底色（色板里的 bg 是白，App 和网页共用，不改） */
  page: string;
  /** 格子、列表行、Tab 栏、输入框、菜单的底 */
  paper: string;
  /** 墨：描边、字、硬投影 */
  ink: string;
  /** 次一档的正文、摘要 */
  ink2: string;
  /** 说明文字、没选中的标签字 */
  mut: string;
  /** 没选中的图标（墨灰） */
  iconMut: string;
  acc: string;
  /** 蓝底上的字 */
  onAcc: string;
  /** 墨底上的蓝（浅蓝） */
  sky: string;
  /** 灰：封面底、灰格子 */
  grey: string;
  /** 浅一档的灰：次要的分隔线、骨架 */
  grey2: string;
  /** 选项的灰底 */
  option: string;
  /** 浅色的线（输入框的占位描边、轨道） */
  line: string;
  /** 深一档的线 */
  line2: string;
  /** 两栏页面左栏选中的一行、选中的列表行 */
  selected: string;
  /** 不能点的按钮底 */
  disabled: string;
  /** 不能点的按钮的描边（字是纸色） */
  disabledLine: string;
  /** 红：删除和出错的字和边 */
  err: string;
  /** 删除按钮的底 */
  danger: string;
  /** 出错的输入框底 */
  errField: string;
  /** 琥珀：只表示警告 */
  warn: string;
  /** 改动对比：原文的酒红、改后的深绿 */
  wine: string;
  forest: string;
  /** 平板两栏页面的详情区（灰底，里面的格子是白的）；夜间是稿子里没有、按墨纸对调取的 */
  detail: string;
  /** 面板、对话框后面的遮罩 */
  scrim: string;
  /** 平板长按卡片时的浅遮罩 */
  scrimLight: string;
};

export const COMIC_COLORS: Record<ThemeId, ComicColors> = {
  light: {
    page: "#F8F8F5",
    paper: "#FFFFFF",
    ink: "#1A1A1A",
    ink2: "#3D3C38",
    mut: "#6E6D68",
    iconMut: "#4A4945",
    acc: "#2F55F4",
    onAcc: "#FFFFFF",
    sky: "#93A8FF",
    grey: "#F5F5F2",
    grey2: "#EBEBE7",
    option: "#EEEEEA",
    line: "#DCDCD6",
    line2: "#C9C9C3",
    selected: "#EEF1FF",
    disabled: "#D8D8D3",
    disabledLine: "#B9B9B3",
    err: "#D93025",
    danger: "#E5483A",
    errField: "#FFF6F5",
    warn: "#B45309",
    wine: "#8C2A3C",
    forest: "#1F6B44",
    detail: "#EFEFEA",
    scrim: "rgba(26,26,26,0.46)",
    scrimLight: "rgba(26,26,26,0.18)",
  },
  night: {
    page: "#0B0B0D",
    paper: "#111113",
    ink: "#F2F2F0",
    ink2: "#D3D3CF",
    mut: "#9C9C97",
    iconMut: "#BDBDB8",
    acc: "#8597FF",
    onAcc: "#111113",
    sky: "#2F55F4",
    grey: "#1C1C1F",
    grey2: "#27272B",
    option: "#1C1C1F",
    line: "#2A2A2F",
    line2: "#3A3A40",
    selected: "#1F2546",
    disabled: "#27272B",
    disabledLine: "#3A3A40",
    err: "#FF7466",
    danger: "#E5483A",
    errField: "#2F1715",
    warn: "#F0B257",
    wine: "#E27B90",
    forest: "#6FCF97",
    detail: "#161618",
    scrim: "rgba(0,0,0,0.6)",
    scrimLight: "rgba(0,0,0,0.4)",
  },
};

/** 描边：frame 格子、列表行、按钮、选项、Tab 栏、面板、导航栏底边；control 输入框、图标按钮、封面、小控件；
 * chip 小标签、列表里的分隔线 */
export const comicStroke = { frame: 2.5, control: 2, chip: 1.5 };

/** 圆角：按钮是胶囊（高度 / 2） */
export const comicRadius = {
  frame: 12,
  cover: 9,
  option: 14,
  iconButton: 12,
  iconButtonSm: 10,
  input: 12,
  menu: 14,
  tabBar: 32,
  /** 底部面板的上沿 */
  sheet: 26,
  dialog: 18,
  /** 平板两栏页面的详情区、停靠的世界状态 */
  panel: 16,
  tag: 7,
  chip: 6,
};

/** 投影的层数：iconButton 图标按钮；raised 按钮、选项、Tab 栏、菜单、浮条；dialog 对话框、主卡；lift 长按浮起的卡片 */
export const comicDepth = { iconButton: 2, focus: 3, raised: 4, dialog: 6, lift: 8 };

/**
 * 硬投影：一像素一层叠出来（1px 1px 0, 2px 2px 0, …），转角处是连着的；不用模糊阴影。
 * 层数为 0 时没有投影（undefined）。React Native 新架构的 boxShadow 直接支持这个写法。
 */
export function hardShadow(color: string, depth: number): string | undefined {
  const layers = Math.max(0, Math.round(depth));
  if (layers === 0) return undefined;
  return Array.from({ length: layers }, (_, i) => `${i + 1}px ${i + 1}px 0 ${color}`).join(", ");
}

/**
 * 按下：往投影的方向挪，投影缩短，松手弹回。投影 4 时挪 3、剩 1；投影 2 时挪 1、剩 1；没有投影时不动。
 * 不缩放、不改透明度。
 */
export function pressedShift(depth: number): { shift: number; depth: number } {
  if (depth <= 0) return { shift: 0, depth: 0 };
  const left = 1;
  return { shift: Math.max(0, depth - left), depth: Math.min(depth, left) };
}

/** 网点：蓝底白点、白底墨点、灰底墨点（和网页的 --ht-acc、--ht-ink、--ht-grey 一样） */
export type HalftoneTone = "acc" | "ink" | "grey";

export function halftone(tone: HalftoneTone, theme: ThemeId): { step: number; radius: number; dot: string } {
  const night = theme === "night";
  if (tone === "acc") {
    return { step: 12, radius: 1.4, dot: night ? "rgba(17,17,19,0.22)" : "rgba(255,255,255,0.22)" };
  }
  const alpha = tone === "ink" ? 0.14 : 0.1;
  return { step: 11, radius: 1.3, dot: night ? `rgba(242,242,240,${alpha})` : `rgba(26,26,26,${alpha})` };
}
