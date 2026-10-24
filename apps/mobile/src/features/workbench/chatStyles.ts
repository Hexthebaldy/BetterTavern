/** 工作台对话里共用的样式（漫画风：格子 2.5 墨线、选项 2 墨线；颜色在组件里按 useComic() 给） */

import { StyleSheet } from "react-native";

import { comicRadius, comicStroke, space } from "../../theme/index.ts";

export const chat = StyleSheet.create({
  agentText: { fontSize: 15, lineHeight: 24 },
  muted: { fontSize: 13.5, lineHeight: 20 },
  card: { borderWidth: comicStroke.frame, borderRadius: comicRadius.frame, padding: 14, gap: space.m },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.m },
  cardTitle: { fontSize: 15, fontWeight: "900" },
  cardMeta: { fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s },
  summaryLine: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 22 },
  summaryLabel: { fontSize: 13.5, fontWeight: "600" },
  summaryText: { flex: 1, fontSize: 13 },
  link: { fontSize: 13.5, fontWeight: "700" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: comicStroke.control,
  },
  choiceText: { fontSize: 14, lineHeight: 19, fontWeight: "700", flexShrink: 1 },
  /** “其他…”“自己起一个”：虚线框 */
  dashed: { borderStyle: "dashed" },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: comicRadius.chip - 1,
    overflow: "hidden",
    fontSize: 10.5,
    fontWeight: "700",
  },
  heading: { fontSize: 12, lineHeight: 18 },
  body: { fontSize: 14, lineHeight: 22 },
  before: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    overflow: "hidden",
    fontSize: 13.5,
    lineHeight: 21,
    textDecorationLine: "line-through",
  },
  after: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, overflow: "hidden", fontSize: 13.5, lineHeight: 21 },
});
