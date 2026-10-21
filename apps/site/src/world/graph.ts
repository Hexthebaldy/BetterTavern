/**
 * “世界状态”一节的关系图：节点、连线和那条秘密，照设计稿 Landing.dc.html 搬。
 * 纯函数（邻接、悬停时亮哪些、选中节点的关系）在这里，测试见 graph.test.ts。
 */

export type Kind = "person" | "place" | "item";
export type NodeId = "me" | "tower" | "grey" | "log" | "keeper" | "chao" | "ship" | "bell" | "pier";

export type GraphNode = {
  label: string;
  kind: Kind;
  /** 在关系图里的位置，百分比；连线的端点就是节点的位置 */
  x: number;
  y: number;
  desc: string;
};

export const NODES: Record<NodeId, GraphNode> = {
  me: { label: "我", kind: "person", x: 18, y: 50, desc: "新来的守夜人。目标：把灯重新点亮。" },
  tower: { label: "灯塔", kind: "place", x: 46, y: 32, desc: "码头尽头的灯塔，灯是灭的。" },
  grey: { label: "灰外套的女人", kind: "person", x: 24, y: 14, desc: "态度：像是早就认识我。说话很轻，很慢。" },
  log: { label: "航海日志", kind: "item", x: 72, y: 14, desc: "最后一页的墨迹还没干。" },
  keeper: { label: "老周", kind: "person", x: 78, y: 50, desc: "守塔人，三天前不见了。" },
  chao: { label: "阿潮", kind: "person", x: 78, y: 90, desc: "抱着一盏没点的提灯，冻得发抖。" },
  ship: { label: "无名旧船", kind: "place", x: 62, y: 72, desc: "船身没有名字，缆绳还在滴水。" },
  bell: { label: "旧船钟", kind: "item", x: 34, y: 90, desc: "钟响三声，就有人要回来。" },
  pier: { label: "雾港码头", kind: "place", x: 24, y: 72, desc: "雾从海面漫上来，已经没过了栏杆。" },
};

export const NODE_IDS = Object.keys(NODES) as NodeId[];

/** 关系的一句话：[前, 对方, 后]，比如 ["在", "灯塔", ""] 读作“在 灯塔” */
export type Relation = readonly [pre: string, target: string, post: string];

export type Edge = {
  a: NodeId;
  b: NodeId;
  /** 从 a 看、从 b 看 */
  fromA: Relation;
  fromB: Relation;
};

export const EDGES: readonly Edge[] = [
  { a: "me", b: "tower", fromA: ["在", "灯塔", ""], fromB: ["", "我", "在这里"] },
  { a: "grey", b: "tower", fromA: ["在", "灯塔", ""], fromB: ["", "灰外套的女人", "在这里"] },
  { a: "tower", b: "pier", fromA: ["在", "雾港码头", "的尽头"], fromB: ["尽头是", "灯塔", ""] },
  { a: "grey", b: "log", fromA: ["拿着", "航海日志", ""], fromB: ["在", "灰外套的女人", "手里"] },
  { a: "log", b: "keeper", fromA: ["是", "老周", "写的"], fromB: ["写下了", "航海日志", ""] },
  { a: "keeper", b: "chao", fromA: ["是", "阿潮", "的爷爷"], fromB: ["是", "老周", "的孙子"] },
  { a: "chao", b: "ship", fromA: ["躲在", "无名旧船", "里"], fromB: ["舱里有", "阿潮", ""] },
  { a: "ship", b: "bell", fromA: ["挂着", "旧船钟", ""], fromB: ["挂在", "无名旧船", "上"] },
  { a: "pier", b: "ship", fromA: ["旁边停着", "无名旧船", ""], fromB: ["停在", "雾港码头", "边上"] },
];

/** 秘密揭开以后图上多出来的一条虚线 */
export const SECRET_EDGE: Edge = {
  a: "keeper",
  b: "ship",
  fromA: ["三十年前死在", "无名旧船", "上"],
  fromB: ["", "老周", "三十年前死在这里"],
};

export const SECRET_TEXT = "老周三十年前就死在那条沉船上了。";

const KIND_LABEL: Record<Kind, string> = { person: "人物", place: "地点", item: "物品" };

export function kindLabel(id: NodeId): string {
  return id === "me" ? "主角" : KIND_LABEL[NODES[id].kind];
}

/** 读屏念的节点名 */
export function nodeAria(id: NodeId): string {
  return id === "me" ? "我，林深，主角" : `${NODES[id].label}，${KIND_LABEL[NODES[id].kind]}`;
}

/** 当前画在图上的连线：秘密揭开以后加上那条虚线 */
export function edgesShown(revealed: boolean): readonly Edge[] {
  return revealed ? [...EDGES, SECRET_EDGE] : EDGES;
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
export function relations(sel: NodeId, revealed: boolean): ShownRelation[] {
  const out: ShownRelation[] = [];
  for (const e of edgesShown(revealed)) {
    const secret = e === SECRET_EDGE;
    const rel = e.a === sel ? e.fromA : e.b === sel ? e.fromB : null;
    if (rel) out.push({ pre: rel[0], target: rel[1], post: rel[2], secret });
  }
  return out;
}
