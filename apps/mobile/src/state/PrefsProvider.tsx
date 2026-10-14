/**
 * 存在设备上的界面偏好：最近用过的服务器、阅读设置、剧本库用网格还是列表。用 usePrefs() 取。
 * 读取失败或内容不对时用默认值；写入失败只影响下次打开，不打断操作。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_READING, parseReadingPrefs, type ReadingPrefs } from "../features/play/reading.ts";
import {
  markServerFailed,
  parseRecentServers,
  rememberServer,
  type RecentServer,
} from "../features/settings/servers.ts";
import { loadPrefs, savePrefs } from "../storage/secure.ts";

export type LibraryView = "grid" | "list";

type Stored = { servers: RecentServer[]; reading: ReadingPrefs; libraryView: LibraryView };

const DEFAULTS: Stored = { servers: [], reading: DEFAULT_READING, libraryView: "grid" };

function parse(raw: unknown): Stored {
  if (typeof raw !== "object" || raw === null) return DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    servers: parseRecentServers(r.servers),
    reading: parseReadingPrefs(r.reading),
    libraryView: r.libraryView === "list" ? "list" : "grid",
  };
}

type PrefsValue = Stored & {
  setReading: (reading: ReadingPrefs) => void;
  setLibraryView: (view: LibraryView) => void;
  /** 这个服务器刚用成功过 */
  serverUsed: (url: string) => void;
  /** 这个服务器刚才连不上 */
  serverFailed: (url: string) => void;
};

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Stored>(DEFAULTS);

  useEffect(() => {
    let alive = true;
    void loadPrefs().then((raw) => {
      if (!alive) return;
      // 读取期间已经改过的值优先（极少见：启动后立刻登录）
      setPrefs((current) => (current === DEFAULTS ? parse(raw) : current));
    });
    return () => {
      alive = false;
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
      setReading: (reading) => update((p) => ({ ...p, reading })),
      setLibraryView: (libraryView) => update((p) => ({ ...p, libraryView })),
      serverUsed: (url) => update((p) => ({ ...p, servers: rememberServer(p.servers, url, new Date()) })),
      serverFailed: (url) => update((p) => ({ ...p, servers: markServerFailed(p.servers, url, new Date()) })),
    }),
    [prefs, update],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const value = useContext(PrefsContext);
  if (!value) throw new Error("usePrefs 必须在 PrefsProvider 里使用");
  return value;
}
