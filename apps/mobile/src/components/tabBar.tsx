/**
 * 标签页的导航（漫画风，docs/design/comic/mobile/README.md 的“Tab 栏”、tablet/README.md 的“左侧导航栏”）。
 *
 * - 手机、中屏：浮在内容上的 Tab 栏，离左右 20、离底 tabBarBottom()，高 64；白底 2.5 墨线，圆角 32，墨色投影 4。
 *   中屏固定宽 460、水平居中。4 块：存档、库、工作台、设置。
 * - 宽屏（≥ 900）：左侧竖着的导航栏，离左 16，宽 76，圆角 38，上下居中，高度随内容；6 块：存档、剧本、角色、
 *   工作台、模型、设置（都指向现有的 4 个页面，靠参数区分，见 navItems.ts）。不放 Logo。
 * 选中的一块不加胶囊、不加底色：图标换成实心的（主体填蓝），字变成墨色、字重 800；没选中是墨灰图标、灰字、字重 500。
 * 一块 64 高，图标 26 在上，字 11.5 在下。
 */

import type { BottomTabBarProps } from "expo-router/tabs";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { bottomBar, rail } from "@bettertavern/design/layout";

import { useLayout } from "../hooks/useLayout.ts";
import { comicDepth, comicRadius, comicStroke, hardShadow, size, space, useComic } from "../theme/index.ts";
import { tabBarBottom } from "./bars.tsx";
import { FilledIcon, Icon } from "./icons.tsx";
import { activeItem, RAIL_ITEMS, railTarget, TAB_ITEMS, type NavItem } from "./navItems.ts";

const ITEM_HEIGHT = 64;
/** 窗口很矮（台前调度）放不下时，每块压到这么高；再放不下就让导航栏自己滚动 */
const ITEM_HEIGHT_TIGHT = 52;
const RAIL_PADDING = 10;

function Item({
  item,
  label,
  focused,
  onPress,
  height,
  vertical,
}: {
  item: NavItem;
  label: string;
  focused: boolean;
  onPress: () => void;
  height: number;
  /** 竖着的侧栏：每块按 height 排；横着的 Tab 栏：平分宽度 */
  vertical?: boolean;
}) {
  const c = useComic();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.item, vertical ? null : styles.itemRow, { height }]}
    >
      {focused ? <FilledIcon name={item.icon} size={26} /> : <Icon name={item.icon} size={26} color={c.iconMut} />}
      <Text
        numberOfLines={1}
        style={[styles.label, { color: focused ? c.ink : c.mut, fontWeight: focused ? "800" : "500" }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useComic();
  const { t } = useTranslation();
  const { size: sizeClass, width, height } = useLayout();
  const vertical = sizeClass === "expanded";
  const current = state.routes[state.index];
  const route = current?.name ?? "";
  const params = current?.params as Readonly<Record<string, unknown>> | undefined;
  const items = vertical ? RAIL_ITEMS : TAB_ITEMS;
  const active = activeItem(items, route, params);

  const press = (item: NavItem): void => {
    const target = state.routes.find((r) => r.name === item.route);
    const event = target
      ? navigation.emit({ type: "tabPress", target: target.key, canPreventDefault: true })
      : null;
    if (event?.defaultPrevented) return;
    if (vertical) {
      const next = railTarget(item, route, params);
      if (next) navigation.navigate(next.route, next.params);
    } else if (item.route !== route) {
      navigation.navigate(item.route, target?.params);
    }
  };

  const frame: ViewStyle = {
    backgroundColor: c.paper,
    borderColor: c.ink,
    boxShadow: hardShadow(c.ink, comicDepth.raised),
  };

  if (vertical) {
    const room = height - insets.top - space.l * 2;
    const tight = items.length * ITEM_HEIGHT + RAIL_PADDING * 2 > room;
    const itemHeight = tight ? ITEM_HEIGHT_TIGHT : ITEM_HEIGHT;
    const scrolls = items.length * itemHeight + RAIL_PADDING * 2 > room;
    const list = items.map((item) => (
      <Item
        key={item.key}
        item={item}
        label={t(item.label)}
        focused={item.key === active}
        onPress={() => press(item)}
        height={itemHeight}
        vertical
      />
    ));
    return (
      <View
        pointerEvents="box-none"
        style={[styles.railHost, { top: insets.top + space.l, bottom: space.l }]}
      >
        <View accessibilityRole="tablist" style={[styles.rail, frame, scrolls ? { flexShrink: 1 } : null]}>
          {scrolls ? <ScrollView showsVerticalScrollIndicator={false}>{list}</ScrollView> : list}
        </View>
      </View>
    );
  }

  const place: StyleProp<ViewStyle> = [
    styles.tabs,
    frame,
    { bottom: tabBarBottom(insets.bottom) },
    sizeClass === "medium"
      ? { left: (width - bottomBar.width) / 2, right: undefined, width: bottomBar.width }
      : null,
  ];
  return (
    <View accessibilityRole="tablist" style={place}>
      {items.map((item) => (
        <Item
          key={item.key}
          item={item}
          label={t(item.label)}
          focused={item.key === active}
          onPress={() => press(item)}
          height={ITEM_HEIGHT - comicStroke.frame * 2}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    position: "absolute",
    left: 20,
    right: 20,
    height: size.tabBar,
    borderRadius: comicRadius.tabBar,
    borderWidth: comicStroke.frame,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  item: { alignItems: "center", justifyContent: "center", gap: 3 },
  /** 横排时平分宽度（竖排不能用 flex: 1：侧栏的高度跟着内容走，flex: 1 会把每块压成 0 高） */
  itemRow: { flex: 1 },
  label: { fontSize: 11.5, lineHeight: 14 },
  railHost: { position: "absolute", left: rail.left, width: rail.width, justifyContent: "center" },
  rail: {
    width: rail.width,
    borderRadius: rail.width / 2,
    borderWidth: comicStroke.frame,
    paddingVertical: RAIL_PADDING,
  },
});
