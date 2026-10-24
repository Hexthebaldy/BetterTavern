/**
 * 世界状态面板（WorldSheet.tsx）的三页：人物与地点、关系、事实。
 *
 * 漫画风（docs/design/comic/mobile/png/09、46、47）：
 * - 人物与地点：筛选标签，下面一张张白底墨线的格子；左边 42 的灰底图标方块，“我”的格子加蓝投影 3、图标方块填蓝；
 * - 关系：白底网点的关系图（“我”是蓝底节点、主角色是墨底节点，其他白底，都是 2 的墨线），下面一个格子列出每条关系；
 * - 事实：一个格子里一条一行，前面墨色圆点；揭示过的秘密是琥珀色；没揭示的秘密是一行墨色虚线框加“揭示”。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";

import type { WorldEntity, WorldView } from "@bettertavern/core/api/types";
import { lookup } from "@bettertavern/core/i18n/index";
import { layoutGraph, NODE_HEIGHT, relLabel } from "@bettertavern/core/play/worldGraph";

import { Halftone } from "../../components/Halftone.tsx";
import { Chip, Group, Icon, Pill, press, type IconName } from "../../components/ui.tsx";
import { comicDepth, comicRadius, comicStroke, space, useComic } from "../../theme/index.ts";

export type Tab = "entities" | "links" | "facts";
type Filter = "all" | "character" | "location" | "item" | "organization";

const KIND_ICONS: Record<string, IconName> = {
  character: "person",
  location: "place",
  item: "item",
  organization: "pair",
};

/** 实体的类别：名字随界面语言，不认识的类别显示它的 id */
function kindOf(kind: string): { label: string; icon: IconName } {
  return { label: lookup(`world.kinds.${kind}`) ?? kind, icon: KIND_ICONS[kind] ?? "item" };
}

