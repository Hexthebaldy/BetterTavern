import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currentSection, isScrolled, SECTION_LINE } from "./scroll.ts";

const tops = (...ys: number[]) => ["how", "world", "more"].map((id, i) => ({ id, top: ys[i]! }));

describe("currentSection", () => {
  it("还没滚到第一节时没有当前节", () => {
    assert.equal(currentSection(tops(600, 1600, 2600)), null);
  });

  it("顶边过了那条线的节里，取最后一个", () => {
    assert.equal(currentSection(tops(-400, 600, 1600)), "how");
    assert.equal(currentSection(tops(-1400, -400, 600)), "world");
    assert.equal(currentSection(tops(-2400, -1400, -400)), "more");
  });

  it("正好在线上算进入了这一节", () => {
    assert.equal(currentSection(tops(-400, SECTION_LINE, 1600)), "world");
    assert.equal(currentSection(tops(-400, SECTION_LINE + 1, 1600)), "how");
  });

  it("没有节时也是 null", () => {
    assert.equal(currentSection([]), null);
  });
});

describe("isScrolled", () => {
  it("往下滚了 8px 以上才算", () => {
    assert.equal(isScrolled(0), false);
    assert.equal(isScrolled(8), false);
    assert.equal(isScrolled(9), true);
  });
});
