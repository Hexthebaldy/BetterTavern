/**
 * 输入控件（漫画风）：输入框、分段、标签、勾选、单选、开关。页面经 ui.tsx 引用。
 *
 * 能列举的选项做成标签、勾选或分段；只有名字、密钥、自由行动这几处保留输入框。
 * 输入框白底 2 墨线，圆角 12；聚焦时 2.5 蓝框加蓝投影 3；出错时红边、浅红底，下面一行红字。
 * 分段是 2 墨线的方块条，选中的一段墨底白字；标签、勾选、开关都是 2 墨线，选中墨底或蓝底。
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

import {
  comicDepth,
  comicRadius,
  comicStroke,
  ctype,
  font,
  hardShadow,
  onColor,
  size,
  space,
  useComic,
} from "../theme/index.ts";
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
  /** 旧样式里放在灰卡上时用；漫画风的输入框都是白底，不再起作用 */
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
    onGrey: _onGrey,
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
  const c = useComic();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const multiline = !!input.multiline;
  const count = `${input.value?.length ?? 0} / ${input.maxLength ?? 0}`;
  const bg = !editable ? c.grey : error ? c.errField : c.paper;
  const border = !editable ? c.line2 : error ? c.err : focused ? c.acc : c.ink;
  const ring = editable && focused ? hardShadow(error ? c.err : c.acc, comicDepth.focus) : undefined;
  return (
    <View style={[styles.field, style]}>
      {hideLabel ? null : (
        <View style={styles.labelRow}>
          <Text style={[ctype.label, { color: c.ink, flex: 1 }]}>
            {label}
            {optional ? (
              <Text style={{ color: c.mut, fontWeight: "500", fontSize: 12.5 }}> {t("common.optional")}</Text>
            ) : null}
          </Text>
          {counter && input.maxLength && !multiline ? (
            <Text style={[styles.count, { color: c.mut }]}>{count}</Text>
          ) : null}
        </View>
      )}
      <View>
        <TextInput
          ref={ref}
          placeholderTextColor={c.mut}
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
            multiline ? [styles.multiline, { height: boxHeight ?? 100 }] : null,
            mono ? { fontFamily: font.monoMedium, fontSize: 15 } : null,
            trailing ? { paddingRight: trailingWidth + 8 } : null,
            {
              color: editable ? c.ink : c.mut,
              backgroundColor: bg,
              borderColor: border,
              borderWidth: focused && editable ? comicStroke.frame : comicStroke.control,
              boxShadow: ring,
            },
          ]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        {counter && input.maxLength && multiline ? (
          <Text style={[styles.count, styles.innerCount, { color: c.mut }]}>{count}</Text>
        ) : null}
      </View>
      {below}
      {error ? (
        <View style={styles.message}>
          <Icon name="alertCircle" size={15} color={c.err} />
          <Text style={[styles.messageText, { color: c.err }]}>{error}</Text>
        </View>
      ) : hint ? (
        <View style={styles.message}>
          {hintIcon ? <Icon name={hintIcon} size={14} color={c.mut} /> : null}
          <Text style={[styles.hint, { color: c.mut }]}>{hint}</Text>
        </View>
      ) : null}
    </View>
  );
});

// ---- 分段 -------------------------------------------------------------------------------

