/**
 * 阅读页的“更多”：阅读设置（宋体 / 黑体、字号），重命名故事、世界状态、删除故事。
 * 阅读设置存在设备上，所有故事共用。
 * 手机上是底部面板；平板上贴着操作栏的“更多”按钮弹出（宽 340，右边缘和按钮对齐，底边在按钮上方 8，不加遮罩）。
 */

import { useRef, useState, type RefObject } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";

import { MenuGroup, MenuItem, Sheet, useSheetSurfaces } from "../../components/ui.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { font, onColor, space, usePalette } from "../../theme/index.ts";
import {
  lineHeightFor,
  READING_SIZES,
  readingSize,
  sizeIndex,
  stepSize,
  type ReadingFont,
} from "./reading.ts";

/** 字号轨道两头的留白 */
const TRACK_PADDING = 14;

function FontChoice() {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const { reading, setReading } = usePrefs();
  const option = (value: ReadingFont, glyph: string, label: string) => {
    const on = reading.font === value;
    const fg = on ? palette.ink : palette.mut;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
        onPress={() => setReading({ ...reading, font: value })}
        style={[
          styles.fontOption,
          on ? { backgroundColor: surfaces.raised, boxShadow: palette.shadowLift } : null,
        ]}
      >
        <Text
          style={{
            fontSize: 20,
            color: fg,
            fontFamily: value === "serif" ? font.serif : undefined,
            fontWeight: value === "sans" ? "700" : "400",
          }}
        >
          {glyph}
        </Text>
        <Text style={{ fontSize: 15, fontWeight: on ? "600" : "400", color: fg }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="正文字体"
      style={[styles.fonts, { backgroundColor: surfaces.inset }]}
    >
      {option("serif", "宋", "宋体")}
      {option("sans", "黑", "黑体")}
    </View>
  );
}

const KNOB = 24;

/** 字号：两头是减小、增大的圆按钮，中间的轨道可以点或拖到某一档 */
function SizeControl() {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const { reading, setReading } = usePrefs();
  const [trackWidth, setTrackWidth] = useState(0);
  const lastIndex = useRef(-1);
  const size = readingSize(reading);
  const index = sizeIndex(size);
  const ratio = index / (READING_SIZES.length - 1);

  const pick = (e: GestureResponderEvent): void => {
    if (trackWidth <= 0) return;
    // locationX 从轨道区域的左边算起，要减掉两边的留白
    const r = Math.min(Math.max((e.nativeEvent.locationX - TRACK_PADDING) / trackWidth, 0), 1);
    const next = Math.round(r * (READING_SIZES.length - 1));
    if (next === lastIndex.current) return;
    lastIndex.current = next;
    setReading({ ...reading, size: READING_SIZES[next] ?? size });
  };

  const stepButton = (label: string, glyphSize: number, delta: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => setReading({ ...reading, size: stepSize(reading, delta) })}
      style={({ pressed }) => [
        styles.sizeButton,
        { backgroundColor: surfaces.raised, transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      <Text style={{ fontSize: glyphSize, color: palette.ink }}>A</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: space.s }}>
      <View style={[styles.size, { backgroundColor: surfaces.inset }]}>
        {stepButton("字号减小", 14, -1)}
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="正文字号"
          accessibilityValue={{ text: `${size}` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) =>
            setReading({
              ...reading,
              size: stepSize(reading, e.nativeEvent.actionName === "increment" ? 1 : -1),
            })
          }
          style={styles.trackArea}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            lastIndex.current = -1;
            pick(e);
          }}
          onResponderMove={pick}
        >
          <View
            pointerEvents="none"
            onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
            style={[styles.track, { backgroundColor: palette.bg3 }]}
          >
            <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: palette.acc }]} />
            <View
              style={[styles.knob, { left: ratio * trackWidth - KNOB / 2, boxShadow: palette.shadowKnob }]}
            />
          </View>
        </View>
        {stepButton("字号增大", 22, 1)}
      </View>
      <View style={styles.sizeNote}>
        <Text style={{ fontFamily: font.mono, fontSize: 12, color: palette.mut }}>
          {size} / {lineHeightFor(size)} · {reading.size === null ? "跟随系统字体大小" : "固定字号"}
        </Text>
        {reading.size !== null ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setReading({ ...reading, size: null })}
            hitSlop={10}
          >
            <Text style={{ fontSize: 13, fontWeight: "500", color: palette.acc }}>跟随系统</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function MoreSheet({
  visible,
  onClose,
  onRename,
  onWorld,
  onDelete,
  anchor,
  above,
}: {
  visible: boolean;
  onClose: () => void;
  onRename: () => void;
  onWorld: () => void;
  onDelete: () => void;
  /** 平板：菜单贴着这个按钮弹出；传了 above 时底边放在它的顶边上方 */
  anchor?: RefObject<View | null>;
  above?: RefObject<View | null>;
}) {
  const palette = usePalette();
  return (
    <Sheet visible={visible} onClose={onClose} kind="menu" anchor={anchor} above={above}>
      <View style={styles.body}>
        <Text style={[styles.label, { color: palette.mut }]}>阅读设置</Text>
        <FontChoice />
        <SizeControl />
        <MenuGroup style={{ marginTop: space.xs }}>
          <MenuItem icon="write" label="重命名故事" onPress={onRename} />
          <MenuItem icon="world" label="世界状态" onPress={onWorld} />
          <MenuItem icon="trash" label="删除故事" danger onPress={onDelete} />
        </MenuGroup>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.s, gap: space.s },
  label: {
    fontSize: 13,
    lineHeight: 18,
    paddingTop: space.s,
    paddingHorizontal: space.s,
    paddingBottom: space.xs,
  },
  fonts: { flexDirection: "row", padding: 4, gap: 4, borderRadius: 26 },
  fontOption: {
    flex: 1,
    height: 52,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
  },
  size: {
    flexDirection: "row",
    alignItems: "center",
    height: 60,
    paddingHorizontal: space.s,
    borderRadius: 26,
  },
  sizeButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  trackArea: { flex: 1, height: 52, justifyContent: "center", paddingHorizontal: TRACK_PADDING },
  track: { height: 6, borderRadius: 3 },
  fill: { height: 6, borderRadius: 3 },
  knob: {
    position: "absolute",
    top: -(KNOB - 6) / 2,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: onColor,
  },
  sizeNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s,
  },
});
