/**
 * 输入控件：输入框、分段、标签、勾选、单选、开关。页面经 ui.tsx 引用。
 *
 * 能列举的选项做成标签、勾选或分段；只有名字、密钥、自由行动这几处保留输入框。
 * 输入框填色无边；聚焦 = 一圈 2px acc，错误 = 浅红底加 1.5px 红圈和说明。
 * 选中 = 黑底，或浅蓝底加 2px 蓝色内描边；分段控件的选中项是浮起的白色胶囊。
 */

import { forwardRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { font, onColor, radius, size, space, type, usePalette } from "../theme/index.ts";
import { Icon, type IconName } from "./icons.tsx";

// ---- 输入框 ------------------------------------------------------------------------------

export type FieldProps = TextInputProps & {
  label: string;
  /** 只给读屏用，不显示 */
  hideLabel?: boolean;
  /** 标签后面的“可选” */
  optional?: boolean;
  /** 在标签行右边显示“已输入 / 上限”（需要 maxLength） */
  counter?: boolean;
  hint?: string;
  hintIcon?: IconName;
  error?: string | null;
  mono?: boolean;
  /** 放在灰卡上：输入框改用白色 card 底 */
  onGrey?: boolean;
  /** 输入框里右侧的按钮（显示密码、随机、粘贴） */
  trailing?: ReactNode;
  /** 右侧按钮占的宽度，输入的文字不会伸到它下面 */
  trailingWidth?: number;
  /** 多行输入框的高度 */
  boxHeight?: number;
  /** 额外的说明行（密码长度条之类），放在输入框下面 */
  below?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  {
    label,
    hideLabel,
    optional,
    counter,
    hint,
    hintIcon,
    error,
    mono,
    onGrey,
    trailing,
    trailingWidth = 52,
    boxHeight,
    below,
    style,
    onFocus,
    onBlur,
    editable = true,
    ...input
  },
  ref,
) {
  const palette = usePalette();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const multiline = !!input.multiline;
  const count = `${input.value?.length ?? 0} / ${input.maxLength ?? 0}`;
  const bg = !editable ? palette.bg3 : error ? palette.errBg : onGrey ? palette.card : palette.bg2;
  const ring = !editable
    ? undefined
    : error
      ? `inset 0 0 0 1.5px ${palette.err}`
      : focused
        ? `inset 0 0 0 2px ${palette.acc}`
        : undefined;
  return (
    <View style={[styles.field, style]}>
      {hideLabel ? null : (
        <View style={styles.labelRow}>
          <Text style={[type.label, { color: palette.ink2, flex: 1 }]}>
            {label}
            {optional ? (
              <Text style={{ color: palette.mut, fontWeight: "400" }}> {t("common.optional")}</Text>
            ) : null}
          </Text>
          {counter && input.maxLength && !multiline ? (
            <Text style={[styles.count, { color: palette.mut }]}>{count}</Text>
          ) : null}
        </View>
      )}
      <View>
        <TextInput
          ref={ref}
          placeholderTextColor={palette.mut}
          accessibilityLabel={label}
          editable={editable}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
          style={[
            styles.input,
            { borderRadius: onGrey ? 16 : radius.input },
            multiline ? [styles.multiline, { height: boxHeight ?? 100 }] : null,
            mono ? { fontFamily: font.mono, fontSize: 15 } : null,
            trailing ? { paddingRight: trailingWidth + 8 } : null,
            { color: editable ? palette.ink : palette.mut, backgroundColor: bg, boxShadow: ring },
          ]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        {counter && input.maxLength && multiline ? (
          <Text style={[styles.count, styles.innerCount, { color: palette.mut }]}>{count}</Text>
        ) : null}
      </View>
      {below}
      {error ? (
        <View style={styles.message}>
          <Icon name="alertCircle" size={15} color={palette.err} />
          <Text style={[styles.messageText, { color: palette.err }]}>{error}</Text>
        </View>
      ) : hint ? (
        <View style={styles.message}>
          {hintIcon ? <Icon name={hintIcon} size={14} color={palette.mut} /> : null}
          <Text style={[styles.hint, { color: palette.mut }]}>{hint}</Text>
        </View>
      ) : null}
    </View>
  );
});

// ---- 分段 -------------------------------------------------------------------------------

/** 几个互斥选项：凹进去的灰色轨道，选中项是浮起的白色胶囊 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  mono,
  height = 48,
  trackColor,
  selectedColor,
  style,
}: {
  label?: string;
  value: T | null;
  options: { value: T; label: string; icon?: IconName; count?: number | string }[];
  onChange: (value: T) => void;
  mono?: boolean;
  /** 整条轨道的高度 */
  height?: number;
  trackColor?: string;
  selectedColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const inner = height - 8;
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={[type.label, styles.label, { color: palette.ink2 }]}>{label}</Text> : null}
      <View
        style={[styles.segmented, { borderRadius: height / 2, backgroundColor: trackColor ?? palette.bg3 }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const fg = selected ? palette.ink : palette.ink2;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={[
                styles.segment,
                { height: inner, borderRadius: inner / 2 },
                selected
                  ? { backgroundColor: selectedColor ?? palette.card, boxShadow: palette.shadowLift }
                  : null,
              ]}
            >
              {option.icon ? <Icon name={option.icon} size={16} color={fg} /> : null}
              <Text
                numberOfLines={1}
                style={[
                  { fontSize: mono ? 14 : 14.5, color: fg },
                  mono ? { fontFamily: selected ? font.monoMedium : font.mono } : null,
                  selected && !mono ? { fontWeight: "600" } : null,
                ]}
              >
                {option.label}
              </Text>
              {option.count !== undefined ? (
                <Text style={{ fontFamily: font.mono, fontSize: 11, color: palette.mut }}>
                  {option.count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---- 标签 -------------------------------------------------------------------------------

/** 可点的胶囊标签。选中时黑底，check 为真时前面加一个对勾 */
export function Chip({
  label,
  selected = false,
  onPress,
  onLongPress,
  check,
  icon,
  small,
  muted,
  onGrey,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  check?: boolean;
  icon?: IconName;
  small?: boolean;
  /** “+ 自定义”这类入口，用蓝字 */
  muted?: boolean;
  /** 放在灰卡上：未选中时用白色 card 底 */
  onGrey?: boolean;
}) {
  const palette = usePalette();
  const fg = selected ? palette.bg : muted ? palette.acc : palette.ink;
  const h = small ? 34 : size.chip;
  return (
    <Pressable
      accessibilityRole={check ? "checkbox" : "button"}
      accessibilityState={check ? { checked: selected } : { selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.chip,
        {
          height: h,
          borderRadius: h / 2,
          paddingHorizontal: small ? 12 : space.l,
          backgroundColor: selected
            ? palette.ink
            : pressed
              ? palette.bg3
              : onGrey
                ? palette.card
                : palette.bg2,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      {selected && check ? <Icon name="check" size={14} color={fg} strokeWidth={2.4} /> : null}
      {icon ? <Icon name={icon} size={15} color={fg} /> : null}
      <Text style={{ fontSize: small ? 13 : 14, lineHeight: 18, color: fg }}>{label}</Text>
    </Pressable>
  );
}

// ---- 勾选、单选、开关 ----------------------------------------------------------------------

/** 22 的圆角勾选框：勾上是蓝底白勾 */
export function CheckMark({ checked }: { checked: boolean }) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.box,
        { borderRadius: 7 },
        checked
          ? { backgroundColor: palette.acc }
          : { backgroundColor: palette.card, boxShadow: `inset 0 0 0 1.75px ${palette.line2}` },
      ]}
    >
      {checked ? <Icon name="check" size={14} color={onColor} strokeWidth={2.6} /> : null}
    </View>
  );
}

/** 22 的单选圈：选中是 7px 的蓝色内圈 */
export function RadioMark({ selected }: { selected: boolean }) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.box,
        { borderRadius: 11 },
        {
          boxShadow: selected ? `inset 0 0 0 7px ${palette.acc}` : `inset 0 0 0 1.75px ${palette.line2}`,
        },
      ]}
    />
  );
}

