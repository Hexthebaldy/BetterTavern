import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FILLED_ICONS, ICONS } from "./icons.ts";

describe("实心图标", () => {
  it("每个实心图标都有同名的线条图标，而且至少有一块填蓝的主体", () => {
    for (const [name, parts] of Object.entries(FILLED_ICONS)) {
      assert.ok(name in ICONS, name);
      assert.ok(
        parts.some((p) => "fill" in p && p.fill === "body"),
        `${name} 没有填蓝的主体`,
      );
    }
  });
});
