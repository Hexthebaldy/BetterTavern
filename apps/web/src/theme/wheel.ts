/**
 * 导航轮盘的纯逻辑（docs/design/comic 的“轮盘”一节）：几何、选哪一块、靠边时往里挪、松手贴边、长按算拖动、位置的存和取。
 * 不依赖 React 和 DOM，用 node --test 测；组件在 shell/NavWheel.tsx。
 *
 * 坐标都是窗口里的像素，圆心记作 (x, y)。存在浏览器里的位置（WheelSpot）用比例，窗口尺寸变了按比例换算再夹回窗口里。
 */

export const WHEEL = {
  /** 收起的圆：直径 72 */
  hub: 72,
  /** 展开后的白色圆盘：半径 178 */
  disc: 178,
  /** 扇区的内外半径；每块往外挪 4 留缝，指着的那块再弹出 14 */
  inner: 52,
  outer: 156,
  gap: 4,
  pop: 14,
  /** 图标、名称、数量的位置；数字键键帽的位置 */
  labelRadius: 102,
  keyRadius: 168,
  /** 贴边时圆心离窗口边 */
  edge: 52,
  /** 展开时圆心离窗口每条边至少这么远，整个圆盘才露得出来 */
  safe: 204,
  /** 松手时圆离左边或右边这么近以内就贴过去 */
  snap: 40,
  /** 按住多久算拿起来拖（毫秒） */
  hold: 400,
  /** 按住没到时间就挪开这么远，算悬停或滑动，不算拖 */
  moveTolerance: 8,
  /** 鼠标停在圆上多久展开、离开圆盘多久收起、靠边时圆心挪过去用多久（毫秒；挪动的时长在 wheel.module.css 里用的是同一个数） */
  openDelay: 120,
  closeDelay: 1000,
  shift: 240,
} as const;

/** 六块，从正上方开始顺时针：存档、剧本、角色、工作台、模型、设置 */
export const SECTORS = 6;
const STEP = 360 / SECTORS;

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Dock = "left" | "right" | null;

/**
 * 存在浏览器里的位置：贴哪一边（null 是没贴边，浮在内容上），圆心的横、纵位置占窗口宽、高的比例。
 * 贴边时横向位置不用（左边圆心离边 52，右边同样）。
 */
export type WheelSpot = { dock: Dock; x: number; y: number };

/** 默认贴着左边、上下居中 */
export const DEFAULT_SPOT: WheelSpot = { dock: "left", x: 0, y: 0.5 };

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

function ratio(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 1) : null;
}

/** 读存储里的位置；内容不对就用默认值 */
export function parseWheelSpot(raw: unknown): WheelSpot {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SPOT;
  const r = raw as Record<string, unknown>;
  const dock: Dock = r.dock === "left" || r.dock === "right" ? r.dock : r.dock === null ? null : "left";
  const x = ratio(r.x) ?? 0;
  const y = ratio(r.y) ?? 0.5;
  return { dock, x, y };
}

/** 收起的圆在这个窗口里的圆心：贴边的离边 52；整个圆留在窗口里 */
export function placeHub(spot: WheelSpot, view: Size): Point {
  const r = WHEEL.edge;
  const x =
    spot.dock === "left"
      ? r
      : spot.dock === "right"
        ? view.width - r
        : clamp(spot.x * view.width, r, view.width - r);
  const y = clamp(spot.y * view.height, r, view.height - r);
  return { x, y };
}

/** 松手的地方离左边或右边 40 以内就贴过去（量的是圆的边，不是圆心） */
export function snapDock(center: Point, view: Size): Dock {
  const radius = WHEEL.hub / 2;
  if (center.x - radius <= WHEEL.snap) return "left";
  if (view.width - center.x - radius <= WHEEL.snap) return "right";
  return null;
}

/** 拖完松手：算出要存的位置 */
export function spotFromPoint(center: Point, view: Size): WheelSpot {
  const dock = snapDock(center, view);
  const placed = placeHub({ dock, x: center.x / view.width, y: center.y / view.height }, view);
  return { dock, x: placed.x / view.width, y: placed.y / view.height };
}