/** 几个互斥选项：2 墨线的方块条，段与段之间一道墨线，选中的一段墨底白字 */
export function Segmented<T extends string>({
  label,
  hideLabel,
  value,
  options,
  onChange,
  mono,
  height = 40,
  style,
}: {
  label?: string;
  /** 标签只给读屏用，不显示 */
  hideLabel?: boolean;
  value: T | null;
  options: { value: T; label: string; icon?: IconName; count?: number | string }[];
  onChange: (value: T) => void;
  mono?: boolean;
  /** 整条的高度 */
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useComic();
  return (
    <View style={[styles.field, style]}>
      {label && !hideLabel ? <Text style={[ctype.label, styles.label, { color: c.ink }]}>{label}</Text> : null}
      <View
        style={[styles.segmented, { height, backgroundColor: c.paper, borderColor: c.ink }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((option, i) => {
          const selected = option.value === value;
          const fg = selected ? c.paper : c.ink;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.segment,
                i > 0 ? { borderLeftWidth: comicStroke.control, borderLeftColor: c.ink } : null,
                { backgroundColor: selected ? c.ink : pressed ? c.grey : "transparent" },
              ]}
            >
              {option.icon ? <Icon name={option.icon} size={16} color={fg} /> : null}
              <Text
                numberOfLines={1}
                style={[
                  { flexShrink: 1, fontSize: 14, fontWeight: "600", color: fg },
                  mono ? { fontFamily: font.monoMedium, fontWeight: "normal" } : null,
                ]}
              >
                {option.label}
              </Text>
              {option.count !== undefined ? (
                <Text style={{ fontFamily: font.monoMedium, fontSize: 11, color: selected ? c.sky : c.mut }}>
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

/** 可点的标签：2 墨线的圆角块，选中时墨底白字，check 为真时前面加一个对勾；muted（“+ 自定义”）是虚线框蓝字 */
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
  /** 旧样式里放在灰卡上时用；漫画风的标签都是白底，不再起作用 */
  onGrey?: boolean;
}) {
  const c = useComic();
  const fg = selected ? c.paper : muted ? c.acc : c.ink;
  const h = small ? 30 : 34;
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
          paddingHorizontal: small ? 10 : 12,
          borderColor: c.ink,
          borderStyle: muted && !selected ? "dashed" : "solid",
          backgroundColor: selected ? c.ink : pressed ? c.grey : c.paper,
        },
      ]}
    >
      {selected && check ? <Icon name="check" size={14} color={fg} strokeWidth={2.6} /> : null}
      {icon ? <Icon name={icon} size={15} color={fg} /> : null}
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: small ? 13 : 13.5, lineHeight: 18, fontWeight: "600", color: fg }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---- 勾选、单选、开关 ----------------------------------------------------------------------

/** 22 的勾选框：2 墨线，圆角 6；勾上是蓝底白勾 */
export function CheckMark({ checked }: { checked: boolean }) {
  const c = useComic();
  return (
    <View
      style={[
        styles.box,
        { borderRadius: comicRadius.chip, borderColor: c.ink, backgroundColor: checked ? c.acc : c.paper },
      ]}
    >
      {checked ? <Icon name="check" size={14} color={c.onAcc} strokeWidth={2.8} /> : null}
    </View>
  );
}

/** 22 的单选圈：2 墨线；选中是 7 的蓝圈，外面一圈墨线 */
export function RadioMark({ selected }: { selected: boolean }) {
  const c = useComic();
  return (
    <View
      style={[
        styles.box,
        { borderRadius: 11, backgroundColor: c.paper },
        selected
          ? { borderWidth: 7, borderColor: c.acc, boxShadow: `0 0 0 2px ${c.ink}` }
          : { borderColor: c.ink },
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
  /** “其他…”入口：前面是虚线框里的蓝色加号，不是勾选框 */
  plus?: boolean;
}) {
  const c = useComic();
  return (
    <Pressable
      accessibilityRole={plus ? "button" : "checkbox"}
      accessibilityState={plus ? undefined : { checked }}
      onPress={onToggle}
      style={styles.checkRow}
    >
      {plus ? (
        <View
          style={[
            styles.box,
            { borderRadius: comicRadius.chip, borderColor: c.acc, borderStyle: "dashed", backgroundColor: c.paper },
          ]}
        >
          <Icon name="plus" size={14} color={c.acc} strokeWidth={2.6} />
        </View>
      ) : (
        <CheckMark checked={checked} />
      )}
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: plus ? c.acc : c.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 开关：2 墨线的胶囊，墨色圆钮；打开是蓝底、白钮加一圈墨线 */
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  const c = useComic();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[styles.track, { borderColor: c.ink, backgroundColor: value ? c.acc : c.paper }]}
    >
      <View
        style={[
          styles.knob,
          value
            ? { left: 23, backgroundColor: onColor, boxShadow: `0 0 0 2px ${c.ink}` }
            : { left: 3, backgroundColor: c.ink },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
  labelRow: { flexDirection: "row", alignItems: "baseline", gap: space.s, paddingHorizontal: 2 },
  label: { paddingLeft: 2 },
  count: { fontFamily: font.monoMedium, fontSize: 12, lineHeight: 16 },
  innerCount: { position: "absolute", right: 14, bottom: 10, fontSize: 11 },
  input: {
    minHeight: 50,
    borderRadius: comicRadius.input,
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontSize: 16,
  },
  multiline: {
    paddingTop: 12,
    paddingBottom: 26,
    fontSize: 15,
    lineHeight: 23,
    textAlignVertical: "top",
  },
  trailing: { position: "absolute", right: 4, top: 0, bottom: 0, justifyContent: "center" },
  message: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 2 },
  messageText: { fontSize: 13, lineHeight: 18, flex: 1 },
  hint: { fontSize: 13, lineHeight: 20, flex: 1 },
  segmented: {
    flexDirection: "row",
    borderWidth: comicStroke.control,
    borderRadius: 11,
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  chip: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: comicStroke.control,
    borderRadius: 9,
  },
  box: {
    width: 22,
    height: 22,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: size.touch },
  track: { width: 50, height: 30, borderRadius: 15, borderWidth: comicStroke.control },
  knob: { position: "absolute", top: 3, width: 20, height: 20, borderRadius: 10 },
});
