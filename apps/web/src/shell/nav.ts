/**
 * 侧栏的导航项，分两组：创作（存档、剧本、角色、工作台）和连接（模型、外部服务）。
 * 剧本详情算在“剧本”下，角色卡详情算在“角色”下，草稿算在“工作台”下，模型详情算在“模型”下。
 * 设置、账户不在侧栏里，从最下面的头像弹出的小窗进入。
 */

import type { IconName } from "@bettertavern/design/icons";

/** name 是 i18n 资源里 nav.<name> 的名字 */
export type NavItem = {
  to: string;
  name: "saves" | "scenarios" | "characters" | "workbench" | "models" | "tools";
  icon: IconName;
  prefixes: string[];
  group: "create" | "connect";
};

export const NAV_ITEMS: NavItem[] = [
  { to: "/playthroughs", name: "saves", icon: "story", prefixes: ["/playthroughs"], group: "create" },
  {
    to: "/scenarios",
    name: "scenarios",
    icon: "library",
    prefixes: ["/scenarios", "/scenario"],
    group: "create",
  },
  {
    to: "/characters",
    name: "characters",
    icon: "person",
    prefixes: ["/characters", "/card"],
    group: "create",
  },
  { to: "/workbench", name: "workbench", icon: "workbench", prefixes: ["/workbench"], group: "create" },
  { to: "/models", name: "models", icon: "key", prefixes: ["/models"], group: "connect" },
  { to: "/tools", name: "tools", icon: "world", prefixes: ["/tools"], group: "connect" },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 当前打开的故事（阅读页的地址 /play/:id） */
export function openStoryId(pathname: string): string | null {
  const match = /^\/play\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