/** 展开时的圆心：离窗口每条边至少 204（窗口太小时放在正中）。离边够远就原地展开 */
export function expandedCenter(center: Point, view: Size): Point {
  return {
    x: clamp(center.x, WHEEL.safe, view.width - WHEEL.safe),
    y: clamp(center.y, WHEEL.safe, view.height - WHEEL.safe),
  };
}

/**
 * 光标指着哪一块：从正上方开始顺时针，每块 60°；离圆心不到内半径时不算（返回 null）。
 * 只看方向，不用真的碰到扇区。
 */
export function sectorAt(center: Point, pointer: Point, inner: number = WHEEL.inner): number | null {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  if (Math.hypot(dx, dy) < inner) return null;
  // 0° 在正上方，顺时针为正（屏幕坐标的 y 往下）
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const turned = (angle + STEP / 2 + 360) % 360;
  return Math.floor(turned / STEP) % SECTORS;
}

/** 光标在不在圆盘上（离开圆盘 1 秒后收起） */
export function insideDisc(center: Point, pointer: Point): boolean {
  return Math.hypot(pointer.x - center.x, pointer.y - center.y) <= WHEEL.disc;
}

/** 方向键在六块之间转：→ ↓ 顺时针，← ↑ 逆时针；还没有选中时从 start（通常是当前页）开始 */
export function stepSector(current: number | null, key: string, start = 0): number | null {
  const base = current ?? start;
  if (key === "ArrowRight" || key === "ArrowDown") return current === null ? base : (base + 1) % SECTORS;
  if (key === "ArrowLeft" || key === "ArrowUp")
    return current === null ? base : (base + SECTORS - 1) % SECTORS;
  return current;
}

/**
 * 在圆上按下以后：按住满 0.4 秒（中途没挪开）就拿起来拖；没到时间就松手是点按；没到时间就挪开了，算悬停或滑动。
 * pending 是还没定。
 */
export function pressOutcome(press: {
  heldMs: number;
  moved: number;
  released: boolean;
}): "pending" | "drag" | "tap" | "cancel" {
  if (press.moved > WHEEL.moveTolerance && press.heldMs < WHEEL.hold) return "cancel";
  if (press.heldMs >= WHEEL.hold) return "drag";
  return press.released ? "tap" : "pending";
}

/** 页面左右留边：轮盘贴着的那一边 112（圆的宽度加 24 的空，再加上离边的 16），另一边 40；没贴边时两边都是 40 */
export function pageInsets(dock: Dock): { left: number; right: number } {
  const wide = 112;
  const narrow = 40;
  if (dock === "left") return { left: wide, right: narrow };
  if (dock === "right") return { left: narrow, right: wide };
  return { left: narrow, right: narrow };
}

// ---- 画圆盘用的几何 ----------------------------------------------------------------------------

/** 第 index 块的中线方向上、离圆心 r 处，相对圆心的位置 */
export function polar(index: number, r: number): Point {
  const angle = ((index * STEP) * Math.PI) / 180;
  return { x: round(Math.sin(angle) * r), y: round(-Math.cos(angle) * r) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 第 index 块扇环的路径（以 (cx, cy) 为圆心）：外弧顺时针，内弧逆时针回来 */
export function sectorPath(index: number, cx: number, cy: number, inner = WHEEL.inner, outer = WHEEL.outer): string {
  const a0 = ((index * STEP - STEP / 2) * Math.PI) / 180;
  const a1 = ((index * STEP + STEP / 2) * Math.PI) / 180;
  const p = (r: number, a: number): string => `${round(cx + Math.sin(a) * r)} ${round(cy - Math.cos(a) * r)}`;
  return [
    `M${p(inner, a0)}`,
    `L${p(outer, a0)}`,
    `A${outer} ${outer} 0 0 1 ${p(outer, a1)}`,
    `L${p(inner, a1)}`,
    `A${inner} ${inner} 0 0 0 ${p(inner, a0)}`,
    "Z",
  ].join("");
}
