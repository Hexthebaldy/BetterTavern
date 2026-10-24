/**
 * 桌面（AuthDesk.tsx）上的四样东西：地图、人物关系图、文稿、索引卡，每样只画 SVG，没有字。
 * 和网页的 apps/web/src/pages/auth/DeskSheets.tsx 一一对应（数值照 docs/design/comic/source/ComicAuth.dc.html），
 * 只是换成 react-native-svg、颜色从 DeskInk 取；看起来随机的形状由 @bettertavern/design 的 desk.ts 按固定种子生成。
 */

import type { ReactNode } from "react";
import { Circle, ClipPath, Defs, G, Path, Rect } from "react-native-svg";

import { contours, lake, smoothPath, strips, zigzag, type Pt } from "@bettertavern/design/desk";

/** 桌面用到的颜色（AuthDesk 按当前主题给） */
export type DeskInk = {
  ink: string;
  paper: string;
  grey: string;
  acc: string;
  onAcc: string;
  sky: string;
  line2: string;
  /** 文稿段首的字条：浅灰掺一点墨 */
  stripDark: string;
};

/** 桌面上共用的底纹（AuthDesk 的 <Defs> 里定义）：蓝网点、白底墨点、灰底墨点、关系图的点阵 */
export type DeskIds = { blue: string; inkDots: string; greyDots: string; grid: string; clip: string };

/** 桌面是“写了一阵子”的样子，还是注册时“刚开始”的样子 */
export type DeskStage = "full" | "start";

const STROKE = 2.5;

/**
 * 一张放在桌上的纸：白底（地图是灰底），2.5 描边，圆角 6，6px 硬投影，里面画的东西裁在纸里。转角绕纸的中心。
 */
