/**
 * UI v2 柔和圆角版「白 / 柔线 / 大圆角」的设计 token，取自 docs/design/ui-v2-soft/tokens.ts。
 *
 * 纯白页面，内容放在浅灰圆角卡片里；按钮、标签、分段控件是胶囊；分区靠灰卡和留白，不画黑线。
 * 层级靠“灰卡放在白底上”：页面 bg，卡片和输入框 bg2，卡片里再嵌一层用 bg3 或白色的 card。
 * 阴影只给浮起来的东西（Tab 栏、阅读页行动面板、提示浮条、“回到最新”）。
 * 状态靠换底色：未选中浅灰，选中黑底或浅蓝底加 2px 蓝色内描边，聚焦一圈 2px acc，按下缩到 97%，禁用不透明度 0.3。
 * 红 / 绿 / 琥珀只表示错误 / 可用 / 警告，并且一定配图标。
 */

import { useColorScheme } from "react-native";

export type Palette = {
  /** 页面底色 */
  bg: string;
  /** 灰卡：列表卡片、分组、输入框、“我的行动”卡片、次要按钮 */
  bg2: string;
  /** 凹面：骨架屏、滑杆 / 进度轨道、卡片里再嵌一层的底 */
  bg3: string;
  /** 主文字、选中态底、Tab 选中胶囊 */
  ink: string;
  /** 次级正文 */
  ink2: string;
  /** 说明、占位、未选中图标 */
  mut: string;
  /** 卡片内部行与行之间的分隔（不画外框） */
  line: string;
  /** 拖拽条、未选中单选圈 */
  line2: string;
  /** 强调：“我”、选中项、流式光标、聚焦圈 */
  acc: string;
  accBg: string;
  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  err: string;
  errBg: string;
  /** 叙述正文（深色下比 ink 低一档，减少眩光） */
  narr: string;
  /** 主按钮 */
  pri: string;
  onPri: string;
  /** 浮层：Tab 栏、提示浮条、对话框；灰卡里再嵌的白卡 */
  card: string;
  /** 阅读页底部行动面板与各类底部面板 */
  sheet: string;
  /** 面板、对话框后面的遮罩 */
  scrim: string;
  /** 主按钮右侧箭头圆的底色（半透明）；墨色卡片上的半透明层也用它 */
  arrowBg: string;
  /** 墨色卡片（设置页的导演模型卡）上的蓝和绿：取另一种模式下的值，保证对比度 */
  accOnInk: string;
  okOnInk: string;
  /** 浮层投影（CSS box-shadow，RN 新架构直接支持） */
  shadowFloat: string;
  /** 底部面板向上的投影 */
  shadowUp: string;
};

const light: Palette = {
  bg: "#FFFFFF",
  bg2: "#F5F5F2",
  bg3: "#EBEBE7",
  ink: "#1A1A1A",
  ink2: "#3D3C38",
  mut: "#6E6D68",
  line: "#EEEEEA",
  line2: "#DCDCD6",
  acc: "#2F55F4",
  accBg: "#EEF2FF",
  ok: "#13875A",
  okBg: "#E9F6EF",
  warn: "#B25A0B",
  warnBg: "#FFF4E4",
  err: "#D3392B",
  errBg: "#FDEEEB",
  narr: "#222222",
  pri: "#1A1A1A",
  onPri: "#FFFFFF",
  card: "#FFFFFF",
  sheet: "#FFFFFF",
  scrim: "rgba(20,20,20,0.38)",
  arrowBg: "rgba(255,255,255,0.14)",
  accOnInk: "#8597FF",
  okOnInk: "#43C98C",
  shadowFloat: "0 1px 2px rgba(20,20,20,0.05), 0 8px 28px rgba(20,20,20,0.10)",
  shadowUp: "0 -2px 6px rgba(20,20,20,0.03), 0 -10px 32px rgba(20,20,20,0.08)",
};

