/**
 * 桌面上的四样东西（地图、人物关系图、文稿、索引卡），每样只画 SVG，没有字。
 * 坐标是每张纸自己的（左上角是纸的里侧，去掉了 2.5 的描边），数值照 docs/design/comic/source/ComicAuth.dc.html；
 * 看起来随机的形状由 desk.ts 按固定种子生成。颜色都走 desk.module.css 里的类（跟着深浅色变）。
 */

import type { ReactNode } from "react";

import styles from "./desk.module.css";
import { contours, lake, smoothPath, strips, zigzag, type Pt } from "./desk.ts";

/** 桌面上共用的底纹（Desk 里的 <defs> 定义）：蓝网点、白底墨点、灰底墨点、关系图的点阵 */
export type DeskIds = { blue: string; inkDots: string; greyDots: string; grid: string; clip: string };

/** 桌面是“写了一阵子”的样子，还是注册时“刚开始”的样子 */
export type DeskStage = "full" | "start";

const STROKE = 2.5;

/**
 * 一张放在桌上的纸：位置、大小、转角照稿子；白底（地图是灰底），2.5 描边，圆角 6，6px 硬投影，
 * 里面画的东西裁在纸里。转角绕纸的中心。
 */
export function Sheet({
  id,
  x,
  y,
  width,
  height,
  rotate,
  grey,
  fill,
  children,
}: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
  grey?: boolean;
  /** 整张纸铺一种底纹（索引卡的蓝网点） */
  fill?: string;
  children: ReactNode;
}) {
  const clip = `${id}-clip`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate} ${width / 2} ${height / 2})`}>
      {[1, 2, 3, 4, 5, 6].map((k) => (
        <rect key={k} x={k} y={k} width={width} height={height} rx={6} className={styles.shade} />
      ))}
      <rect
        width={width}
        height={height}
        rx={6}
        className={fill ? undefined : grey ? styles.greyPaper : styles.paper}
        fill={fill ? `url(#${fill})` : undefined}
      />
      <clipPath id={clip}>
        <rect x={STROKE} y={STROKE} width={width - 2 * STROKE} height={height - 2 * STROKE} rx={3.5} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <g transform={`translate(${STROKE} ${STROKE})`}>{children}</g>
      </g>
      <rect
        x={STROKE / 2}
        y={STROKE / 2}
        width={width - STROKE}
        height={height - STROKE}
        rx={6 - STROKE / 2}
        className={styles.edge}
      />
    </g>
  );
}

// ---- 地图 ------------------------------------------------------------------------------------------

const MAP = { width: 455, height: 355 };
const MOUNTAINS = [
  { seed: 11, at: { x: 121, y: 111 }, rx: 80, ry: 76, rings: 5 },
  { seed: 12, at: { x: 329, y: 253 }, rx: 74, ry: 63, rings: 4 },
  { seed: 13, at: { x: 360, y: 69 }, rx: 40, ry: 41, rings: 3 },
];
const RIVER: Pt[] = [
  { x: -10, y: 300 },
  { x: 70, y: 270 },
  { x: 150, y: 292 },
  { x: 210, y: 230 },
  { x: 250, y: 160 },
  { x: 300, y: 130 },
  { x: 380, y: 150 },
  { x: 465, y: 120 },
];
const ROUTE: Pt[] = [
  { x: 60, y: 236 },
  { x: 140, y: 196 },
  { x: 205, y: 262 },
  { x: 292, y: 232 },
];
/** 注册时只走了一小段 */
const ROUTE_START: Pt[] = [
  { x: 60, y: 236 },
  { x: 130, y: 214 },
];

/** 路上经过的地方：白心图钉 */
function RoutePin({ at }: { at: Pt }) {
  return (
    <>
      <circle cx={at.x + 2} cy={at.y + 2} r={7} className={styles.ink} />
      <circle cx={at.x} cy={at.y} r={7} className={styles.whitePin} />
      <circle cx={at.x} cy={at.y} r={2.4} className={styles.ink} />
    </>
  );
}

/** “你现在在这里”：带虚线圈的蓝色大图钉 */
function HerePin({ at }: { at: Pt }) {
  return (
    <>
      <circle cx={at.x} cy={at.y} r={20} className={styles.ring} />
      <circle cx={at.x + 2.5} cy={at.y + 2.5} r={10} className={styles.ink} />
      <circle cx={at.x} cy={at.y} r={10} className={styles.bluePin} />
    </>
  );
}

