/**
 * 存在浏览器里的界面偏好（localStorage 的 bt.prefs，键名和 App 相同）：阅读设置、外观、界面语言，
 * 以及网页端才有的导航轮盘的位置、单键快捷键开关。
 * 读到的内容不对就用默认值。
 */

import { parseLanguageSetting, type LanguageSetting } from "@bettertavern/core/i18n/index";
import { DEFAULT_READING, parseReadingPrefs, type ReadingPrefs } from "@bettertavern/core/play/reading";
import { parseThemeSetting, THEMES, type Scheme, type ThemeSetting } from "@bettertavern/design/themes";

import { DEFAULT_SPOT, parseWheelSpot, type WheelSpot } from "../theme/wheel.ts";

export const PREFS_KEY = "bt.prefs";
/** index.html 里的脚本在页面脚本加载前读它，先设好深浅，深色下打开不闪白 */
export const SCHEME_KEY = "bt.scheme";

export type WebPrefs = {
  reading: ReadingPrefs;
  theme: ThemeSetting;
  /** 界面语言：跟随系统（浏览器）、中文、English、日本語 */
  language: LanguageSetting;
  /** 导航轮盘停在哪（窗口 ≥ 900 时；贴哪一边、圆心在窗口里的比例） */
  wheel: WheelSpot;
  /** 单键快捷键（A–D、/、W、L、Q、?）；用读屏或语音输入的人可以关掉 */
  singleKeys: boolean;
};

export const DEFAULT_PREFS: WebPrefs = {
  reading: DEFAULT_READING,
  theme: "system",
  language: "system",
  wheel: DEFAULT_SPOT,
  singleKeys: true,
};

export function parsePrefs(raw: unknown): WebPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const r = raw as Record<string, unknown>;
  return {
    reading: parseReadingPrefs(r.reading),
    theme: parseThemeSetting(r.theme),
    language: parseLanguageSetting(r.language),
    wheel: parseWheelSpot(r.wheel),
    singleKeys: r.singleKeys !== false,
  };
}

/** 给启动脚本的深浅：固定主题时是它的基调，跟随系统时是 "system"（启动脚本自己看系统） */
export function bootScheme(theme: ThemeSetting): Scheme | "system" {
  return theme === "system" ? "system" : THEMES[theme].scheme;
}
