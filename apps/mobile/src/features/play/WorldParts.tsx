/**
 * 世界状态面板（WorldSheet.tsx）的三页：人物与地点、关系、事实。
 * 卡片底色按面板的表面取（useSheetSurfaces）：手机的底部面板里是灰卡，平板灰底的停靠面板里是白卡。
 */

import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";

import type { WorldEntity, WorldView } from "../../api/types.ts";
import { Chip, Icon, Pill, useSheetSurfaces, type IconName } from "../../components/ui.tsx";
import { onColor, radius, space, useIsDark, usePalette } from "../../theme/index.ts";
import { layoutGraph, NODE_HEIGHT, relLabel } from "./worldGraph.ts";

export type Tab = "entities" | "links" | "facts";
type Filter = "all" | "character" | "location" | "item" | "organization";

const KIND: Record<string, { label: string; icon: IconName }> = {
  character: { label: "人物", icon: "person" },
  location: { label: "地点", icon: "place" },
  item: { label: "物品", icon: "item" },
  organization: { label: "组织", icon: "pair" },
};

const DATA_LABELS: Record<string, string> = {
  goal: "目标",
  attitude: "态度",
  speech_style: "说话方式",
  stance: "立场",
};

function EntityRow({
  entity,
  names,
  view,
  open,
  onToggle,
}: {
  entity: WorldEntity;
  names: Map<string, string>;
  view: WorldView;
  open: boolean;
  onToggle: () => void;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const kind = KIND[entity.kind] ?? { label: entity.kind, icon: "item" as const };
  const outgoing = view.links.filter((l) => l.src_id === entity.id && names.has(l.dst_id));
  const incoming = view.links.filter((l) => l.dst_id === entity.id && names.has(l.src_id));
  const details = Object.entries(entity.data).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].trim() !== "" && entry[0] in DATA_LABELS,
  );
  // 简介太长时收起只显示 3 行，点开看全文
  const expandable = outgoing.length + incoming.length + details.length > 0 || entity.summary.length > 60;
  const me = entity.is_protagonist;
  const chip = (key: string, label: string, name: string | undefined, incoming?: boolean) => (
    <View key={key} style={[styles.relChip, { backgroundColor: surfaces.onFill }]}>
      <Text style={[styles.kind, { color: palette.mut }]}>{label}</Text>
      {incoming ? <Icon name="arrowLeft" size={12} color={palette.mut} /> : null}
      <Text style={{ fontSize: 12.5, color: palette.ink }}>{name}</Text>
    </View>
  );
  return (
    <Pressable
      accessibilityRole={expandable ? "button" : undefined}
      accessibilityState={expandable ? { expanded: open } : undefined}
      disabled={!expandable}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.entity,
        {
          backgroundColor: me ? palette.accBg : surfaces.fill,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={[styles.entityIcon, { backgroundColor: me ? palette.acc : surfaces.onFill }]}>
        <Icon name={kind.icon} size={20} color={me ? onColor : palette.ink} />
      </View>
      <View style={{ flex: 1, gap: open ? space.s : 2 }}>
        <View style={styles.entityTop}>
          <Text style={[styles.entityName, { color: palette.ink, flex: me ? 0 : 1 }]}>{entity.name}</Text>
          {me ? <Pill label="我" tone="accSolid" height={20} /> : null}
          {me ? <View style={{ flex: 1 }} /> : null}
          {me ? null : <Text style={[styles.kind, { color: palette.mut }]}>{kind.label}</Text>}
          {expandable ? (
            <Icon name={open ? "chevronUp" : "chevronDown"} size={16} color={palette.mut} />
          ) : null}
        </View>
        {entity.summary ? (
          <Text
            numberOfLines={open ? undefined : 3}
            style={{ fontSize: 13.5, lineHeight: 21, color: palette.ink2 }}
          >
            {entity.summary}
          </Text>
        ) : null}
        {open && details.length > 0 ? (
          <View style={{ gap: 4 }}>
            {details.map(([key, value]) => (
              <Text key={key} style={{ fontSize: 13, lineHeight: 20, color: palette.ink }}>
                <Text style={{ color: palette.mut }}>{DATA_LABELS[key]} </Text>
                {value}
              </Text>
            ))}
          </View>
        ) : null}
        {open && outgoing.length + incoming.length > 0 ? (
          <View style={styles.relChips}>
            {outgoing.map((l) => chip(`o${l.rel}${l.dst_id}`, relLabel(l.rel), names.get(l.dst_id)))}
            {incoming.map((l) => chip(`i${l.rel}${l.src_id}`, relLabel(l.rel), names.get(l.src_id), true))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Entities({
  view,
  names,
  panel,
}: {
  view: WorldView;
  names: Map<string, string>;
  /** 平板的灰底面板：未选中的标签用白色 card 底 */
  panel: boolean;
}) {
  const palette = usePalette();
  // 深色下面板比页面亮，未选中的标签改用更亮的 card 底；平板的灰底面板上也用 card 底
  const onGrey = useIsDark() || panel;
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const entities = view.entities
    .filter((e) => e.kind !== "world")
    .sort((a, b) => Number(b.is_protagonist) - Number(a.is_protagonist) || b.importance - a.importance);
  const kinds = (["character", "location", "item", "organization"] as const).filter((k) =>
    entities.some((e) => e.kind === k),
  );
  const shown = filter === "all" ? entities : entities.filter((e) => e.kind === filter);
  return (
    <View>
      <View style={styles.filters}>
        <Chip
          small
          onGrey={onGrey}
          label="全部"
          selected={filter === "all"}
          onPress={() => setFilter("all")}
        />
        {kinds.map((k) => (
          <Chip
            key={k}
            small
            onGrey={onGrey}
            label={KIND[k]?.label ?? k}
            icon={KIND[k]?.icon}
            selected={filter === k}
            onPress={() => setFilter(k)}
          />
        ))}
      </View>
      <View style={styles.list}>
        {shown.map((e) => (
          <EntityRow
            key={e.id}
            entity={e}
            names={names}
            view={view}
            open={open === e.id}
            onToggle={() => setOpen((current) => (current === e.id ? null : e.id))}
          />
        ))}
      </View>
      {shown.length === 0 ? (
        <Text style={[styles.empty, { color: palette.mut }]}>还没有记下什么。</Text>
      ) : null}
    </View>
  );
}

/** panelWidth：面板的宽度（手机是屏幕宽减两边各 8，平板是 400），关系图卡片左右再各缩进 12 */
export function Links({
  view,
  names,
  panelWidth,
}: {
  view: WorldView;
  names: Map<string, string>;
  panelWidth: number;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const width = panelWidth - space.list * 2;
  const height = 300;
  const graph = useMemo(() => layoutGraph(view.entities, view.links, width, height), [view, width]);
  const links = view.links.filter((l) => names.has(l.src_id) && names.has(l.dst_id));
  if (links.length === 0)
    return <Text style={[styles.empty, { color: palette.mut }]}>还没有记下人物和地点之间的关系。</Text>;
  return (
    <View>
      <View style={[styles.graph, { backgroundColor: surfaces.fill }]}>
        <Svg
          width={width}
          height={height}
          accessibilityLabel={`关系图：${graph.nodes.map((n) => n.label).join("、")}`}
        >
          {graph.edges.map((e, i) => (
            <Line
              key={i}
              x1={e.from.x}
              y1={e.from.y}
              x2={e.to.x}
              y2={e.to.y}
              stroke={palette.line2}
              strokeWidth={1.6}
              strokeLinecap="round"
            />
          ))}
          {graph.edges.map((e, i) => (
            <SvgText
              key={`t${i}`}
              x={(e.from.x + e.to.x) / 2 + 4}
              y={(e.from.y + e.to.y) / 2 - 4}
              fontSize={11}
              fill={palette.mut}
            >
              {e.label}
            </SvgText>
          ))}
          {graph.nodes.map((n) => {
            const fill = n.role === "me" ? palette.acc : n.role === "hub" ? palette.ink : surfaces.onFill;
            const text = n.role === "me" ? onColor : n.role === "hub" ? palette.bg : palette.ink;
            return (
              <G key={n.id}>
                <Rect
                  x={n.x - n.width / 2}
                  y={n.y - NODE_HEIGHT / 2}
                  width={n.width}
                  height={NODE_HEIGHT}
                  rx={NODE_HEIGHT / 2}
                  fill={fill}
                />
                <SvgText
                  x={n.x}
                  y={n.y + 4.5}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={n.role === "other" ? "400" : "700"}
                  fill={text}
                >
                  {n.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
      <View style={styles.list}>
        {links.map((l) => (
          <View
            key={`${l.src_id}${l.rel}${l.dst_id}`}
            style={[styles.linkLine, { backgroundColor: surfaces.fill }]}
          >
            <Text numberOfLines={1} style={[styles.linkName, { color: palette.ink }]}>
              {names.get(l.src_id)}
            </Text>
            <View style={[styles.linkMid, { backgroundColor: surfaces.onFill }]}>
              <Text style={{ fontSize: 12, color: palette.mut }}>{relLabel(l.rel)} →</Text>
            </View>
            <Text numberOfLines={1} style={[styles.linkName, { color: palette.ink, textAlign: "right" }]}>
              {names.get(l.dst_id)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Facts({
  view,
  names,
  onReveal,
}: {
  view: WorldView;
  names: Map<string, string>;
  onReveal: () => void;
}) {
  const palette = usePalette();
  const surfaces = useSheetSurfaces();
  const facts = [...view.facts].sort(
    (a, b) => Number(a.secret) - Number(b.secret) || b.importance - a.importance,
  );
  return (
    <View style={styles.list}>
      {facts.map((f) => (
        <View
          key={f.id}
          style={[styles.fact, { backgroundColor: f.secret ? palette.warnBg : surfaces.fill }]}
        >
          {f.secret ? (
            <View style={{ marginTop: 3 }}>
              <Icon name="unlock" size={16} color={palette.warn} />
            </View>
          ) : (
            <View style={[styles.factDot, { backgroundColor: palette.ink }]} />
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 14, lineHeight: 22, color: palette.ink }}>{f.text}</Text>
            {f.secret || f.entity_ids.length > 0 ? (
              <Text style={[styles.kind, { color: f.secret ? palette.warn : palette.mut }]}>
                {[
                  f.secret ? "秘密 · 已揭示" : null,
                  ...f.entity_ids.map((id) => names.get(id)).filter(Boolean),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {view.hidden_facts > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${view.hidden_facts} 条未揭示的秘密，揭示`}
          onPress={onReveal}
          style={({ pressed }) => [
            styles.fact,
            styles.hidden,
            { backgroundColor: palette.warnBg, transform: [{ scale: pressed ? 0.98 : 1 }] },
          ]}
        >
          <Icon name="lock" size={16} color={palette.warn} />
          <Text style={{ flex: 1, fontSize: 13, color: palette.warn }}>{view.hidden_facts} 条秘密</Text>
          <View style={[styles.revealPill, { backgroundColor: surfaces.onFill }]}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: palette.warn }}>揭示</Text>
          </View>
        </Pressable>
      ) : null}
      {facts.length === 0 && view.hidden_facts === 0 ? (
        <Text style={[styles.empty, { color: palette.mut }]}>还没有记下事实。</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: space.m,
    paddingHorizontal: space.list,
  },
  list: { paddingVertical: space.s, paddingHorizontal: space.list, gap: 6 },
  entity: { flexDirection: "row", gap: space.m, padding: space.m, borderRadius: radius.option },
  entityIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  entityTop: { flexDirection: "row", alignItems: "center", gap: space.s },
  entityName: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  kind: { fontSize: 12, lineHeight: 17 },
  relChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  relChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  graph: { marginTop: space.m, marginHorizontal: space.list, borderRadius: radius.group, overflow: "hidden" },
  linkLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingVertical: space.m,
    paddingHorizontal: space.l,
    borderRadius: radius.card,
  },
  linkName: { flex: 1, fontSize: 14 },
  linkMid: { height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: "center" },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: space.m, padding: 14, borderRadius: 22 },
  hidden: { alignItems: "center", paddingVertical: 6, paddingRight: 6 },
  revealPill: { height: 32, paddingHorizontal: space.m, borderRadius: 16, justifyContent: "center" },
  factDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  empty: { padding: space.page, fontSize: 14, lineHeight: 22 },
});
