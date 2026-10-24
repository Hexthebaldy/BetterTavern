/**
 * 按钮和图标按钮（漫画风）。页面经 ui.tsx 引用。
 *
 * 按钮是胶囊，2.5 墨线：主按钮墨底、蓝投影 4；次要按钮白底、墨投影 4；删除按钮红底；文字按钮没有边。
 * 推进流程的主按钮用 between + trailingIcon：文字靠左，右边一个圆形箭头。不能点时变灰、没有投影。
 * 图标按钮是圆角方块，2 墨线、墨投影 2；plain 没有边，active 是墨底蓝投影。
 */

import type { ReactNode, Ref } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import {
  comicDepth,
  comicRadius,
  comicStroke,
  ctype,
  onColor,
  size,
  space,
  useComic,
  usePalette,
} from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";
import { press } from "./press.ts";
import { Dots } from "./primitives.tsx";

export type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "dangerSolid";

const BUTTON_HEIGHT = 48;
const BUTTON_HEIGHT_ARROW = 52;
const BUTTON_HEIGHT_SM = 38;

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  icon,
  trailingIcon,
  between,
  small,
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
  /** 文字后的图标；between 时放进右边的圆里 */
  trailingIcon?: IconName;
  /** 文字靠左、图标靠右（推进流程时像在翻下一页） */
  between?: boolean;
  /** 小号：高 38，2 描边，投影 3 */
  small?: boolean;
  /** 旧样式里放在灰卡上时用；漫画风的按钮都是白底或墨底，不再起作用 */
  onGrey?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  /** 替换文字部分（比如两行的按钮） */
  children?: ReactNode;
}) {
  const c = useComic();
  const palette = usePalette();
  const inactive = !!disabled || !!busy;
  const off = !!disabled && !busy;
  const look: Record<ButtonVariant, { bg: string; fg: string; shadow: string }> = {
    primary: { bg: c.ink, fg: c.paper, shadow: c.acc },
    secondary: { bg: c.paper, fg: c.ink, shadow: c.ink },
    text: { bg: "transparent", fg: c.acc, shadow: c.ink },
    danger: { bg: c.paper, fg: c.err, shadow: c.ink },
    dangerSolid: { bg: c.danger, fg: onColor, shadow: c.ink },
  };
  const tone = look[variant];
  const fg = off && variant !== "text" ? c.paper : tone.fg;
  const framed = variant !== "text";
  const arrowInCircle = between && trailingIcon;
  const depth = framed && !off ? (small ? comicDepth.focus : comicDepth.raised) : 0;
  const height = small ? BUTTON_HEIGHT_SM : arrowInCircle ? BUTTON_HEIGHT_ARROW : BUTTON_HEIGHT;
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
        { minHeight: height, borderRadius: height / 2 },
        small ? styles.small : null,
        between && styles.between,
        arrowInCircle ? styles.withArrow : null,
        framed
          ? {
              borderWidth: small ? comicStroke.control : comicStroke.frame,
              borderColor: off ? c.disabledLine : c.ink,
              backgroundColor: off ? c.disabled : tone.bg,
            }
          : styles.textButton,
        framed
          ? press(pressed && !inactive, depth, tone.shadow)
          : { backgroundColor: pressed && !inactive ? c.grey : "transparent", opacity: off ? 0.4 : 1 },
        style,
      ]}
    >
      {busy ? (
        <Dots color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={fg} /> : null}
          {children ?? (
            // 窄按钮里的长文字（英文）缩进按钮里换行，不撑出去
            <Text
              style={[
                small ? ctype.buttonSm : ctype.button,
                { flexShrink: 1, color: fg },
                between ? null : { textAlign: "center" },
              ]}
            >
              {label}
            </Text>
          )}
          {arrowInCircle ? (
            <View
              style={[
                styles.arrow,
                { backgroundColor: variant === "primary" ? palette.arrowBg : c.grey },
              ]}
            >
              <Icon name={trailingIcon} size={18} color={fg} />
            </View>
          ) : trailingIcon ? (
            <Icon name={trailingIcon} size={20} color={fg} />
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export type IconButtonTone = "grey" | "plain" | "card";

/**
 * 图标按钮：圆角方块（38 以下圆角 10，再大 12），2 墨线、白底、墨投影 2；热区至少 44。
 * plain 透明没有边（输入框里的显示密码）；card 和默认一样（以前是叠在封面图上的白色圆按钮）。
 * active 是墨底白图标、蓝投影（阅读页停靠着的世界状态、开着的“更多”）。
 */
export function IconButton({
  ref,
  icon,
  label,
  onPress,
  color,
  size: iconSize = 22,
  diameter = 40,
  tone = "grey",
  active,
  disabled,
  badge,
  style,
}: {
  /** 量按钮位置用（平板上贴着按钮弹出的菜单） */
  ref?: Ref<View>;
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  diameter?: number;
  tone?: IconButtonTone;
  active?: boolean;
  disabled?: boolean;
  /** 右上角的蓝色小圆点 */
  badge?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  const plain = tone === "plain";
  const slop = Math.max(0, (size.touch - diameter) / 2);
  const shadow = active ? c.acc : c.ink;
  const depth = plain || disabled ? 0 : comicDepth.iconButton;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: active || undefined }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={slop}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter <= 38 ? comicRadius.iconButtonSm : comicRadius.iconButton,
        },
        plain
          ? { backgroundColor: pressed ? c.grey : "transparent" }
          : {
              borderWidth: comicStroke.control,
              borderColor: c.ink,
              backgroundColor: active ? c.ink : c.paper,
              opacity: disabled ? 0.4 : 1,
            },
        plain ? null : press(pressed && !disabled, depth, shadow),
        style,
      ]}
    >
      <Icon name={icon} size={iconSize} color={color ?? (active ? c.paper : c.ink)} />
      {badge ? <View style={[styles.badge, { backgroundColor: c.acc, borderColor: c.paper }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  small: { paddingHorizontal: space.l, gap: space.s },
  textButton: { minHeight: size.touch, paddingHorizontal: space.m, borderWidth: 0 },
  between: { justifyContent: "space-between" },
  withArrow: { paddingLeft: 22, paddingRight: space.s },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButton: { alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 4, right: 4, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
