/**
 * 输入控件：输入框、分段、标签、勾选、单选、开关。页面经 ui.tsx 引用。
 *
 * 能列举的选项做成标签、勾选或分段；只有名字、密钥、自由行动这几处保留输入框。
 * 聚焦 = 2px 黑线，错误 = 1.5px 红线加叉号说明，选中 = 黑白反转。
 */

import { forwardRef, useState, type ReactNode } from "react";
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

import { font, onColor, size, space, type, usePalette } from "../theme/index.ts";
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
  /** 输入框里右侧的按钮（比如显示密码） */
  trailing?: ReactNode;
  /** 输入框右边的独立按钮（比如“粘贴”） */
  action?: ReactNode;
  /** 多行输入框的高度 */
  boxHeight?: number;
  /** 额外的说明行（密码强度条之类），放在输入框下面 */
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
    trailing,
    action,
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
  const [focused, setFocused] = useState(false);
  const multiline = !!input.multiline;
  const count = `${input.value?.length ?? 0} / ${input.maxLength ?? 0}`;
  const border = !editable
    ? { borderWidth: 0 }
    : error
      ? { borderWidth: 1.5, borderColor: palette.err }
      : focused
        ? { borderWidth: 2, borderColor: palette.ink }
        : { borderWidth: 1, borderColor: palette.line2 };
  return (
    <View style={[styles.field, style]}>
      {hideLabel ? null : (
        <View style={styles.labelRow}>
          <Text style={[type.label, { color: palette.ink2, flex: 1 }]}>
            {label}
            {optional ? <Text style={{ color: palette.mut, fontWeight: "400" }}> 可选</Text> : null}
          </Text>
          {counter && input.maxLength && !multiline ? (
            <Text style={[styles.count, { color: palette.mut }]}>{count}</Text>
          ) : null}
        </View>
      )}
      <View style={styles.inputRow}>
        <View style={{ flex: 1 }}>
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
              multiline ? [styles.multiline, { height: boxHeight ?? 96 }] : null,
              mono ? { fontFamily: font.mono, fontSize: 15 } : null,
              trailing ? { paddingRight: 52 } : null,
              {
                color: editable ? palette.ink : palette.mut,
                backgroundColor: editable ? palette.bg : palette.bg2,
              },
              border,
            ]}
          />
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
          {counter && input.maxLength && multiline ? (
            <Text style={[styles.count, styles.innerCount, { color: palette.mut }]}>{count}</Text>
          ) : null}
        </View>
        {action}
      </View>
      {below}
      {error ? (
        <View style={styles.message}>
          <Icon name="cross" size={15} color={palette.err} />
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

/** 几个互斥选项：选中项黑底白字 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  mono,
  height = 48,
  style,
}: {
  label?: string;
  value: T | null;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
  mono?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={[type.label, { color: palette.ink2 }]}>{label}</Text> : null}
      <View
        style={[styles.segmented, { borderColor: palette.line2 }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const fg = selected ? palette.bg : palette.ink2;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.segment,
                { height: height - 2 },
                index > 0 && { borderLeftWidth: 1, borderLeftColor: palette.line2 },
                { backgroundColor: selected ? palette.ink : pressed ? palette.bg2 : "transparent" },
              ]}
            >
              {option.icon ? <Icon name={option.icon} size={16} color={fg} /> : null}
              <Text
                style={[
                  { fontSize: mono ? 14 : 15, color: fg },
                  mono ? { fontFamily: selected ? font.monoMedium : font.mono } : null,
                  selected && !mono ? { fontWeight: "500" } : null,
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

// ---- 标签 -------------------------------------------------------------------------------

/** 可点的标签。选中时黑白反转，check 为真时前面加一个对勾 */
export function Chip({
  label,
  selected = false,
  onPress,
  onLongPress,
  check,
  icon,
  small,
  muted,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  check?: boolean;
  icon?: IconName;
  small?: boolean;
  /** “+ 自定义”这类入口，文字弱一些 */
  muted?: boolean;
}) {
  const palette = usePalette();
  const fg = selected ? palette.bg : muted ? palette.mut : palette.ink;
  return (
    <Pressable
      accessibilityRole={check ? "checkbox" : "button"}
      accessibilityState={check ? { checked: selected } : { selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.chip,
        small ? styles.chipSmall : null,
        // 选中时边框换成墨色而不是去掉，宽度不变，标签不会挪动
        selected
          ? { backgroundColor: palette.ink, borderWidth: 1, borderColor: palette.ink }
          : {
              backgroundColor: pressed ? palette.bg2 : palette.bg,
              borderWidth: 1,
              borderColor: palette.line2,
            },
      ]}
    >
      {selected && check ? <Icon name="check" size={14} color={fg} /> : null}
      {icon ? <Icon name={icon} size={small ? 15 : 14} color={fg} /> : null}
      <Text style={{ fontSize: small ? 13 : 14, lineHeight: 18, color: fg }}>{label}</Text>
    </Pressable>
  );
}

// ---- 勾选、单选、开关 ----------------------------------------------------------------------

/** 20×20 的勾选框：勾上是蓝底白勾 */
export function CheckMark({ checked }: { checked: boolean }) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.box,
        checked ? { backgroundColor: palette.acc } : { borderWidth: 1.5, borderColor: palette.line2 },
      ]}
    >
      {checked ? <Icon name="check" size={14} color={onColor} strokeWidth={2.5} /> : null}
    </View>
  );
}

/** 20×20 的单选框：选中是 6px 的实心框 */
export function RadioMark({ selected, accent }: { selected: boolean; accent?: boolean }) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.box,
        selected
          ? { borderWidth: 6, borderColor: accent ? palette.acc : palette.ink }
          : { borderWidth: 1.5, borderColor: palette.line2 },
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
  /** “其他…”入口：前面是加号，不是勾选框 */
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
        <View style={styles.box}>
          <Icon name="plus" size={16} color={palette.mut} />
        </View>
      ) : (
        <CheckMark checked={checked} />
      )}
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: plus ? palette.mut : palette.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 开关：直角的轨道和滑块，打开时蓝色 */
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
      <View style={[styles.knob, { left: value ? 28 : 4, backgroundColor: palette.bg }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
  labelRow: { flexDirection: "row", alignItems: "baseline", gap: space.s },
  count: { fontFamily: font.mono, fontSize: 12, lineHeight: 16 },
  innerCount: { position: "absolute", right: 10, bottom: 8, fontSize: 11 },
  inputRow: { flexDirection: "row", gap: space.s },
  input: {
    minHeight: size.input,
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontSize: 16,
  },
  multiline: {
    paddingTop: space.m,
    paddingBottom: 24,
    fontSize: 15,
    lineHeight: 24,
    textAlignVertical: "top",
  },
  trailing: { position: "absolute", right: 4, top: 4, bottom: 4, justifyContent: "center" },
  message: { flexDirection: "row", alignItems: "center", gap: 6 },
  messageText: { fontSize: 13, lineHeight: 18, flex: 1 },
  hint: { fontSize: 12.5, lineHeight: 18, flex: 1 },
  segmented: { flexDirection: "row", borderWidth: 1 },
  segment: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: size.chip,
    paddingHorizontal: 14,
  },
  chipSmall: { height: 32, paddingHorizontal: 10 },
  box: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: size.touch },
  track: { width: 52, height: 28 },
  knob: { position: "absolute", top: 4, width: 20, height: 20 },
});
