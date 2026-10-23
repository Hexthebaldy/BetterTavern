/**
 * 一级页的“漫画格子”（docs/design/comic 的“页面结构”）：6 列 × 3 行，格子之间空 14，一页排满，翻页，不无限滚动。
 * 这里决定每一页放哪几项、每一项占哪几格。只有纯函数，不依赖 React 和 DOM，用 node --test 测。
 *
 * - 存档：第一页最近玩的那个占左上的大格（4 × 2），旁边和下面五个，再加一格“新的故事”；之后每页九个 2 × 1 的格子。
 * - 剧本：第一页最近添加的占左边一整列（3 × 3），右边是宽格（封面在左）和窄格（封面在上）各几个，再加一格“新建剧本”；
 *   之后每页十二个，每行宽、窄、窄、宽。
 * - 角色：另一种排法，4 × 2 张卡，每页八张（castPage）。
 * 第一页不满时换一套排法，把空出来的地方分给前面的格子和“新建”那一格，不留空洞。
 */

export const GRID = { cols: 6, rows: 3, gap: 14, minRow: 200 } as const;

/** 格子的位置：从第 col 列、第 row 行开始（都从 1 数），占 w 列、h 行 */
export type Slot = { col: number; row: number; w: number; h: number };

/** 一格：kind 决定怎么画，item 是这一项在整个列表里的下标（“新建”那一格是 null） */
export type Placed<K extends string> = { kind: K; item: number | null; slot: Slot };

const s = (col: number, row: number, w: number, h: number): Slot => ({ col, row, w, h });

type Template<K extends string> = { items: { kind: K; slot: Slot }[]; extra: { kind: K; slot: Slot }[] };

type Spec<K extends string> = {
  /** 第一页按这一页有几项选排法（下标是项数，0 不用） */
  first: Template<K>[];
  /** 之后每一页的格子，按顺序放 */
  rest: { kind: K; slot: Slot }[];
};

function capacity<K extends string>(spec: Spec<K>): { first: number; rest: number } {
  return { first: spec.first.length - 1, rest: spec.rest.length };
}

/** 一共几页（至少一页） */
function pagesOf<K extends string>(spec: Spec<K>, total: number): number {
  const cap = capacity(spec);
  if (total <= cap.first) return 1;
  return 1 + Math.ceil((total - cap.first) / cap.rest);
}

/** 第 page 页（从 0 数）的格子；页数越界时按最后一页算 */
function pageOf<K extends string>(spec: Spec<K>, total: number, page: number): Placed<K>[] {
  const cap = capacity(spec);
  const last = pagesOf(spec, total) - 1;
  const p = Math.min(Math.max(page, 0), last);
  if (p === 0) {
    const n = Math.min(total, cap.first);
    const template = spec.first[n];
    if (!template) return [];
    return [
      ...template.items.map((cell, i) => ({ kind: cell.kind, item: i, slot: cell.slot })),
      ...template.extra.map((cell) => ({ kind: cell.kind, item: null, slot: cell.slot })),
    ];
  }
  const start = cap.first + (p - 1) * cap.rest;
  const n = Math.min(cap.rest, total - start);
  return spec.rest.slice(0, n).map((cell, i) => ({ kind: cell.kind, item: start + i, slot: cell.slot }));
}

// ---- 存档 -------------------------------------------------------------------------------------

export type SaveCell = "hero" | "wide" | "small" | "new";

const SAVES: Spec<SaveCell> = {
  first: [
    { items: [], extra: [{ kind: "new", slot: s(1, 1, 6, 3) }] },
    { items: [{ kind: "hero", slot: s(1, 1, 4, 3) }], extra: [{ kind: "new", slot: s(5, 1, 2, 3) }] },
    {
      items: [
        { kind: "hero", slot: s(1, 1, 4, 2) },
        { kind: "wide", slot: s(5, 1, 2, 2) },
      ],
      extra: [{ kind: "new", slot: s(1, 3, 6, 1) }],
    },
    {
      items: [
        { kind: "hero", slot: s(1, 1, 4, 2) },
        { kind: "wide", slot: s(5, 1, 2, 1) },
        { kind: "wide", slot: s(5, 2, 2, 1) },
      ],
      extra: [{ kind: "new", slot: s(1, 3, 6, 1) }],
    },
    {
      items: [
        { kind: "hero", slot: s(1, 1, 4, 2) },
        { kind: "wide", slot: s(5, 1, 2, 1) },
        { kind: "wide", slot: s(5, 2, 2, 1) },
        { kind: "wide", slot: s(1, 3, 2, 1) },
      ],
      extra: [{ kind: "new", slot: s(3, 3, 4, 1) }],
    },
    {
      items: [
        { kind: "hero", slot: s(1, 1, 4, 2) },
        { kind: "wide", slot: s(5, 1, 2, 1) },
        { kind: "wide", slot: s(5, 2, 2, 1) },
        { kind: "wide", slot: s(1, 3, 2, 1) },
        { kind: "wide", slot: s(5, 3, 2, 1) },
      ],
      extra: [{ kind: "new", slot: s(3, 3, 2, 1) }],
    },
    // 一页排满：和设计稿 01 一样
    {
      items: [
        { kind: "hero", slot: s(1, 1, 4, 2) },
        { kind: "wide", slot: s(5, 1, 2, 1) },
        { kind: "wide", slot: s(5, 2, 2, 1) },
        { kind: "wide", slot: s(1, 3, 2, 1) },
        { kind: "small", slot: s(5, 3, 1, 1) },
        { kind: "small", slot: s(6, 3, 1, 1) },
      ],
      extra: [{ kind: "new", slot: s(3, 3, 2, 1) }],
    },
  ],
  rest: [1, 2, 3].flatMap((row) => [1, 3, 5].map((col) => ({ kind: "wide" as const, slot: s(col, row, 2, 1) }))),
};

