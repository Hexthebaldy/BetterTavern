/**
 * 页头（漫画风）：一级页的大标题、二级页的导航栏和返回栏。页面经 ui.tsx 引用；Tab 栏和侧栏在 tabBar.tsx。
 *
 * 一级页：大标题 36/44，右侧放墨线方框里的数量或操作按钮；标题下不画线。
 * 二级页：底色同页面、底边 2.5 墨线的导航栏，38 的返回按钮和居中的粗体标题；也可以只有返回按钮，大标题写在内容里。
 * Tab 栏浮在内容上面；标签页的内容底部要用 useTabBarSpace() 留出它的位置，提示浮条贴在它上方（tabBarTop）。
 * 宽屏的导航栏在左边，一级页的内容从 x = 124 开始，底部不再留 Tab 栏的位置。
 */

import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { rail, tabInsets, type Insets } from "@bettertavern/design/layout";

import { useLayout } from "../hooks/useLayout.ts";
import { comicStroke, ctype, font, size, space, useComic } from "../theme/index.ts";
import { IconButton } from "./buttons.tsx";
import type { IconName } from "./icons.tsx";

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

/** 一级页大标题：存档 / 库 / 工作台 / 设置 */
export function LargeHeader({
  title,
  count,
  insets: frame,
  children,
}: {
  title: string;
  /** 右侧墨线方框里的数量；null 表示还不知道（显示一道横线） */
  count?: number | null;
  /** 平板上标题的左右留白（和内容对齐）；默认按一级页的留白（theme/layout.ts 的 tabInsets） */
  insets?: Insets;
  /** 右侧的操作 */
  children?: ReactNode;
}) {
  const c = useComic();
  const { t } = useTranslation();
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
      {/* 手机上数量靠右；平板上紧跟在标题后面，右侧的操作仍然靠右 */}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[ctype.display, { color: c.ink }, sides ? null : { flex: 1 }]}
      >
        {title}
      </Text>
      {count !== undefined ? (
        <View style={[styles.count, { borderColor: c.ink }]}>
          <Text
            accessibilityLabel={count === null ? undefined : t("nav.count", { count })}
            style={{ fontFamily: font.monoMedium, fontSize: 15, color: c.ink }}
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

/** 二级页导航栏：38 的返回按钮、居中的粗体标题（下面可以有一行小字）、右侧最多两个图标按钮；底边 2.5 墨线 */
export function NavBar({
  title,
  subtitle,
  mono,
  actions,
  onBack,
  style,
}: {
  title: string;
  subtitle?: string;
  /** 标题用等宽字（模型名） */
  mono?: boolean;
  actions?: { icon: IconName; label: string; onPress: () => void; badge?: boolean }[];
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View
      style={[
        styles.nav,
        { paddingTop: insets.top, backgroundColor: c.page, borderBottomColor: c.ink },
        style,
      ]}
    >
      <View style={styles.navSide}>
        <IconButton
          icon="back"
          label={t("common.back")}
          diameter={38}
          onPress={onBack ?? (() => router.back())}
        />
      </View>
      <View style={styles.navTitleBox}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[ctype.navTitle, { color: c.ink }, mono ? { fontFamily: font.monoMedium, fontWeight: "normal" } : null]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ fontSize: 11.5, lineHeight: 15, color: c.mut }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.navSide, { justifyContent: "flex-end" }]}>
        {actions?.map((a) => (
          <IconButton
            key={a.label}
            icon={a.icon}
            label={a.label}
            diameter={38}
            onPress={a.onPress}
            badge={a.badge}
          />
        ))}
      </View>
    </View>
  );
}

/** 只有返回按钮的页头，大标题写在内容里 */
export function BackBar({ onBack, right }: { onBack?: () => void; right?: ReactNode }) {
  const c = useComic();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View style={[styles.back, { paddingTop: insets.top + space.s, backgroundColor: c.page }]}>
      <IconButton
        icon="back"
        label={t("common.back")}
        diameter={38}
        onPress={onBack ?? (() => router.back())}
      />
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

/** 切换标签时新页面淡入的时长（TabScene.tsx） */
export const TAB_FADE_MS = 220;

const styles = StyleSheet.create({
  large: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingLeft: 20,
    paddingRight: 20,
    paddingBottom: space.m,
  },
  count: {
    height: 38,
    minWidth: 38,
    paddingHorizontal: 9,
    borderRadius: 10,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    paddingHorizontal: 14,
    paddingBottom: 11,
    borderBottomWidth: comicStroke.frame,
  },
  navSide: { width: 86, flexDirection: "row", alignItems: "center", gap: 6 },
  navTitleBox: { flex: 1, minWidth: 0, alignItems: "center", gap: 1, paddingTop: 11 },
  back: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.l, minHeight: size.touch },
});
