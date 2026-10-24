/**
 * 模型详情页“能记住多少”的格子图（漫画风，docs/design/comic/mobile/png/32）：白底墨线的格子里一排排小方块，
 * 每块是一格（默认 4K）：墨色是工作窗口，蓝色是留给回复，灰色是空着的。
 * 格子怎么分见 window.ts；标题右边写模型上下文和它从哪来（服务商提供、你填的、估计值……）。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { ModelRoute } from "@bettertavern/core/api/types";
import { formatTokens } from "@bettertavern/core/utils/format";
import { windowSourceLabel } from "@bettertavern/core/settings/labels";
import { choiceTokens, windowBlocks, type WindowChoice } from "@bettertavern/core/settings/window";

import { comicRadius, comicStroke, font, space, useComic } from "../../theme/index.ts";

const COLUMNS = 16;
const GAP = 4;

export function MemoryBlocks({ route, choice }: { route: ModelRoute; choice: WindowChoice }) {
  const c = useComic();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  // 圆点直径按格子区的宽度算（百分比宽度加 aspectRatio 在换行容器里会让布局反复计算）。
  // 先按手机上的样子估一个，量到实际宽度（平板的居中栏、设置的右栏）再改
  const [measured, setMeasured] = useState<number | null>(null);
  const inner = measured ?? width - 20 * 2 - comicStroke.frame * 2 - 14 * 2;
  const cell = Math.floor((inner - GAP * (COLUMNS - 1)) / COLUMNS);
  const w = windowBlocks(route.window.model_window, choiceTokens(choice), route.window.max_tokens);
  const k = formatTokens;
  const legend = (swatch: object, label: string) => (
    <View style={styles.legend}>
      <View style={[styles.swatch, swatch]} />
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: c.ink2 }}>{label}</Text>
    </View>
  );
  return (
    <View style={[styles.memory, { backgroundColor: c.paper, borderColor: c.ink }]}>
      <View style={styles.memoryTitle}>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "900", color: c.ink }}>
          {t("models.memoryTitle")}
        </Text>
        <Text style={{ fontFamily: font.mono, fontSize: 12.5, color: c.mut }}>
          {t("models.memoryContext", {
            window: k(route.window.model_window),
            source: windowSourceLabel(route.window.source),
          })}
        </Text>
      </View>
      <View
        style={styles.blocks}
        onLayout={(e) => {
          const next = e.nativeEvent.layout.width;
          setMeasured((old) => (old !== null && Math.abs(old - next) < 1 ? old : next));
        }}
        accessibilityRole="image"
        accessibilityLabel={t("models.memoryLabel", {
          window: k(route.window.model_window),
          story: k(w.story),
          output: k(route.window.max_tokens),
          free: k(w.free),
        })}
      >
        {w.blocks.map((b, i) => (
          <View
            key={i}
            style={{
              width: cell,
              height: cell,
              borderRadius: 2,
              backgroundColor: b === "story" ? c.ink : b === "output" ? c.acc : c.line2,
              boxShadow:
                i === w.mark ? `0 0 0 2px ${c.paper}, 0 0 0 4px ${c.warn}` : undefined,
            }}
          />
        ))}
      </View>
      <View style={styles.legends}>
        {legend({ backgroundColor: c.ink }, t("models.memoryStory", { size: k(w.story) }))}
        {legend(
          { backgroundColor: c.acc },
          t("models.memoryOutput", { size: k(route.window.max_tokens) }),
        )}
        {legend({ backgroundColor: c.line2 }, t("models.memoryFree", { size: k(w.free) }))}
        {legend({ boxShadow: `inset 0 0 0 2.5px ${c.warn}` }, t("models.memoryCompact"))}
      </View>
      <Text style={{ fontSize: 14, lineHeight: 23, color: c.ink2 }}>
        {t("models.memoryNote", {
          unit: k(w.unit),
          window: k(route.window.model_window),
          used: k(w.used),
          output: k(route.window.max_tokens),
          story: k(w.story),
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  memory: {
    marginHorizontal: 20,
    paddingVertical: space.l,
    paddingHorizontal: 14,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
    gap: 14,
  },
  memoryTitle: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    columnGap: space.s,
    rowGap: 2,
  },
  blocks: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  legends: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: space.s },
  legend: { flexDirection: "row", alignItems: "center", gap: space.s },
  swatch: { width: 12, height: 12, borderRadius: 2 },
});
