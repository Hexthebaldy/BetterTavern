/**
 * 基本部件：页面容器、加载、文字、按钮、列表行、分区标题。页面经 ui.tsx 引用。
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { font, onColor, size, space, type, usePalette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";

// ---- 页面 -------------------------------------------------------------------------------

export function Page({
  children,
  refreshing,
  onRefresh,
  contentStyle,
  header,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** 固定在顶上、不随内容滚动的页头 */
  header?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.page, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={palette.mut} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** 整页居中的状态 */
export function Centered({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return <View style={[styles.centered, { backgroundColor: palette.bg }, style]}>{children}</View>;
}

/** 三格墨点：通用加载。依次加深，表示“在动”，不代表进度 */
export function Dots({ color, cell = 6, gap = 4 }: { color?: string; cell?: number; gap?: number }) {
  const palette = usePalette();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => (s + 1) % 3), 320);
    return () => clearInterval(timer);
  }, []);
  const levels = [1, 0.35, 0.12];
  return (
    <View style={{ flexDirection: "row", gap }} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: cell,
            height: cell,
            backgroundColor: color ?? palette.ink,
            opacity: levels[(i - step + 3) % 3],
          }}
        />
      ))}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <Centered>
      <View style={styles.loadingRow} accessibilityRole="progressbar" accessibilityLabel={label ?? "加载中"}>
        <Dots />
        {label ? <Mono>{label}</Mono> : null}
      </View>
    </Centered>
  );
}

/** 骨架屏的一条 */
export function SkeletonLine({
  width = "100%",
  height = 12,
  strong,
}: {
  width?: ViewStyle["width"];
  height?: number;
  strong?: boolean;
}) {
  const palette = usePalette();
  return <View style={{ width, height, backgroundColor: strong ? palette.bg3 : palette.bg2 }} />;
}

// ---- 文字 -------------------------------------------------------------------------------

type TextProps = {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
};

export function Title({ children, style, numberOfLines }: TextProps) {
  const palette = usePalette();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      style={[type.title, { color: palette.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Heading({ children, style, numberOfLines }: TextProps) {
  const palette = usePalette();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      style={[type.rowTitle, { color: palette.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Body({ children, style, numberOfLines, selectable }: TextProps) {
  const palette = usePalette();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[type.body, { color: palette.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, style, numberOfLines }: TextProps) {
  const palette = usePalette();
  return (
    <Text numberOfLines={numberOfLines} style={[type.caption, { color: palette.mut }, style]}>
      {children}
    </Text>
  );
}

/** 等宽元信息：时间、计数、标签、Key 尾号 */
export function Mono({ children, style, numberOfLines, selectable }: TextProps) {
  const palette = usePalette();
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[type.meta, { fontFamily: font.mono, color: palette.mut }, style]}
    >
      {children}
    </Text>
  );
}

// ---- 按钮 -------------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "dangerSolid";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  icon,
  trailingIcon,
  between,
  style,
  accessibilityHint,
  accessibilityLabel,
  children,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  /** 文字前的图标 */
  icon?: IconName;
  /** 文字后的图标；推进流程的主按钮用 arrowRight */
  trailingIcon?: IconName;
  /** 文字左对齐、图标右对齐（推进流程时像在翻下一页） */
  between?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  /** 替换文字部分（比如两行的按钮） */
  children?: ReactNode;
}) {
  const palette = usePalette();
  const inactive = !!disabled || !!busy;
  const look: Record<ButtonVariant, { bg: string; fg: string; border: string | null; pressed: string }> = {
    primary: { bg: palette.pri, fg: palette.onPri, border: null, pressed: palette.ink2 },
    secondary: { bg: palette.bg, fg: palette.ink, border: palette.line2, pressed: palette.bg2 },
    text: { bg: "transparent", fg: palette.ink, border: null, pressed: palette.bg2 },
    danger: { bg: palette.bg, fg: palette.err, border: palette.err, pressed: palette.errBg },
    dangerSolid: { bg: palette.err, fg: onColor, border: null, pressed: palette.err },
  };
  const c = look[variant];
  let bg = c.bg;
  let fg = c.fg;
  let border = c.border;
  let opacity = 1;
  if (disabled && !busy) {
    if (variant === "primary") {
      bg = palette.bg3;
      fg = palette.mut;
    } else if (variant === "secondary") {
      fg = palette.mut;
      border = palette.line;
    } else if (variant === "text") {
      fg = palette.line2;
    } else {
      opacity = 0.35;
    }
  }
  const textStyle = [
    type.button,
    { color: fg },
    variant === "text" && !disabled
      ? { textDecorationLine: "underline" as const, textDecorationColor: palette.line2 }
      : null,
  ];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "text" && styles.textButton,
        between && styles.between,
        {
          backgroundColor: pressed && !inactive ? c.pressed : bg,
          borderWidth: border ? 1 : 0,
          borderColor: border ?? "transparent",
          opacity,
        },
        style,
      ]}
    >
      {busy ? (
        <Dots color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={fg} /> : null}
          {children ?? <Text style={textStyle}>{label}</Text>}
          {trailingIcon ? <Icon name={trailingIcon} size={22} color={fg} /> : null}
        </>
      )}
    </Pressable>
  );
}

/** 44×44 的图标按钮 */
export function IconButton({
  icon,
  label,
  onPress,
  color,
  size: iconSize = 22,
  disabled,
  badge,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  disabled?: boolean;
  /** 右上角的蓝色小方块 */
  badge?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: pressed ? palette.bg2 : "transparent", opacity: disabled ? 0.35 : 1 },
        style,
      ]}
    >
      <Icon name={icon} size={iconSize} color={color ?? palette.ink} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: palette.acc, borderColor: palette.bg }]} />
      ) : null}
    </Pressable>
  );
}

