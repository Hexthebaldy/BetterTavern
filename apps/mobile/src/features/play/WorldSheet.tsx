/**
 * 世界状态面板：导演记下的人物与地点、关系图、事实。数据来自 GET /v1/playthroughs/{id}/world。
 * 主角不知道的秘密默认隐藏，揭示前要确认（会剧透）；揭示后标为“秘密 · 已揭示”。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { describeError } from "../../api/client.ts";
import type { WorldEntity, WorldView } from "../../api/types.ts";
import {
  Chip,
  Dots,
  ErrorState,
  Icon,
  IconButton,
  Sheet,
  Tag,
  useOverlay,
  type IconName,
} from "../../components/ui.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import { font, onColor, space, usePalette } from "../../theme/index.ts";
import { layoutGraph, NODE_HEIGHT, relLabel } from "./worldGraph.ts";

type Tab = "entities" | "links" | "facts";
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
  return (
    <Pressable
      accessibilityRole={expandable ? "button" : undefined}
      accessibilityState={expandable ? { expanded: open } : undefined}
      disabled={!expandable}
      onPress={onToggle}
      style={[
        styles.entity,
        { borderBottomColor: palette.line, backgroundColor: open ? palette.bg2 : palette.bg },
      ]}
    >
      <View
        style={[styles.entityIcon, { backgroundColor: me ? palette.acc : open ? palette.bg : palette.bg2 }]}
      >
        <Icon name={kind.icon} size={20} color={me ? onColor : palette.ink} />
      </View>
      <View style={{ flex: 1, gap: open ? space.s : 2 }}>
        <View style={styles.entityTop}>
          <Text style={[styles.entityName, { color: palette.ink, flex: me ? 0 : 1 }]}>{entity.name}</Text>
          {me ? <Tag label="我" variant="solid" /> : null}
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
        {open ? (
          <View style={{ borderTopWidth: 1, borderTopColor: palette.line2 }}>
            {details.map(([key, value]) => (
              <View key={key} style={[styles.linkRow, { borderBottomColor: palette.line }]}>
                <Text style={[styles.kind, styles.linkKey, { color: palette.mut }]}>{DATA_LABELS[key]}</Text>
                <Text style={{ flex: 1, fontSize: 13, color: palette.ink }}>{value}</Text>
              </View>
            ))}
            {outgoing.map((l) => (
              <View
                key={`o${l.rel}${l.dst_id}`}
                style={[styles.linkRow, { borderBottomColor: palette.line }]}
              >
                <Text style={[styles.kind, styles.linkKey, { color: palette.mut }]}>{relLabel(l.rel)}</Text>
                <Icon name="arrowRight" size={14} color={palette.mut} />
                <Text style={{ fontSize: 13, color: palette.ink }}>{names.get(l.dst_id)}</Text>
              </View>
            ))}
            {incoming.map((l) => (
              <View
                key={`i${l.rel}${l.src_id}`}
                style={[styles.linkRow, { borderBottomColor: palette.line }]}
              >
                <Text style={[styles.kind, styles.linkKey, { color: palette.mut }]}>{relLabel(l.rel)}</Text>
                <Icon name="arrowLeft" size={14} color={palette.mut} />
                <Text style={{ fontSize: 13, color: palette.ink }}>{names.get(l.src_id)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Entities({ view, names }: { view: WorldView; names: Map<string, string> }) {
  const palette = usePalette();
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
      <View style={[styles.filters, { borderBottomColor: palette.line }]}>
        <Chip small label="全部" selected={filter === "all"} onPress={() => setFilter("all")} />
        {kinds.map((k) => (
          <Chip
            key={k}
            small
            label={KIND[k]?.label ?? k}
            icon={KIND[k]?.icon}
            selected={filter === k}
            onPress={() => setFilter(k)}
          />
        ))}
      </View>
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
      {shown.length === 0 ? (
        <Text style={[styles.empty, { color: palette.mut }]}>还没有记下什么。</Text>
      ) : null}
    </View>
  );
}

function Links({ view, names }: { view: WorldView; names: Map<string, string> }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const height = 300;
  const graph = useMemo(() => layoutGraph(view.entities, view.links, width, height), [view, width]);
  const links = view.links.filter((l) => names.has(l.src_id) && names.has(l.dst_id));
  if (links.length === 0)
    return <Text style={[styles.empty, { color: palette.mut }]}>还没有记下人物和地点之间的关系。</Text>;
  const grid: string[] = [];
  for (let y = 60; y < height; y += 60) grid.push(`M0 ${y}H${width}`);
  for (let x = 65; x < width; x += 65) grid.push(`M${x} 0V${height}`);
  return (
    <View>
      <View style={{ backgroundColor: palette.bg2, borderBottomWidth: 1, borderBottomColor: palette.line }}>
        <Svg
          width={width}
          height={height}
          accessibilityLabel={`关系图：${graph.nodes.map((n) => n.label).join("、")}`}
        >
          <Path d={grid.join("")} stroke={palette.line} strokeWidth={1} />
          {graph.edges.map((e, i) => (
            <Line
              key={i}
              x1={e.from.x}
              y1={e.from.y}
              x2={e.to.x}
              y2={e.to.y}
              stroke={palette.ink}
              strokeWidth={1.2}
            />
          ))}
          {graph.edges.map((e, i) => (
            <SvgText
              key={`t${i}`}
              x={(e.from.x + e.to.x) / 2 + 4}
              y={(e.from.y + e.to.y) / 2 - 4}
              fontSize={10.5}
              fontFamily={font.mono}
              fill={palette.mut}
            >
              {e.label}
            </SvgText>
          ))}
          {graph.nodes.map((n) => {
            const fill = n.role === "me" ? palette.acc : n.role === "hub" ? palette.ink : palette.bg;
            const text = n.role === "me" ? onColor : n.role === "hub" ? palette.bg : palette.ink;
            return (
              <G key={n.id}>
                <Rect
                  x={n.x - n.width / 2}
                  y={n.y - NODE_HEIGHT / 2}
                  width={n.width}
                  height={NODE_HEIGHT}
                  fill={fill}
                  stroke={n.role === "other" ? palette.ink : "none"}
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
      {links.map((l) => (
        <View
          key={`${l.src_id}${l.rel}${l.dst_id}`}
          style={[styles.linkLine, { borderBottomColor: palette.line }]}
        >
          <Text numberOfLines={1} style={[styles.linkName, { color: palette.ink }]}>
            {names.get(l.src_id)}
          </Text>
          <Text style={[styles.kind, styles.linkMid, { color: palette.mut }]}>{relLabel(l.rel)} →</Text>
          <Text numberOfLines={1} style={[styles.linkName, { color: palette.ink }]}>
            {names.get(l.dst_id)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Facts({
  view,
  names,
  onReveal,
}: {
  view: WorldView;
  names: Map<string, string>;
  onReveal: () => void;
}) {
  const palette = usePalette();
  const facts = [...view.facts].sort(
    (a, b) => Number(a.secret) - Number(b.secret) || b.importance - a.importance,
  );
  return (
    <View>
      {facts.map((f) => (
        <View
          key={f.id}
          style={[
            styles.fact,
            { borderBottomColor: palette.line, backgroundColor: f.secret ? palette.warnBg : palette.bg },
          ]}
        >
          {f.secret ? (
            <Icon name="unlock" size={16} color={palette.warn} />
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
            {
              alignItems: "center",
              borderBottomColor: palette.line,
              backgroundColor: pressed ? palette.bg2 : palette.bg,
            },
          ]}
        >
          <Icon name="lock" size={16} color={palette.mut} />
          <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
            <View style={[styles.bar, { width: 120, backgroundColor: palette.bg3 }]} />
            <View style={[styles.bar, { width: 70, backgroundColor: palette.bg3 }]} />
          </View>
          <Text style={{ fontSize: 13, color: palette.mut }}>{view.hidden_facts} 条秘密</Text>
          <Text style={{ fontSize: 13, fontWeight: "700", color: palette.warn }}>揭示</Text>
        </Pressable>
      ) : null}
      {facts.length === 0 && view.hidden_facts === 0 ? (
        <Text style={[styles.empty, { color: palette.mut }]}>还没有记下事实。</Text>
      ) : null}
    </View>
  );
}

export function WorldSheet({
  visible,
  onClose,
  playthroughId,
}: {
  visible: boolean;
  onClose: () => void;
  playthroughId: string;
}) {
  const { api } = useApp();
  const palette = usePalette();
  const overlay = useOverlay();
  const [tab, setTab] = useState<Tab>("entities");
  const [view, setView] = useState<WorldView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(
    async (reveal: boolean): Promise<void> => {
      setError(null);
      try {
        setView(await api.playthroughs.world(playthroughId, reveal));
      } catch (e) {
        setError(e);
      }
    },
    [api, playthroughId],
  );

  useEffect(() => {
    if (visible) void load(revealed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, load]);

  const reveal = async (): Promise<void> => {
    const count = view?.hidden_facts ?? 0;
    const ok = await overlay.confirm({
      title: count > 1 ? `揭示 ${count} 条秘密？` : "揭示一条秘密？",
      message: "这是导演知道、而“我”还不知道的事，看了会剧透接下来的故事。",
      confirmLabel: "揭示",
      tone: "warn",
      icon: "lock",
    });
    if (!ok) return;
    setRevealed(true);
    await load(true);
  };

  const names = useMemo(() => new Map((view?.entities ?? []).map((e) => [e.id, e.name])), [view]);
  const counts = view
    ? {
        entities: view.entities.filter((e) => e.kind !== "world").length,
        links: view.links.length,
        facts: view.facts.length + view.hidden_facts,
      }
    : null;
  const tabs: { key: Tab; label: string }[] = [
    { key: "entities", label: "人物与地点" },
    { key: "links", label: "关系" },
    { key: "facts", label: "事实" },
  ];
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      full
      header={
        <View>
          <View style={styles.head}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>
                世界
              </Text>
              <Text style={[styles.kind, { fontSize: 11.5, color: palette.mut }]}>
                导演记下的一切 · 开局时整理
              </Text>
            </View>
            <IconButton icon="close" label="关闭" onPress={onClose} />
          </View>
          <View style={[styles.tabs, { borderBottomColor: palette.line }]} accessibilityRole="tablist">
            {tabs.map((t) => {
              const on = tab === t.key;
              return (
                <Pressable
                  key={t.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setTab(t.key)}
                  style={styles.tab}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: on ? "700" : "400",
                      color: on ? palette.ink : palette.mut,
                    }}
                  >
                    {t.label}
                  </Text>
                  {counts ? (
                    <Text style={[styles.count, { color: palette.mut }]}>{counts[t.key]}</Text>
                  ) : null}
                  {on ? <View style={[styles.tabMark, { backgroundColor: palette.ink }]} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space.xxl }}>
        {view ? (
          tab === "entities" ? (
            <Entities view={view} names={names} />
          ) : tab === "links" ? (
            <Links view={view} names={names} />
          ) : (
            <Facts view={view} names={names} onReveal={() => void reveal()} />
          )
        ) : error ? (
          <ErrorState
            title="世界状态没加载出来"
            message={describeError(error)}
            onRetry={() => void load(revealed)}
          />
        ) : (
          <View style={styles.loading}>
            <Dots />
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: space.l,
    paddingLeft: space.page,
    paddingRight: space.s,
  },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "900", letterSpacing: -0.5 },
  tabs: { flexDirection: "row", paddingHorizontal: space.page, marginTop: 14, borderBottomWidth: 1, gap: 22 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, height: 44 },
  tabMark: { position: "absolute", left: 0, right: 0, bottom: -1, height: 2 },
  count: { fontFamily: font.mono, fontSize: 11 },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingVertical: space.m,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  entity: {
    flexDirection: "row",
    gap: space.m,
    paddingVertical: 14,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  entityIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  entityTop: { flexDirection: "row", alignItems: "center", gap: space.s },
  entityName: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  kind: { fontFamily: font.mono, fontSize: 11, letterSpacing: 0.7 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: space.s, minHeight: 34, borderBottomWidth: 1 },
  linkKey: { width: 52 },
  linkLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingVertical: space.m,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  linkName: { flex: 1, fontSize: 14 },
  linkMid: { width: 64, textAlign: "center" },
  fact: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: space.m,
    paddingHorizontal: space.page,
    borderBottomWidth: 1,
  },
  factDot: { width: 6, height: 6, marginTop: 8, marginHorizontal: 5 },
  bar: { height: 10 },
  empty: { padding: space.page, fontSize: 14, lineHeight: 22 },
  loading: { padding: space.xxl, alignItems: "center" },
});
