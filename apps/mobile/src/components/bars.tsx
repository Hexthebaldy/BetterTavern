/**
 * 页头与导航：一级页的大标题、二级页的导航栏和返回栏、浮动的胶囊标签栏。页面经 ui.tsx 引用。
 *
 * 一级页：大标题下面不画线，右侧放一个计数胶囊或圆形主操作按钮。
 * 二级页：40 的灰色圆形返回按钮和居中标题；也可以只有返回按钮，大标题写在内容里。
 * 标签栏是一条离开屏幕边缘的胶囊（高 64，左右 20），浮在内容上面；标签页的内容底部要用
 * useTabBarSpace() 留出它的位置，提示浮条贴在它上方（tabBarTop）。
 */

import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useRef, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { font, size, space, type, usePalette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";
import { IconButton } from "./primitives.tsx";

/**
 * 标签栏离屏幕底边的距离。有 Home 指示条的机型按设计稿放在 28（指示条上方，不挡手势）；
 * 安全区更高的设备跟着抬高；没有安全区的设备离底 16。
 */
export function tabBarBottom(insetBottom: number): number {
  return insetBottom > 0 ? Math.max(insetBottom - 6, 16) : 16;
}

/** 标签栏顶边离屏幕底边的距离：提示浮条等浮层贴在它上方 */
export function tabBarTop(insetBottom: number): number {
  return tabBarBottom(insetBottom) + size.tabBar;
}

/** 标签页的列表底部要留出的空白，最后一项不被标签栏挡住 */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return tabBarTop(insets.bottom) + space.l;
}

/** 一级页大标题：故事 / 剧本 / 设置 */
export function LargeHeader({
  title,
  count,
  children,
}: {
  title: string;
  /** 右侧的计数胶囊；null 表示还不知道（显示一道横线） */
  count?: number | null;
  /** 右侧的操作 */
  children?: ReactNode;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.large, { paddingTop: insets.top + space.m }]}>
      <Text accessibilityRole="header" style={[type.display, { color: palette.ink, flex: 1 }]}>
        {title}
      </Text>
      {count !== undefined ? (
        <View style={[styles.count, { backgroundColor: palette.bg2 }]}>
          <Text
            accessibilityLabel={count === null ? undefined : `${count} 个`}
            style={{ fontFamily: font.mono, fontSize: 13, color: palette.ink2 }}
          >
            {count === null ? "–" : String(count)}
          </Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** 二级页导航栏：灰色圆形返回按钮、居中标题、右侧最多两个灰色圆按钮 */
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
    <View style={[styles.nav, { paddingTop: insets.top + space.xs, backgroundColor: palette.bg }, style]}>
      <View style={styles.navSide}>
        <IconButton icon="back" label="返回" onPress={onBack ?? (() => router.back())} />
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

/** 只有返回按钮的页头，大标题写在内容里 */
export function BackBar({ onBack, right }: { onBack?: () => void; right?: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.back, { paddingTop: insets.top + space.s, backgroundColor: palette.bg }]}>
      <IconButton icon="back" label="返回" diameter={size.touch} onPress={onBack ?? (() => router.back())} />
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

/** 切换标签时淡入淡出的时长：标签栏的胶囊和页面（app/(tabs)/_layout.tsx）共用 */
export const TAB_FADE_MS = 220;

/**
 * 标签栏的一格：未选中的样子（图标在上、文字在下）和选中的黑色胶囊叠在一起，
 * 切换时一个淡出、一个淡入，胶囊同时从 92% 放大到原大
 */
function TabItem({
  label,
  icon,
  focused,
  onPress,
}: {
  label: string;
  icon: IconName;
  focused: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: focused ? 1 : 0,
      duration: TAB_FADE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focused, progress]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tabSlot}
    >
      <Animated.View
        style={[
          styles.tabIdle,
          { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
        ]}
      >
        <Icon name={icon} size={22} color={palette.mut} />
        <Text style={[type.tab, { color: palette.mut }]}>{label}</Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.tabActive,
          {
            backgroundColor: palette.ink,
            opacity: progress,
            transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          },
        ]}
      >
        <Icon name={icon} size={22} color={palette.bg} />
        <Text style={{ fontSize: 14, fontWeight: "500", color: palette.bg }}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

/** 浮动的胶囊标签栏：选中项展开成黑色小胶囊，图标和文字横排；未选中项图标在上、文字在下 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.tabs,
        {
          bottom: tabBarBottom(insets.bottom),
          backgroundColor: palette.card,
          boxShadow: palette.shadowFloat,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const options = descriptors[route.key]?.options;
        const label = options?.title ?? route.name;
        const icon = TAB_ICONS[route.name] ?? "story";
        const onPress = (): void => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return <TabItem key={route.key} label={label} icon={icon} focused={focused} onPress={onPress} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  large: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingLeft: space.page,
    paddingRight: space.l,
    paddingBottom: space.m,
  },
  count: {
    height: 32,
    minWidth: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: space.xs,
  },
  nav: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: space.s },
  navSide: { width: 86, flexDirection: "row", alignItems: "center", gap: 6 },
  navTitle: { flex: 1, textAlign: "center", ...type.navTitle },
  back: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.l },
  tabs: {
    position: "absolute",
    left: 20,
    right: 20,
    height: size.tabBar,
    borderRadius: size.tabBar / 2,
    paddingHorizontal: space.s,
    flexDirection: "row",
    alignItems: "center",
  },
  tabSlot: { flex: 1, height: size.tabBar, alignItems: "center", justifyContent: "center" },
  tabActive: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: size.tabActive,
    paddingLeft: 24,
    paddingRight: 24,
    borderRadius: size.tabActive,
  },
  tabIdle: { alignItems: "center", gap: 2 },
});
