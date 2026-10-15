/**
 * 存在设备上的界面偏好：最近用过的服务器、阅读设置、剧本库用网格还是列表、外观（主题）、
 * 平板阅读页的世界状态停靠面板开着还是收着（所有故事共用）。用 usePrefs() 取。
 * 读取失败或内容不对时用默认值；写入失败只影响下次打开，不打断操作。
 * loaded 表示已经读过存储：根布局等它再收起启动画面，免得先按系统深浅画一帧再跳到用户选的主题。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_READING, parseReadingPrefs, type ReadingPrefs } from "@bettertavern/core/play/reading";

import {
  markServerFailed,
  parseRecentServers,
  rememberServer,
  type RecentServer,
} from "../features/settings/servers.ts";
import { loadPrefs, savePrefs } from "../storage/secure.ts";
import { parseThemeSetting, type ThemeSetting } from "../theme/index.ts";

export type LibraryView = "grid" | "list";

type Stored = {
  servers: RecentServer[];
  reading: ReadingPrefs;
  libraryView: LibraryView;
  theme: ThemeSetting;
  /** 平板阅读页够宽（≥ 1100）时，世界状态停靠在右侧：开着还是收着 */
  worldDocked: boolean;
};

const DEFAULTS: Stored = {
  servers: [],
  reading: DEFAULT_READING,
  libraryView: "grid",
  theme: "system",
  worldDocked: false,
};

/** 存储读得太慢（几乎不会）也不能一直挡着启动画面 */
const LOAD_TIMEOUT_MS = 1500;

function parse(raw: unknown): Stored {
  if (typeof raw !== "object" || raw === null) return DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    servers: parseRecentServers(r.servers),
    reading: parseReadingPrefs(r.reading),
    libraryView: r.libraryView === "list" ? "list" : "grid",
    theme: parseThemeSetting(r.theme),
    worldDocked: r.worldDocked === true,
  };
}

type PrefsValue = Stored & {
  /** 已经读过存储（或者等超时了） */
  loaded: boolean;
  setReading: (reading: ReadingPrefs) => void;
  setTheme: (theme: ThemeSetting) => void;
  setLibraryView: (view: LibraryView) => void;
  setWorldDocked: (open: boolean) => void;
  /** 这个服务器刚用成功过 */
  serverUsed: (url: string) => void;
  /** 这个服务器刚才连不上 */
  serverFailed: (url: string) => void;
};

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Stored>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => setLoaded(true), LOAD_TIMEOUT_MS);
    void loadPrefs().then((raw) => {
      if (!alive) return;
      // 读取期间已经改过的值优先（极少见：启动后立刻登录）
      setPrefs((current) => (current === DEFAULTS ? parse(raw) : current));
      setLoaded(true);
      clearTimeout(timer);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const update = useCallback((change: (current: Stored) => Stored) => {
    setPrefs((current) => {
      const next = change(current);
      void savePrefs(next).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo<PrefsValue>(
    () => ({
      ...prefs,
      loaded,
      setReading: (reading) => update((p) => ({ ...p, reading })),
      setTheme: (theme) => update((p) => ({ ...p, theme })),
      setLibraryView: (libraryView) => update((p) => ({ ...p, libraryView })),
      setWorldDocked: (worldDocked) => update((p) => ({ ...p, worldDocked })),
      serverUsed: (url) => update((p) => ({ ...p, servers: rememberServer(p.servers, url, new Date()) })),
      serverFailed: (url) => update((p) => ({ ...p, servers: markServerFailed(p.servers, url, new Date()) })),
    }),
    [prefs, loaded, update],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const value = useContext(PrefsContext);
  if (!value) throw new Error("usePrefs 必须在 PrefsProvider 里使用");
  return value;
}
