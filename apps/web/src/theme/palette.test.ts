import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { darkPalette, lightPalette } from "@bettertavern/design/palettes";

import { cssVarName, paletteVars } from "./palette.ts";

describe("paletteVars", () => {
  it("字段名转成短横线写法的 CSS 变量", () => {
    assert.equal(cssVarName("bg2"), "--bg2");
    assert.equal(cssVarName("accBg"), "--acc-bg");
    assert.equal(cssVarName("shadowFloat"), "--shadow-float");
    assert.equal(cssVarName("accOnInk"), "--acc-on-ink");
  });

  it("色板的每个字段都有一个变量，值原样带过去", () => {
    const vars = paletteVars(darkPalette);
    assert.equal(Object.keys(vars).length, Object.keys(darkPalette).length);
    assert.equal(vars["--bg"], darkPalette.bg);
    assert.equal(vars["--on-pri"], darkPalette.onPri);
    assert.notEqual(paletteVars(lightPalette)["--bg"], vars["--bg"]);
  });
});
