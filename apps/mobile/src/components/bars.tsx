/**
 * 页头与导航：一级页的大标题、二级页的导航栏和返回栏、浮动的胶囊标签栏。页面经 ui.tsx 引用。
 *
 * 一级页：大标题下面不画线，右侧放一个计数胶囊或圆形主操作按钮。
 * 二级页：40 的灰色圆形返回按钮和居中标题；也可以只有返回按钮，大标题写在内容里。
 * 标签栏是一条离开屏幕边缘的胶囊（高 64，左右 20），浮在内容上面；标签页的内容底部要用
 * useTabBarSpace() 留出它的位置，提示浮条贴在它上方（tabBarTop）。
 *
 * 平板（断点见 theme/layout.ts）：中屏的胶囊固定宽 392、水平居中；宽屏改成左侧竖着的浮动导航栏
 * （Logo 加三个标签，选中项是 60×64 的玻璃框），一级页的内容从 x = 124 开始，底部不再留标签栏的位置。
 * 选中项是一块滑动的框，图标和文字是 tabOn 蓝；切换时框滑过去。
 * iOS 26 起有系统的液态玻璃（expo-glass-effect）：整条标签栏是一块玻璃（页面内容从下面透出来），选中框是另一块
 * 透明玻璃。没有液态玻璃时（Android、更早的 iOS）标签栏是白卡，选中框没有底色，一圈蓝色细描边加灰色投影。
 */

import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";

import { bottomBar, rail, tabInsets, type Insets } from "@bettertavern/design/layout";

import { useLayout } from "../hooks/useLayout.ts";
import { font, size, space, type, useIsDark, usePalette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Logo } from "./Logo.tsx";
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

/**
 * 标签页的内容要给导航让出的空间：手机和中屏让出底部的胶囊（最后一项不被挡住）；
 * 宽屏的导航栏在左边，left 是正文的起始 x，底部只留普通的页尾空白。
 */
export function useTabBarSpace(): { left: number; bottom: number } {
  const insets = useSafeAreaInsets();
  const { expanded } = useLayout();
  if (expanded) return { left: rail.contentLeft, bottom: insets.bottom + space.xxl };
  return { left: 0, bottom: tabBarTop(insets.bottom) + space.l };
}

