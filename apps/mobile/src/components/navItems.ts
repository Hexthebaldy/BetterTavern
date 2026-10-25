/**
 * 导航的几块（docs/design/comic/tablet/README.md 的“左侧导航栏”）：每块去哪个标签页、带什么参数、什么时候算选中。
 *
 * 手机和中屏是底部 4 块，按 4 个标签页的路由画；宽屏的左侧导航栏是 6 块，都指向现有的 4 个页面，不加新页面：
 * “剧本”和“角色”都是库（角色带 tab=cards，世界书 tab=lorebooks 也算“角色”），“模型”和“设置”都是设置页（模型带 section=models）。
 * 同一个页面的两块靠参数区分，所以点的时候要比较参数（railTarget），不同就带着新参数再导航一次。
 *
 * 纯数据和纯函数，不依赖 React Native，用 node --test 测。
 */

import type { FilledIconName } from "@bettertavern/design/icons";

export type TabRoute = "playthroughs" | "library" | "workbench" | "settings";

/** 界面文字的键（packages/core 的 shell 资源） */
export type NavLabel =
  | "nav.saves"
  | "nav.library"
  | "nav.workbench"
  | "nav.settings"
  | "nav.scenarios"
  | "nav.characters"
  | "nav.models";

/** 导航参数：值为 undefined 表示清掉这个参数 */
export type NavParams = Record<string, string | undefined>;

export type NavItem = {
  key: string;
  route: TabRoute;
  params: NavParams;
  /** 图标（选中时画实心版） */
  icon: FilledIconName;
  label: NavLabel;
  /** 这几组参数也算这一块（“角色”里的世界书） */
  aliases?: NavParams[];
};

/** 底部 Tab 栏的 4 块 */
export const TAB_ITEMS: NavItem[] = [
  { key: "saves", route: "playthroughs", params: {}, icon: "story", label: "nav.saves" },
  { key: "library", route: "library", params: {}, icon: "library", label: "nav.library" },
  { key: "workbench", route: "workbench", params: {}, icon: "workbench", label: "nav.workbench" },
  { key: "settings", route: "settings", params: {}, icon: "settings", label: "nav.settings" },
];

/** 宽屏左侧导航栏的 6 块 */
export const RAIL_ITEMS: NavItem[] = [
  { key: "saves", route: "playthroughs", params: {}, icon: "story", label: "nav.saves" },
  { key: "scenarios", route: "library", params: { tab: undefined }, icon: "card", label: "nav.scenarios" },
  {
    key: "characters",
    route: "library",
    params: { tab: "cards" },
    aliases: [{ tab: "lorebooks" }],
    icon: "library",
    label: "nav.characters",
  },
  { key: "workbench", route: "workbench", params: {}, icon: "workbench", label: "nav.workbench" },
  { key: "models", route: "settings", params: { section: "models" }, icon: "director", label: "nav.models" },
  { key: "settings", route: "settings", params: { section: undefined }, icon: "settings", label: "nav.settings" },
];

function paramOf(params: Readonly<Record<string, unknown>> | undefined, name: string): string | undefined {
  const value = params?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 一块的参数和当前页面的参数对得上（这一块写到的参数都相同；没写到的不管） */
function matches(item: NavItem, params: Readonly<Record<string, unknown>> | undefined): boolean {
  return [item.params, ...(item.aliases ?? [])].some((wanted) =>
    Object.entries(wanted).every(([name, value]) => paramOf(params, name) === value),
  );
}

/** 现在选中哪一块：当前标签页的路由名和参数；不在这几页里返回 null */
export function activeItem(
  items: NavItem[],
  route: string,
  params: Readonly<Record<string, unknown>> | undefined,
): string | null {
  const candidates = items.filter((item) => item.route === route);
  return (candidates.find((item) => matches(item, params)) ?? candidates[0])?.key ?? null;
}

/**
 * 点了一块以后要不要导航、带什么参数：已经在这个页面而且参数对得上就不动（null）；
 * 否则导航到它的路由，带上它的参数（undefined 的参数会把旧值清掉）。
 */
export function railTarget(
  item: NavItem,
  route: string,
  params: Readonly<Record<string, unknown>> | undefined,
): { route: TabRoute; params: NavParams } | null {
  if (item.route === route && matches(item, params)) return null;
  return { route: item.route, params: item.params };
}
