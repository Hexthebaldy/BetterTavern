/**
 * 存在浏览器里的界面偏好（localStorage 的 bt.prefs，键名和 App 相同）：阅读设置、剧本库视图、外观、界面语言、
 * 阅读页世界停靠开着还是收着，以及网页端才有的侧栏收起、单键快捷键开关。读到的内容不对就用默认值。
 */

import { parseLanguageSetting, type LanguageSetting } from "@bettertavern/core/i18n/index";
import { DEFAULT_READING, parseReadingPrefs, type ReadingPrefs } from "@bettertavern/core/play/reading";
import { parseThemeSetting, THEMES, type Scheme, type ThemeSetting } from "@bettertavern/design/themes";

export const PREFS_KEY = "bt.prefs";
/** index.html 里的脚本在页面脚本加载前读它，先设好深浅，深色下打开不闪白 */
export const SCHEME_KEY = "bt.scheme";

export type LibraryView = "grid" | "list";

export type WebPrefs = {
  reading: ReadingPrefs;
  libraryView: LibraryView;
  theme: ThemeSetting;
  /** 界面语言：跟随系统（浏览器）、中文、English */
  language: LanguageSetting;
  /** 阅读页够宽时世界状态停靠在右侧：开着还是收着（所有故事共用） */
  worldDocked: boolean;
  /** 用户收起了侧栏（≥ 1280 时显示导航条） */
  sidebarCollapsed: boolean;
  /** 单键快捷键（A–D、/、W、[、?）；用读屏或语音输入的人可以关掉 */
  singleKeys: boolean;
};

export const DEFAULT_PREFS: WebPrefs = {
  reading: DEFAULT_READING,
  libraryView: "grid",
  theme: "system",
  language: "system",
  worldDocked: false,
  sidebarCollapsed: false,
  singleKeys: true,
};

export function parsePrefs(raw: unknown): WebPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PREFS;
  const r = raw as Record<string, unknown>;
  return {
    reading: parseReadingPrefs(r.reading),
    libraryView: r.libraryView === "list" ? "list" : "grid",
    theme: parseThemeSetting(r.theme),
    language: parseLanguageSetting(r.language),
    worldDocked: r.worldDocked === true,
    sidebarCollapsed: r.sidebarCollapsed === true,
    singleKeys: r.singleKeys !== false,
  };
}

/** 给启动脚本的深浅：固定主题时是它的基调，跟随系统时是 "system"（启动脚本自己看系统） */
export function bootScheme(theme: ThemeSetting): Scheme | "system" {
  return theme === "system" ? "system" : THEMES[theme].scheme;
}
