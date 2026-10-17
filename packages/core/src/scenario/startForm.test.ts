import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOUNDARIES_MAX,
  composeBoundaries,
  composeStyle,
  NAME_POOL,
  randomName,
  STYLE_MAX,
  suggestNames,
  summaryParts,
} from "./startForm.ts";

describe("开始新故事的表单", () => {
  it("名字建议不重复", () => {
    const names = suggestNames(4, () => 0);
    assert.equal(new Set(names).size, 4);
    assert.ok(names.every((n) => (NAME_POOL as readonly string[]).includes(n)));
  });

  it("随机名字和当前的不同", () => {
    for (let i = 0; i < 10; i += 1)
      assert.notEqual(
        randomName("林川", () => i / 10),
        "林川",
      );
  });

  it("文风和边界用顿号连起来，超出上限的整项丢掉", () => {
    assert.equal(composeStyle(["克制", " 白描 ", ""]), "克制、白描");
    const long = Array.from({ length: 80 }, (_, i) => `风格${i}`);
    const style = composeStyle(long);
    assert.ok(style.length <= STYLE_MAX);
    assert.ok(style.endsWith(`风格${style.split("、").length - 1}`));
    assert.ok(composeBoundaries(long).length <= BOUNDARIES_MAX);
  });

  it("底部摘要分段", () => {
    assert.deepEqual(
      summaryParts({ name: "林川", length: "medium", styles: ["克制", "白描"], boundaries: 2 }),
      ["林川", "适中", "克制 · 白描", "避开 2 项"],
    );
    assert.deepEqual(summaryParts({ name: " ", length: "short", styles: [], boundaries: 0 }), [
      "还没起名",
      "短",
    ]);
  });
});
