/** 图标：几何数据在 @bettertavern/design 的 icons.ts（和 App 共用），颜色跟着文字色（currentColor） */

import { ICONS, type IconName, type Part } from "@bettertavern/design/icons";
import { stroke } from "@bettertavern/design/tokens";

export type { IconName };

export function Icon({
  name,
  size = 22,
  strokeWidth = stroke.icon,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const parts: Part[] = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none" }}
    >
      {parts.map((part, i) => {
        const paint = {
          fill: part.solid ? "currentColor" : "none",
          stroke: part.bare ? "none" : "currentColor",
          strokeDasharray: part.dash,
        };
        if ("rect" in part) {
          const [x, y, w, h, r] = part.rect;
          return <rect key={i} x={x} y={y} width={w} height={h} rx={r} ry={r} {...paint} />;
        }
        if ("circle" in part) {
          const [cx, cy, r] = part.circle;
          return <circle key={i} cx={cx} cy={cy} r={r} {...paint} />;
        }
        return <path key={i} d={part.d} {...paint} />;
      })}
    </svg>
  );
}
