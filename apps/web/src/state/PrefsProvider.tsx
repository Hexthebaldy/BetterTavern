/**
 * 界面偏好（state/prefs.ts）：打开页面时从 localStorage 同步读出，改了立刻写回。
 * 别的标签页改了（外观、快捷键开关）这里跟着变。用 usePrefs() 取。
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { ReadingPrefs } from "@bettertavern/core/play/reading";
import type { ThemeSetting } from "@bettertavern/design/themes";

import { localStore } from "../storage/local.ts";
import { parsePrefs, PREFS_KEY, type LibraryView, type WebPrefs } from "./prefs.ts";

type PrefsValue = WebPrefs & {
  setReading: (reading: ReadingPrefs) => void;
  setTheme: (theme: ThemeSetting) => void;
  setLibraryView: (view: LibraryView) => void;
  setWorldDocked: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSingleKeys: (enabled: boolean) => void;
};

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<WebPrefs>(() => parsePrefs(localStore.read(PREFS_KEY)));

  useEffect(() => {
    localStore.write(PREFS_KEY, prefs);
  }, [prefs]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === PREFS_KEY) setPrefs(parsePrefs(localStore.read(PREFS_KEY)));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<PrefsValue>(() => {
    const set = (change: Partial<WebPrefs>): void => setPrefs((current) => ({ ...current, ...change }));
    return {
      ...prefs,
      setReading: (reading) => set({ reading }),
      setTheme: (theme) => set({ theme }),
      setLibraryView: (libraryView) => set({ libraryView }),
      setWorldDocked: (worldDocked) => set({ worldDocked }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSingleKeys: (singleKeys) => set({ singleKeys }),
    };
  }, [prefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const value = useContext(PrefsContext);
  if (!value) throw new Error("usePrefs 必须在 PrefsProvider 里使用");
  return value;
}
