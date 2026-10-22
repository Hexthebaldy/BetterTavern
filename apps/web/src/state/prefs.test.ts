import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bootScheme, DEFAULT_PREFS, parsePrefs } from "./prefs.ts";

describe("parsePrefs", () => {
  it("没存过或内容不对时用默认值", () => {
    assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs("oops"), DEFAULT_PREFS);
    assert.deepEqual(
      parsePrefs({ theme: "sepia", libraryView: "table", singleKeys: "no", language: "fr" }),
      DEFAULT_PREFS,
    );
  });

  it("读出存过的设置", () => {
    const prefs = parsePrefs({
      reading: { font: "sans", size: 20.5 },
      libraryView: "list",
      theme: "night",
      language: "en",
      worldDocked: true,
      sidebarCollapsed: true,
      singleKeys: false,
      movedHintDismissed: true,
    });
    assert.deepEqual(prefs, {
      reading: { font: "sans", size: 20.5 },
      libraryView: "list",
      theme: "night",
      language: "en",
      worldDocked: true,
      sidebarCollapsed: true,
      singleKeys: false,
      movedHintDismissed: true,
    });
  });

  it("启动脚本用的深浅", () => {
    assert.equal(bootScheme("system"), "system");
    assert.equal(bootScheme("night"), "dark");
    assert.equal(bootScheme("light"), "light");
  });
});
