/**
 * 平板横屏登录、注册页左边那一格里的“写故事的桌面”（docs/design/comic/tablet/README.md 的 16–17）：
 * 和网页登录页的 Desk（apps/web/src/pages/auth/Desk.tsx）是同一张画，去掉了胶带。地图、人物关系图、三张文稿、
 * 一张索引卡乱放着、互相压着、各自转一个小角度；最上层是两颗蓝图钉和一根蓝色点线。没有字，对读屏隐藏。
 * 整个是一张 700×820 的 SVG：格子大小不同时按比例铺满、裁掉多出来的边，不变形。
 * stage="start" 是注册页“刚开始”的样子：地图上只有起点和一小段路，关系图只有“你”和一个人，文稿几乎空白，没有索引卡。
 */

import { useId } from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from "react-native-svg";

import { halftone } from "@bettertavern/design/comic";

import { useComic, useTheme } from "../theme/index.ts";
import {
  DocSheet,
  IndexCard,
  MapSheet,
  RelationSheet,
  Sheet,
  type DeskIds,
  type DeskInk,
  type DeskStage,
} from "./AuthDeskSheets.tsx";

const PINS = [
  { x: 536, y: 22 },
  { x: 116, y: 436 },
];
/** 蓝线：地图上的当前位置 → 关系图里的“你” → 索引卡（注册时只连到“你”） */
const THREAD = {
  full: "M320 276 C 380 330, 440 420, 474 504 S 560 650, 582 716",
  start: "M160 254 C 260 300, 400 380, 474 504",
};

/** 两个 #RRGGBB 颜色按 t 混合（t = 0 是 a） */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function AuthDesk({ stage = "full" }: { stage?: DeskStage }) {
  const c = useComic();
  const theme = useTheme();
  const base = `desk${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const ids: DeskIds = {
    blue: `${base}-blue`,
    inkDots: `${base}-ink`,
    greyDots: `${base}-grey`,
    grid: `${base}-grid`,
    clip: `${base}-clip`,
  };
  const k: DeskInk = {
    ink: c.ink,
    paper: c.paper,
    grey: c.grey,
    acc: c.acc,
    onAcc: c.onAcc,
    sky: c.sky,
    line2: c.line2,
    stripDark: mix(c.line2, c.ink, 0.12),
  };
  const full = stage === "full";
  return (
    <Svg
      viewBox="0 0 700 820"
      preserveAspectRatio="xMidYMid slice"
      style={StyleSheet.absoluteFill}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Defs>
        <Pattern id={ids.blue} width={10} height={10} patternUnits="userSpaceOnUse">
          <Rect width={10} height={10} fill={c.acc} />
          <Circle cx={5} cy={5} r={1.4} fill={halftone("acc", theme.id).dot} />
        </Pattern>
        <Pattern id={ids.inkDots} width={8} height={8} patternUnits="userSpaceOnUse">
          <Rect width={8} height={8} fill={c.paper} />
          <Circle cx={4} cy={4} r={1.3} fill={c.ink} opacity={0.32} />
        </Pattern>
        <Pattern id={ids.greyDots} width={9} height={9} patternUnits="userSpaceOnUse">
          <Rect width={9} height={9} fill={c.grey} />
          <Circle cx={4.5} cy={4.5} r={1.2} fill={c.ink} opacity={0.16} />
        </Pattern>
        <Pattern id={ids.grid} width={24} height={24} patternUnits="userSpaceOnUse">
          <Rect width={24} height={24} fill={c.paper} />
          <Circle cx={12} cy={12} r={1.2} fill={c.line2} />
        </Pattern>
      </Defs>

      <Sheet k={k} id={`${ids.clip}-1`} x={400} y={-24} width={270} height={330} rotate={6}>
        <DocSheet
          k={k}
          seed={31}
          width={265}
          height={325}
          lines={full ? 16 : 2}
          highlight={full ? 3 : undefined}
          struck={full ? [7, 8] : undefined}
          note={full ? { x: 231, y: 188 } : undefined}
        />
      </Sheet>
      <Sheet k={k} id={`${ids.clip}-2`} x={30} y={40} width={460} height={360} rotate={-2.5} grey>
        <MapSheet k={k} stage={stage} ids={ids} />
      </Sheet>
      <Sheet k={k} id={`${ids.clip}-3`} x={-20} y={420} width={280} height={370} rotate={-5}>
        <DocSheet
          k={k}
          seed={32}
          width={275}
          height={365}
          lines={full ? 15 : 2}
          highlight={full ? 3 : undefined}
        />
      </Sheet>
      <Sheet k={k} id={`${ids.clip}-4`} x={280} y={340} width={400} height={340} rotate={2.5}>
        <RelationSheet k={k} stage={stage} ids={ids} />
      </Sheet>
      <Sheet k={k} id={`${ids.clip}-5`} x={130} y={620} width={290} height={300} rotate={3.5}>
        <DocSheet
          k={k}
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
        <Sheet k={k} id={`${ids.clip}-6`} x={460} y={660} width={230} height={150} rotate={-4} fill={ids.blue}>
          <IndexCard k={k} />
        </Sheet>
      ) : null}

      <Path
        d={THREAD[stage]}
        fill="none"
        stroke={c.acc}
        strokeWidth={2.5}
        strokeDasharray="2 6"
        strokeLinecap="round"
      />
      {PINS.map((pin) => (
        <G key={pin.x}>
          <Circle cx={pin.x + 2} cy={pin.y + 2} r={6.75} fill={c.ink} />
          <Circle cx={pin.x} cy={pin.y} r={6.75} fill={c.acc} stroke={c.ink} strokeWidth={2.5} />
        </G>
      ))}
    </Svg>
  );
}
