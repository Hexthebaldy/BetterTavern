import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextTabIndex } from "./tabs.ts";

describe("nextTabIndex", () => {
  it("左右键换到前一个、后一个，两头循环", () => {
    assert.equal(nextTabIndex("ArrowRight", 0, 4), 1);
    assert.equal(nextTabIndex("ArrowRight", 3, 4), 0);
    assert.equal(nextTabIndex("ArrowLeft", 0, 4), 3);
    assert.equal(nextTabIndex("ArrowLeft", 2, 4), 1);
  });

  it("Home、End 到第一个、最后一个；别的键不处理", () => {
    assert.equal(nextTabIndex("Home", 2, 4), 0);
    assert.equal(nextTabIndex("End", 0, 4), 3);
    assert.equal(nextTabIndex("Enter", 1, 4), null);
    assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
  });
});
