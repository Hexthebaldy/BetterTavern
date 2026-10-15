/**
 * 行动面板（ActionBar.tsx）里的几块内容：选项行、“自己写…”行、自由输入、生成中的状态行，
 * 以及放在面板右下角的世界状态和“更多”两个圆按钮。
 * 平板上世界状态停靠着、或者“更多”菜单开着时，对应的按钮显示为选中（墨色底、反白图标）。
 */

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import type { TurnOption } from "../../api/types.ts";
import { Icon, IconButton, useSheetSurfaces } from "../../components/ui.tsx";
import { font, radius, size, space, usePalette } from "../../theme/index.ts";

const MAX_TEXT = 2000;
const KEYS = ["A", "B", "C", "D"];

/** 拖拽条形状的状态条：一段 18 宽的颜色在 44 宽的槽里来回移动 */
function Handle({ warn }: { warn: boolean }) {
  const palette = usePalette();
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  const { width, height, segment } = size.handle;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.handle,
        { width, height, borderRadius: height / 2, backgroundColor: warn ? palette.warnBg : palette.bg3 },
      ]}
    >
      <Animated.View
        style={{
          width: segment,
          height,
          borderRadius: height / 2,
          backgroundColor: warn ? palette.warn : palette.acc,
          opacity: warn ? 0.6 : 1,
          transform: [
            { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, width - segment] }) },
          ],
        }}
      />
    </View>
  );
}

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
            <View style={[styles.key, { backgroundColor: on ? palette.acc : palette.sheet }]}>
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

export function Generating({
  label,
  reconnecting,
  onStop,
  tools,
}: {
  label: string;
  reconnecting: boolean;
  onStop: (() => void) | null;
  /** 世界状态和“更多”两个圆按钮，放在“停止”左边 */
  tools: ReactNode;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  return (
    <View>
      <Handle warn={reconnecting} />
      <View style={styles.gen}>
        <View
          style={[
            styles.genDot,
            reconnecting
              ? { backgroundColor: palette.warn }
              : { backgroundColor: palette.acc, boxShadow: `0 0 0 4px ${palette.accBg}` },
          ]}
        />
        <Text style={{ flex: 1, fontSize: 15, color: palette.ink }}>
          {label}
          {reconnecting ? <Text style={{ fontSize: 13, color: palette.mut }}> · 已写好的不会丢</Text> : null}
        </Text>
        {tools}
        {onStop ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="停止"
            onPress={onStop}
            style={({ pressed }) => [
              styles.stop,
              { backgroundColor: surfaces.fill, transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            <Icon name="stop" size={16} />
            <Text style={{ fontSize: 15, color: palette.ink }}>停止</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** 世界状态和“更多”（阅读设置、重命名、删除）两个圆按钮，放在面板右下角 */
export function PanelTools({
  onWorld,
  onMore,
  worldActive,
  moreActive,
  moreRef,
}: {
  onWorld: () => void;
  onMore: () => void;
  /** 世界状态停靠着（平板宽屏），再点一次收起 */
  worldActive?: boolean;
  /** “更多”菜单正贴着按钮开着（平板） */
  moreActive?: boolean;
  /** “更多”按钮：平板上菜单贴着它弹出 */
  moreRef?: Ref<View>;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const look = (active?: boolean) =>
    active
      ? { style: { backgroundColor: palette.ink }, color: palette.bg }
      : { style: { backgroundColor: surfaces.fill } };
  return (
    <View style={styles.tools}>
      <IconButton
        icon="world"
        label={worldActive ? "收起世界状态" : "世界状态"}
        onPress={onWorld}
        {...look(worldActive)}
      />
      <IconButton
        ref={moreRef}
        icon="more"
        label="更多：阅读设置、重命名、删除"
        onPress={onMore}
        {...look(moreActive)}
      />
    </View>
  );
}

/** 选项下面的第三行：左边“自己写…”（有草稿时显示草稿），右边是两个圆按钮 */
export function WriteRow({
  draft,
  enabled,
  onWrite,
  tools,
}: {
  draft: string;
  enabled: boolean;
  onWrite: () => void;
  tools: ReactNode;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  return (
    <View style={styles.writeRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={draft ? "继续写草稿" : "自己写"}
        onPress={onWrite}
        disabled={!enabled}
        style={({ pressed }) => [
          styles.write,
          { backgroundColor: pressed ? surfaces.fill : "transparent", opacity: enabled ? 1 : 0.3 },
        ]}
      >
        <View style={[styles.key, { backgroundColor: surfaces.fill }]}>
          <Icon name="write" size={16} color={palette.mut} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: palette.mut }}>
          {draft ? draft : "自己写…"}
        </Text>
      </Pressable>
      {tools}
    </View>
  );
}

const styles = StyleSheet.create({
  handle: { alignSelf: "center", marginTop: 2, marginBottom: 6, overflow: "hidden" },
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
  writeRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 6 },
  write: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 52,
    paddingLeft: space.m,
    paddingRight: space.m,
    borderRadius: radius.option,
  },
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
  gen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 56,
    paddingLeft: space.m,
    paddingRight: 4,
  },
  genDot: { width: 8, height: 8, borderRadius: 4 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 48,
    paddingLeft: 14,
    paddingRight: 18,
    borderRadius: 24,
  },
  tools: { flexDirection: "row", alignItems: "center", gap: 6 },
});
