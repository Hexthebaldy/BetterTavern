/**
 * 配色与字号。故事是主角：叙述用大字号、宽行距，界面元素退到一边；
 * “我的行动”统一用左侧一道青色竖线标出——选项、故事里的玩家行动都是这一个记号。
 */

import { useColorScheme } from "react-native";

export type Palette = {
  /** 页面底色：偏冷的纸色 */
  paper: string;
  /** 输入框、浮层 */
  surface: string;
  ink: string;
  muted: string;
  rule: string;
  /** 黛青：玩家的行动、主要按钮 */
  accent: string;
  onAccent: string;
  accentSoft: string;
  /** 朱砂：错误与删除 */
  danger: string;
  dangerSoft: string;
};

const light: Palette = {
  paper: "#F2F3EE",
  surface: "#FBFCF9",
  ink: "#23272C",
  muted: "#626A71",
  rule: "#D6D9D1",
  accent: "#2E5E63",
  onAccent: "#F4F7F5",
  accentSoft: "#DDE7E5",
  danger: "#A63D2A",
  dangerSoft: "#F3E1DC",
};

const dark: Palette = {
  paper: "#1A1E22",
  surface: "#22272C",
  ink: "#DCDFD8",
  muted: "#929A9F",
  rule: "#323940",
  accent: "#8DBAB5",
  onAccent: "#13201F",
  accentSoft: "#26393A",
  danger: "#E58A76",
  dangerSoft: "#3A2622",
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}

/** 字号（中文正文行高取 1.75 左右） */
export const type = {
  narrative: { fontSize: 17.5, lineHeight: 31 },
  action: { fontSize: 15, lineHeight: 24 },
  body: { fontSize: 15, lineHeight: 22 },
  title: { fontSize: 22, lineHeight: 30, fontWeight: "600" as const },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: "600" as const },
  caption: { fontSize: 13, lineHeight: 18 },
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };
