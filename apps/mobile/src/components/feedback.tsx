/**
 * 反馈（漫画风）：提示条、小标签（状态、“我”、“导演”、上下文长度）、加载失败。页面经 ui.tsx 引用。
 * 红 / 绿 / 琥珀只表示状态，并且一定配图标（三角、对勾、虚线圆、叉），不能只靠颜色区分。
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import {
  comicDepth,
  comicRadius,
  comicStroke,
  ctype,
  font,
  hardShadow,
  onColor,
  space,
  useComic,
  type ComicColors,
} from "../theme/index.ts";
import { Button, IconButton } from "./buttons.tsx";
import { Halftone } from "./Halftone.tsx";
import { FilledIcon, Icon, type FilledIconName, type IconName } from "./icons.tsx";
import { press } from "./press.ts";

// ---- 提示条 ------------------------------------------------------------------------------

export type Tone = "error" | "info" | "warn";

export function toneColors(tone: Tone, c: ComicColors) {
  if (tone === "error") return { fg: c.err, action: c.danger, icon: "alert" as const };
  if (tone === "warn") return { fg: c.warn, action: c.warn, icon: "alert" as const };
  return { fg: c.acc, action: c.acc, icon: "info" as const };
}

/**
 * 提示条：白底 2.5 墨线的格子，图标按语气上色（三角 = 错误 / 警告，圆圈 i = 信息）。
 * 带操作时右边是一个同色的胶囊按钮（错误是红底），link 时是一行蓝色粗字（“去看看”）；带操作的不自动消失。
 * floating 时带墨色投影 4（浮在页面顶上）。
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
  link,
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
  /** 操作写成一行蓝色粗字，不是按钮 */
  link?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const tc = toneColors(tone, c);
  const action = actionLabel && onAction;
  return (
    <View
      accessibilityRole={tone === "info" ? undefined : "alert"}
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        { backgroundColor: c.paper, borderColor: c.ink },
        action && !link ? styles.noticeWithAction : null,
        title ? { alignItems: "flex-start" } : null,
        floating ? { boxShadow: hardShadow(c.ink, comicDepth.raised) } : null,
        style,
      ]}
    >
      <View style={title ? { marginTop: 1 } : null}>
        <Icon name={icon ?? tc.icon} size={20} color={tc.fg} />
      </View>
      <View style={{ flex: 1 }}>
        {title ? <Text style={[styles.text, { color: c.ink, fontWeight: "700" }]}>{title}</Text> : null}
        {typeof message === "string" ? (
          <Text style={[styles.text, { color: title ? c.ink2 : c.ink }]}>{message}</Text>
        ) : (
          message
        )}
      </View>
      {action && link ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: c.acc }}>{actionLabel}</Text>
        </Pressable>
      ) : action ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: tc.action, borderColor: c.ink },
            press(pressed, comicDepth.iconButton, c.ink),
          ]}
        >
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: tone === "info" ? c.onAcc : onColor }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
      {onClose ? (
        <IconButton
          icon="close"
          label={t("common.close")}
          size={16}
          diameter={34}
          tone="plain"
          onPress={onClose}
          style={{ marginVertical: -6 }}
        />
      ) : null}
    </View>
  );
}

// ---- 小标签 ------------------------------------------------------------------------------

export type PillTone = "acc" | "accSolid" | "ink" | "ok" | "warn" | "err" | "grey" | "card";

/** 底色、字色，和白底标签的描边色（有描边的是白底配同色线框） */
function pillColors(tone: PillTone, c: ComicColors): { bg: string; fg: string; line?: string } {
  switch (tone) {
    case "acc":
    case "accSolid":
      return { bg: c.acc, fg: c.onAcc };
    case "ink":
      return { bg: c.ink, fg: c.paper };
    case "ok":
      return { bg: c.paper, fg: c.forest, line: c.forest };
    case "warn":
      return { bg: c.paper, fg: c.warn, line: c.warn };
    case "err":
      return { bg: c.paper, fg: c.err, line: c.err };
    case "grey":
    case "card":
      return { bg: c.paper, fg: c.ink, line: c.ink };
  }
}

