/**
 * 阅读页的两块输入：选项行（TurnActions.tsx，接在故事流末尾）和自由输入（底部操作栏 BottomBar.tsx 展开后）。
 */

import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";

import type { TurnOption } from "../../api/types.ts";
import { Icon, useSheetSurfaces } from "../../components/ui.tsx";
import { font, radius, size, space, usePalette } from "../../theme/index.ts";

const MAX_TEXT = 2000;
const KEYS = ["A", "B", "C", "D"];

export function OptionRow({
  option,
  index,
  disabled,
  chosen,
  dimmed,
  onPress,
  style,
}: {
  option: TurnOption;
  index: number;
  disabled: boolean;
  chosen: boolean;
  dimmed: boolean;
  onPress: () => void;
  /** 平板宽屏排两列时的宽度和最小高度 */
  style?: StyleProp<ViewStyle>;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${KEYS[index] ?? ""}：${option.text}`}
      accessibilityHint="选择这个行动"
      accessibilityState={{ disabled, selected: chosen }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => {
        const on = chosen || pressed;
        return [
          styles.option,
          {
            backgroundColor: on ? palette.accBg : surfaces.fill,
            boxShadow: on ? `inset 0 0 0 2px ${palette.acc}` : undefined,
            opacity: dimmed ? 0.4 : 1,
            transform: [{ scale: on ? 0.98 : 1 }],
          },
          style,
        ];
      }}
    >
      {({ pressed }) => {
        const on = chosen || pressed;
        return (
          <>
            <View style={[styles.key, { backgroundColor: on ? palette.acc : surfaces.onFill }]}>
              <Text style={[styles.keyText, { color: on ? palette.bg : palette.ink }]}>
                {KEYS[index] ?? "·"}
              </Text>
            </View>
            <Text style={[styles.optionText, { color: palette.ink }]}>{option.text}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

export function FreeInput({
  draft,
  onDraft,
  disabled,
  onSend,
  onClose,
}: {
  draft: string;
  onDraft: (text: string) => void;
  disabled: boolean;
  onSend: (text: string) => void;
  /** 没有选项时没法收起 */
  onClose: (() => void) | null;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const [focused, setFocused] = useState(false);
  const trimmed = draft.trim();
  const left = MAX_TEXT - draft.length;
  const blocked = disabled || !trimmed;
  return (
    <View style={styles.inputBlock}>
      <TextInput
        value={draft}
        onChangeText={onDraft}
        placeholder="我……（用第一人称写下你要做的事）"
        placeholderTextColor={palette.mut}
        multiline
        autoFocus={onClose !== null}
        maxLength={MAX_TEXT}
        accessibilityLabel="我要做的事"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          {
            color: palette.ink,
            backgroundColor: surfaces.fill,
            boxShadow: focused ? `inset 0 0 0 2px ${palette.acc}` : undefined,
          },
        ]}
      />
      <View style={styles.inputRow}>
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.collapse,
              { backgroundColor: surfaces.fill, transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Icon name="chevronDown" size={20} />
            <Text style={{ fontSize: 15, color: palette.ink }}>收起</Text>
          </Pressable>
        ) : null}
        {left <= 200 ? <Text style={[styles.left, { color: palette.mut }]}>剩 {left}</Text> : null}
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: blocked }}
          disabled={blocked}
          onPress={() => onSend(trimmed)}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: palette.pri,
              opacity: blocked ? 0.3 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
        >
          <View style={[styles.sendIcon, { backgroundColor: palette.arrowBg }]}>
            <Icon name="send" size={16} color={palette.onPri} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: "500", color: palette.onPri }}>发送</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: size.optionRow,
    paddingVertical: 10,
    paddingLeft: space.m,
    paddingRight: 14,
    borderRadius: radius.option,
  },
  key: {
    width: size.optionKey,
    height: size.optionKey,
    borderRadius: size.optionKey / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  keyText: { fontFamily: font.monoMedium, fontSize: 13 },
  optionText: { flex: 1, fontSize: 15, lineHeight: 22 },
  inputBlock: { gap: space.s },
  input: {
    height: 124,
    borderRadius: radius.option,
    paddingHorizontal: space.l,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 16,
    lineHeight: 25,
    textAlignVertical: "top",
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: space.s },
  collapse: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingLeft: space.m,
    paddingRight: space.l,
    borderRadius: 22,
  },
  left: { fontFamily: font.mono, fontSize: 12 },
  send: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 44,
    paddingLeft: space.s,
    paddingRight: 18,
    borderRadius: 22,
  },
  sendIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
