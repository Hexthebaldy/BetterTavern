/** 工作台对话里共用的样式（颜色在组件里按色板给） */

import { StyleSheet } from "react-native";

import { radius, space } from "../../theme/index.ts";

export const chat = StyleSheet.create({
  agentText: { fontSize: 15, lineHeight: 24 },
  muted: { fontSize: 13.5, lineHeight: 20 },
  card: { borderRadius: 22, padding: 14, gap: space.m },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.m },
  cardTitle: { fontSize: 13.5, fontWeight: "600" },
  cardMeta: { fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s },
  summaryLine: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 22 },
  summaryLabel: { fontSize: 13, fontWeight: "600" },
  summaryText: { flex: 1, fontSize: 13 },
  link: { fontSize: 13 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  choiceText: { fontSize: 13.5, lineHeight: 19, flexShrink: 1 },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: "hidden", fontSize: 10.5 },
  heading: { fontSize: 12, lineHeight: 18 },
  body: { fontSize: 14, lineHeight: 22 },
  before: { padding: 10, borderRadius: 10, fontSize: 13.5, lineHeight: 21, textDecorationLine: "line-through" },
  after: { padding: 10, borderRadius: 10, fontSize: 13.5, lineHeight: 21 },
});