/** 小标签（圆角 6，粗体小字）：状态、“我”、“导演”、上下文长度。dot 是前面的小圆点（“正在写下一段”） */
export function Pill({
  label,
  tone = "grey",
  icon,
  dot,
  mono,
  height = 22,
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
  const c = useComic();
  const pc = pillColors(tone, c);
  const fontSize = height <= 20 ? 11 : height >= 28 ? 13 : 12;
  return (
    <View
      style={[
        styles.pill,
        {
          height,
          backgroundColor: pc.bg,
          paddingLeft: icon || dot ? 7 : 8,
          paddingRight: 8,
          boxShadow: pc.line ? `inset 0 0 0 ${comicStroke.chip}px ${pc.line}` : undefined,
        },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: pc.fg }]} /> : null}
      {icon ? <Icon name={icon} size={height <= 24 ? 13 : 15} color={pc.fg} strokeWidth={2.4} /> : null}
      <Text
        numberOfLines={1}
        style={[
          { fontSize, color: pc.fg, fontWeight: "700" },
          mono ? { fontFamily: font.monoMedium, fontWeight: "normal" } : null,
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

/** 小标签：solid = 蓝底（“我”），soft = 白底蓝框（“导演”“新”），ink = 墨底，plain = 白底墨框等宽（128K） */
export function Tag({
  label,
  variant = "plain",
}: {
  label: string;
  variant?: "solid" | "soft" | "ink" | "plain";
}) {
  const c = useComic();
  if (variant === "soft") {
    return (
      <Pill
        label={label}
        tone="card"
        height={20}
        style={{ boxShadow: `inset 0 0 0 ${comicStroke.chip}px ${c.acc}` }}
      />
    );
  }
  const tone: PillTone = variant === "solid" ? "accSolid" : variant === "ink" ? "ink" : "grey";
  return <Pill label={label} tone={tone} height={20} mono={variant === "plain"} />;
}

/**
 * 空状态和加载失败共用的大格子：白底 2.5 墨线，上半是网点底，中间一个墨线方块放图标（投影 4）；
 * 下面标题、说明和一个按钮。
 */
export function EmptyPanel({
  icon,
  filled,
  iconColor,
  title,
  message,
  action,
  style,
}: {
  icon: IconName;
  /** 用实心图标（主体填蓝）；只有 Tab 栏那几个图标有实心版 */
  filled?: FilledIconName;
  iconColor?: string;
  title: string;
  message: ReactNode;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  return (
    <View style={[styles.panel, { backgroundColor: c.paper, borderColor: c.ink }, style]}>
      <Halftone tone="ink" style={[styles.panelTop, { borderColor: c.ink }]}>
        <View
          style={[
            styles.panelIcon,
            { backgroundColor: c.paper, borderColor: c.ink, boxShadow: hardShadow(c.ink, comicDepth.raised) },
          ]}
        >
          {filled ? <FilledIcon name={filled} size={36} /> : <Icon name={icon} size={32} color={iconColor ?? c.acc} />}
        </View>
      </Halftone>
      <View style={styles.panelBody}>
        <Text accessibilityRole="header" style={[ctype.title, { fontSize: 24, lineHeight: 30, color: c.ink }]}>
          {title}
        </Text>
        {typeof message === "string" ? (
          <Text style={{ fontSize: 15, lineHeight: 23, color: c.ink2 }}>{message}</Text>
        ) : (
          message
        )}
        {action}
      </View>
    </View>
  );
}

/** 加载失败：同一种大格子，红色图标、标题、说明、“重新加载” */
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
  const c = useComic();
  const { t } = useTranslation();
  return (
    <View accessibilityRole="alert">
      <EmptyPanel
        icon={icon}
        iconColor={c.err}
        title={title}
        message={message}
        style={[{ marginHorizontal: 20 }, style]}
        action={
          onRetry ? (
            <Button
              label={t("common.reload")}
              variant={primary ? "primary" : "secondary"}
              icon="retry"
              onPress={onRetry}
              style={{ alignSelf: "stretch", marginTop: space.s }}
            />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 10,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  noticeWithAction: { paddingVertical: 6, paddingRight: 6 },
  text: { fontSize: 14, lineHeight: 20 },
  action: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: comicRadius.chip,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  panel: {
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    overflow: "hidden",
  },
  panelTop: {
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: comicStroke.frame,
  },
  panelIcon: {
    width: 80,
    height: 80,
    borderRadius: 18,
    borderWidth: comicStroke.frame,
    alignItems: "center",
    justifyContent: "center",
  },
  panelBody: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 18, gap: 10 },
});
