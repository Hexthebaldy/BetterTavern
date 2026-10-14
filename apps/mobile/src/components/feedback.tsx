/**
 * 反馈：提示条、状态（可用 / 还没测试 / Key 无效）、等宽小标签、加载失败。页面经 ui.tsx 引用。
 * 红 / 绿 / 琥珀只表示状态，并且一定配图标（三角、对勾、虚线方框、叉），不能只靠颜色区分。
 */

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { font, onColor, size, space, type, usePalette, type Palette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Button, IconButton, Mono } from "./primitives.tsx";

// ---- 提示条 ------------------------------------------------------------------------------

export type Tone = "error" | "info" | "warn";

export function toneColors(tone: Tone, palette: Palette) {
  if (tone === "error") return { fg: palette.err, bg: palette.errBg, icon: "alert" as const };
  if (tone === "warn") return { fg: palette.warn, bg: palette.warnBg, icon: "alert" as const };
  return { fg: palette.acc, bg: palette.accBg, icon: "info" as const };
}

/**
 * 提示条：三角 = 错误 / 警告，方框 = 信息。banner 是贴着页面顶边的通栏样式（只有底线）。
 * 带操作的不自动消失。
 */
export function Notice({
  tone = "error",
  message,
  title,
  actionLabel,
  onAction,
  onClose,
  banner,
  style,
}: {
  tone?: Tone;
  message: string;
  /** 加粗的第一行，message 变成说明 */
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  banner?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const c = toneColors(tone, palette);
  const action = actionLabel && onAction;
  return (
    <View
      accessibilityRole={tone === "info" ? undefined : "alert"}
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        { backgroundColor: c.bg },
        banner
          ? { borderBottomWidth: 1, borderColor: c.fg, paddingHorizontal: space.page, paddingVertical: 14 }
          : { borderWidth: 1, borderColor: c.fg },
        action && !banner ? { paddingVertical: 4, paddingRight: 4 } : null,
        style,
      ]}
    >
      <View style={title ? { marginTop: 1 } : null}>
        <Icon name={c.icon} size={banner ? 20 : 18} color={c.fg} />
      </View>
      <View style={{ flex: 1 }}>
        {title ? (
          <Text style={[styles.noticeText, { color: palette.ink, fontWeight: "500" }]}>{title}</Text>
        ) : null}
        <Text style={[styles.noticeText, { color: title ? palette.ink2 : palette.ink }]}>{message}</Text>
      </View>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={styles.noticeAction}>
          <Text style={[styles.noticeText, { color: palette.ink, fontWeight: "700" }]}>{actionLabel}</Text>
          <Icon name="arrowRight" size={14} color={palette.ink} />
        </Pressable>
      ) : null}
      {onClose ? (
        <IconButton
          icon="close"
          label="关闭"
          size={18}
          onPress={onClose}
          style={{ margin: -12, marginLeft: 0 }}
        />
      ) : null}
    </View>
  );
}

// ---- 状态 -------------------------------------------------------------------------------

export type StatusKind = "ok" | "untested" | "invalid";

/** 可用 / 还没测试 / Key 无效：颜色一定配图标（对勾、虚线方框、叉） */
export function Status({
  kind,
  label,
  size: textSize = 12.5,
}: {
  kind: StatusKind;
  label: string;
  size?: number;
}) {
  const palette = usePalette();
  const color = kind === "ok" ? palette.ok : kind === "untested" ? palette.warn : palette.err;
  const icon: IconName = kind === "ok" ? "check" : kind === "untested" ? "untested" : "cross";
  return (
    <View style={styles.status}>
      <Icon name={icon} size={14} color={color} strokeWidth={kind === "untested" ? 1.5 : 2} />
      <Text style={{ color, fontSize: textSize, lineHeight: 18, fontWeight: "500" }}>{label}</Text>
    </View>
  );
}

/** 等宽小标签：solid = 蓝底白字（导演、我），outline = 蓝框（新），plain = 灰框（128K） */
export function Tag({
  label,
  variant = "plain",
}: {
  label: string;
  variant?: "solid" | "outline" | "plain";
}) {
  const palette = usePalette();
  const solid = variant === "solid";
  return (
    <View
      style={[
        styles.tag,
        solid
          ? { backgroundColor: palette.acc }
          : { borderWidth: 1, borderColor: variant === "outline" ? palette.acc : palette.line2 },
      ]}
    >
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 10.5,
          lineHeight: 14,
          letterSpacing: 0.6,
          color: solid ? onColor : variant === "outline" ? palette.acc : palette.ink2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** 加载失败：等宽红字标签、标题、说明，加一个“重新加载” */
export function ErrorState({
  label = "连接失败",
  icon = "offline",
  title,
  message,
  onRetry,
  style,
}: {
  label?: string;
  icon?: IconName;
  title: string;
  message: ReactNode;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <View accessibilityRole="alert" style={[styles.errorState, { borderTopColor: palette.ink }, style]}>
      <View style={styles.status}>
        <Icon name={icon} size={22} color={palette.err} />
        <Mono style={{ color: palette.err, fontSize: 12, letterSpacing: 1 }}>{label}</Mono>
      </View>
      <Text style={[type.section, { fontSize: 20, lineHeight: 28, color: palette.ink }]}>{title}</Text>
      <Text style={{ fontSize: 14, lineHeight: 22, color: palette.mut }}>{message}</Text>
      {onRetry ? (
        <Button
          label="重新加载"
          variant="secondary"
          trailingIcon="retry"
          between
          onPress={onRetry}
          style={{ marginTop: space.xs }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: space.m,
  },
  noticeText: { fontSize: 14, lineHeight: 21 },
  noticeAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    minHeight: size.touch,
    paddingHorizontal: space.m,
  },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  tag: { paddingHorizontal: 6, paddingVertical: 2 },
  errorState: { borderTopWidth: 1, paddingTop: space.read, paddingHorizontal: space.read, gap: 14 },
});
