/**
 * 当前主题的上下文。根布局按用户的外观设置包一层 ThemeProvider，页面用 usePalette() / useIsDark() 取值。
 *
 * 选了固定主题时用 Appearance.setColorScheme() 覆盖系统的深浅，键盘、系统弹窗、状态栏跟着 App 走；
 * 跟随系统时清掉覆盖。覆盖期间 useColorScheme() 返回的是覆盖后的值，所以只在“跟随系统”时才看它。
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";

import type { Palette } from "./palettes.ts";
import { resolveTheme, THEMES, type ThemeDef, type ThemeSetting } from "./themes.ts";

const ThemeContext = createContext<ThemeDef | null>(null);

export function ThemeProvider({ setting, children }: { setting: ThemeSetting; children: ReactNode }) {
  const system = useColorScheme();
  const theme = THEMES[resolveTheme(setting, system)];

  useEffect(() => {
    Appearance.setColorScheme(setting === "system" ? "unspecified" : theme.scheme);
  }, [setting, theme.scheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** 当前主题；在 ThemeProvider 外面（启动早期）按系统深浅取 */
export function useTheme(): ThemeDef {
  const theme = useContext(ThemeContext);
  const system = useColorScheme();
  return theme ?? THEMES[resolveTheme("system", system)];
}

export function usePalette(): Palette {
  return useTheme().palette;
}

/** 当前主题是不是深色基调 */
export function useIsDark(): boolean {
  return useTheme().scheme === "dark";
}
