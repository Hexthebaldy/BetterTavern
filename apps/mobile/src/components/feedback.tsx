/**
 * 反馈：提示条、胶囊标签（状态、“我”、“导演”、上下文长度）、加载失败。页面经 ui.tsx 引用。
 * 红 / 绿 / 琥珀只表示状态，并且一定配图标（三角、对勾、虚线圆、叉），不能只靠颜色区分。
 */

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { font, onColor, radius, space, usePalette, type Palette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Button, IconButton } from "./primitives.tsx";

// ---- 提示条 ------------------------------------------------------------------------------

export type Tone = "error" | "info" | "warn";

export function toneColors(tone: Tone, palette: Palette) {
  if (tone === "error") return { fg: palette.err, bg: palette.errBg, icon: "alert" as const };
  if (tone === "warn") return { fg: palette.warn, bg: palette.warnBg, icon: "alert" as const };
  return { fg: palette.acc, bg: palette.accBg, icon: "info" as const };
}

/**
 * 提示条：圆角 20 的色卡，三角 = 错误 / 警告，圆圈 i = 信息。
 * 带操作时右边是一个同色的胶囊按钮；带操作的不自动消失。floating 时带投影（浮在页面顶上）。
 */
export function Notice({
  tone = "error",
  message,
  title,
  icon,
  actionLabel,
  onAction,
  onClose,
  floating,
  style,
}: {
  tone?: Tone;
  message: ReactNode;
  /** 加粗的第一行，message 变成说明 */
  title?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  floating?: boolean;
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
        action ? styles.noticeWithAction : null,
        title ? { alignItems: "flex-start" } : null,
        floating ? { boxShadow: palette.shadowFloat } : null,
        style,
      ]}
    >
      <View style={title ? { marginTop: 1 } : null}>
        <Icon name={icon ?? c.icon} size={20} color={c.fg} />
      </View>
      <View style={{ flex: 1 }}>
        {title ? <Text style={[styles.text, { color: palette.ink, fontWeight: "500" }]}>{title}</Text> : null}
        {typeof message === "string" ? (
          <Text style={[styles.text, { color: title ? palette.ink2 : palette.ink }]}>{message}</Text>
        ) : (
          message
        )}
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: c.fg, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}
        >
          <Text style={{ fontSize: 13.5, fontWeight: "500", color: onColor }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      {onClose ? (
        <IconButton
          icon="close"
          label="关闭"
          size={16}
          diameter={36}
          tone="plain"
          onPress={onClose}
          style={{ backgroundColor: palette.closeOnTint, marginVertical: -6 }}
        />
      ) : null}
    </View>
  );
}

// ---- 胶囊标签 ----------------------------------------------------------------------------

export type PillTone = "acc" | "accSolid" | "ink" | "ok" | "warn" | "err" | "grey" | "card";

function pillColors(tone: PillTone, palette: Palette): { bg: string; fg: string } {
  switch (tone) {
    case "acc":
      return { bg: palette.accBg, fg: palette.acc };
    case "accSolid":
      return { bg: palette.acc, fg: onColor };
    case "ink":
      return { bg: palette.ink, fg: palette.bg };
    case "ok":
      return { bg: palette.okBg, fg: palette.ok };
    case "warn":
      return { bg: palette.warnBg, fg: palette.warn };
    case "err":
      return { bg: palette.errBg, fg: palette.err };
    case "grey":
      return { bg: palette.bg2, fg: palette.ink };
    case "card":
      return { bg: palette.card, fg: palette.ink };
  }
}

/** 胶囊标签：状态、“我”、“导演”、上下文长度。dot 是前面的小圆点（“正在写下一段”） */
export function Pill({
  label,
  tone = "grey",
  icon,
  dot,
  mono,
  height = 24,
  style,
}: {
  label: ReactNode;
  tone?: PillTone;
  icon?: IconName;
  dot?: boolean;
  mono?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const c = pillColors(tone, palette);
  const fontSize = height <= 20 ? 11 : height >= 28 ? 13 : 12;
  return (
    <View
      style={[
        styles.pill,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: c.bg,
          paddingLeft: icon || dot ? 8 : 10,
          paddingRight: 10,
        },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: c.fg }]} /> : null}
      {icon ? <Icon name={icon} size={height <= 24 ? 13 : 15} color={c.fg} strokeWidth={2.2} /> : null}
      <Text
        numberOfLines={1}
        style={[
          { fontSize, color: c.fg, fontWeight: tone === "grey" || tone === "card" ? "400" : "500" },
          mono ? { fontFamily: font.mono, fontWeight: "400" } : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export type StatusKind = "ok" | "untested" | "invalid";

/** 可用 / 还没测试 / Key 无效：颜色一定配图标（对勾、虚线圆、叉） */
export function Status({ kind, label, height }: { kind: StatusKind; label: string; height?: number }) {
  const tone: PillTone = kind === "ok" ? "ok" : kind === "untested" ? "warn" : "err";
  const icon: IconName = kind === "ok" ? "check" : kind === "untested" ? "untested" : "cross";
  return <Pill label={label} tone={tone} icon={icon} height={height} />;
}

/** 小标签：solid = 蓝底白字（“我”），soft = 浅蓝（“导演”“新”），ink = 黑底，plain = 灰底（128K） */
export function Tag({
  label,
  variant = "plain",
}: {
  label: string;
  variant?: "solid" | "soft" | "ink" | "plain";
}) {
  const tone: PillTone =
    variant === "solid" ? "accSolid" : variant === "soft" ? "acc" : variant === "ink" ? "ink" : "grey";
  return <Pill label={label} tone={tone} height={22} mono={variant === "plain"} />;
}

/** 加载失败：一张灰卡，红色圆形图标、标题、说明、“重新加载” */
export function ErrorState({
  icon = "offline",
  title,
  message,
  onRetry,
  primary,
  style,
}: {
  icon?: IconName;
  title: string;
  message: ReactNode;
  onRetry?: () => void;
  /** 重新加载用主按钮（整页只有这一件事可做时） */
  primary?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <View accessibilityRole="alert" style={[styles.errorState, { backgroundColor: palette.bg2 }, style]}>
      <View style={[styles.errorIcon, { backgroundColor: palette.errBg }]}>
        <Icon name={icon} size={26} color={palette.err} />
      </View>
      <Text
        style={{ fontSize: 20, lineHeight: 28, fontWeight: "700", color: palette.ink, textAlign: "center" }}
      >
        {title}
      </Text>
      {typeof message === "string" ? (
        <Text style={{ fontSize: 14, lineHeight: 22, color: palette.mut, textAlign: "center" }}>
          {message}
        </Text>
      ) : (
        message
      )}
      {onRetry ? (
        <Button
          label="重新加载"
          variant={primary ? "primary" : "secondary"}
          onGrey
          icon="retry"
          onPress={onRetry}
          style={{ alignSelf: "stretch", marginTop: space.s }}
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
    paddingHorizontal: space.l,
    paddingVertical: 14,
    borderRadius: radius.card,
  },
  noticeWithAction: { paddingVertical: 6, paddingRight: 6 },
  text: { fontSize: 14, lineHeight: 21 },
  action: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  errorState: {
    marginHorizontal: space.l,
    paddingTop: space.xl,
    paddingHorizontal: space.page - 4,
    paddingBottom: space.page - 4,
    borderRadius: radius.sheet,
    alignItems: "center",
    gap: space.m,
  },
  errorIcon: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
});
