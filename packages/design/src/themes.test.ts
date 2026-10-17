import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lightPalette } from "./palettes.ts";
import { parseThemeSetting, resolveTheme, THEME_ORDER, THEMES, type ThemeId } from "./themes.ts";

describe("主题表", () => {
  it("存储里不认识的值退回跟随系统", () => {
    assert.equal(parseThemeSetting("night"), "night");
    assert.equal(parseThemeSetting("light"), "light");
    assert.equal(parseThemeSetting("system"), "system");
    for (const raw of ["sepia", "toString", "", 1, null, undefined, {}]) {
      assert.equal(parseThemeSetting(raw), "system");
    }
  });

  it("跟随系统时按系统深浅选浅色或夜间，固定主题时不看系统", () => {
    assert.equal(resolveTheme("system", "dark"), "night");
    assert.equal(resolveTheme("system", "light"), "light");
    assert.equal(resolveTheme("system", "unspecified"), "light");
    assert.equal(resolveTheme("system", null), "light");
    assert.equal(resolveTheme("night", "light"), "night");
    assert.equal(resolveTheme("light", "dark"), "light");
  });

  it("每个主题都排进了设置列表，色板字段齐全", () => {
    assert.deepEqual([...THEME_ORDER].sort(), Object.keys(THEMES).sort());
    const fields = Object.keys(lightPalette).sort();
    for (const id of Object.keys(THEMES) as ThemeId[]) {
      const palette = THEMES[id].palette;
      assert.deepEqual(Object.keys(palette).sort(), fields, id);
      for (const value of Object.values(palette)) assert.ok(value.length > 0, id);
    }
  });
});
