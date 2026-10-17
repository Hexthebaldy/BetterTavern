/** 一级导航的三项。剧本详情算在“剧本”下，设置的子页和连接测试算在“设置”下 */

import type { IconName } from "@bettertavern/design/icons";

export type NavItem = { to: string; label: string; icon: IconName; prefixes: string[] };

export const NAV_ITEMS: NavItem[] = [
  { to: "/playthroughs", label: "存档", icon: "story", prefixes: ["/playthroughs"] },
  { to: "/library", label: "剧本", icon: "library", prefixes: ["/library", "/scenario"] },
  { to: "/settings", label: "设置", icon: "settings", prefixes: ["/settings", "/dev"] },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 当前打开的故事（阅读页的地址 /play/:id） */
export function openStoryId(pathname: string): string | null {
  const match = /^\/play\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