export function savesPages(total: number): number {
  return pagesOf(SAVES, total);
}

export function savesPage(total: number, page: number): Placed<SaveCell>[] {
  return pageOf(SAVES, total, page);
}

// ---- 剧本 -------------------------------------------------------------------------------------

export type ScenarioCell = "hero" | "wide" | "narrow" | "new";

const HERO = { kind: "hero" as const, slot: s(1, 1, 3, 3) };

const SCENARIOS: Spec<ScenarioCell> = {
  first: [
    { items: [], extra: [{ kind: "new", slot: s(1, 1, 6, 3) }] },
    { items: [HERO], extra: [{ kind: "new", slot: s(4, 1, 3, 3) }] },
    { items: [HERO, { kind: "wide", slot: s(4, 1, 3, 2) }], extra: [{ kind: "new", slot: s(4, 3, 3, 1) }] },
    {
      items: [HERO, { kind: "wide", slot: s(4, 1, 3, 1) }, { kind: "wide", slot: s(4, 2, 3, 1) }],
      extra: [{ kind: "new", slot: s(4, 3, 3, 1) }],
    },
    {
      items: [
        HERO,
        { kind: "wide", slot: s(4, 1, 2, 1) },
        { kind: "narrow", slot: s(6, 1, 1, 1) },
        { kind: "wide", slot: s(4, 2, 3, 1) },
      ],
      extra: [{ kind: "new", slot: s(4, 3, 3, 1) }],
    },
    {
      items: [
        HERO,
        { kind: "wide", slot: s(4, 1, 2, 1) },
        { kind: "narrow", slot: s(6, 1, 1, 1) },
        { kind: "narrow", slot: s(4, 2, 1, 1) },
        { kind: "wide", slot: s(5, 2, 2, 1) },
      ],
      extra: [{ kind: "new", slot: s(4, 3, 3, 1) }],
    },
    // 一页排满：和设计稿 04 一样
    {
      items: [
        HERO,
        { kind: "wide", slot: s(4, 1, 2, 1) },
        { kind: "narrow", slot: s(6, 1, 1, 1) },
        { kind: "narrow", slot: s(4, 2, 1, 1) },
        { kind: "wide", slot: s(5, 2, 2, 1) },
        { kind: "wide", slot: s(4, 3, 2, 1) },
      ],
      extra: [{ kind: "new", slot: s(6, 3, 1, 1) }],
    },
  ],
  rest: [1, 2, 3].flatMap((row) => [
    { kind: "wide" as const, slot: s(1, row, 2, 1) },
    { kind: "narrow" as const, slot: s(3, row, 1, 1) },
    { kind: "narrow" as const, slot: s(4, row, 1, 1) },
    { kind: "wide" as const, slot: s(5, row, 2, 1) },
  ]),
};

export function scenariosPages(total: number): number {
  return pagesOf(SCENARIOS, total);
}

export function scenariosPage(total: number, page: number): Placed<ScenarioCell>[] {
  return pageOf(SCENARIOS, total, page);
}

// ---- 角色：4 × 2 张卡 --------------------------------------------------------------------------

export const CAST = { cols: 4, rows: 2, gap: 16, perPage: 8 } as const;

export function castPages(total: number): number {
  return Math.max(1, Math.ceil(total / CAST.perPage));
}

/** 第 page 页（从 0 数）放的是哪几项的下标 */
export function castPage(total: number, page: number): number[] {
  const p = Math.min(Math.max(page, 0), castPages(total) - 1);
  const start = p * CAST.perPage;
  return Array.from({ length: Math.max(0, Math.min(CAST.perPage, total - start)) }, (_, i) => start + i);
}

// ---- 翻页 -------------------------------------------------------------------------------------

/** ← → 翻页：到头了不动 */
export function turnPage(page: number, pages: number, key: string): number {
  if (key === "ArrowRight") return Math.min(page + 1, pages - 1);
  if (key === "ArrowLeft") return Math.max(page - 1, 0);
  return page;
}

/** 页码：两位数，前面补 0（“— 01 —”） */
export function pageLabel(page: number): string {
  return String(page + 1).padStart(2, "0");
}
