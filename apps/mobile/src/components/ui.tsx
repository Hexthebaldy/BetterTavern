/**
 * 界面的基本部件：页面容器、文字、按钮、输入框、提示、列表行、分段选择。
 * 颜色都从 usePalette() 取，深色模式自动适配。
 */

import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { space, type, usePalette } from "../theme/index.ts";

// ---- 页面 -------------------------------------------------------------------------------

export function Page({
  children,
  refreshing,
  onRefresh,
  contentStyle,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.paper }}
      contentContainerStyle={[styles.page, contentStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={palette.muted} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

/** 整页居中的状态：加载中、空、出错 */
export function Centered({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return <View style={[styles.centered, { backgroundColor: palette.paper }]}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  const palette = usePalette();
  return (
    <Centered>
      <ActivityIndicator color={palette.muted} />
      {label ? <Caption style={{ marginTop: space.m }}>{label}</Caption> : null}
    </Centered>
  );
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
      style={[type.heading, { color: palette.ink }, style]}
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
    <Text numberOfLines={numberOfLines} style={[type.caption, { color: palette.muted }, style]}>
      {children}
    </Text>
  );
}

// ---- 按钮 -------------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "plain" | "danger";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const palette = usePalette();
  const inactive = disabled || busy;
  const colors: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: palette.accent, fg: palette.onAccent, border: palette.accent },
    secondary: { bg: "transparent", fg: palette.ink, border: palette.rule },
    plain: { bg: "transparent", fg: palette.accent, border: "transparent" },
    danger: { bg: "transparent", fg: palette.danger, border: palette.rule },
  };
  const c = colors[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "plain" && styles.plainButton,
        { backgroundColor: c.bg, borderColor: c.border, opacity: inactive ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <Text style={[type.body, styles.buttonLabel, { color: c.fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

// ---- 输入 -------------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <View style={[styles.field, style]}>
      <Text style={[type.caption, { color: palette.muted, marginBottom: space.xs }]}>{label}</Text>
      <TextInput
        placeholderTextColor={palette.muted}
        accessibilityLabel={label}
        {...input}
        style={[
          type.body,
          styles.input,
          input.multiline ? styles.multiline : null,
          {
            color: palette.ink,
            backgroundColor: palette.surface,
            borderColor: error ? palette.danger : palette.rule,
          },
        ]}
      />
      {error ? (
        <Text style={[type.caption, { color: palette.danger, marginTop: space.xs }]}>{error}</Text>
      ) : hint ? (
        <Text style={[type.caption, { color: palette.muted, marginTop: space.xs }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** 几个互斥选项（篇幅、服务商之类） */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      {label ? (
        <Text style={[type.caption, { color: palette.muted, marginBottom: space.xs }]}>{label}</Text>
      ) : null}
      <View style={[styles.segmented, { borderColor: palette.rule }]} accessibilityRole="radiogroup">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={[
                styles.segment,
                index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: palette.rule },
                selected && { backgroundColor: palette.accentSoft },
              ]}
            >
              <Text
                style={[
                  type.body,
                  { color: selected ? palette.accent : palette.ink, fontWeight: selected ? "600" : "400" },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---- 提示 -------------------------------------------------------------------------------

export function Notice({
  tone = "error",
  message,
  actionLabel,
  onAction,
  style,
}: {
  tone?: "error" | "info";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const error = tone === "error";
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={[styles.notice, { backgroundColor: error ? palette.dangerSoft : palette.accentSoft }, style]}
    >
      <Text style={[type.body, { color: error ? palette.danger : palette.ink, flex: 1 }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <Text style={[type.body, { color: palette.accent, fontWeight: "600" }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- 列表 -------------------------------------------------------------------------------

export function ListRow({
  title,
  subtitle,
  detail,
  onPress,
  onLongPress,
  accessory,
}: {
  title: string;
  subtitle?: string;
  detail?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  accessory?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: palette.rule, backgroundColor: pressed ? palette.accentSoft : "transparent" },
      ]}
    >
      {accessory}
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={[type.heading, { color: palette.ink, flex: 1 }]} numberOfLines={1}>
            {title}
          </Text>
          {detail ? <Caption style={{ marginLeft: space.s }}>{detail}</Caption> : null}
        </View>
        {subtitle ? (
          <Text style={[type.body, { color: palette.muted, marginTop: 2 }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** 一组设置项的小标题 */
export function GroupLabel({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return (
    <Text style={[type.caption, { color: palette.muted, marginTop: space.xl, marginBottom: space.s }]}>
      {children}
    </Text>
  );
}

export function Rule() {
  const palette = usePalette();
  return (
    <View
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.rule, marginVertical: space.l }}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, paddingBottom: space.xxl * 2 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  button: {
    minHeight: 46,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.l,
    alignItems: "center",
    justifyContent: "center",
  },
  plainButton: { minHeight: 40, paddingHorizontal: space.s },
  buttonLabel: { fontWeight: "600" },
  field: { marginBottom: space.l },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: space.m,
    paddingVertical: space.m,
    minHeight: 46,
  },
  multiline: { minHeight: 92, textAlignVertical: "top" },
  segmented: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: space.s,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    borderRadius: 10,
    paddingHorizontal: space.m,
    paddingVertical: space.m,
    marginBottom: space.l,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingVertical: space.m + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTop: { flexDirection: "row", alignItems: "baseline" },
});