// ---- 列表 -------------------------------------------------------------------------------

/** 列表行左边的 36×36 图标格 */
export function RowIcon({ name, tone }: { name: IconName; tone?: "ink" | "acc" }) {
  const palette = usePalette();
  const bg = tone === "ink" ? palette.ink : tone === "acc" ? palette.accBg : palette.bg2;
  const fg = tone === "ink" ? palette.bg : tone === "acc" ? palette.acc : palette.ink;
  return (
    <View style={[styles.rowIcon, { backgroundColor: bg }]}>
      <Icon name={name} size={20} color={fg} />
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  subtitleColor,
  leading,
  trailing,
  onPress,
  onLongPress,
  chevron,
  mono,
  style,
}: {
  title: string;
  subtitle?: string;
  subtitleColor?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** 默认可点的行显示右箭头 */
  chevron?: boolean;
  /** 标题用等宽字（模型名之类） */
  mono?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const showChevron = chevron ?? !!onPress;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: palette.line, backgroundColor: pressed ? palette.bg2 : palette.bg },
        style,
      ]}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[
            styles.rowTitle,
            { color: palette.ink },
            mono ? { fontFamily: font.mono, fontSize: 15 } : null,
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={[styles.rowSubtitle, { color: subtitleColor ?? palette.mut }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {showChevron ? <Icon name="chevronRight" size={18} color={palette.line2} /> : null}
    </Pressable>
  );
}

/** 分区标题：下面压一道 2px ink 线，右边一行等宽说明 */
export function SectionHeader({
  title,
  meta,
  style,
}: {
  title: string;
  meta?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.section, { borderBottomColor: palette.ink }, style]}>
      <Text accessibilityRole="header" style={[type.section, { color: palette.ink, flex: 1 }]}>
        {title}
      </Text>
      {typeof meta === "string" ? <Mono>{meta}</Mono> : meta}
    </View>
  );
}

/** 一组设置项的小标题（等宽小字，下面一条浅线） */
export function GroupLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <View style={[styles.group, { borderBottomColor: palette.line }, style]}>
      <Mono style={{ letterSpacing: 0.9 }}>{children}</Mono>
    </View>
  );
}

export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return <View style={[{ height: 1, backgroundColor: palette.line }, style]} />;
}

const styles = StyleSheet.create({
  page: { paddingBottom: 56 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.read },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  button: {
    minHeight: size.button,
    paddingHorizontal: space.page,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
  },
  textButton: { minHeight: size.touch, paddingHorizontal: space.s },
  between: { justifyContent: "space-between" },
  iconButton: { width: size.touch, height: size.touch, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 9, right: 9, width: 7, height: 7, borderWidth: 2 },
  rowIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 60,
    paddingVertical: 10,
    paddingLeft: space.page,
    paddingRight: space.l,
    borderBottomWidth: 1,
  },
  rowTitle: { fontSize: 16, lineHeight: 22 },
  rowSubtitle: { fontSize: 12.5, lineHeight: 18, marginTop: 1 },
  section: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingTop: 32,
    paddingBottom: space.m,
    paddingHorizontal: space.page,
    borderBottomWidth: 2,
    gap: space.m,
  },
  group: {
    paddingTop: space.read,
    paddingBottom: space.s,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
});
