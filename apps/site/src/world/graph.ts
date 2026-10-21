/**
 * “世界状态”一节的关系图：节点的位置和类别、连线、那条秘密，照设计稿 Landing.dc.html 搬；文字在各语言的文案里（WorldText）。
 * 纯函数（邻接、悬停时亮哪些、选中节点的关系）在这里，测试见 graph.test.ts。
 */

import { fill } from "../i18n/format.ts";

export type Kind = "person" | "place" | "item";
export type NodeId = "me" | "tower" | "grey" | "log" | "keeper" | "chao" | "ship" | "bell" | "pier";

export type GraphNode = {
  kind: Kind;
  /** 在关系图里的位置，百分比；连线的端点就是节点的位置 */
  x: number;
  y: number;
};

export const NODES: Record<NodeId, GraphNode> = {
  me: { kind: "person", x: 18, y: 50 },
  tower: { kind: "place", x: 46, y: 32 },
  grey: { kind: "person", x: 24, y: 14 },
  log: { kind: "item", x: 72, y: 14 },
  keeper: { kind: "person", x: 78, y: 50 },
  chao: { kind: "person", x: 78, y: 90 },
  ship: { kind: "place", x: 62, y: 72 },
  bell: { kind: "item", x: 34, y: 90 },
  pier: { kind: "place", x: 24, y: 72 },
};

export const NODE_IDS = Object.keys(NODES) as NodeId[];

export const EDGES = [
  { id: "me-tower", a: "me", b: "tower" },
  { id: "grey-tower", a: "grey", b: "tower" },
  { id: "tower-pier", a: "tower", b: "pier" },
  { id: "grey-log", a: "grey", b: "log" },
  { id: "log-keeper", a: "log", b: "keeper" },
  { id: "keeper-chao", a: "keeper", b: "chao" },
  { id: "chao-ship", a: "chao", b: "ship" },
  { id: "ship-bell", a: "ship", b: "bell" },
  { id: "pier-ship", a: "pier", b: "ship" },
] as const satisfies readonly { id: string; a: NodeId; b: NodeId }[];

export type EdgeId = (typeof EDGES)[number]["id"];

/** 秘密揭开以后图上多出来的一条虚线 */
export const SECRET_EDGE = { id: "secret", a: "keeper", b: "ship" } as const satisfies {
  id: string;
  a: NodeId;
  b: NodeId;
};

export type Edge = { id: EdgeId | "secret"; a: NodeId; b: NodeId };

/** 关系的一句话：[前, 对方, 后]，比如 ["在", "灯塔", ""] 读作“在 灯塔” */
export type Relation = readonly [pre: string, target: string, post: string];

/** 关系图的文字：节点的名字和说明，每条线从两头各读一句（fromA 是从 a 看） */
export type WorldText = {
  nodes: Record<NodeId, { label: string; desc: string }>;
  edges: Record<EdgeId | "secret", { fromA: Relation; fromB: Relation }>;
  /** 那条秘密 */
  secret: string;
  kinds: Record<Kind, string>;
  /** 主角节点的类别 */
  meKind: string;
  /** 读屏念的节点名：{label}、{kind}；主角另有 {name} */
  nodeAria: string;
  meAria: string;
};

/** 当前画在图上的连线：秘密揭开以后加上那条虚线 */
export function edgesShown(revealed: boolean): readonly Edge[] {
  return revealed ? [...EDGES, SECRET_EDGE] : EDGES;
}

export function kindLabel(id: NodeId, text: WorldText): string {
  return id === "me" ? text.meKind : text.kinds[NODES[id].kind];
}

/** 读屏念的节点名；name 是主角的名字 */
export function nodeAria(id: NodeId, text: WorldText, name: string): string {
  const label = text.nodes[id].label;
  return id === "me"
    ? fill(text.meAria, { label, name, kind: text.meKind })
    : fill(text.nodeAria, { label, kind: kindLabel(id, text) });
}

/** 每个节点连着哪些节点 */
export function neighbors(revealed: boolean): Record<NodeId, NodeId[]> {
  const out = Object.fromEntries(NODE_IDS.map((id) => [id, [] as NodeId[]])) as Record<NodeId, NodeId[]>;
  for (const e of edgesShown(revealed)) {
    out[e.a].push(e.b);
    out[e.b].push(e.a);
  }
  return out;
}

export type Highlight = {
  /** 变淡的节点 */
  dimNodes: ReadonlySet<NodeId>;
  /** 连着悬停节点的线（亮）；其余的线变淡。下标对应 edgesShown 的顺序 */
  litEdges: ReadonlySet<number>;
};

/** 鼠标移到某个节点上：它和它的邻居亮着，其余变淡；连着它的线变亮。没有悬停时什么都不变 */
export function highlight(focus: NodeId | null, revealed: boolean): Highlight | null {
  if (!focus) return null;
  const lit = new Set<NodeId>([focus, ...neighbors(revealed)[focus]]);
  const litEdges = new Set<number>();
  edgesShown(revealed).forEach((e, i) => {
    if (e.a === focus || e.b === focus) litEdges.add(i);
  });
  return { dimNodes: new Set(NODE_IDS.filter((id) => !lit.has(id))), litEdges };
}

export type ShownRelation = { pre: string; target: string; post: string; secret: boolean };

/** 选中的节点下面列出的关系：从它这一头读；秘密揭开以后，老周和旧船各多一条 */
export function relations(sel: NodeId, revealed: boolean, text: WorldText): ShownRelation[] {
  const out: ShownRelation[] = [];
  for (const e of edgesShown(revealed)) {
    const t = text.edges[e.id];
    const rel = e.a === sel ? t.fromA : e.b === sel ? t.fromB : null;
    if (rel) out.push({ pre: rel[0], target: rel[1], post: rel[2], secret: e.id === "secret" });
  }
  return out;
}