const dark: Palette = {
  bg: "#111113",
  bg2: "#1C1C1F",
  bg3: "#27272B",
  ink: "#F2F2F0",
  ink2: "#D3D3CF",
  mut: "#9C9C97",
  line: "#2A2A2F",
  line2: "#3A3A40",
  acc: "#8597FF",
  accBg: "#1F2546",
  ok: "#43C98C",
  okBg: "#11281D",
  warn: "#F0B257",
  warnBg: "#2C2213",
  err: "#FF7466",
  errBg: "#2F1715",
  narr: "#E2E2DE",
  pri: "#F2F2F0",
  onPri: "#111113",
  card: "#2A2A2F",
  sheet: "#1F1F23",
  scrim: "rgba(0,0,0,0.6)",
  arrowBg: "rgba(0,0,0,0.08)",
  accOnInk: "#2F55F4",
  okOnInk: "#13875A",
  shadowFloat: "0 1px 2px rgba(0,0,0,0.4), 0 10px 30px rgba(0,0,0,0.5)",
  shadowUp: "0 -2px 6px rgba(0,0,0,0.3), 0 -10px 32px rgba(0,0,0,0.5)",
};

/** 红底、蓝底上的白字（两种模式下都一样） */
export const onColor = "#FFFFFF";

/** 选中的分段、滑块等“小浮起”的投影 */
export const liftShadow = "0 1px 3px rgba(20,20,20,0.12)";

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}

/**
 * 圆角阶梯。规则：容器越大，圆角越大；嵌套时内层圆角 = 外层圆角 − 内边距。
 * 按钮、标签、分段控件、Tab 栏是全圆（高度 / 2）。不要出现 2–8 这种小圆角。
 */
export const radius = {
  tag: 10,
  input: 14,
  cover: 16,
  card: 20,
  /** 阅读页选项卡片、故事列表卡片 */
  option: 24,
  group: 28,
  sheet: 32,
  /** 阅读页浮起的行动面板（四周留 8） */
  floatingSheet: 36,
  pill: 999,
};

/** 图标描边 1.75，圆头圆角；聚焦圈 2；错误输入框描边 1.5 */
export const stroke = { icon: 1.75, focus: 2, error: 1.5, hair: 1 };

/**
 * 字体族。sans 用系统字体（不打包）；mono 用 IBM Plex Mono；serif 用思源宋体的 GB2312 子集
 * （assets/fonts，生成方法见 scripts/font-subset-chars.py）。名字与根布局 useFonts 的键一致。
 */
export const font = {
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  serif: "NotoSerifSC-Regular",
};

export const type = {
  /** 一级页大标题：故事 / 剧本 / 设置（标题下不画线） */
  display: { fontSize: 32, lineHeight: 40, fontWeight: "700" as const, letterSpacing: -0.64 },
  /** 剧本名等超大标题 */
  hero: { fontSize: 38, lineHeight: 44, fontWeight: "900" as const, letterSpacing: -1.1 },
  /** 页面 / 面板标题 */
  title: { fontSize: 20, lineHeight: 28, fontWeight: "600" as const },
  /** 分区标题 */
  section: { fontSize: 19, lineHeight: 26, fontWeight: "700" as const },
  /** 阅读页导航栏标题 */
  navTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
  /** 列表卡片标题 */
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700" as const },
  /** 叙述正文：宋体，跟随阅读设置（15–24），行高 = 字号 × 1.77 */
  narrative: { fontSize: 17.5, lineHeight: 31 },
  /** “我的行动”卡片 */
  action: { fontSize: 15, lineHeight: 24, fontWeight: "500" as const },
  body: { fontSize: 15, lineHeight: 22 },
  button: { fontSize: 16, lineHeight: 22, fontWeight: "500" as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
  caption: { fontSize: 13, lineHeight: 19 },
  /** 等宽元信息：时间、计数、Key 尾号、上下文窗口 */
  meta: { fontSize: 12, lineHeight: 16 },
  /** Tab 栏未选中文字 */
  tab: { fontSize: 11, lineHeight: 14 },
};

/** 4pt 栅格；一级页左右 24、列表卡片区左右 12、阅读页正文 24、“我的行动”卡片外边距 16 */
export const space = { xs: 4, s: 8, m: 12, l: 16, page: 24, list: 12, read: 24, xl: 28, xxl: 36 };

/** 控件尺寸 */
export const size = {
  button: 52,
  input: 52,
  touch: 44,
  /** 导航按钮（灰色圆底，热区仍是 44） */
  navButton: 40,
  /** 主按钮右侧的半透明箭头圆 */
  buttonArrow: 36,
  chip: 40,
  optionRow: 62,
  optionKey: 32,
  actionIcon: 26,
  icon: 22,
  /** 浮动 Tab 栏：高 64，左右 20 */
  tabBar: 64,
  tabActive: 48,
  cover: 56,
  /** 生成中拖拽条形状的进度条 */
  handle: { width: 44, height: 5, segment: 18 },
  caret: { width: 3, height: 20 },
};
