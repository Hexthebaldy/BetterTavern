/**
 * 人物位的占位（docs/design/comic 的“人物头像”）：角色卡没有头像时，用名字里的一个字压在网点底上。网页和 App 共用。
 * 取哪个字、用哪种底都只看名字和 ID，同一个角色在存档、角色、工作台几页上一样。
 * 这里只有纯函数，不依赖 React 和 DOM，用 node --test 测。
 */

/** 格子的五种底：白、墨、蓝网点、白底墨点、灰网点 */
export type PanelTone = "white" | "ink" | "blue" | "dots" | "grey";

/** 人物位轮着用的底（和设计稿 05 的顺序一样：蓝、白点、墨、灰、白） */
export const PORTRAIT_TONES: readonly PanelTone[] = ["blue", "dots", "ink", "grey", "white"];

/** 名字开头这几个字是称呼，不像姓（阿澄、小满、老陈），跳过。写成码位：界面代码里不写汉字（scripts/check-i18n.mjs） */
const PREFIXES = new Set([0x963f, 0x5c0f, 0x8001]);

/** 名字里拿来做大字的那一个：一般是第一个字；称呼开头时取下一个；拉丁字母大写；没有字时是“?” */
export function portraitGlyph(name: string): string {
  const chars = Array.from(name.trim()).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const first = chars[0];
  if (!first) return "?";
  const prefix = PREFIXES.has(first.codePointAt(0) ?? 0);
  const pick = prefix && chars.length > 1 ? (chars[1] ?? first) : first;
  return pick.toUpperCase();
}

/** 按 ID 选一种底：同一个 ID 总是同一种 */
export function portraitTone(seed: string): PanelTone {
  let hash = 0;
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return PORTRAIT_TONES[hash % PORTRAIT_TONES.length] ?? "blue";
}

/** 这种底上的字是反白的（墨底、蓝底） */
export function isDarkTone(tone: PanelTone): boolean {
  return tone === "ink" || tone === "blue";
}