export function Checkbox({
  label,
  checked,
  onToggle,
  plus,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  /** “其他…”入口：前面是浅蓝底的加号，不是勾选框 */
  plus?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole={plus ? "button" : "checkbox"}
      accessibilityState={plus ? undefined : { checked }}
      onPress={onToggle}
      style={styles.checkRow}
    >
      {plus ? (
        <View style={[styles.box, { borderRadius: 7, backgroundColor: palette.accBg }]}>
          <Icon name="plus" size={14} color={palette.acc} strokeWidth={2.2} />
        </View>
      ) : (
        <CheckMark checked={checked} />
      )}
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: plus ? palette.acc : palette.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 开关：全圆的轨道和白色滑块，打开时蓝色 */
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[styles.track, { backgroundColor: value ? palette.acc : palette.line2 }]}
    >
      <View style={[styles.knob, { left: value ? 22 : 2, boxShadow: palette.shadowKnob }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
  labelRow: { flexDirection: "row", alignItems: "baseline", gap: space.s, paddingHorizontal: space.xs },
  label: { paddingLeft: space.xs },
  count: { fontFamily: font.mono, fontSize: 12, lineHeight: 16 },
  innerCount: { position: "absolute", right: 12, bottom: 10, fontSize: 11 },
  input: {
    minHeight: size.input,
    paddingHorizontal: space.l,
    paddingVertical: 0,
    fontSize: 16,
  },
  multiline: {
    paddingTop: 14,
    paddingBottom: 26,
    borderRadius: 18,
    fontSize: 15,
    lineHeight: 24,
    textAlignVertical: "top",
  },
  trailing: { position: "absolute", right: 6, top: 0, bottom: 0, justifyContent: "center" },
  message: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: space.xs },
  messageText: { fontSize: 13, lineHeight: 18, flex: 1 },
  hint: { fontSize: 12.5, lineHeight: 18, flex: 1 },
  segmented: { flexDirection: "row", padding: 4, gap: 4 },
  segment: { flex: 1, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6 },
  box: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: size.touch },
  track: { width: 51, height: 31, borderRadius: 15.5 },
  knob: {
    position: "absolute",
    top: 2,
    width: 27,
    height: 27,
    borderRadius: 13.5,
    backgroundColor: onColor,
  },
});
