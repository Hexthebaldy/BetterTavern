import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commandText, DEPLOY_TABS } from "./deploy.ts";

describe("commandText", () => {
  it("复制的文字：命令不带 $，注释带 #，一行一条", () => {
    assert.equal(
      commandText([
        ["$", "make js-install"],
        ["#", "浏览器打开 http://localhost:5173"],
      ]),
      "make js-install\n# 浏览器打开 http://localhost:5173",
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
