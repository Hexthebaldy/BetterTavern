import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fill, richParts } from "./format.ts";

describe("fill", () => {
  it("换掉给了值的占位，没给的原样留着", () => {
    assert.equal(fill("去 {name} 获取 Key", { name: "DeepSeek" }), "去 DeepSeek 获取 Key");
    assert.equal(fill("第 {n} 段，{x}", { n: 11 }), "第 11 段，{x}");
  });
});

describe("richParts", () => {
  it("反引号括起来的是行内代码", () => {
    assert.deepEqual(richParts("本地用 `make web` 启动。"), [
      { code: false, text: "本地用 " },
      { code: true, text: "make web" },
      { code: false, text: " 启动。" },
    ]);
  });

  it("没有反引号就是一整段文字；开头结尾的代码不多出空段", () => {
    assert.deepEqual(richParts("收费吗？"), [{ code: false, text: "收费吗？" }]);
    assert.deepEqual(richParts("`a`"), [{ code: true, text: "a" }]);
  });
});
