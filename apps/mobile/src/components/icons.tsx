/**
 * 图标：几何数据在 @bettertavern/design 的 icons.ts（和网页端共用），这里用 react-native-svg 画出来。
 */

import Svg, { Circle, Path, Rect } from "react-native-svg";

import { ICONS, type IconName, type Part } from "@bettertavern/design/icons";

import { stroke, usePalette } from "../theme/index.ts";

export type { IconName };

export function Icon({
  name,
  size = 22,
  color,
  strokeWidth = stroke.icon,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const palette = usePalette();
  const c = color ?? palette.ink;
  const parts: Part[] = ICONS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} pointerEvents="none">
      {parts.map((part, i) => {
        const common = {
          fill: part.solid ? c : "none",
          stroke: part.bare ? "none" : c,
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