export function MapSheet({ stage, ids }: { stage: DeskStage; ids: DeskIds }) {
  const route = stage === "full" ? ROUTE : ROUTE_START;
  const here = route[route.length - 1]!;
  return (
    <>
      <g className={styles.gridLine}>
        {Array.from({ length: Math.ceil(MAP.width / 32) }, (_, i) => (
          <path key={`v${i}`} d={`M${i * 32} 0V${MAP.height}`} />
        ))}
        {Array.from({ length: Math.ceil(MAP.height / 32) }, (_, i) => (
          <path key={`h${i}`} d={`M0 ${i * 32}H${MAP.width}`} />
        ))}
      </g>
      <g className={styles.contour}>
        {MOUNTAINS.flatMap((m) =>
          contours(m.seed, m.at, m.rx, m.ry, m.rings).map((ring, i) => (
            <path key={`${m.seed}-${i}`} d={smoothPath(ring, true)} />
          )),
        )}
      </g>
      <path d={smoothPath(lake(21, { x: 251, y: 118 }, 33), true)} fill={`url(#${ids.blue})`} className={styles.lake} />
      <path d={smoothPath(RIVER, false)} className={styles.river} />
      <path d={smoothPath(RIVER, false)} className={styles.riverDots} />
      <path d={smoothPath(route, false)} className={styles.route} />
      {stage === "full" ? route.slice(0, -1).map((p) => <RoutePin key={`${p.x}-${p.y}`} at={p} />) : null}
      <HerePin at={stage === "full" ? here : route[0]!} />
      {/* 没有字的指北针 */}
      <circle cx={415} cy={44} r={20} className={styles.whitePin} />
      <path d="M415 29L421 44L415 42Z" className={styles.needle} />
      <path d="M415 59L409 44L415 46Z" className={styles.ink} />
      {/* 黑白相间的比例尺 */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={18 + i * 22} y={325} width={22} height={8} className={i % 2 ? styles.scaleWhite : styles.scaleInk} />
      ))}
    </>
  );
}

// ---- 人物关系图 --------------------------------------------------------------------------------------

type Person = { x: number; y: number; r: number; look: "you" | "ink" | "dots" | "grey" | "white"; shadow: boolean };
const PEOPLE = {
  you: { x: 200, y: 168, r: 30, look: "you", shadow: true },
  a: { x: 84, y: 82, r: 24, look: "ink", shadow: true },
  b: { x: 322, y: 76, r: 22, look: "dots", shadow: true },
  c: { x: 76, y: 262, r: 20, look: "grey", shadow: true },
  d: { x: 318, y: 262, r: 26, look: "white", shadow: true },
  e: { x: 196, y: 300, r: 16, look: "ink", shadow: false },
  f: { x: 382, y: 170, r: 14, look: "grey", shadow: false },
} satisfies Record<string, Person>;
type Who = keyof typeof PEOPLE;

/** 四种关系：实线（中间一个白菱形）、虚线、双线、箭头（中间一个蓝圆点） */
type Tie = { from: Who; to: Who; kind: "solid" | "dashed" | "double" | "arrow"; mark?: boolean };
const TIES: Tie[] = [
  { from: "you", to: "a", kind: "solid", mark: true },
  { from: "you", to: "b", kind: "dashed" },
  { from: "you", to: "c", kind: "double" },
  { from: "you", to: "d", kind: "arrow" },
  { from: "you", to: "e", kind: "solid", mark: true },
  { from: "b", to: "f", kind: "dashed" },
  { from: "a", to: "c", kind: "dashed" },
  { from: "d", to: "f", kind: "solid", mark: true },
  { from: "b", to: "d", kind: "double" },
];

/** 两个人之间的线：从圆边往外 4 开始，到对方圆边外 6 为止 */
function tieLine(tie: Tie): { a: Pt; b: Pt; ux: number; uy: number } {
  const p = PEOPLE[tie.from];
  const q = PEOPLE[tie.to];
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const ux = (q.x - p.x) / len;
  const uy = (q.y - p.y) / len;
  return {
    a: { x: p.x + ux * (p.r + 4), y: p.y + uy * (p.r + 4) },
    b: { x: q.x - ux * (q.r + 6), y: q.y - uy * (q.r + 6) },
    ux,
    uy,
  };
}

