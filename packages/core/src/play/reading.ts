/**
 * 阅读设置：正文字体（宋体 / 黑体）和字号。存在设备上。
 * 字号没设置时跟随系统的动态字体（以 17.5 为基准，放大到 24 为止）；设置后用固定字号。
 */

export type ReadingFont = "serif" | "sans";

export type ReadingPrefs = {
  font: ReadingFont;
  /** null 表示跟随系统字体大小 */
  size: number | null;
};

export const DEFAULT_READING: ReadingPrefs = { font: "serif", size: null };

export const READING_SIZES = [15, 16, 17.5, 19, 20.5, 22, 24] as const;
export const BASE_SIZE = 17.5;
export const MAX_SIZE = 24;

/** 行高 = 字号 × 1.77（17.5 → 31） */
export function lineHeightFor(size: number): number {
  return Math.round(size * 1.77);
}

export function readingSize(prefs: ReadingPrefs): number {
  return prefs.size ?? BASE_SIZE;
}

/** 字号档位里离当前值最近的一档 */
export function sizeIndex(size: number): number {
  let best = 0;
  READING_SIZES.forEach((s, i) => {
    if (Math.abs(s - size) < Math.abs((READING_SIZES[best] ?? s) - size)) best = i;
  });
  return best;
}

/** 往大或往小挪一档；到头了不变 */
export function stepSize(prefs: ReadingPrefs, delta: 1 | -1): number {
  const index = sizeIndex(readingSize(prefs)) + delta;
  return READING_SIZES[Math.min(Math.max(index, 0), READING_SIZES.length - 1)] ?? BASE_SIZE;
}

export function parseReadingPrefs(raw: unknown): ReadingPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_READING;
  const r = raw as Record<string, unknown>;
  const font: ReadingFont = r.font === "sans" ? "sans" : "serif";
  const size = typeof r.size === "number" && r.size >= READING_SIZES[0] && r.size <= MAX_SIZE ? r.size : null;
  return { font, size };
}
