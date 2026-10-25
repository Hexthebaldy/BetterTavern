import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CardSummary, Scenario } from "@bettertavern/core/api/types";

import { byCreated, genreOptions, matchesCard, matchesScenario, scenarioTags } from "./collection.ts";

const scenario = (name: string, cardIds: string[], extra: Partial<Scenario> = {}): Scenario => ({
  id: name,
  name,
  cards: cardIds.map((id) => ({ card_id: id, name: `卡${id}`, cover_blob_id: null })),
  cover_blob_id: null,
  setup: { protagonist: { name: "", summary: "" }, preferences: { length: "medium", style: "", boundaries: "" }, opening: null, lightning: false },
  description_preview: "",
  version: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  lorebooks: [],
  ...extra,
});

const card = (id: string, tags: string[], extra: Partial<CardSummary> = {}) =>
  ({ id, name: id, character_name: id, tags, creator: "", description_preview: "", ...extra }) as CardSummary;

describe("剧本的题材", () => {
  const cards = new Map([
    ["a", card("a", ["古风", "悬疑", "江南"])],
    ["b", card("b", ["悬疑", "群像"])],
  ]);

  it("几张卡的标签按顺序去重，最多两个", () => {
    assert.deepEqual(scenarioTags(scenario("s", ["a", "b"]), cards), ["古风", "悬疑"]);
    assert.deepEqual(scenarioTags(scenario("s", ["b"]), cards), ["悬疑", "群像"]);
  });

  it("卡不在列表里时没有题材", () => {
    assert.deepEqual(scenarioTags(scenario("s", ["x"]), cards), []);
  });

  it("筛选的选项按出现次数排", () => {
    assert.deepEqual(genreOptions([["悬疑", "古风"], ["悬疑"], ["群像"]]), ["悬疑", "古风", "群像"]);
  });
});

describe("搜索", () => {
  it("剧本按名字、卡名、题材、简介找，不分大小写", () => {
    const s = scenario("雨夜渡口", ["a"], { description_preview: "最后一班船" });
    assert.equal(matchesScenario(s, [], "渡口"), true);
    assert.equal(matchesScenario(s, [], "卡a"), true);
    assert.equal(matchesScenario(s, ["悬疑"], "悬疑"), true);
    assert.equal(matchesScenario(s, [], "班船"), true);
    assert.equal(matchesScenario(s, [], "长生"), false);
    assert.equal(matchesScenario(s, [], "  "), true);
  });

  it("角色卡按名字、标签、作者找", () => {
    const c = card("Rowan", ["Fantasy"], { creator: "林一" });
    assert.equal(matchesCard(c, "row"), true);
    assert.equal(matchesCard(c, "fanta"), true);
    assert.equal(matchesCard(c, "林"), true);
    assert.equal(matchesCard(c, "猫"), false);
  });
});

describe("排序", () => {
  it("最近添加的在前，不改原数组", () => {
    const items = [
      { id: "old", created_at: "2026-01-01T00:00:00Z" },
      { id: "new", created_at: "2026-05-01T00:00:00Z" },
    ];
    assert.deepEqual(
      byCreated(items).map((i) => i.id),
      ["new", "old"],
    );
    assert.equal(items[0]?.id, "old");
  });
});
