import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COPIES } from "../i18n/all.ts";
import { commandText, DEPLOY_TABS } from "./deploy.ts";

describe("commandText", () => {
  it("复制的文字：命令不带 $，注释换成这种语言的文字、带 #，一行一条", () => {
    const lines = [
      ["$", "make js-install"],
      ["#", "browser"],
    ] as const;
    assert.equal(
      commandText(lines, COPIES.zh.deploy.notes),
      "make js-install\n# 浏览器打开 http://localhost:5173",
    );
    assert.equal(
      commandText(lines, COPIES.en.deploy.notes),
      "make js-install\n# Open http://localhost:5173 in a browser",
    );
  });

  it("四组命令各有内容，id 不重复", () => {
    assert.deepEqual(
      DEPLOY_TABS.map((t) => t.id),
      ["docker", "source", "web", "mobile"],
    );
    for (const t of DEPLOY_TABS) assert.ok(t.lines.some(([kind]) => kind === "$"), t.id);
  });
});
