/**
 * 基本部件：页面容器、加载、骨架、文字。页面经 ui.tsx 引用；按钮在 buttons.tsx，分组和列表行在 rows.tsx。
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { pane } from "@bettertavern/design/layout";

import { useLayout } from "../hooks/useLayout.ts";
import {
  comicDepth,
  comicStroke,
  ctype,
  font,
  hardShadow,
  space,
  useComic,
} from "../theme/index.ts";

// ---- 页面 -------------------------------------------------------------------------------

/** 内容已经放在一栏里（平板设置两栏的详情区）：页面不再自己居中限宽 */
export const InColumnContext = createContext(false);

/**
 * 平板（中屏、宽屏）上把页面内容收进居中的一栏：给 ScrollView 的 contentContainerStyle 用。
 * 手机上、或者已经在一栏里时返回 null。maxWidth 传 null 表示这一页不限宽。
 */
export function useColumnStyle(maxWidth: number | null = pane.readable): ViewStyle | null {
  const { compact } = useLayout();
  const inColumn = useContext(InColumnContext);
  if (compact || inColumn || maxWidth === null) return null;
  return { width: "100%", maxWidth, alignSelf: "center" };
}

export function Page({
  children,
  refreshing,
  onRefresh,
  contentStyle,
  header,
  bottomSpace = 56,
  maxWidth = pane.readable,
  overlay,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** 固定在顶上、不随内容滚动的页头 */
  header?: ReactNode;
  /** 内容底部留白；标签页要让出浮动 Tab 栏（useTabBarSpace） */
  bottomSpace?: number;
  /** 平板上内容收进居中的一栏，最宽多少（默认 640）；null 不限宽 */
  maxWidth?: number | null;
  /** 盖在滚动内容上面、不随它滚动的东西（宽屏设置的右栏） */
  overlay?: ReactNode;
}) {
  const c = useComic();
  const column = useColumnStyle(maxWidth);
  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[{ paddingBottom: bottomSpace }, column, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={c.ink} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {overlay}
    </View>
  );
}

/** 整页居中的状态 */
export function Centered({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useComic();
  return <View style={[styles.centered, { backgroundColor: c.page }, style]}>{children}</View>;
}

/** 三个圆点：通用加载。依次加深，表示“在动”，不代表进度 */
export function Dots({ color, cell = 6, gap = 4 }: { color?: string; cell?: number; gap?: number }) {
  const c = useComic();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => (s + 1) % 3), 320);
    return () => clearInterval(timer);
  }, []);
  const levels = [1, 0.4, 0.15];
  return (
    <View style={{ flexDirection: "row", gap }} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: cell,
            height: cell,
            borderRadius: cell / 2,
            backgroundColor: color ?? c.ink,
            opacity: levels[(i - step + 3) % 3],
          }}
        />
      ))}
    </View>
  );
}

/** 整页加载：白底墨框的小胶囊里三个点（和下拉刷新的“刷新中”一样） */
export function Loading({ label }: { label?: string }) {
  const c = useComic();
  const { t } = useTranslation();
  return (
    <Centered>
      <View
        style={[
          styles.loadingPill,
          {
            backgroundColor: c.paper,
            borderColor: c.ink,
            boxShadow: hardShadow(c.ink, comicDepth.iconButton),
          },
        ]}
        accessibilityRole="progressbar"
        accessibilityLabel={label ?? t("common.loading")}
      >
        <Dots />
        {label ? <Text style={{ fontSize: 13, fontWeight: "600", color: c.ink }}>{label}</Text> : null}
      </View>
    </Centered>
  );
}

/** 骨架屏的一条（圆头，灰） */
export function SkeletonLine({
  width = "100%",
  height = 12,
  strong,
}: {
  width?: ViewStyle["width"];
  height?: number;
  strong?: boolean;
}) {
  const c = useComic();
  return (
    <View style={{ width, height, borderRadius: height / 2, backgroundColor: strong ? c.grey2 : c.grey }} />
  );
}

// ---- 文字 -------------------------------------------------------------------------------

type TextProps = {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
};

/** 面板、格子里的大标题 */
export function Title({ children, style, numberOfLines }: TextProps) {
  const c = useComic();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      style={[ctype.title, { color: c.ink }, style]}
    >
      {children}
    </Text>
  );
}

/** 格子和列表里的标题 */
export function Heading({ children, style, numberOfLines }: TextProps) {
  const c = useComic();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      style={[ctype.frameTitle, { color: c.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Body({ children, style, numberOfLines, selectable }: TextProps) {
  const c = useComic();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[ctype.body, { color: c.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, style, numberOfLines }: TextProps) {
  const c = useComic();
  return (
    <Text numberOfLines={numberOfLines} style={[ctype.caption, { color: c.mut }, style]}>
      {children}
    </Text>
  );
}

/** 等宽元信息：时间、计数、Key 尾号、上下文窗口 */
export function Mono({ children, style, numberOfLines, selectable }: TextProps) {
  const c = useComic();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[ctype.meta, { fontFamily: font.monoMedium, color: c.mut }, style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.read },
  loadingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: comicStroke.control,
  },
});