/** 一级页大标题：存档 / 剧本 / 设置 */
export function LargeHeader({
  title,
  count,
  insets: frame,
  children,
}: {
  title: string;
  /** 右侧的计数胶囊；null 表示还不知道（显示一道横线） */
  count?: number | null;
  /** 平板上标题的左右留白（和内容对齐）；默认按一级页的留白（theme/layout.ts 的 tabInsets） */
  insets?: Insets;
  /** 右侧的操作 */
  children?: ReactNode;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { size } = useLayout();
  const sides = size === "compact" ? null : (frame ?? tabInsets(size));
  return (
    <View
      style={[
        styles.large,
        { paddingTop: insets.top + space.m },
        sides ? { paddingLeft: sides.left, paddingRight: sides.right } : null,
      ]}
    >
      {/* 手机上计数胶囊靠右；平板上紧跟在标题后面（设计稿 T03），右侧的操作仍然靠右 */}
      <Text
        accessibilityRole="header"
        style={[type.display, { color: palette.ink }, sides ? null : { flex: 1 }]}
      >
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
      {sides ? <View style={{ flex: 1 }} /> : null}
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

/** 选中项的玻璃框滑到新位置的时长：和页面交叉淡入淡出同时长 */
const SLIDE_MS = TAB_FADE_MS;

/**
 * 能不能用系统的液态玻璃：只有 iOS 26 起才有；某些 iOS 26 测试版没有这个接口，原生模块缺失时也当作没有。
 * 注意玻璃（GlassView）和它的上层都不能改 opacity，否则玻璃不画；这里玻璃框只改位置。
 */
const LIQUID_GLASS = ((): boolean => {
  if (Platform.OS !== "ios") return false;
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
})();

type SlotBox = { x: number; y: number; width: number; height: number };

/**
 * 标签栏的一格：未选中的样子（灰色，图标在上、文字在下）和选中的样子（蓝色 tabOn，图标和文字横排）叠在一起，
 * 切换时一个淡出、一个淡入，选中的样子同时从 92% 放大到原大。玻璃框不在这里画，由 TabBar 统一画一块滑过去。
 * 竖着的导航栏（宽屏）里选中的样子图标仍在上、文字在下。
 * onSlot 报这一格在标签栏里的位置，onActiveWidth 报选中样子的宽度（横着时玻璃框按它的宽度）。
 */
function TabItem({
  label,
  icon,
  focused,
  onPress,
  vertical,
  onSlot,
  onActiveWidth,
}: {
  label: string;
  icon: IconName;
  focused: boolean;
  onPress: () => void;
  vertical?: boolean;
  onSlot: (box: SlotBox) => void;
  onActiveWidth: (width: number) => void;
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
      onLayout={(e) => onSlot(e.nativeEvent.layout)}
      style={vertical ? styles.railSlot : styles.tabSlot}
    >
      <Animated.View
        style={[
          styles.tabIdle,
          { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
        ]}
      >
        <Icon name={icon} size={22} color={palette.mut} />
        <Text style={[vertical ? styles.railText : type.tab, { color: palette.mut }]}>{label}</Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        onLayout={(e) => onActiveWidth(e.nativeEvent.layout.width)}
        style={[
          vertical ? styles.railActive : styles.tabActive,
          {
            opacity: progress,
            transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          },
        ]}
      >
        <Icon name={icon} size={22} color={palette.tabOn} />
        <Text
          style={
            vertical
              ? [styles.railText, { fontWeight: "500", color: palette.tabOn }]
              : { fontSize: 14, fontWeight: "500", color: palette.tabOn }
          }
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * 滑动的选中框：有液态玻璃时是一块透明玻璃；没有时没有底色，一圈蓝色细描边加灰色投影（tabGlassEdge、tabCapsuleShadow）。
 * 记下每一格的位置和选中样子的宽度，选中项变了就从原来的位置滑过去（横着沿 x，竖着沿 y）；
 * 第一次量到位置、或者屏幕转动后位置变了，就直接放到位，不滑。
 */
function useGlass(index: number, vertical: boolean) {
  const slots = useRef<(SlotBox | undefined)[]>([]);
  const widths = useRef<(number | undefined)[]>([]);
  const offset = useRef(new Animated.Value(0)).current;
  // 玻璃框现在放在哪一格、横着还是竖着；还没放过是 null
  const shown = useRef<{ index: number; vertical: boolean } | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const place = (animated: boolean): void => {
    const slot = slots.current[index];
    const width = vertical ? rail.item.width : widths.current[index];
    if (!slot || !width) return;
    const to = vertical ? slot.y : slot.x + (slot.width - width) / 2;
    const next = vertical
      ? { left: slot.x, top: 0, width, height: rail.item.height }
      : { left: 0, top: (size.tabBar - size.tabActive) / 2, width, height: size.tabActive };
    setBox((b) =>
      b && b.left === next.left && b.top === next.top && b.width === next.width && b.height === next.height
        ? b
        : next,
    );
    if (!animated || shown.current?.vertical !== vertical) {
      offset.stopAnimation();
      offset.setValue(to);
    } else {
      Animated.timing(offset, {
        toValue: to,
        duration: SLIDE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    shown.current = { index, vertical };
  };

  // 选中项变了：滑过去（横竖刚切换过就直接放到位，见 place）
  useEffect(() => {
    if (shown.current && shown.current.index !== index) place(true);
  });

  const glass = box ? <GlassBox box={box} offset={offset} vertical={vertical} /> : null;
  return {
    glass,
    onSlot: (i: number) => (layout: SlotBox) => {
      slots.current[i] = layout;
      if (i === index) place(false);
    },
    onActiveWidth: (i: number) => (width: number) => {
      widths.current[i] = width;
      if (i === index) place(false);
    },
  };
}

function GlassBox({
  box,
  offset,
  vertical,
}: {
  box: { left: number; top: number; width: number; height: number };
  offset: Animated.Value;
  vertical: boolean;
}) {
  const palette = usePalette();
  const dark = useIsDark();
  const radius = Math.min(box.width, box.height) / 2;
  const place = {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    borderRadius: radius,
    transform: [vertical ? { translateY: offset } : { translateX: offset }],
  };
  if (LIQUID_GLASS) {
    return (
      <Animated.View pointerEvents="none" style={[styles.glassSlot, place]}>
        <GlassView
          glassEffectStyle="clear"
          colorScheme={dark ? "dark" : "light"}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
      </Animated.View>
    );
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.glass,
        place,
        { borderColor: palette.tabGlassEdge, boxShadow: palette.tabCapsuleShadow },
      ]}
    />
  );
}

/**
 * 浮动的胶囊标签栏：选中项是一块透明的玻璃框，图标和文字变成蓝色横排；未选中项灰色，图标在上、文字在下。
 * 切换时玻璃框从原来的标签滑到新的标签。
 * 中屏固定宽 392 水平居中；宽屏改成左侧竖着的导航栏，顶上是 Logo，高度随内容，玻璃框上下滑。
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const palette = usePalette();
  const dark = useIsDark();
  const { size: sizeClass, width } = useLayout();
  const vertical = sizeClass === "expanded";
  const { glass, onSlot, onActiveWidth } = useGlass(state.index, vertical);
  const place: StyleProp<ViewStyle> = vertical
    ? [styles.rail, { top: Math.max(rail.top, insets.top + space.s) }]
    : [
        styles.tabs,
        { bottom: tabBarBottom(insets.bottom) },
        sizeClass === "medium"
          ? { left: (width - bottomBar.width) / 2, right: undefined, width: bottomBar.width }
          : null,
      ];
  const items = (
    <>
      {vertical ? (
        <View style={styles.railLogo}>
          <Logo size={40} />
        </View>
      ) : null}
      {glass}
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const options = descriptors[route.key]?.options;
        const label = options?.title ?? route.name;
        const icon = TAB_ICONS[route.name] ?? "story";
        const onPress = (): void => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <TabItem
            key={route.key}
            label={label}
            icon={icon}
            focused={focused}
            onPress={onPress}
            vertical={vertical}
            onSlot={onSlot(index)}
            onActiveWidth={onActiveWidth(index)}
          />
        );
      })}
    </>
  );
  // 液态玻璃：整条栏是一块玻璃，页面内容从下面透出来；系统自己画边缘和投影
  if (LIQUID_GLASS) {
    return (
      <GlassView
        accessibilityRole="tablist"
        glassEffectStyle="regular"
        colorScheme={dark ? "dark" : "light"}
        style={place}
      >
        {items}
      </GlassView>
    );
  }
  return (
    <View
      accessibilityRole="tablist"
      style={[place, { backgroundColor: palette.card, boxShadow: palette.shadowFloat }]}
    >
      {items}
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
  rail: {
    position: "absolute",
    left: rail.left,
    width: rail.width,
    padding: space.s,
    borderRadius: rail.width / 2,
    alignItems: "center",
    gap: 6,
  },
  railLogo: { marginTop: 6, marginBottom: 10 },
  railSlot: {
    width: rail.item.width,
    height: rail.item.height,
    alignItems: "center",
    justifyContent: "center",
  },
  glass: { position: "absolute", borderWidth: 1, backgroundColor: "transparent" },
  glassSlot: { position: "absolute" },
  railActive: {
    position: "absolute",
    top: 0,
    left: 0,
    width: rail.item.width,
    height: rail.item.height,
    borderRadius: rail.item.width / 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  railText: { fontSize: 11.5, lineHeight: 14 },
});