function TieMark({ tie }: { tie: Tie }) {
  const { a, b, ux, uy } = tieLine(tie);
  const f = (n: number) => Math.round(n * 10) / 10;
  if (tie.kind === "double") {
    // 两根平行线，各往一边挪 3
    const nx = -uy * 3;
    const ny = ux * 3;
    return (
      <path
        d={`M${f(a.x + nx)} ${f(a.y + ny)}L${f(b.x + nx)} ${f(b.y + ny)}M${f(a.x - nx)} ${f(a.y - ny)}L${f(b.x - nx)} ${f(b.y - ny)}`}
        className={styles.tieDouble}
      />
    );
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const line = <path d={`M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`} className={tie.kind === "dashed" ? styles.tieDashed : styles.tie} />;
  if (tie.kind === "arrow") {
    // 箭头尖在线的终点外 4，长 14、宽 12
    const tip = { x: b.x + ux * 4, y: b.y + uy * 4 };
    const back = { x: tip.x - ux * 14, y: tip.y - uy * 14 };
    const head = `M${f(tip.x)} ${f(tip.y)}L${f(back.x - uy * 6)} ${f(back.y + ux * 6)}L${f(back.x + uy * 6)} ${f(back.y - ux * 6)}Z`;
    return (
      <>
        {line}
        <path d={head} className={styles.ink} />
        <circle cx={f(mid.x)} cy={f(mid.y)} r={5} className={styles.tieDot} />
      </>
    );
  }
  return (
    <>
      {line}
      {tie.mark ? (
        <rect
          x={f(mid.x - 5)}
          y={f(mid.y - 5)}
          width={10}
          height={10}
          transform={`rotate(45 ${f(mid.x)} ${f(mid.y)})`}
          className={styles.tieDiamond}
        />
      ) : null}
    </>
  );
}

function PersonDot({ p, ids }: { p: Person; ids: DeskIds }) {
  const fill = {
    you: `url(#${ids.blue})`,
    ink: undefined,
    dots: `url(#${ids.inkDots})`,
    grey: `url(#${ids.greyDots})`,
    white: undefined,
  }[p.look];
  return (
    <>
      {p.look === "you" ? <circle cx={p.x} cy={p.y} r={p.r + 12} className={styles.ring} /> : null}
      {p.shadow ? <circle cx={p.x + 3} cy={p.y + 3} r={p.r} className={styles.ink} /> : null}
      <circle
        cx={p.x}
        cy={p.y}
        r={p.r}
        fill={fill}
        className={p.look === "ink" ? styles.personInk : p.look === "white" ? styles.personWhite : styles.person}
      />
    </>
  );
}

export function RelationSheet({ stage, ids }: { stage: DeskStage; ids: DeskIds }) {
  const shown: Who[] = stage === "full" ? (Object.keys(PEOPLE) as Who[]) : ["you", "a"];
  const ties = stage === "full" ? TIES : [{ from: "you", to: "a", kind: "dashed" } satisfies Tie];
  return (
    <>
      <rect width={395} height={335} fill={`url(#${ids.grid})`} />
      {ties.map((tie) => (
        <TieMark key={`${tie.from}-${tie.to}`} tie={tie} />
      ))}
      {shown.map((who) => (
        <PersonDot key={who} p={PEOPLE[who]} ids={ids} />
      ))}
      {/* 圈起来的一组关系 */}
      {stage === "full" ? <rect x={282} y={40} width={128} height={160} rx={16} className={styles.group} /> : null}
    </>
  );
}

// ---- 文稿 ------------------------------------------------------------------------------------------

/**
 * 一张文稿：左边一道浅蓝的页边线；每行字是一根灰色字条；有一行蓝色高亮，可能有两行被划掉、页边一个批注圈和箭头。
 * lines 是最多写几行（注册时的空文稿写得少）
 */
export function DocSheet({
  seed,
  width,
  height,
  lines,
  highlight,
  struck,
  note,
}: {
  seed: number;
  width: number;
  height: number;
  lines: number;
  /** 第几行高亮（从 0 数） */
  highlight?: number;
  /** 被划掉的两行（从 0 数） */
  struck?: [number, number];
  /** 批注圈的圆心 */
  note?: Pt;
}) {
  const rows = strips(seed, { top: 30, bottom: height - 30, lines, min: 72, max: width - 50 });
  return (
    <>
      <path d={`M22 0V${height}`} className={styles.margin} />
      {rows.map((row, i) => (
        <g key={row.y}>
          {i === highlight ? <rect x={30} y={row.y - 5} width={row.width + 8} height={16} className={styles.highlight} /> : null}
          <rect x={34} y={row.y} width={row.width} height={6} rx={3} className={row.dark ? styles.stripDark : styles.strip} />
          {struck?.includes(i) ? <path d={zigzag(34, 34 + row.width, row.y)} className={styles.strike} /> : null}
        </g>
      ))}
      {note ? (
        <>
          <circle cx={note.x} cy={note.y} r={14} className={styles.note} />
          <path d={`M${note.x - 14} ${note.y + 12}q-22 22 -46 18`} className={styles.note} />
        </>
      ) : null}
    </>
  );
}

// ---- 索引卡 ----------------------------------------------------------------------------------------

/** 蓝网点底，几道白字条，右上角一个打了勾的小方框 */
export function IndexCard() {
  return (
    <>
      {[140, 110, 160, 80].map((w, i) => (
        <rect key={w} x={18} y={30 + i * 22} width={w} height={7} rx={3.5} className={i === 0 ? styles.cardStrip : styles.cardStripSoft} />
      ))}
      <rect x={179} y={18} width={28} height={28} rx={6} className={styles.box} />
      <path d="M186 32l5 5 9-10" className={styles.tick} />
    </>
  );
}
