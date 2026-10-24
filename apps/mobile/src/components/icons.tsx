/**
 * 图标：几何数据在 @bettertavern/design 的 icons.ts（和网页端共用），这里用 react-native-svg 画出来。
 * 线宽默认 2.2（漫画风，网页漫画版也是 2.2；两端共用的 stroke.icon 是旧样式的 1.75）。
 * FilledIcon 是 Tab 栏和侧栏选中时的实心版：主体填蓝，墨色描边不变，挖空的地方是纸色。
 */

import Svg, { Circle, Path, Rect } from "react-native-svg";

import { FILLED_ICONS, ICONS, type FilledIconName, type IconName, type Part } from "@bettertavern/design/icons";

import { useComic } from "../theme/index.ts";

export type { FilledIconName, IconName };

export const ICON_STROKE = 2.2;

function Parts({
  parts,
  size,
  color,
  strokeWidth,
  body,
  hole,
}: {
  parts: Part[];
  size: number;
  color: string;
  strokeWidth: number;
  body?: string;
  hole?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} pointerEvents="none">
      {parts.map((part, i) => {
        const fill = part.fill === "body" ? body : part.fill === "hole" ? hole : part.solid ? color : "none";
        const common = {
          fill: fill ?? "none",
          stroke: part.bare ? "none" : part.line === "hole" ? (hole ?? color) : color,
          strokeWidth,
          strokeLinecap: "round" as const,
          strokeLinejoin: "round" as const,
          strokeDasharray: part.dash,
        };
        if ("rect" in part) {
          const [x, y, w, h, r] = part.rect;
          return <Rect key={i} x={x} y={y} width={w} height={h} rx={r} ry={r} {...common} />;
        }
        if ("circle" in part) {
          const [cx, cy, r] = part.circle;
          return <Circle key={i} cx={cx} cy={cy} r={r} {...common} />;
        }
        return <Path key={i} d={part.d} {...common} />;
      })}
    </Svg>
  );
}

export function Icon({
  name,
  size = 22,
  color,
  strokeWidth = ICON_STROKE,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const c = useComic();
  return <Parts parts={ICONS[name]} size={size} color={color ?? c.ink} strokeWidth={strokeWidth} />;
}

/** 选中时的实心图标：主体填蓝，挖空的地方是纸色，描边是墨色 */
export function FilledIcon({ name, size = 26 }: { name: FilledIconName; size?: number }) {
  const c = useComic();
  return (
    <Parts
      parts={FILLED_ICONS[name]}
      size={size}
      color={c.ink}
      strokeWidth={ICON_STROKE}
      body={c.acc}
      hole={c.paper}
    />
  );
}
