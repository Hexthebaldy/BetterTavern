import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isActive, NAV_ITEMS, openStoryId } from "./nav.ts";

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
    assert.equal(isActive(item("models"), "/models/r1"), true);
    assert.equal(isActive(item("saves"), "/play/p1"), false);
    assert.equal(isActive(item("scenarios"), "/scenariosx"), false);
  });

  it("创作在前、连接在后", () => {
    assert.deepEqual(
      NAV_ITEMS.map((i) => i.group),
      ["create", "create", "create", "create", "connect", "connect"],
    );
  });

  it("阅读页的地址里取出故事 ID", () => {
    assert.equal(openStoryId("/play/p%201"), "p 1");
    assert.equal(openStoryId("/play/p1/"), "p1");
    assert.equal(openStoryId("/playthroughs"), null);
  });
});
