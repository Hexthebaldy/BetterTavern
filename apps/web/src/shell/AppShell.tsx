/**
 * 登录后的外壳：左边的侧栏或导航条（窄于 900 时是底部 Tab 栏），右边是页面。
 *
 * 形态由 theme/layout.ts 的 navMode(窗口宽度, 用户收起了侧栏) 决定，拖动窗口时即时切换，页面不卸载。
 * 窄于 1280 时“展开”打开的侧栏盖在内容上（带遮罩），点遮罩、按 Esc、点了侧栏里的一项都会收回。
 * 阅读页打开世界、侧栏放不下时，用 useNavOverride 临时收成导航条（用户的“收起”设置不变）。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { Outlet, useLocation } from "react-router";

import { useWindowWidth } from "../hooks/useWindowSize.ts";
import { ImportProvider } from "../import/ImportProvider.tsx";
import { OverlayProvider } from "../overlay/OverlayProvider.tsx";
import { ShortcutsDialog } from "../overlay/ShortcutsDialog.tsx";
import { TooltipLayer } from "../overlay/Tooltip.tsx";
import { usePrefs } from "../state/PrefsProvider.tsx";
import {
  acceptsSingleKey,
  desktop,
  navMode,
  navWidth,
  sidebarOverlays,
  type NavMode,
} from "../theme/layout.ts";
import { Rail } from "./Rail.tsx";
import styles from "./shell.module.css";
import { Sidebar } from "./Sidebar.tsx";
import { TabBar } from "./TabBar.tsx";

type ShellValue = {
  /** 这一刻实际画出来的导航 */
  nav: NavMode;
  /** 展开或收起侧栏（快捷键 [、按钮）；< 900 时什么都不做 */
  toggleSidebar: () => void;
  /** 页面临时指定导航形态（阅读页）；null 表示按用户设置 */
  setNavOverride: (mode: NavMode | null) => void;
};

const ShellContext = createContext<ShellValue | null>(null);

const TOP_LEVEL = new Set(["/playthroughs", "/library", "/settings"]);

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside AppShell");
  return value;
}

export function AppShell() {
  const width = useWindowWidth();
  const { sidebarCollapsed, setSidebarCollapsed, singleKeys } = usePrefs();
  const [shortcuts, setShortcuts] = useState(false);
  const [override, setNavOverride] = useState<NavMode | null>(null);
  const [overlay, setOverlay] = useState(false);
  const { pathname } = useLocation();
  const preferred = navMode(width, sidebarCollapsed);
  const nav = override ?? preferred;
  const showOverlay = overlay && nav === "rail";
  // 和 App 一样：底部 Tab 栏只在三个一级页上，进了阅读页、剧本详情、设置子页就收起（它们有自己的返回）
  const topLevel = TOP_LEVEL.has(pathname);

  // 点了侧栏里的一项（换了页面）就收回盖在上面的侧栏
  useEffect(() => setOverlay(false), [pathname]);

  useEffect(() => {
    if (!showOverlay) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOverlay(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showOverlay]);

  const toggleSidebar = useCallback(() => {
    if (width < desktop.rail) return;
    if (nav === "sidebar") {
      setSidebarCollapsed(true);
      return;
    }
    // 窄屏，或者是页面临时收起的：盖在上面；宽屏用户自己收起的：展开回来
    if (sidebarOverlays(width) || override !== null) setOverlay((open) => !open);
    else setSidebarCollapsed(false);
  }, [width, nav, override, setSidebarCollapsed]);

  // 任何页面都有的快捷键：? 打开快捷键一览，[ 展开或收起侧栏（阅读页自己的 A–D、/、W、End 在 PlayPage）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const single = acceptsSingleKey({
        enabled: singleKeys,
        typing,
        composing: event.isComposing,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
      });
      if (!single) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcuts(true);
      } else if (event.key === "[") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    const open = (): void => setShortcuts(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("bt:shortcuts", open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("bt:shortcuts", open);
    };
  }, [singleKeys, toggleSidebar]);

  const value = useMemo<ShellValue>(() => ({ nav, toggleSidebar, setNavOverride }), [nav, toggleSidebar]);
  const frame = { "--nav-width": `${navWidth(nav)}px` } as CSSProperties;

  return (
    <ShellContext.Provider value={value}>
      <div className={styles.shell} data-nav={nav} data-top={topLevel || undefined} style={frame}>
        <OverlayProvider>
          <ImportProvider>
            {nav === "sidebar" ? <Sidebar onCollapse={toggleSidebar} /> : null}
            {nav === "rail" ? <Rail onExpand={toggleSidebar} /> : null}
            {showOverlay ? (
              <>
                <div className={styles.scrim} onClick={() => setOverlay(false)} aria-hidden="true" />
                <Sidebar overlay onCollapse={() => setOverlay(false)} />
              </>
            ) : null}
            <main className={styles.main} id="main">
              <Outlet />
            </main>
            {nav === "tabbar" && topLevel ? <TabBar /> : null}
            {shortcuts ? <ShortcutsDialog onClose={() => setShortcuts(false)} /> : null}
            <TooltipLayer />
          </ImportProvider>
        </OverlayProvider>
      </div>
    </ShellContext.Provider>
  );
}
