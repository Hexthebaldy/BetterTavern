/**
 * 模型详情页“能记住多少”的格子图：一张灰卡，里面一块白色面板，每个圆点是一格（默认 4K）。
 * 格子怎么分见 window.ts；标题右边写模型上下文和它从哪来（服务商提供、你填的、估计值……）。
 */

import { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { ModelRoute } from "@bettertavern/core/api/types";
import { formatTokens } from "@bettertavern/core/utils/format";
import { WINDOW_SOURCE } from "@bettertavern/core/settings/labels";
import { choiceTokens, windowBlocks, type WindowChoice } from "@bettertavern/core/settings/window";

import { font, space, usePalette } from "../../theme/index.ts";

const COLUMNS = 16;
const GAP = 4;

export function MemoryBlocks({ route, choice }: { route: ModelRoute; choice: WindowChoice }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  // 圆点直径按格子区的宽度算（百分比宽度加 aspectRatio 在换行容器里会让布局反复计算）。
  // 先按手机上的样子估一个，量到实际宽度（平板的居中栏、设置的右栏）再改
  const [measured, setMeasured] = useState<number | null>(null);
  const inner = measured ?? width - space.list * 2 - space.l * 2 - 14 * 2;
  const cell = Math.floor((inner - GAP * (COLUMNS - 1)) / COLUMNS);
  const w = windowBlocks(route.window.model_window, choiceTokens(choice), route.window.max_tokens);
  const k = formatTokens;
  const legend = (swatch: object, label: string) => (
    <View style={styles.legend}>
      <View style={[styles.swatch, swatch]} />
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: palette.ink2 }}>{label}</Text>
    </View>
  );
  return (
    <View style={[styles.memory, { backgroundColor: palette.bg2 }]}>
      <View style={styles.memoryTitle}>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "700", color: palette.ink }}>
          能记住多少
        </Text>
        <Text style={{ fontFamily: font.mono, fontSize: 12.5, color: palette.mut }}>
          上下文 {k(route.window.model_window)} · {WINDOW_SOURCE[route.window.source]}
        </Text>
      </View>
      <View
        style={[styles.blocks, { backgroundColor: palette.card }]}
        onLayout={(e) => {
          const next = e.nativeEvent.layout.width - 14 * 2;
          setMeasured((old) => (old !== null && Math.abs(old - next) < 1 ? old : next));
        }}
        accessibilityRole="image"
        accessibilityLabel={`上下文 ${k(route.window.model_window)}，故事 ${k(w.story)}，每轮输出 ${k(route.window.max_tokens)}，不使用 ${k(w.free)}`}
      >
        {w.blocks.map((b, i) => (
          <View
            key={i}
            style={{
              width: cell,
              height: cell,
              borderRadius: cell / 2,
              backgroundColor: b === "story" ? palette.ink : b === "output" ? palette.acc : palette.bg3,
              boxShadow:
                i === w.mark ? `0 0 0 2.5px ${palette.card}, 0 0 0 4.5px ${palette.warn}` : undefined,
            }}
          />
        ))}
      </View>
      <View style={styles.legends}>
        {legend({ backgroundColor: palette.ink }, `故事 ${k(w.story)}`)}
        {legend({ backgroundColor: palette.acc }, `每轮输出 ${k(route.window.max_tokens)}`)}
        {legend({ backgroundColor: palette.bg3 }, `不使用 ${k(w.free)}`)}
        {legend({ boxShadow: `inset 0 0 0 2.5px ${palette.warn}` }, "开始压缩")}
      </View>
      <Text style={{ fontSize: 14, lineHeight: 23, color: palette.ink2 }}>
        每个圆点是 {k(w.unit)}。模型最多能读 {k(route.window.model_window)}，你给导演 {k(w.used)}：每轮最多写{" "}
        {k(route.window.max_tokens)}，剩下约 {k(w.story)} 用来记前情和世界状态。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  memory: {
    marginHorizontal: space.list,
    paddingVertical: 18,
    paddingHorizontal: space.l,
    borderRadius: 30,
    gap: 14,
  },
  memoryTitle: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  blocks: { flexDirection: "row", flexWrap: "wrap", gap: GAP, padding: 14, borderRadius: 22 },
  legends: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: space.s },
  legend: { flexDirection: "row", alignItems: "center", gap: space.s },
  swatch: { width: 12, height: 12, borderRadius: 6 },
});
