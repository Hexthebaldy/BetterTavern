/**
 * 世界状态的三页（同 App 的 WorldParts.tsx）：人物与地点、关系、事实。
 * 面板是灰底，里面的卡片是白的（.surface-panel：--fill 是白、--on-fill 是灰）。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { WorldEntity, WorldView } from "@bettertavern/core/api/types";
import { lookup } from "@bettertavern/core/i18n/index";
import { layoutGraph, NODE_HEIGHT, relLabel } from "@bettertavern/core/play/worldGraph";

import { Chip, cx } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import styles from "./world.module.css";

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
  const body = (
    <>
      <span className={styles.entityIcon}>
        <Icon name={kind.icon} size={20} />
      </span>
      <span className={styles.entityBody}>
        <span className={styles.entityTop}>
          <span className={styles.entityName}>{entity.name}</span>
          {me ? (
            <span className={styles.me}>{t("world.me")}</span>
          ) : (
            <span className={styles.kind}>{kind.label}</span>
          )}
          {expandable ? (
            <Icon name={open ? "chevronUp" : "chevronDown"} size={16} className={styles.chevron} />
          ) : null}
        </span>
        {entity.summary ? (
          <span className={cx(styles.summary, !open && styles.clamp)}>{entity.summary}</span>
        ) : null}
        {open && details.length > 0 ? (
          <span className={styles.details}>
            {details.map(([key, value]) => (
              <span key={key}>
                <span className={styles.kind}>{lookup(`world.attrs.${key}`) ?? key} </span>
                {value}
              </span>
            ))}
          </span>
        ) : null}
        {open && outgoing.length + incoming.length > 0 ? (
          <span className={styles.relChips}>
            {outgoing.map((l) => (
              <span key={`o${l.rel}${l.dst_id}`} className={styles.relChip}>
                <span className={styles.kind}>{relLabel(l.rel)}</span>
                {names.get(l.dst_id)}
              </span>
            ))}
            {incoming.map((l) => (
              <span key={`i${l.rel}${l.src_id}`} className={styles.relChip}>
                <span className={styles.kind}>{relLabel(l.rel)}</span>
                <Icon name="arrowLeft" size={12} />
                {names.get(l.src_id)}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </>
  );
  return expandable ? (
    <button
      type="button"
      className={cx(styles.entity, me && styles.entityMe)}
      aria-expanded={open}
      onClick={onToggle}
    >
      {body}
    </button>
  ) : (
    <div className={cx(styles.entity, me && styles.entityMe)}>{body}</div>
  );
}

export function Entities({ view, names }: { view: WorldView; names: Map<string, string> }) {
  const { t } = useTranslation();
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
    <>
      <div className={styles.filters}>
        <Chip label={t("world.all")} selected={filter === "all"} onClick={() => setFilter("all")} />
        {kinds.map((k) => (
          <Chip
            key={k}
            label={kindOf(k).label}
            icon={kindOf(k).icon}
            selected={filter === k}
            onClick={() => setFilter(k)}
          />
        ))}
      </div>
      <div className={styles.list}>
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
      </div>
      {shown.length === 0 ? <p className={styles.empty}>{t("world.empty")}</p> : null}
    </>
  );
}

/** 关系图（画在面板宽度减两边 12 的卡片里）和关系列表 */
export function Links({
  view,
  names,
  width,
}: {
  view: WorldView;
  names: Map<string, string>;
  width: number;
}) {
  const { t } = useTranslation();
  const inner = width - 24;
  const height = 300;
  const graph = useMemo(() => layoutGraph(view.entities, view.links, inner, height), [view, inner]);
  const links = view.links.filter((l) => names.has(l.src_id) && names.has(l.dst_id));
  if (links.length === 0) return <p className={styles.empty}>{t("world.noLinks")}</p>;
  return (
    <>
      <div className={styles.graph}>
        <svg
          width={inner}
          height={height}
          viewBox={`0 0 ${inner} ${height}`}
          role="img"
          aria-label={t("world.graph", {
            nodes: graph.nodes.map((n) => n.label).join(t("common.listSeparator")),
          })}
        >
          {graph.edges.map((e, i) => (
            <line
              key={i}
              x1={e.from.x}
              y1={e.from.y}
              x2={e.to.x}
              y2={e.to.y}
              stroke="var(--line2)"
              strokeWidth={1.6}
              strokeLinecap="round"
            />
          ))}
          {graph.edges.map((e, i) => (
            <text
              key={`t${i}`}
              x={(e.from.x + e.to.x) / 2 + 4}
              y={(e.from.y + e.to.y) / 2 - 4}
              fontSize={11}
              fill="var(--mut)"
            >
              {e.label}
            </text>
          ))}
          {graph.nodes.map((n) => {
            const fill = n.role === "me" ? "var(--acc)" : n.role === "hub" ? "var(--ink)" : "var(--on-fill)";
            const text = n.role === "me" ? "#FFFFFF" : n.role === "hub" ? "var(--bg)" : "var(--ink)";
            return (
              <g key={n.id}>
                <rect
                  x={n.x - n.width / 2}
                  y={n.y - NODE_HEIGHT / 2}
                  width={n.width}
                  height={NODE_HEIGHT}
                  rx={NODE_HEIGHT / 2}
                  fill={fill}
                />
                <text
                  x={n.x}
                  y={n.y + 4.5}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={n.role === "other" ? 400 : 700}
                  fill={text}
                >
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className={styles.list}>
        {links.map((l) => (
          <div key={`${l.src_id}${l.rel}${l.dst_id}`} className={styles.link}>
            <span className={styles.linkName}>{names.get(l.src_id)}</span>
            <span className={styles.linkMid}>{relLabel(l.rel)} →</span>
            <span className={cx(styles.linkName, styles.right)}>{names.get(l.dst_id)}</span>
          </div>
        ))}
      </div>
    </>
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
  const { t } = useTranslation();
  const facts = [...view.facts].sort(
    (a, b) => Number(a.secret) - Number(b.secret) || b.importance - a.importance,
  );
  return (
    <div className={styles.list}>
      {facts.map((f) => (
        <div key={f.id} className={cx(styles.fact, f.secret && styles.factSecret)}>
          {f.secret ? (
            <Icon name="unlock" size={16} className={styles.factIcon} />
          ) : (
            <span className={styles.factDot} />
          )}
          <span className={styles.factBody}>
            <span>{f.text}</span>
            {f.secret || f.entity_ids.length > 0 ? (
              <span className={styles.kind}>
                {[f.secret ? t("world.secretRevealed") : null, ...f.entity_ids.map((id) => names.get(id))]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </span>
        </div>
      ))}
      {view.hidden_facts > 0 ? (
        <button
          type="button"
          className={cx(styles.fact, styles.factSecret, styles.hidden)}
          aria-label={t("world.hiddenLabel", { count: view.hidden_facts })}
          onClick={onReveal}
        >
          <Icon name="lock" size={16} />
          <span className={styles.flex}>{t("world.hidden", { count: view.hidden_facts })}</span>
          <span className={styles.revealPill}>{t("world.reveal")}</span>
        </button>
      ) : null}
      {facts.length === 0 && view.hidden_facts === 0 ? (
        <p className={styles.empty}>{t("world.noFacts")}</p>
      ) : null}
    </div>
  );
}
