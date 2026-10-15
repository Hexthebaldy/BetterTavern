import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isActive, NAV_ITEMS, openStoryId } from "./nav.ts";

const [stories, library, settings] = NAV_ITEMS;

describe("导航的选中项", () => {
  it("剧本详情算在剧本下，设置子页和连接测试算在设置下", () => {
    assert.ok(stories && library && settings);
    assert.equal(isActive(stories, "/playthroughs"), true);
    assert.equal(isActive(library, "/scenario/sc_1"), true);
    assert.equal(isActive(settings, "/settings/model/r1"), true);
    assert.equal(isActive(settings, "/dev/probe"), true);
    assert.equal(isActive(stories, "/play/p1"), false);
    assert.equal(isActive(library, "/libraryx"), false);
  });

  it("阅读页的地址里取出故事 ID", () => {
    assert.equal(openStoryId("/play/p%201"), "p 1");
    assert.equal(openStoryId("/play/p1/"), "p1");
    assert.equal(openStoryId("/playthroughs"), null);
  });
});
