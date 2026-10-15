/**
 * 阅读页的纯逻辑：自动跟随新文字、输入框里 Enter 发送、每个故事一份的草稿。
 */

/** 离底部小于这个距离就算在最新位置：新文字出来时跟着滚 */
export const FOLLOW_THRESHOLD = 80;

export type Follow = { following: boolean; lastY: number };

/**
 * 滚动之后要不要继续跟随：到了底部就跟随；往上翻（位置变小）就停止跟随；往下翻但没到底保持原样。
 * 新文字让页面变长时位置不变、没有滚动事件，程序滚到底部只会往下，所以只有玩家往上翻会停止跟随。
 */
export function nextFollow(prev: Follow, scroll: { y: number; distance: number }): Follow {
  if (scroll.distance < FOLLOW_THRESHOLD) return { following: true, lastY: scroll.y };
  if (scroll.y < prev.lastY) return { following: false, lastY: scroll.y };
  return { following: prev.following, lastY: scroll.y };
}

/**
 * 输入框里按下的键是不是“发送”：Enter 发送，Shift + Enter 换行；输入法正在组字时按的 Enter 是确认候选词，
 * 不能发送（isComposing，Safari 上还要看 keyCode 229）。
 */
export function isSendKey(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

/** 草稿存在浏览器里，每个故事一份：刷新、关掉标签页都不丢 */
export function draftKey(playthroughId: string): string {
  return `bt.draft.${playthroughId}`;
}

export function parseDraft(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}
