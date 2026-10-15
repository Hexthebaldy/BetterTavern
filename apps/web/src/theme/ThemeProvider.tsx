/**
 * 当前主题：用户的外观设置（跟随系统 / 浅色 / 夜间）加上系统的深浅（prefers-color-scheme）。
 * 把色板写到 <html> 上（CSS 变量），设 data-scheme，并记下启动脚本要用的深浅（index.html）。
 */

import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";

import { resolveTheme, THEMES, type Scheme, type ThemeDef } from "@bettertavern/design/themes";

import { bootScheme, SCHEME_KEY } from "../state/prefs.ts";
import { usePrefs } from "../state/PrefsProvider.tsx";
import { localStore } from "../storage/local.ts";
import { paletteVars } from "./palette.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribe(listener: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function useSystemScheme(): Scheme {
  return useSyncExternalStore(subscribe, () => (window.matchMedia(DARK_QUERY).matches ? "dark" : "light"));
}

const ThemeContext = createContext<ThemeDef>(THEMES.light);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = usePrefs();
  const system = useSystemScheme();
  const current = THEMES[resolveTheme(theme, system)];

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.scheme = current.scheme;
    for (const [name, value] of Object.entries(paletteVars(current.palette)))
      root.style.setProperty(name, value);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", current.palette.bg);
    localStore.write(SCHEME_KEY, bootScheme(theme));
  }, [current, theme]);

  return <ThemeContext.Provider value={current}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeDef {
  return useContext(ThemeContext);
}
