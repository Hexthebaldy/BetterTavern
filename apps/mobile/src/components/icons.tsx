/**
 * 图标：24 栅格，描边 1.5，方头、尖角。路径取自 docs/design/ui-v2/source/Main.dc.html 的图标区和各画板。
 * solid 的部分用描边色填充；cut 的部分用底色画（实心图标里挖出的线）；bare 的部分不描边。
 */

import Svg, { Circle, Path, Rect } from "react-native-svg";

import { usePalette } from "../theme/index.ts";

type Paint = { solid?: boolean; cut?: boolean; bare?: boolean; dash?: string };
type Part =
  | ({ d: string } & Paint)
  | ({ rect: [number, number, number, number] } & Paint)
  | ({ circle: [number, number, number] } & Paint);

const ICONS = {
  story: [{ d: "M3 5h6.5L12 7l2.5-2H21v14h-6.5L12 21l-2.5-2H3z" }, { d: "M12 7v14" }],
  library: [{ rect: [6, 3, 12, 18] }, { d: "M3 6v12M21 6v12" }, { rect: [10, 7, 4, 4] }, { d: "M8.5 17h7" }],
  settings: [{ d: "M3 7h11M18 7h3M3 17h3M10 17h11" }, { rect: [14, 5, 4, 4] }, { rect: [6, 15, 4, 4] }],
  world: [{ circle: [12, 12, 9] }, { d: "M15.5 8.5l-2 5-5 2 2-5z" }],
  import: [{ d: "M12 4v11M7 10l5 5 5-5M4 15v5h16v-5" }],
  write: [{ d: "M4 20h4L20 8l-4-4L4 16z" }],
  send: [{ d: "M12 20V5M6 11l6-6 6 6" }],
  stop: [{ rect: [4, 4, 16, 16], solid: true }],
  down: [{ d: "M12 4v15M6 13l6 6 6-6" }],
  retry: [{ d: "M20 12a8 8 0 11-2.3-5.7M20 4v5h-5" }],
  key: [{ circle: [8, 15, 4] }, { d: "M11 12l9-9M17 6l3 3M14 9l2 2" }],
  director: [{ rect: [3, 9, 18, 12] }, { d: "M3 9l2-5h16l-2 5M10 4L8 9M16 4l-2 5" }],
  person: [{ rect: [8, 3, 8, 8] }, { d: "M4 21v-5h16v5" }],
  place: [{ d: "M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6" }],
  item: [{ rect: [4, 8, 16, 12] }, { d: "M9 8V4h6v4" }],
  probe: [{ d: "M3 12h4l3-7 4 14 3-7h4" }],
  lock: [{ rect: [5, 11, 14, 10] }, { d: "M8 11V7a4 4 0 018 0v4" }],
  unlock: [{ rect: [5, 11, 14, 10] }, { d: "M8 11V7a4 4 0 017.5-2" }],
  trash: [{ d: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" }],
  dice: [
    { rect: [3, 3, 18, 18] },
    { rect: [7, 7, 2, 2], solid: true },
    { rect: [15, 15, 2, 2], solid: true },
    { rect: [11, 11, 2, 2], solid: true },
    { rect: [15, 7, 2, 2], solid: true },
    { rect: [7, 15, 2, 2], solid: true },
  ],
  paste: [{ rect: [5, 4, 14, 17] }, { d: "M9 4V2h6v2M9 11h6M9 15h4" }],
  back: [{ d: "M15 5l-7 7 7 7" }],
  chevronRight: [{ d: "M9 5l7 7-7 7" }],
  chevronDown: [{ d: "M6 9l6 6 6-6" }],
  chevronUp: [{ d: "M6 15l6-6 6 6" }],
  close: [{ d: "M5 5l14 14M19 5L5 19" }],
  cross: [{ d: "M6 6l12 12M18 6L6 18" }],
  arrowRight: [{ d: "M4 12h15M13 6l6 6-6 6" }],
  arrowLeft: [{ d: "M20 12H5M11 6l-6 6 6 6" }],
  more: [
    { rect: [4, 11, 3, 3], solid: true, bare: true },
    { rect: [10.5, 11, 3, 3], solid: true, bare: true },
    { rect: [17, 11, 3, 3], solid: true, bare: true },
  ],
  grid: [{ rect: [4, 4, 7, 7] }, { rect: [13, 4, 7, 7] }, { rect: [4, 13, 7, 7] }, { rect: [13, 13, 7, 7] }],
  list: [{ d: "M4 6h16M4 12h16M4 18h16" }],
  plus: [{ d: "M12 4v16M4 12h16" }],
  eye: [{ d: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" }, { rect: [10, 10, 4, 4] }],
  eyeOff: [{ d: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" }, { d: "M4 4l16 16" }],
  server: [{ rect: [3, 4, 18, 7] }, { rect: [3, 13, 18, 7] }, { d: "M7 7.5h1M7 16.5h1" }],
  alert: [{ d: "M12 3L2 20h20z" }, { d: "M12 10v4M12 17v.5" }],
  info: [{ rect: [4, 4, 16, 16] }, { d: "M12 11v5M12 8v.5" }],
  check: [{ d: "M4 12l5 5 11-11" }],
  untested: [{ rect: [4, 4, 16, 16], dash: "3 3" }],
  minus: [{ d: "M6 12h12" }],
  image: [{ rect: [3, 4, 18, 16] }, { d: "M3 17l5-5 4 4 3-3 6 6" }, { rect: [15, 7, 3, 3] }],
  turn: [{ d: "M5 4v9h13M14 9l4 4-4 4" }],
  search: [{ circle: [10.5, 10.5, 6.5] }, { d: "M15.5 15.5L21 21" }],
  swap: [{ d: "M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" }],
  bulb: [{ d: "M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5V16h8v-2.5A6 6 0 0012 3z" }],
  logout: [{ d: "M14 4h6v16h-6M10 16l-4-4 4-4M6 12h10" }],
  greeting: [{ d: "M4 5h16v11H9l-5 4z" }],
  truncated: [{ d: "M4 6h16M4 12h16M4 18h9M17 16l3 3-3 3" }],
  offline: [{ d: "M2 9a14 14 0 0120 0M5.5 12.5a9 9 0 0113 0M9 16a4 4 0 016 0M3 3l18 18" }],
  sync: [{ rect: [3, 5, 8, 12] }, { rect: [13, 7, 8, 12] }, { d: "M11 11h2" }],
  play: [{ d: "M6 4l14 8-14 8z", solid: true }],
  disconnect: [{ d: "M3 12h6M15 12h6M9 8v8M15 8v8" }],
  traveler: [{ d: "M12 3v18M5 21l7-14 7 14" }],
  pair: [{ d: "M3 5h7v14H3zM14 5h7v14h-7zM10 9h4" }],
  lens: [{ circle: [10, 10, 6] }, { d: "M14.5 14.5L21 21" }],
} satisfies Record<string, Part[]>;

/** Tab 选中时的实心版本：外形填满，里面的线用底色挖出 */
const SOLID: Partial<Record<IconName, Part[]>> = {
  story: [
    { d: "M3 5h6.5L12 7l2.5-2H21v14h-6.5L12 21l-2.5-2H3z", solid: true },
    { d: "M12 7v14", cut: true },
  ],
  library: [
    { rect: [6, 3, 12, 18], solid: true },
    { d: "M3 6v12M21 6v12" },
    { rect: [10, 7, 4, 4], cut: true },
    { d: "M8.5 17h7", cut: true },
  ],
  settings: [
    { d: "M3 7h11M18 7h3M3 17h3M10 17h11" },
    { rect: [14, 5, 4, 4], solid: true },
    { rect: [6, 15, 4, 4], solid: true },
  ],
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 22,
  color,
  strokeWidth = 1.5,
  solid = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** 用实心版本（Tab 选中态） */
  solid?: boolean;
}) {
  const palette = usePalette();
  const c = color ?? palette.ink;
  const parts: Part[] = (solid ? SOLID[name] : undefined) ?? ICONS[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} pointerEvents="none">
      {parts.map((part, i) => {
        const tone = part.cut ? palette.bg : c;
        const common = {
          fill: part.solid || (part.cut && "rect" in part) ? tone : "none",
          stroke: part.bare ? "none" : tone,
          strokeWidth,
          strokeLinecap: "square" as const,
          strokeLinejoin: "miter" as const,
          strokeDasharray: part.dash,
        };
        if ("rect" in part) {
          const [x, y, w, h] = part.rect;
          return <Rect key={i} x={x} y={y} width={w} height={h} {...common} />;
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
