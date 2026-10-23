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

// ---- 漫画分镜版的阅读页：左栏回想、右栏人物和刚记下的（docs/design/comic 的 09） ----

export type RecapItem = { id: string; seq: number; text: string };

/** 一段叙述的头一句话（压成一行，太长截断加省略号），回想列表里用 */
export function firstLine(narrative: string, max = 48): string {
  const line = narrative
    .split(/\n+/)
    .map((p) => p.trim())
    .find((p) => p.length > 0);
  if (!line) return "";
  const chars = Array.from(line.replace(/\s+/g, " "));
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : line;
}

/** 回想列表：默认最近 count 段；all 时是全部。从旧到新排，最后一项是最新的一段 */
export function recapItems(
  turns: readonly { id: string; seq: number; narrative: string }[],
  all: boolean,
  count = 5,
): RecapItem[] {
  const shown = all ? turns : turns.slice(-count);
  return shown.map((t) => ({ id: t.id, seq: t.seq, text: firstLine(t.narrative) }));
}

type Entity = { id: string; kind: string; name: string; summary: string; is_protagonist: boolean };
type Fact = { id: string; text: string; secret: boolean };

/** 右栏“这一话的人物”：主角在最前，其余的人物按世界状态里的顺序，最多 max 个 */
export function castOf<T extends Entity>(entities: readonly T[], max = 4): T[] {
  const people = entities.filter((e) => e.kind === "character" || e.is_protagonist);
  const hero = people.filter((e) => e.is_protagonist);
  const others = people.filter((e) => !e.is_protagonist);
  return [...hero, ...others].slice(0, max);
}

/**
 * 右栏“刚记下的”：最后记下的一个地点、最后两条事实（不含秘密），以及还没揭开的秘密有几条。
 * 世界状态里没有记录时间，这里按列表的顺序算“最后”。
 */
export function recentNotes<E extends Entity, F extends Fact>(view: {
  entities: readonly E[];
  facts: readonly F[];
  hidden_facts: number;
}): { place: E | null; facts: F[]; hidden: number } {
  const places = view.entities.filter((e) => e.kind === "location");
  const facts = view.facts.filter((f) => !f.secret);
  return { place: places.at(-1) ?? null, facts: facts.slice(-2), hidden: view.hidden_facts };
}

/** 选项卡一行放几张：三张以内一行放下，四张分两行 */
export function optionColumns(count: number): number {
  return count <= 3 ? Math.max(count, 1) : 2;
}
