/**
 * 几何封面的图形：角色卡没有图片时画的封面。
 *
 * 按种子（剧本 ID）从 5 种线条母题里确定性地选一种：波浪、钟面、网格、拱桥、山峰，
 * 圆头的黑色线条加一个蓝色圆点。母题按实际宽高计算坐标，方形缩略图和通栏横幅都能用。
 * 封面是圆角方块（圆角 16 起，越大越圆）。
 *
 * 只有数据和纯函数：coverArt 给出要画的形状和每个形状的“色调”，手机端和网页端各自按色板上色：
 * line → 描边 ink、粗 strokeWidth、圆头圆角；soft → 描边 line2、粗 softStrokeWidth、圆头；focus → 实心 acc。
 */

const MOTIFS = ["wave", "dial", "grid", "arch", "peak"] as const;
export type Motif = (typeof MOTIFS)[number];

/** FNV-1a：同一个 ID 总是得到同一种母题 */
export function motifFor(seed: string): Motif {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return MOTIFS[(hash >>> 0) % MOTIFS.length] ?? "wave";
}

export type CoverShape =
  | { kind: "path"; d: string; tone: "line" | "soft" }
  | { kind: "circle"; cx: number; cy: number; r: number; tone: "line" | "focus" };

export type CoverArt = { strokeWidth: number; softStrokeWidth: number; shapes: CoverShape[] };

function wave(y: number, width: number, period: number, amp: number): string {
  let d = `M0 ${y}q${period / 2} ${-amp} ${period} 0`;
  for (let x = period; x < width; x += period) d += `t${period} 0`;
  return d;
}

function motifShapes(motif: Motif, w: number, h: number): CoverShape[] {
  const k = h / 96; // 位置和焦点按高度缩放
  const ks = Math.min(k, 2); // 重复的纹样（波长、间距）放大得慢一些
  const line = (d: string): CoverShape => ({ kind: "path", d, tone: "line" });
  const soft = (d: string): CoverShape => ({ kind: "path", d, tone: "soft" });
  const focus = (cx: number, cy: number, d: number): CoverShape => ({
    kind: "circle",
    cx,
    cy,
    r: d / 2,
    tone: "focus",
  });
  switch (motif) {
    case "wave": {
      const count = h >= 200 ? 4 : 3;
      const gap = 12 * ks;
      const ys = Array.from({ length: count }, (_, i) => h - gap * (count - i));
      const dot = 12 * k;
      return [
        line(ys.map((y) => wave(y, w, 24 * ks, 6 * ks)).join("")),
        focus(w * 0.65 + dot / 2, h * 0.21 + dot / 2, dot * 1.3),
      ];
    }
    case "dial": {
      const cx = w / 2;
      const cy = h * 0.46;
      const r = h * 0.27;
      const dot = 6 * k;
      return [
        { kind: "circle", cx, cy, r, tone: "line" },
        line(
          `M${cx} ${cy}V${cy - r * 0.69}M${cx} ${cy}l${r * 0.46} ${r * 0.31}M${cx - r * 1.54} ${h}V${h * 0.83}M${cx + r * 1.54} ${h}V${h * 0.83}`,
        ),
        focus(cx, cy, dot * 1.2),
      ];
    }
    case "grid": {
      const inset = 12 * k;
      const size = h - inset * 2;
      const step = size / 3;
      let grid = `M${inset} ${inset + step}H${w - inset}M${inset} ${inset + step * 2}H${w - inset}`;
      for (let x = inset + step; x < w - inset; x += step) grid += `M${x} ${inset}V${h - inset}`;
      const dot = 8 * k;
      return [
        soft(grid),
        line(`M${inset} ${h - inset}A${size} ${size} 0 0 1 ${inset + size} ${inset}`),
        focus(inset + size * 0.667, inset + size * 0.333, dot * 1.3),
      ];
    }
    case "arch": {
      const base = h * 0.73;
      const r = 28 * k;
      const cx = w / 2;
      const dot = 10 * k;
      return [
        soft(`M0 ${h * 0.31}H${w}M0 ${h * 0.44}H${w * 0.625}`),
        line(`M${8 * k} ${base}H${w - 8 * k}M${cx - r} ${base}A${r} ${r} 0 0 1 ${cx + r} ${base}`),
        focus(w * 0.73 + dot / 2, h * 0.375 + dot / 2, dot * 1.3),
      ];
    }
    case "peak": {
      const base = h * 0.83;
      const x0 = w / 2 - 50 * k;
      const tri = (a: number, top: number, b: number, height: number): string =>
        `M${x0 + a * k} ${base}L${x0 + top * k} ${base - height * k}L${x0 + b * k} ${base}Z`;
      return [
        line(tri(14, 28, 42, 32) + tri(40, 56, 72, 44) + tri(66, 76, 86, 24)),
        line(`M0 ${base}H${w}`),
        focus(x0 + 56 * k, base - 14 * k, 9 * k),
      ];
    }
  }
}

/** 种子和尺寸对应的封面图形 */
export function coverArt(seed: string, w: number, h: number): CoverArt {
  const k = h / 96;
  const strokeWidth = h > 200 ? 1.8 : Math.min(Math.max(1.8 * k, 1.4), 3);
  return {
    strokeWidth,
    softStrokeWidth: Math.max(strokeWidth * 0.8, 1),
    shapes: motifShapes(motifFor(seed), w, h),
  };
}

/** 封面的圆角：16 起，越大越圆，最大 34 */
export function coverRadius(width: number, height: number): number {
  return Math.round(Math.min(Math.max(Math.min(width, height) * 0.28, 16), 34));
}
