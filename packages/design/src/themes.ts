/**
 * 主题表：按 id 登记每个主题的基调和色板。加主题就是在 THEMES 里加一项，再排进 THEME_ORDER，
 * 再在 core 的 i18n 资源里给它起名字（appearance.<id>、appearance.<id>Note）。
 *
 * 基调（scheme）决定系统那一侧的样子：状态栏、键盘、系统弹窗跟着它切深浅。
 * 用户的设置是“跟随系统”或某个主题 id；跟随系统时，系统是深色用夜间，否则用浅色。
 * 这里只有纯数据和纯函数，不依赖 React Native，用 node --test 测。
 */

import { darkPalette, lightPalette, type Palette } from "./palettes.ts";

export type ThemeId = "light" | "night";
export type Scheme = "light" | "dark";

export type ThemeDef = {
  id: ThemeId;
  scheme: Scheme;
  palette: Palette;
};

export const THEMES: Record<ThemeId, ThemeDef> = {
  light: { id: "light", scheme: "light", palette: lightPalette },
  night: { id: "night", scheme: "dark", palette: darkPalette },
};

/** 设置里列出的顺序（“跟随系统”总在最前） */
export const THEME_ORDER: ThemeId[] = ["light", "night"];

/** 用户的外观设置：跟随系统，或固定某个主题 */
export type ThemeSetting = "system" | ThemeId;

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(THEMES, value);
}

/** 读存储里的设置；不认识的值（比如以后删掉的主题）退回跟随系统 */
export function parseThemeSetting(raw: unknown): ThemeSetting {
  return isThemeId(raw) ? raw : "system";
}

/** 设置加上系统当前的深浅，得出实际用哪个主题 */
export function resolveTheme(setting: ThemeSetting, system: string | null | undefined): ThemeId {
  if (setting !== "system") return setting;
  return system === "dark" ? "night" : "light";
}
