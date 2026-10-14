/**
 * UI v2「白 / 线 / 直角」的设计 token，取自 docs/design/ui-v2/（tokens.ts 与 source/Main.dc.html）。
 *
 * 白色作底，1px 线条分区，所有圆角为 0；黑白两色加一个蓝色强调色。
 * 选中 = 黑白反转或 2px 黑色描边；“我的”“当前的” = 蓝色 acc；红 / 绿 / 琥珀只表示状态，并且一定配图标。
 * 对比度：文字色在对应底色上都 ≥ 4.5:1（mut 在白底上约 5.4:1）。
 */

import { useColorScheme } from "react-native";

export type Palette = {
  /** 页面底色 */
  bg: string;
  /** 分区、凹面、“我的行动”色带、封面底 */
  bg2: string;
  /** 骨架屏、禁用按钮、左滑操作的次要底色 */
  bg3: string;
  /** 主文字、主按钮底、选中态底、深分隔线 */
  ink: string;
  /** 次级正文 */
  ink2: string;
  /** 说明、占位、未选中图标 */
  mut: string;
  /** 列表行分隔线 */
  line: string;
  /** 控件描边（输入框、次要按钮、未选中标签） */
  line2: string;
  /** 强调：“我”、选中项、流式光标、进度线 */
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
  /** 面板、对话框后面的遮罩 */
  scrim: string;
};

const light: Palette = {
  bg: "#FFFFFF",
  bg2: "#F7F7F5",
  bg3: "#EFEFEC",
  ink: "#111111",
  ink2: "#37352F",
  mut: "#6B6A66",
  line: "#E8E8E5",
  line2: "#D3D3CF",
  acc: "#2747FF",
  accBg: "#EEF1FF",
  ok: "#0B8A55",
  okBg: "#E7F5EE",
  warn: "#B45309",
  warnBg: "#FDF3E3",
  err: "#D92D20",
  errBg: "#FDECEA",
  narr: "#1C1C1C",
  pri: "#111111",
  onPri: "#FFFFFF",
  scrim: "rgba(17,17,17,0.45)",
};

const dark: Palette = {
  bg: "#0E0E0E",
  bg2: "#171717",
  bg3: "#222222",
  ink: "#F2F2F0",
  ink2: "#D6D6D2",
  mut: "#9A9A95",
  line: "#262626",
  line2: "#363636",
  acc: "#7C8CFF",
  accBg: "#1A1F3D",
  ok: "#3CCB8A",
  okBg: "#10261C",
  warn: "#F2B04C",
  warnBg: "#2B2112",
  err: "#FF6B5E",
  errBg: "#2E1513",
  narr: "#E4E4E0",
  pri: "#F2F2F0",
  onPri: "#0E0E0E",
  scrim: "rgba(0,0,0,0.65)",
};

/** 红底、蓝底上的白字（两种模式下都一样） */
export const onColor = "#FFFFFF";

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}

/** 所有圆角都是 0；保留这个常量，避免各处写死数字 */
export const radius = 0;

/** 线宽：常规分隔 1，分区标题与面板顶边 2，选中描边 2 */
export const stroke = { hair: 1, strong: 2, focus: 2 };

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
  /** 一级页大标题：故事 / 剧本 / 设置 */
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700" as const, letterSpacing: -0.7 },
  /** 剧本名等超大标题 */
  hero: { fontSize: 40, lineHeight: 46, fontWeight: "900" as const, letterSpacing: -1.2 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700" as const },
  /** 分区标题（下面压一道 2px ink 线） */
  section: { fontSize: 20, lineHeight: 26, fontWeight: "700" as const },
  /** 列表行标题、故事标题 */
  rowTitle: { fontSize: 17, lineHeight: 24, fontWeight: "700" as const },
  /** 叙述正文：宋体，跟随动态字体（15–24），行高 = 字号 × 1.77 */
  narrative: { fontSize: 17.5, lineHeight: 31 },
  /** “我的行动”色带 */
  action: { fontSize: 15, lineHeight: 24, fontWeight: "500" as const },
  body: { fontSize: 15, lineHeight: 22 },
  button: { fontSize: 16, lineHeight: 22, fontWeight: "500" as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
  caption: { fontSize: 13, lineHeight: 19 },
  /** 等宽元信息：时间、计数、标签、Key 尾号（字距 +6%） */
  meta: { fontSize: 11.5, lineHeight: 16, letterSpacing: 0.7 },
};

/** 4pt 栅格；页面左右边距 20，阅读页 24 */
export const space = { xs: 4, s: 8, m: 12, l: 16, page: 20, read: 24, xl: 28, xxl: 36 };

/** 控件尺寸 */
export const size = {
  button: 52,
  input: 52,
  touch: 44,
  chip: 40,
  optionRow: 64,
  optionKey: 28,
  icon: 22,
  tabBar: 50,
  cover: 56,
};