/** 卡片展开后列出的几项资料 */
const DATA_KEYS = new Set(["goal", "attitude", "speech_style", "stance"]);

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
  const c = useComic();
  const { t } = useTranslation();
  const kind = kindOf(entity.kind);
  const outgoing = view.links.filter((l) => l.src_id === entity.id && names.has(l.dst_id));
  const incoming = view.links.filter((l) => l.dst_id === entity.id && names.has(l.src_id));
  const details = Object.entries(entity.data).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].trim() !== "" && DATA_KEYS.has(entry[0]),
  );
  // 简介太长时收起只显示 3 行，点开看全文
  const expandable = outgoing.length + incoming.length + details.length > 0 || entity.summary.length > 60;
  const me = entity.is_protagonist;
  const chip = (key: string, label: string, name: string | undefined, incoming?: boolean) => (
    <View key={key} style={[styles.relChip, { borderColor: c.ink, backgroundColor: c.paper }]}>
      <Text style={[styles.kind, { color: c.mut }]}>{label}</Text>
      {incoming ? <Icon name="arrowLeft" size={12} color={c.mut} /> : null}
      <Text style={{ fontSize: 12.5, color: c.ink }}>{name}</Text>
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
        { borderColor: c.ink, backgroundColor: pressed && !me ? c.grey : c.paper },
        me ? press(pressed, comicDepth.focus, c.acc) : null,
      ]}
    >
      <View style={[styles.entityIcon, { borderColor: c.ink, backgroundColor: me ? c.acc : c.grey }]}>
        <Icon name={kind.icon} size={20} color={me ? c.onAcc : c.ink} />
      </View>
      <View style={{ flex: 1, gap: open ? space.s : 2 }}>
        <View style={styles.entityTop}>
          <Text style={[styles.entityName, { color: c.ink, flex: me ? 0 : 1 }]}>{entity.name}</Text>
          {me ? <Pill label={t("world.me")} tone="accSolid" height={20} /> : null}
          {me ? <View style={{ flex: 1 }} /> : null}
          {me ? null : <Text style={[styles.kind, { color: c.mut }]}>{kind.label}</Text>}
          {expandable ? <Icon name={open ? "chevronUp" : "chevronDown"} size={16} color={c.mut} /> : null}
        </View>
        {entity.summary ? (
          <Text
            numberOfLines={open ? undefined : 3}
            style={{ fontSize: 14, lineHeight: 21, color: c.ink2 }}
          >
            {entity.summary}
          </Text>
        ) : null}
        {open && details.length > 0 ? (
          <View style={{ gap: 4 }}>
            {details.map(([key, value]) => (
              <Text key={key} style={{ fontSize: 13, lineHeight: 20, color: c.ink }}>
                <Text style={{ color: c.mut }}>{lookup(`world.attrs.${key}`) ?? key} </Text>
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
}: {
  view: WorldView;
  names: Map<string, string>;
}) {
  const c = useComic();
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const entities = view.entities
    .filter((e) => e.kind !== "world")
    // 主角排第一个，其余沿用服务端的顺序（按类型、最近出现的回合）
    .sort((a, b) => Number(b.is_protagonist) - Number(a.is_protagonist));
  const kinds = (["character", "location", "item", "organization"] as const).filter((k) =>
    entities.some((e) => e.kind === k),
  );
  const shown = filter === "all" ? entities : entities.filter((e) => e.kind === filter);
  return (
    <View>
      <View style={styles.filters}>
        <Chip
          small
          label={t("world.all")}
          selected={filter === "all"}
          onPress={() => setFilter("all")}
        />
        {kinds.map((k) => (
          <Chip
            key={k}
            small
            label={kindOf(k).label}
            icon={kindOf(k).icon}
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
        <Text style={[styles.empty, { color: c.mut }]}>{t("world.empty")}</Text>
      ) : null}
    </View>
  );
}

/** panelWidth：面板的宽度（手机是屏幕宽减两边各 8，平板是 400），关系图格子左右再各缩进 12 */
export function Links({
  view,
  names,
  panelWidth,
}: {
  view: WorldView;
  names: Map<string, string>;
  panelWidth: number;
}) {
  const c = useComic();
  const { t } = useTranslation();
  // 格子的 2.5 墨线在里面
  const width = panelWidth - space.list * 2 - comicStroke.frame * 2;
  const height = 300;
  const graph = useMemo(() => layoutGraph(view.entities, view.links, width, height), [view, width]);
  const links = view.links.filter((l) => names.has(l.src_id) && names.has(l.dst_id));
  if (links.length === 0) return <Text style={[styles.empty, { color: c.mut }]}>{t("world.noLinks")}</Text>;
  return (
    <View>
      <Halftone tone="ink" style={[styles.graph, { borderColor: c.ink }]}>
        <Svg
          width={width}
          height={height}
          accessibilityLabel={t("world.graph", {
            nodes: graph.nodes.map((n) => n.label).join(t("common.listSeparator")),
          })}
        >
          {graph.edges.map((e, i) => (
            <Line
              key={i}
              x1={e.from.x}
              y1={e.from.y}
              x2={e.to.x}
              y2={e.to.y}
              stroke={c.ink}
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
          {graph.edges.map((e, i) => {
            const x = (e.from.x + e.to.x) / 2;
            const y = (e.from.y + e.to.y) / 2 + 4;
            // 先描一圈白边再写字：字压在连线和网点上也看得清
            return (
              <G key={`t${i}`}>
                <SvgText
                  x={x}
                  y={y}
                  textAnchor="middle"
                  fontSize={12}
                  stroke={c.paper}
                  strokeWidth={5}
                  strokeLinejoin="round"
                  fill={c.paper}
                >
                  {e.label}
                </SvgText>
                <SvgText x={x} y={y} textAnchor="middle" fontSize={12} fill={c.mut}>
                  {e.label}
                </SvgText>
              </G>
            );
          })}
          {graph.nodes.map((n) => {
            const fill = n.role === "me" ? c.acc : n.role === "hub" ? c.ink : c.paper;
            const text = n.role === "me" ? c.onAcc : n.role === "hub" ? c.paper : c.ink;
            return (
              <G key={n.id}>
                <Rect
                  x={n.x - n.width / 2}
                  y={n.y - NODE_HEIGHT / 2}
                  width={n.width}
                  height={NODE_HEIGHT}
                  rx={NODE_HEIGHT / 2}
                  fill={fill}
                  stroke={c.ink}
                  strokeWidth={comicStroke.control}
                />
                <SvgText x={n.x} y={n.y + 4.5} textAnchor="middle" fontSize={13} fontWeight="700" fill={text}>
                  {n.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </Halftone>
      <Group style={styles.block}>
        {links.map((l) => (
          <View key={`${l.src_id}${l.rel}${l.dst_id}`} style={styles.linkLine}>
            <Text numberOfLines={1} style={[styles.linkName, { color: c.ink }]}>
              {names.get(l.src_id)}
            </Text>
            <View style={[styles.linkMid, { borderColor: c.ink, backgroundColor: c.paper }]}>
              <Text style={{ fontSize: 12.5, color: c.ink }}>{relLabel(l.rel)} →</Text>
            </View>
            <Text numberOfLines={1} style={[styles.linkName, { color: c.ink, textAlign: "right" }]}>
              {names.get(l.dst_id)}
            </Text>
          </View>
        ))}
      </Group>
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
  const c = useComic();
  const { t } = useTranslation();
  const facts = [...view.facts].sort(
    // 秘密排在后面，其余沿用服务端的顺序（建立得越晚越靠前）
    (a, b) => Number(a.secret) - Number(b.secret),
  );
  return (
    <View style={styles.block}>
      {facts.length > 0 ? (
        <Group>
          {facts.map((f) => (
            <View key={f.id} style={styles.fact}>
              {f.secret ? (
                <View style={{ marginTop: 3 }}>
                  <Icon name="unlock" size={16} color={c.warn} />
                </View>
              ) : (
                <View style={[styles.factDot, { backgroundColor: c.ink }]} />
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14.5, lineHeight: 22, color: c.ink }}>{f.text}</Text>
                {f.secret || f.entity_ids.length > 0 ? (
                  <Text style={[styles.kind, { color: f.secret ? c.warn : c.mut }]}>
                    {[
                      f.secret ? t("world.secretRevealed") : null,
                      ...f.entity_ids.map((id) => names.get(id)).filter(Boolean),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </Group>
      ) : null}
      {view.hidden_facts > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("world.hiddenLabel", { count: view.hidden_facts })}
          onPress={onReveal}
          style={({ pressed }) => [
            styles.hidden,
            { borderColor: c.ink, backgroundColor: pressed ? c.grey : "transparent" },
          ]}
        >
          {({ pressed }) => (
            <>
              <Icon name="lock" size={18} color={c.ink} />
              <Text style={{ flex: 1, fontSize: 13.5, fontWeight: "700", color: c.ink }}>
                {t("world.hidden", { count: view.hidden_facts })}
              </Text>
              <View style={[styles.revealPill, { backgroundColor: c.ink }, press(pressed, comicDepth.focus, c.acc)]}>
                <Text style={{ fontSize: 13.5, fontWeight: "700", color: c.paper }}>{t("world.reveal")}</Text>
              </View>
            </>
          )}
        </Pressable>
      ) : null}
      {facts.length === 0 && view.hidden_facts === 0 ? (
        <Text style={[styles.empty, { color: c.mut }]}>{t("world.noFacts")}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s,
    paddingTop: space.m,
    paddingHorizontal: space.list,
  },
  list: { paddingTop: space.m, paddingBottom: space.s, paddingHorizontal: space.list, gap: space.m },
  block: { marginTop: space.m, marginHorizontal: space.list, gap: space.m },
  entity: {
    flexDirection: "row",
    gap: space.m,
    padding: space.m,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  entityIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: comicStroke.control,
    alignItems: "center",
    justifyContent: "center",
  },
  entityTop: { flexDirection: "row", alignItems: "center", gap: space.s },
  entityName: { fontSize: 17, lineHeight: 23, fontWeight: "900" },
  kind: { fontSize: 12.5, lineHeight: 17 },
  relChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  relChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 26,
    paddingHorizontal: 9,
    borderRadius: comicRadius.tag,
    borderWidth: comicStroke.chip,
  },
  graph: {
    marginTop: space.m,
    marginHorizontal: space.list,
    borderWidth: comicStroke.frame,
    borderRadius: comicRadius.frame,
  },
  linkLine: { flexDirection: "row", alignItems: "center", gap: space.s, paddingVertical: space.m, paddingHorizontal: 14 },
  linkName: { flex: 1, fontSize: 14.5 },
  linkMid: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: comicRadius.tag,
    borderWidth: comicStroke.chip,
    justifyContent: "center",
  },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: space.m, paddingHorizontal: 14 },
  hidden: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    height: 46,
    paddingLeft: space.m,
    paddingRight: 6,
    borderRadius: 10,
    borderWidth: comicStroke.control,
    borderStyle: "dashed",
  },
  revealPill: { height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: "center" },
  factDot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },
  empty: { padding: space.page, fontSize: 14, lineHeight: 22 },
});
