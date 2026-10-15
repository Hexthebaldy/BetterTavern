/**
 * 图标的几何数据：24 栅格，描边 1.75，圆头圆角。路径取自 docs/design/ui/source/ 的图标区和各画板。
 * solid 的部分用描边色填充；bare 的部分不描边（实心小圆点、实心方块）。
 *
 * 只有数据，手机端（react-native-svg）和网页端（<svg>）各自按这份数据画。
 */

export type Paint = { solid?: boolean; bare?: boolean; dash?: string };
export type Part =
  | ({ d: string } & Paint)
  /** x, y, 宽, 高, 圆角 */
  | ({ rect: [number, number, number, number, number?] } & Paint)
  | ({ circle: [number, number, number] } & Paint);

const dot = (cx: number, cy: number, r = 1.2): Part => ({ circle: [cx, cy, r], solid: true, bare: true });

export const ICONS = {
  story: [
    { d: "M12 6.5C10.3 5.2 7.8 4.5 4 4.5v13c3.8 0 6.3.7 8 2 1.7-1.3 4.2-2 8-2v-13c-3.8 0-6.3.7-8 2z" },
    { d: "M12 6.5v13" },
  ],
  library: [
    { rect: [6, 3, 12, 18, 3] },
    { circle: [12, 10, 2.5] },
    { d: "M8.8 16.5c.7-1.5 1.8-2.3 3.2-2.3s2.5.8 3.2 2.3" },
  ],
  settings: [{ d: "M4 7h9M17 7h3M4 17h3M11 17h9" }, { circle: [15, 7, 2] }, { circle: [9, 17, 2] }],
  world: [{ circle: [12, 12, 9] }, { d: "M15.5 8.5l-2 5-5 2 2-5z" }],
  import: [{ d: "M12 4v11M7.5 10.5L12 15l4.5-4.5" }, { d: "M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3" }],
  share: [{ d: "M12 15V4M7.5 8.5L12 4l4.5 4.5" }, { d: "M5 13v5a2 2 0 002 2h10a2 2 0 002-2v-5" }],
  write: [{ d: "M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z" }],
  send: [{ d: "M12 19V6M6.5 11.5L12 6l5.5 5.5" }],
  stop: [{ rect: [5, 5, 14, 14, 3.5], solid: true, bare: true }],
  down: [{ d: "M12 5v14M6 13l6 6 6-6" }],
  retry: [{ d: "M20 12a8 8 0 11-2.4-5.7M20 4v4.5h-4.5" }],
  key: [{ circle: [8, 15, 4] }, { d: "M11 12l8-8M16 7l2.5 2.5M14 9l2 2" }],
  director: [{ rect: [3, 9, 18, 12, 3] }, { d: "M3.5 9l2-5h14l-1.5 5M10 4L8.5 9M15.5 4L14 9" }],
  person: [{ circle: [12, 8, 4] }, { d: "M5 20c1.3-3.5 3.8-5 7-5s5.7 1.5 7 5" }],
  place: [{ d: "M4 20h16M6 20V10l6-5 6 5v10M10 20v-5h4v5" }],
  item: [{ rect: [4, 8, 16, 12, 3] }, { d: "M9 8V6a3 3 0 016 0v2" }],
  probe: [{ d: "M3 12h4l3-7 4 14 3-7h4" }],
  moon: [{ d: "M12 3a6 6 0 009 9 9 9 0 11-9-9z" }],
  lock: [{ rect: [5, 11, 14, 10, 3] }, { d: "M8 11V8a4 4 0 018 0v3" }],
  unlock: [{ rect: [5, 11, 14, 10, 3] }, { d: "M8 11V8a4 4 0 017.5-2" }],
  trash: [
    {
      d: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2",
    },
  ],
  dice: [
    { rect: [3.5, 3.5, 17, 17, 4] },
    dot(8.5, 8.5),
    dot(15.5, 15.5),
    dot(12, 12),
    dot(15.5, 8.5),
    dot(8.5, 15.5),
  ],
  paste: [{ rect: [6, 4, 12, 17, 3] }, { d: "M9.5 4V3h5v1" }],
  back: [{ d: "M15 5l-7 7 7 7" }],
  chevronRight: [{ d: "M9 5l7 7-7 7" }],
  chevronDown: [{ d: "M6 9l6 6 6-6" }],
  chevronUp: [{ d: "M6 15l6-6 6 6" }],
  close: [{ d: "M6 6l12 12M18 6L6 18" }],
  /** 收起停靠在右侧的面板（平板阅读页的世界状态） */
  sidebar: [{ rect: [3.5, 4.5, 17, 15, 4] }, { d: "M14.5 4.5v15M8 10l2 2-2 2" }],
  cross: [{ d: "M7 7l10 10M17 7L7 17" }],
  arrowRight: [{ d: "M5 12h14M13 6l6 6-6 6" }],
  arrowLeft: [{ d: "M19 12H5M11 6l-6 6 6 6" }],
  more: [dot(6, 12, 1.6), dot(12, 12, 1.6), dot(18, 12, 1.6)],
  grid: [
    { rect: [4, 4, 7, 7, 2] },
    { rect: [13, 4, 7, 7, 2] },
    { rect: [4, 13, 7, 7, 2] },
    { rect: [13, 13, 7, 7, 2] },
  ],
  list: [{ d: "M5 7h14M5 12h14M5 17h14" }],
  plus: [{ d: "M12 5v14M5 12h14" }],
  eye: [
    { d: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" },
    { circle: [12, 12, 3] },
  ],
  eyeOff: [{ d: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" }, { d: "M4 4l16 16" }],
  server: [{ rect: [3, 4, 18, 7, 2.5] }, { rect: [3, 13, 18, 7, 2.5] }, { d: "M7 7.5h.01M7 16.5h.01" }],
  alert: [
    { d: "M10.3 4.3L2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z" },
    { d: "M12 10v4M12 17h.01" },
  ],
  info: [{ circle: [12, 12, 9] }, { d: "M12 11v5M12 8h.01" }],
  alertCircle: [{ circle: [12, 12, 9] }, { d: "M12 8v5M12 16h.01" }],
  check: [{ d: "M5 12.5l4.5 4.5L19 7.5" }],
  checkCircle: [{ circle: [12, 12, 9] }, { d: "M8 12.5l2.8 2.8L16 10" }],
  untested: [{ circle: [12, 12, 8], dash: "3 3" }],
  minus: [{ d: "M6 12h12" }],
  image: [{ rect: [3, 4, 18, 16, 4] }, { circle: [9, 10, 1.8] }, { d: "M4 18l5-5 4 4 3-3 5 5" }],
  turn: [{ d: "M6 5v7h12M14 8l4 4-4 4" }],
  search: [{ circle: [10.5, 10.5, 6.5] }, { d: "M15.5 15.5L20 20" }],
  swap: [{ d: "M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" }],
  bulb: [{ d: "M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5V16h8v-2.5A6 6 0 0012 3z" }],
  logout: [{ d: "M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M10 16l-4-4 4-4M6 12h10" }],
  greeting: [{ d: "M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1H10l-5 4z" }],
  truncated: [{ d: "M4 6h16M4 12h16M4 18h9M17 16l3 3-3 3" }],
  offline: [{ d: "M2 9a14 14 0 0120 0M5.5 12.5a9 9 0 0113 0M9 16a4 4 0 016 0M3 3l18 18" }],
  play: [{ d: "M7 5l12 7-12 7z", solid: true }],
  disconnect: [{ d: "M3 12h6M15 12h6M9 8v8M15 8v8" }],
  traveler: [{ circle: [12, 5, 2] }, { d: "M12 8v6l-3 6M12 14l3 6M8 11l4-2 4 2" }],
  pair: [{ rect: [3, 5, 7, 14, 2] }, { rect: [14, 5, 7, 14, 2] }, { d: "M10 9h4" }],
  lens: [{ circle: [10.5, 10.5, 6] }, { d: "M15 15l5 5" }],
} satisfies Record<string, Part[]>;

export type IconName = keyof typeof ICONS;
