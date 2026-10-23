/**
 * 一级导航的六项，也是轮盘上的六块（从正上方开始顺时针）：存档、剧本、角色、工作台、模型、设置。
 * 剧本详情算在“剧本”下，角色卡详情算在“角色”下，草稿算在“工作台”下，模型详情算在“模型”下，
 * 外部服务（/settings/tools）和连接测试（/dev/probe）算在“设置”下。
 * 窄于 900 时是底部 Tab 栏：前四项（tab）放在栏里，模型和设置从“更多”进。
 */

import type { IconName } from "@bettertavern/design/icons";

/** name 是 i18n 资源里 nav.<name> 的名字 */
export type NavItem = {
  to: string;
  name: "saves" | "scenarios" | "characters" | "workbench" | "models" | "settings";
  icon: IconName;
  prefixes: string[];
  /** 窄屏底部 Tab 栏里有没有这一项（没有的从“更多”进） */
  tab: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/playthroughs", name: "saves", icon: "play", prefixes: ["/playthroughs"], tab: true },
  { to: "/scenarios", name: "scenarios", icon: "library", prefixes: ["/scenarios", "/scenario"], tab: true },
  { to: "/characters", name: "characters", icon: "person", prefixes: ["/characters", "/card"], tab: true },
  { to: "/workbench", name: "workbench", icon: "workbench", prefixes: ["/workbench"], tab: true },
  { to: "/models", name: "models", icon: "key", prefixes: ["/models"], tab: false },
  { to: "/settings", name: "settings", icon: "settings", prefixes: ["/settings", "/dev"], tab: false },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 当前页在第几项（阅读页这类不属于任何一项的返回 null） */
export function activeIndex(pathname: string): number | null {
  const index = NAV_ITEMS.findIndex((item) => isActive(item, pathname));
  return index >= 0 ? index : null;
}

/** 当前打开的故事（阅读页的地址 /play/:id） */
export function openStoryId(pathname: string): string | null {
  const match = /^\/play\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