export function Sheet({
  k,
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
  k: DeskInk;
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
    <G transform={`translate(${x} ${y}) rotate(${rotate} ${width / 2} ${height / 2})`}>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <Rect key={n} x={n} y={n} width={width} height={height} rx={6} fill={k.ink} />
      ))}
      <Rect width={width} height={height} rx={6} fill={fill ? `url(#${fill})` : grey ? k.grey : k.paper} />
      <Defs>
        <ClipPath id={clip}>
          <Rect x={STROKE} y={STROKE} width={width - 2 * STROKE} height={height - 2 * STROKE} rx={3.5} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clip})`}>
        <G transform={`translate(${STROKE} ${STROKE})`}>{children}</G>
      </G>
      <Rect
        x={STROKE / 2}
        y={STROKE / 2}
        width={width - STROKE}
        height={height - STROKE}
        rx={6 - STROKE / 2}
        fill="none"
        stroke={k.ink}
        strokeWidth={STROKE}
      />
    </G>
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
function RoutePin({ k, at }: { k: DeskInk; at: Pt }) {
  return (
    <>
      <Circle cx={at.x + 2} cy={at.y + 2} r={7} fill={k.ink} />
      <Circle cx={at.x} cy={at.y} r={7} fill={k.paper} stroke={k.ink} strokeWidth={2.5} />
      <Circle cx={at.x} cy={at.y} r={2.4} fill={k.ink} />
    </>
  );
}

/** “你现在在这里”：带虚线圈的蓝色大图钉 */
function HerePin({ k, at }: { k: DeskInk; at: Pt }) {
  return (
    <>
      <Circle cx={at.x} cy={at.y} r={20} fill="none" stroke={k.acc} strokeWidth={2} strokeDasharray="4 4" />
      <Circle cx={at.x + 2.5} cy={at.y + 2.5} r={10} fill={k.ink} />
      <Circle cx={at.x} cy={at.y} r={10} fill={k.acc} stroke={k.ink} strokeWidth={2.5} />
    </>
  );
}

export function MapSheet({ k, stage, ids }: { k: DeskInk; stage: DeskStage; ids: DeskIds }) {
  const route = stage === "full" ? ROUTE : ROUTE_START;
  const here = route[route.length - 1]!;
  return (
    <>
      <G stroke={k.line2} strokeWidth={1}>
        {Array.from({ length: Math.ceil(MAP.width / 32) }, (_, i) => (
          <Path key={`v${i}`} d={`M${i * 32} 0V${MAP.height}`} />
        ))}
        {Array.from({ length: Math.ceil(MAP.height / 32) }, (_, i) => (
          <Path key={`h${i}`} d={`M0 ${i * 32}H${MAP.width}`} />
        ))}
      </G>
      <G fill="none" stroke={k.ink} strokeWidth={1.5} opacity={0.5}>
        {MOUNTAINS.flatMap((m) =>
          contours(m.seed, m.at, m.rx, m.ry, m.rings).map((ring, i) => (
            <Path key={`${m.seed}-${i}`} d={smoothPath(ring, true)} />
          )),
        )}
      </G>
      <Path
        d={smoothPath(lake(21, { x: 251, y: 118 }, 33), true)}
        fill={`url(#${ids.blue})`}
        stroke={k.ink}
        strokeWidth={2.5}
      />
      <Path d={smoothPath(RIVER, false)} fill="none" stroke={k.acc} strokeWidth={8} strokeLinecap="round" />
      <Path
        d={smoothPath(RIVER, false)}
        fill="none"
        stroke={k.ink}
        strokeWidth={1.5}
        strokeDasharray="1 9"
        strokeLinecap="round"
        opacity={0.6}
      />
      <Path
        d={smoothPath(route, false)}
        fill="none"
        stroke={k.ink}
        strokeWidth={2.5}
        strokeDasharray="9 7"
        strokeLinecap="round"
      />
      {stage === "full" ? route.slice(0, -1).map((p) => <RoutePin key={`${p.x}-${p.y}`} k={k} at={p} />) : null}
      <HerePin k={k} at={stage === "full" ? here : route[0]!} />
      {/* 没有字的指北针 */}
      <Circle cx={415} cy={44} r={20} fill={k.paper} stroke={k.ink} strokeWidth={2.5} />
      <Path d="M415 29L421 44L415 42Z" fill={k.acc} stroke={k.ink} strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M415 59L409 44L415 46Z" fill={k.ink} />
      {/* 黑白相间的比例尺 */}
      {[0, 1, 2, 3].map((i) => (
        <Rect
          key={i}
          x={18 + i * 22}
          y={325}
          width={22}
          height={8}
          fill={i % 2 ? k.paper : k.ink}
          stroke={k.ink}
          strokeWidth={2}
        />
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

const f = (n: number): number => Math.round(n * 10) / 10;

function TieMark({ k, tie }: { k: DeskInk; tie: Tie }) {
  const { a, b, ux, uy } = tieLine(tie);
  if (tie.kind === "double") {
    // 两根平行线，各往一边挪 3
    const nx = -uy * 3;
    const ny = ux * 3;
    return (
      <Path
        d={`M${f(a.x + nx)} ${f(a.y + ny)}L${f(b.x + nx)} ${f(b.y + ny)}M${f(a.x - nx)} ${f(a.y - ny)}L${f(b.x - nx)} ${f(b.y - ny)}`}
        stroke={k.ink}
        strokeWidth={2}
      />
    );
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const line = (
    <Path
      d={`M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`}
      stroke={k.ink}
      strokeWidth={2.5}
      strokeDasharray={tie.kind === "dashed" ? "7 6" : undefined}
    />
  );
  if (tie.kind === "arrow") {
    // 箭头尖在线的终点外 4，长 14、宽 12
    const tip = { x: b.x + ux * 4, y: b.y + uy * 4 };
    const back = { x: tip.x - ux * 14, y: tip.y - uy * 14 };
    const head = `M${f(tip.x)} ${f(tip.y)}L${f(back.x - uy * 6)} ${f(back.y + ux * 6)}L${f(back.x + uy * 6)} ${f(back.y - ux * 6)}Z`;
    return (
      <>
        {line}
        <Path d={head} fill={k.ink} />
        <Circle cx={f(mid.x)} cy={f(mid.y)} r={5} fill={k.acc} stroke={k.ink} strokeWidth={2} />
      </>
    );
  }
  return (
    <>
      {line}
      {tie.mark ? (
        <Rect
          x={f(mid.x - 5)}
          y={f(mid.y - 5)}
          width={10}
          height={10}
          transform={`rotate(45 ${f(mid.x)} ${f(mid.y)})`}
          fill={k.paper}
          stroke={k.ink}
          strokeWidth={2}
        />
      ) : null}
    </>
  );
}

function PersonDot({ k, p, ids }: { k: DeskInk; p: Person; ids: DeskIds }) {
  const fill = {
    you: `url(#${ids.blue})`,
    ink: k.ink,
    dots: `url(#${ids.inkDots})`,
    grey: `url(#${ids.greyDots})`,
    white: k.paper,
  }[p.look];
  return (
    <>
      {p.look === "you" ? (
        <Circle cx={p.x} cy={p.y} r={p.r + 12} fill="none" stroke={k.acc} strokeWidth={2} strokeDasharray="4 4" />
      ) : null}
      {p.shadow ? <Circle cx={p.x + 3} cy={p.y + 3} r={p.r} fill={k.ink} /> : null}
      <Circle cx={p.x} cy={p.y} r={p.r} fill={fill} stroke={k.ink} strokeWidth={2.5} />
    </>
  );
}

export function RelationSheet({ k, stage, ids }: { k: DeskInk; stage: DeskStage; ids: DeskIds }) {
  const shown: Who[] = stage === "full" ? (Object.keys(PEOPLE) as Who[]) : ["you", "a"];
  const ties = stage === "full" ? TIES : [{ from: "you", to: "a", kind: "dashed" } satisfies Tie];
  return (
    <>
      <Rect width={395} height={335} fill={`url(#${ids.grid})`} />
      {ties.map((tie) => (
        <TieMark key={`${tie.from}-${tie.to}`} k={k} tie={tie} />
      ))}
      {shown.map((who) => (
        <PersonDot key={who} k={k} p={PEOPLE[who]} ids={ids} />
      ))}
      {/* 圈起来的一组关系 */}
      {stage === "full" ? (
        <Rect
          x={282}
          y={40}
          width={128}
          height={160}
          rx={16}
          fill="none"
          stroke={k.acc}
          strokeWidth={2}
          strokeDasharray="6 5"
        />
      ) : null}
    </>
  );
}

// ---- 文稿 ------------------------------------------------------------------------------------------

/**
 * 一张文稿：左边一道浅蓝的页边线；每行字是一根灰色字条；有一行蓝色高亮，可能有两行被划掉、页边一个批注圈和箭头。
 * lines 是最多写几行（注册时的空文稿写得少）
 */
export function DocSheet({
  k,
  seed,
  width,
  height,
  lines,
  highlight,
  struck,
  note,
}: {
  k: DeskInk;
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
      <Path d={`M22 0V${height}`} stroke={k.sky} strokeWidth={2} />
      {rows.map((row, i) => (
        <G key={row.y}>
          {i === highlight ? (
            <Rect x={30} y={row.y - 5} width={row.width + 8} height={16} fill={k.sky} opacity={0.55} />
          ) : null}
          <Rect x={34} y={row.y} width={row.width} height={6} rx={3} fill={row.dark ? k.stripDark : k.line2} />
          {struck?.includes(i) ? (
            <Path
              d={zigzag(34, 34 + row.width, row.y)}
              fill="none"
              stroke={k.ink}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ) : null}
        </G>
      ))}
      {note ? (
        <>
          <Circle cx={note.x} cy={note.y} r={14} fill="none" stroke={k.acc} strokeWidth={2.5} />
          <Path
            d={`M${note.x - 14} ${note.y + 12}q-22 22 -46 18`}
            fill="none"
            stroke={k.acc}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </>
      ) : null}
    </>
  );
}

// ---- 索引卡 ----------------------------------------------------------------------------------------

/** 蓝网点底，几道白字条，右上角一个打了勾的小方框 */
export function IndexCard({ k }: { k: DeskInk }) {
  return (
    <>
      {[140, 110, 160, 80].map((w, i) => (
        <Rect
          key={w}
          x={18}
          y={30 + i * 22}
          width={w}
          height={7}
          rx={3.5}
          fill={k.onAcc}
          opacity={i === 0 ? 0.95 : 0.7}
        />
      ))}
      <Rect x={179} y={18} width={28} height={28} rx={6} fill={k.paper} stroke={k.ink} strokeWidth={2.5} />
      <Path
        d="M186 32l5 5 9-10"
        fill="none"
        stroke={k.acc}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}
