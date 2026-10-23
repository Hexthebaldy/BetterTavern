/**
 * 登录后的外壳：没有顶栏和侧栏。窗口 ≥ 900 时导航收进一只轮盘（NavWheel，docs/design/comic），浮在页面上；
 * 窄于 900 时是底部 Tab 栏（只在一级页上）和“更多”弹出的账户小窗。拖动窗口时即时切换，页面不卸载。
 *
 * 页面左右留边写成 CSS 变量（--page-left、--page-right），页面自己用：轮盘贴着哪一边，那一边留 112，另一边 40；
 * 轮盘没贴边（拖到中间）时两边都是 40，轮盘浮在内容上面。窄屏两边都是 24。
 */

import { useEffect, useState, type CSSProperties } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";

import { useWindowWidth } from "../hooks/useWindowSize.ts";
import { ImportProvider } from "../import/ImportProvider.tsx";
import { OverlayProvider } from "../overlay/OverlayProvider.tsx";
import { ShortcutsDialog } from "../overlay/ShortcutsDialog.tsx";
import { TooltipLayer } from "../overlay/Tooltip.tsx";
import { usePrefs } from "../state/PrefsProvider.tsx";
import { acceptsSingleKey, usesWheel } from "../theme/layout.ts";
import { pageInsets } from "../theme/wheel.ts";
import { NavWheel } from "./NavWheel.tsx";
import styles from "./shell.module.css";
import { TabBar } from "./TabBar.tsx";

/** 窄屏底部 Tab 栏只在这些一级页上（进了阅读页、剧本详情、草稿、设置子页就收起，它们有自己的返回） */
const TOP_LEVEL = new Set([
  "/playthroughs",
  "/scenarios",
  "/characters",
  "/workbench",
  "/models",
  "/settings",
]);

/** 窄屏的页面左右留边 */
const NARROW = 24;

export function AppShell() {
  const width = useWindowWidth();
  const { wheel, singleKeys } = usePrefs();
  const [shortcuts, setShortcuts] = useState(false);
  const { pathname } = useLocation();
  const withWheel = usesWheel(width);
  const topLevel = TOP_LEVEL.has(pathname);

  // 任何页面都有的快捷键：? 打开快捷键一览（轮盘的 Q、1–6 在 NavWheel，阅读页的 A–D、/、W、L、End 在 PlayPage）
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
      if (single && event.key === "?") {
        event.preventDefault();
        setShortcuts(true);
      }
    };
    const open = (): void => setShortcuts(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("bt:shortcuts", open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("bt:shortcuts", open);
    };
  }, [singleKeys]);

  const insets = withWheel ? pageInsets(wheel.dock) : { left: NARROW, right: NARROW };
  const frame = {
    "--page-left": `${insets.left}px`,
    "--page-right": `${insets.right}px`,
  } as CSSProperties;

  return (
    <div
      className={styles.shell}
      data-nav={withWheel ? "wheel" : "tabbar"}
      data-top={topLevel || undefined}
      style={frame}
    >
      <OverlayProvider>
        <ImportProvider>
          <main className={styles.main} id="main">
            <Outlet />
          </main>
          {/* 进新页面从顶上开始，前进、后退回到原来的位置 */}
          <ScrollRestoration />
          {withWheel ? <NavWheel /> : topLevel ? <TabBar /> : null}
          {shortcuts ? <ShortcutsDialog onClose={() => setShortcuts(false)} /> : null}
          <TooltipLayer />
        </ImportProvider>
      </OverlayProvider>
    </div>
  );
}
