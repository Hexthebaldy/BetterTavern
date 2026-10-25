import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activeIndex, isActive, NAV_ITEMS, openStoryId } from "./nav.ts";

const item = (name: string) => {
  const found = NAV_ITEMS.find((i) => i.name === name);
  assert.ok(found, name);
  return found;
};

describe("导航的选中项", () => {
  it("详情页算在各自的模块下", () => {
    assert.equal(isActive(item("saves"), "/playthroughs"), true);
    assert.equal(isActive(item("scenarios"), "/scenario/sc_1"), true);
    assert.equal(isActive(item("characters"), "/card/c1"), true);
    assert.equal(isActive(item("characters"), "/lorebooks"), true);
    assert.equal(isActive(item("characters"), "/lorebook/b1"), true);
    assert.equal(isActive(item("models"), "/models/r1"), true);
    assert.equal(isActive(item("settings"), "/settings/tools"), true);
    assert.equal(isActive(item("settings"), "/dev/probe"), true);
    assert.equal(isActive(item("saves"), "/play/p1"), false);
    assert.equal(isActive(item("scenarios"), "/scenariosx"), false);
  });

  it("轮盘上的顺序：存档、剧本、角色、工作台、模型、设置", () => {
    assert.deepEqual(
      NAV_ITEMS.map((i) => i.name),
      ["saves", "scenarios", "characters", "workbench", "models", "settings"],
    );
    assert.equal(activeIndex("/workbench/d/1"), 3);
    assert.equal(activeIndex("/play/p1"), null);
  });

  it("窄屏的 Tab 栏放前四项，模型和设置从“更多”进", () => {
    assert.deepEqual(
      NAV_ITEMS.filter((i) => i.tab).map((i) => i.name),
      ["saves", "scenarios", "characters", "workbench"],
    );
  });

  it("阅读页的地址里取出故事 ID", () => {
    assert.equal(openStoryId("/play/p%201"), "p 1");
    assert.equal(openStoryId("/play/p1/"), "p1");
    assert.equal(openStoryId("/playthroughs"), null);
  });
});
