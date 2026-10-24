/**
 * 登录页左格：一张写故事的桌面（docs/design/comic 的“登录页”一节，png/10–12）。
 * 地图、人物关系图、三张文稿、一张索引卡乱放着、互相压着、各自转一个小角度，有的出了格子的边；
 * 最上层是三条半透明的蓝胶带、两颗蓝图钉和一根蓝色点线（从地图上的当前位置连到关系图里的“你”，再连到索引卡）。
 * 一个字都没有，也没有图片，整个是一张 700×820 的 SVG：格子大小不同时按比例铺满、裁掉多出来的边，不变形。
 * stage="start" 是注册页“刚开始”的样子：地图上只有起点和一小段路，关系图只有“你”和一个人，文稿几乎是空白，没有索引卡。
 *
 * 右格的集中线（FormRays）也在这里：从格子四周往中间收的细三角形，中间半径 300 以内空着放表单。
 */

import { useId } from "react";

import styles from "./desk.module.css";
import { rays } from "./desk.ts";
import { DocSheet, IndexCard, MapSheet, RelationSheet, Sheet, type DeskIds, type DeskStage } from "./DeskSheets.tsx";

const TAPES = [
  { x: 8, y: 34, width: 96, rotate: -24 },
  { x: 600, y: 330, width: 92, rotate: 28 },
  { x: 150, y: 612, width: 84, rotate: -8 },
];
const PINS = [
  { x: 536, y: 22 },
  { x: 116, y: 436 },
];
/** 蓝线：地图上的当前位置 → 关系图里的“你” → 索引卡（注册时只连到“你”） */
const THREAD = {
  full: "M320 276 C 380 330, 440 420, 474 504 S 560 650, 582 716",
  start: "M160 254 C 260 300, 400 380, 474 504",
};

export function Desk({ stage = "full" }: { stage?: DeskStage }) {
  const base = useId();
  const ids: DeskIds = {
    blue: `${base}-blue`,
    inkDots: `${base}-ink`,
    greyDots: `${base}-grey`,
    grid: `${base}-grid`,
    clip: `${base}-clip`,
  };
  const full = stage === "full";
  return (
    <svg className={styles.desk} viewBox="0 0 700 820" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={ids.blue} width={10} height={10} patternUnits="userSpaceOnUse">
          <rect width={10} height={10} className={styles.blueBg} />
          <circle cx={5} cy={5} r={1.4} className={styles.blueDot} />
        </pattern>
        <pattern id={ids.inkDots} width={8} height={8} patternUnits="userSpaceOnUse">
          <rect width={8} height={8} className={styles.paper} />
          <circle cx={4} cy={4} r={1.3} className={styles.inkDot} />
        </pattern>
        <pattern id={ids.greyDots} width={9} height={9} patternUnits="userSpaceOnUse">
          <rect width={9} height={9} className={styles.greyPaper} />
          <circle cx={4.5} cy={4.5} r={1.2} className={styles.greyDot} />
        </pattern>
        <pattern id={ids.grid} width={24} height={24} patternUnits="userSpaceOnUse">
          <rect width={24} height={24} className={styles.paper} />
          <circle cx={12} cy={12} r={1.2} className={styles.gridDot} />
        </pattern>
      </defs>

      <Sheet id={`${ids.clip}-1`} x={400} y={-24} width={270} height={330} rotate={6}>
        <DocSheet
          seed={31}
          width={265}
          height={325}
          lines={full ? 16 : 2}
          highlight={full ? 3 : undefined}
          struck={full ? [7, 8] : undefined}
          note={full ? { x: 231, y: 188 } : undefined}
        />
      </Sheet>
      <Sheet id={`${ids.clip}-2`} x={30} y={40} width={460} height={360} rotate={-2.5} grey>
        <MapSheet stage={stage} ids={ids} />
      </Sheet>
      <Sheet id={`${ids.clip}-3`} x={-20} y={420} width={280} height={370} rotate={-5}>
        <DocSheet seed={32} width={275} height={365} lines={full ? 15 : 2} highlight={full ? 3 : undefined} />
      </Sheet>
      <Sheet id={`${ids.clip}-4`} x={280} y={340} width={400} height={340} rotate={2.5}>
        <RelationSheet stage={stage} ids={ids} />
      </Sheet>
      <Sheet id={`${ids.clip}-5`} x={130} y={620} width={290} height={300} rotate={3.5}>
        <DocSheet
          seed={33}
          width={285}
          height={295}
          lines={full ? 13 : 0}
          highlight={full ? 3 : undefined}
          struck={full ? [7, 8] : undefined}
          note={full ? { x: 251, y: 171 } : undefined}
        />
      </Sheet>
      {full ? (
        <Sheet id={`${ids.clip}-6`} x={460} y={660} width={230} height={150} rotate={-4} fill={ids.blue}>
          <IndexCard />
        </Sheet>
      ) : null}

      <path d={THREAD[stage]} className={styles.thread} />
      {TAPES.map((tape) => (
        <rect
          key={tape.x}
          x={tape.x}
          y={tape.y}
          width={tape.width}
          height={26}
          transform={`rotate(${tape.rotate} ${tape.x + tape.width / 2} ${tape.y + 13})`}
          className={styles.tape}
        />
      ))}
      {PINS.map((pin) => (
        <g key={pin.x}>
          <circle cx={pin.x + 2} cy={pin.y + 2} r={6.75} className={styles.shade} />
          <circle cx={pin.x} cy={pin.y} r={6.75} className={styles.pin} />
        </g>
      ))}
    </svg>
  );
}

/** 集中线：以格子中心为原点，尖离中心 300–435，底边远在格子外面（被格子裁掉）；10% 的墨色 */
const RAYS = rays(41, { count: 170, inner: 300, spread: 135, outer: 1035, minWidth: 9, maxWidth: 41 });
const RAY_PATH = RAYS.map(([a, b, c]) => `M${a.x} ${a.y}L${b.x} ${b.y}L${c.x} ${c.y}Z`).join("");

export function FormRays() {
  return (
    <svg className={styles.rays} viewBox="-320 -408 640 816" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path d={RAY_PATH} className={styles.ray} />
    </svg>
  );
}
