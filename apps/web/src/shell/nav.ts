/** 一级导航的三项。剧本详情算在“剧本”下，设置的子页和连接测试算在“设置”下 */

import type { IconName } from "@bettertavern/design/icons";

/** name 是 i18n 资源里 nav.<name> 的名字 */
export type NavItem = {
  to: string;
  name: "saves" | "library" | "settings";
  icon: IconName;
  prefixes: string[];
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/playthroughs", name: "saves", icon: "story", prefixes: ["/playthroughs"] },
  { to: "/library", name: "library", icon: "library", prefixes: ["/library", "/scenario"] },
  { to: "/settings", name: "settings", icon: "settings", prefixes: ["/settings", "/dev"] },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 点的就是当前这一页（不是它下面的子页）：不换页，滚回顶部 */
export function isCurrentPage(item: NavItem, pathname: string): boolean {
  return pathname === item.to || pathname === `${item.to}/`;
}

/** 平滑滚回页面顶部；系统要求减少动态效果时直接跳过去 */
export function scrollToTop(): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
}

/** 当前打开的故事（阅读页的地址 /play/:id） */
export function openStoryId(pathname: string): string | null {
  const match = /^\/play\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
