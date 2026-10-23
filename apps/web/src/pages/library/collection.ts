/**
 * 剧本、角色两页的纯函数：剧本的题材（取它用的几张卡的标签）、搜索、题材筛选、排序。
 * 不依赖 React，用 node --test 测。
 */

import type { CardSummary, Scenario } from "@bettertavern/core/api/types";

/** 剧本的题材：几张卡的标签按顺序去重，最多两个（“古风 · 悬疑”） */
export function scenarioTags(scenario: Pick<Scenario, "cards">, cards: ReadonlyMap<string, Pick<CardSummary, "tags">>): string[] {
  const seen: string[] = [];
  for (const ref of scenario.cards)
    for (const tag of cards.get(ref.card_id)?.tags ?? []) {
      const clean = tag.trim();
      if (clean && !seen.includes(clean)) seen.push(clean);
    }
  return seen.slice(0, 2);
}

function includes(haystack: (string | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((text) => (text ?? "").toLowerCase().includes(q));
}

/** 剧本的搜索：名字、用的卡、题材、简介 */
export function matchesScenario(scenario: Scenario, tags: string[], query: string): boolean {
  return includes([scenario.name, scenario.description_preview, ...scenario.cards.map((c) => c.name), ...tags], query);
}

/** 角色卡的搜索：名字、角色名、标签、作者、简介 */
export function matchesCard(card: CardSummary, query: string): boolean {
  return includes([card.name, card.character_name, card.creator, card.description_preview, ...card.tags], query);
}

/** 题材筛选的选项：出现得多的在前，一样多的按名字 */
export function genreOptions(tagLists: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const tags of tagLists) for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** 最近添加的在前 */
export function byCreated<T extends { created_at: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
