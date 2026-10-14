/**
 * 阅读页的“更多”：阅读设置（宋体 / 黑体、字号），重命名故事、世界状态、删除故事。
 * 阅读设置存在设备上，所有故事共用。
 */

import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";

import { MenuItem, Sheet } from "../../components/ui.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { font, space, usePalette } from "../../theme/index.ts";
import {
  lineHeightFor,
  READING_SIZES,
  readingSize,
  sizeIndex,
  stepSize,
  type ReadingFont,
} from "./reading.ts";

function FontChoice() {
  const palette = usePalette();
  const { reading, setReading } = usePrefs();
  const option = (value: ReadingFont, glyph: string, label: string, last?: boolean) => {
    const on = reading.font === value;
    const fg = on ? palette.bg : palette.ink;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
        onPress={() => setReading({ ...reading, font: value })}
        style={[
          styles.fontOption,
          { backgroundColor: on ? palette.ink : "transparent" },
          last ? null : { borderRightWidth: 1, borderRightColor: palette.line2 },
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
        <Text style={{ fontSize: 15, color: fg }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="正文字体"
      style={[styles.fonts, { borderColor: palette.line2 }]}
    >
      {option("serif", "宋", "宋体")}
      {option("sans", "黑", "黑体", true)}
    </View>
  );
}

const TRACK_PADDING = space.l;

/** 字号：两头是减小、增大，中间的轨道可以点或拖到某一档 */
function SizeControl() {
  const palette = usePalette();
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

  return (
    <View style={{ gap: space.s }}>
      <View style={[styles.size, { borderColor: palette.line2 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="字号减小"
          onPress={() => setReading({ ...reading, size: stepSize(reading, -1) })}
          style={[styles.sizeButton, { borderRightWidth: 1, borderRightColor: palette.line2 }]}
        >
          <Text style={{ fontSize: 14, color: palette.ink }}>A</Text>
        </Pressable>
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
            style={[styles.track, { backgroundColor: palette.line2 }]}
          >
            <View style={{ width: `${ratio * 100}%`, height: 2, backgroundColor: palette.ink }} />
            <View style={[styles.knob, { left: ratio * trackWidth - 8, backgroundColor: palette.ink }]} />
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="字号增大"
          onPress={() => setReading({ ...reading, size: stepSize(reading, 1) })}
          style={[styles.sizeButton, { borderLeftWidth: 1, borderLeftColor: palette.line2 }]}
        >
          <Text style={{ fontSize: 22, color: palette.ink }}>A</Text>
        </Pressable>
      </View>
      <View style={styles.sizeNote}>
        <Text style={[styles.mono, { color: palette.mut }]}>
          {size} / {lineHeightFor(size)} · {reading.size === null ? "跟随系统字体大小" : "固定字号"}
        </Text>
        {reading.size !== null ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setReading({ ...reading, size: null })}
            hitSlop={10}
          >
            <Text
              style={{ fontSize: 12, fontWeight: "500", color: palette.ink, textDecorationLine: "underline" }}
            >
              跟随系统
            </Text>
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
}: {
  visible: boolean;
  onClose: () => void;
  onRename: () => void;
  onWorld: () => void;
  onDelete: () => void;
}) {
  const palette = usePalette();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.reading}>
        <Text style={[styles.mono, { color: palette.mut, letterSpacing: 0.9 }]}>阅读设置</Text>
        <FontChoice />
        <SizeControl />
      </View>
      <View style={{ marginTop: space.m, borderTopWidth: 1, borderTopColor: palette.line }}>
        <MenuItem icon="write" label="重命名故事" onPress={onRename} />
        <MenuItem icon="world" label="世界状态" onPress={onWorld} />
        <MenuItem icon="trash" label="删除故事" danger last onPress={onDelete} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reading: { paddingTop: space.m, paddingHorizontal: space.page, gap: 14 },
  mono: { fontFamily: font.mono, fontSize: 11.5 },
  fonts: { flexDirection: "row", borderWidth: 1 },
  fontOption: {
    flex: 1,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
  },
  size: { flexDirection: "row", alignItems: "center", height: 48, borderWidth: 1 },
  sizeButton: { width: 48, height: 46, alignItems: "center", justifyContent: "center" },
  trackArea: { flex: 1, height: 46, justifyContent: "center", paddingHorizontal: TRACK_PADDING },
  track: { height: 2 },
  knob: { position: "absolute", top: -7, width: 16, height: 16 },
  sizeNote: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
