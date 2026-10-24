import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMIC_COLORS, halftone, hardShadow, pressedShift } from "./comic.ts";
import { THEME_ORDER } from "./themes.ts";

const COLOR = /^(#[0-9A-F]{6}|rgba\(\d+,\d+,\d+,0(\.\d+)?\))$/;

describe("漫画风的颜色", () => {
  it("每个主题都有全部颜色，而且都是合法的颜色值", () => {
    const keys = Object.keys(COMIC_COLORS.light).sort();
    for (const id of THEME_ORDER) {
      assert.deepEqual(Object.keys(COMIC_COLORS[id]).sort(), keys, id);
      for (const [key, value] of Object.entries(COMIC_COLORS[id])) {
        assert.match(value, COLOR, `${id}.${key}`);
      }
    }
  });

  it("夜间是墨和纸对调", () => {
    assert.equal(COMIC_COLORS.night.ink, "#F2F2F0");
    assert.equal(COMIC_COLORS.night.paper, "#111113");
    assert.notEqual(COMIC_COLORS.night.page, COMIC_COLORS.light.page);
  });
});

describe("硬投影", () => {
  it("一像素一层，层数就是投影的长度", () => {
    assert.equal(hardShadow("#000", 2), "1px 1px 0 #000, 2px 2px 0 #000");
    assert.equal(hardShadow("#1A1A1A", 6)?.split(", ").length, 6);
    assert.equal(hardShadow("#1A1A1A", 0), undefined);
  });

  it("按下时往投影方向挪，投影剩一层；没有投影就不动", () => {
    assert.deepEqual(pressedShift(4), { shift: 3, depth: 1 });
    assert.deepEqual(pressedShift(2), { shift: 1, depth: 1 });
    assert.deepEqual(pressedShift(0), { shift: 0, depth: 0 });
  });
});

describe("网点", () => {
  it("蓝底是白点，夜间跟着对调", () => {
    assert.equal(halftone("acc", "light").dot, "rgba(255,255,255,0.22)");
    assert.equal(halftone("ink", "night").dot, "rgba(242,242,240,0.14)");
    assert.ok(halftone("grey", "light").step > 0);
  });
});
