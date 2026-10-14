/**
 * 页头与导航：一级页的大标题、二级页的导航栏和返回栏、底部标签栏。页面经 ui.tsx 引用。
 *
 * 一级页：大标题压一道 1px 黑线，右侧放等宽数字计数或操作。
 * 二级页：返回箭头和居中标题，标题下一条浅线；也可以只有返回箭头，大标题写在内容里。
 */

import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { font, size, space, type, usePalette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";
import { IconButton } from "./primitives.tsx";

/** 一级页大标题：故事 / 剧本 / 设置 */
export function LargeHeader({
  title,
  count,
  children,
}: {
  title: string;
  /** 右侧的等宽计数；null 表示还不知道（显示一道横线） */
  count?: number | null;
  /** 右侧的操作 */
  children?: ReactNode;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.large, { paddingTop: insets.top + space.l, borderBottomColor: palette.ink }]}>
      <Text accessibilityRole="header" style={[type.display, { color: palette.ink, flex: 1 }]}>
        {title}
      </Text>
      {count !== undefined ? (
        <Text
          accessibilityLabel={count === null ? undefined : `${count} 个`}
          style={[styles.count, { color: palette.mut }]}
        >
          {count === null ? "——" : String(count).padStart(2, "0")}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** 二级页导航栏：返回、居中标题、右侧最多两个图标按钮 */
export function NavBar({
  title,
  actions,
  onBack,
  style,
}: {
  title: string;
  actions?: { icon: IconName; label: string; onPress: () => void; badge?: boolean }[];
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={[
        styles.nav,
        { paddingTop: insets.top, borderBottomColor: palette.line, backgroundColor: palette.bg },
        style,
      ]}
    >
      <View style={styles.navSide}>
        <IconButton icon="back" label="返回" size={24} onPress={onBack ?? (() => router.back())} />
      </View>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.navTitle, { color: palette.ink }]}>
        {title}
      </Text>
      <View style={[styles.navSide, { justifyContent: "flex-end" }]}>
        {actions?.map((a) => (
          <IconButton key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} badge={a.badge} />
        ))}
      </View>
    </View>
  );
}

/** 只有返回箭头的页头，大标题写在内容里 */
export function BackBar({ onBack, right }: { onBack?: () => void; right?: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.back, { paddingTop: insets.top + space.m, backgroundColor: palette.bg }]}>
      <IconButton icon="back" label="返回" size={24} onPress={onBack ?? (() => router.back())} />
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

const TAB_ICONS: Record<string, IconName> = {
  playthroughs: "story",
  library: "library",
  settings: "settings",
};

/** 底部标签栏：选中项图标变实心、文字加粗，并在顶边加一道 2px 黑线 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.tabs,
        { paddingBottom: insets.bottom, borderTopColor: palette.line, backgroundColor: palette.bg },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const options = descriptors[route.key]?.options;
        const label = options?.title ?? route.name;
        const color = focused ? palette.ink : palette.mut;
        const onPress = (): void => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            style={styles.tab}
          >
            {focused ? <View style={[styles.tabMark, { backgroundColor: palette.ink }]} /> : null}
            <Icon name={TAB_ICONS[route.name] ?? "story"} size={24} color={color} solid={focused} />
            <Text style={[styles.tabLabel, { color, fontWeight: focused ? "700" : "400" }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  large: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.s,
    paddingLeft: space.page,
    paddingRight: space.l,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  count: { fontFamily: font.mono, fontSize: 13, lineHeight: 18, paddingBottom: 6, paddingRight: space.xs },
  nav: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, borderBottomWidth: 1 },
  navSide: { width: size.touch * 2, height: 52, flexDirection: "row", alignItems: "center" },
  navTitle: { flex: 1, textAlign: "center", fontSize: 15, lineHeight: 20, fontWeight: "700" },
  back: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10 },
  tabs: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, height: size.tabBar, alignItems: "center", justifyContent: "center", gap: 3 },
  tabMark: { position: "absolute", top: -1, left: "34%", right: "34%", height: 2 },
  tabLabel: { fontSize: 11, lineHeight: 14 },
});
