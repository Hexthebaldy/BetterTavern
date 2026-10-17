/**
 * 世界状态面板的关系图布局：连接最多的实体放在中间，其余的绕成一圈，主角放在左上。
 * 只画出现在关系里的实体，最多 8 个（主角一定在）。纯函数，坐标以画布左上角为原点。
 */

import type { WorldEntity } from "../api/types.ts";
import { lookup } from "../i18n/index.ts";

export type GraphNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  role: "me" | "hub" | "other";
};

export type GraphEdge = { from: GraphNode; to: GraphNode; label: string };

export const NODE_HEIGHT = 32;
const MAX_NODES = 8;

/** 关系名（位于、持有者、属于）；不认识的关系显示它的 id */
export function relLabel(rel: string): string {
  return lookup(`world.rel.${rel}`) ?? rel;
}

/** 方框宽度按字数估算：中文一个字约 13pt，两边各留 12 */
export function nodeWidth(label: string): number {
  let units = 0;
  for (const ch of label) units += /[\u0000-ÿ]/.test(ch) ? 0.55 : 1;
  return Math.round(Math.min(Math.max(units * 13 + 24, 56), 132));
}

function shortLabel(name: string): string {
  const chars = [...name];
  return chars.length > 8 ? `${chars.slice(0, 7).join("")}…` : name;
}

export function layoutGraph(
  entities: WorldEntity[],
  links: { src_id: string; rel: string; dst_id: string }[],
  width: number,
  height: number,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const valid = links.filter((l) => byId.has(l.src_id) && byId.has(l.dst_id) && l.src_id !== l.dst_id);
  const degree = new Map<string, number>();
  for (const l of valid) {
    degree.set(l.src_id, (degree.get(l.src_id) ?? 0) + 1);
    degree.set(l.dst_id, (degree.get(l.dst_id) ?? 0) + 1);
  }
  const score = (id: string): number => (degree.get(id) ?? 0) * 10 + (byId.get(id)?.importance ?? 0);
  const ranked = [...degree.keys()].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const me = entities.find((e) => e.is_protagonist && degree.has(e.id));
  const kept = ranked.slice(0, MAX_NODES);
  if (me && !kept.includes(me.id)) kept[kept.length - 1] = me.id;
  if (kept.length === 0) return { nodes: [], edges: [] };

  const hubId = kept.find((id) => id !== me?.id) ?? kept[0] ?? "";
  const ring = kept.filter((id) => id !== hubId);
  // 主角排在圈上的第一个，放在左上
  ring.sort((a, b) => (a === me?.id ? -1 : b === me?.id ? 1 : 0));

  const cx = width * 0.55;
  const cy = height / 2;
  const rx = width / 2 - 70;
  const ry = height / 2 - NODE_HEIGHT;
  const nodes = new Map<string, GraphNode>();
  const place = (id: string, x: number, y: number, role: GraphNode["role"]): void => {
    const label = shortLabel(byId.get(id)?.name ?? "");
    const w = nodeWidth(label);
    nodes.set(id, {
      id,
      label,
      width: w,
      role,
      x: Math.min(Math.max(x, w / 2 + 4), width - w / 2 - 4),
      y: Math.min(Math.max(y, NODE_HEIGHT / 2 + 4), height - NODE_HEIGHT / 2 - 4),
    });
  };
  place(hubId, cx, cy, hubId === me?.id ? "me" : "hub");
  ring.forEach((id, i) => {
    const angle = (-150 + (360 / Math.max(ring.length, 1)) * i) * (Math.PI / 180);
    place(id, cx + rx * Math.cos(angle), cy + ry * Math.sin(angle), id === me?.id ? "me" : "other");
  });

  const edges: GraphEdge[] = [];
  for (const l of valid) {
    const from = nodes.get(l.src_id);
    const to = nodes.get(l.dst_id);
    if (from && to) edges.push({ from, to, label: relLabel(l.rel) });
  }
  return { nodes: [...nodes.values()], edges };
}
