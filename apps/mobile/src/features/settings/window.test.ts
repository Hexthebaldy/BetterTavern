import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { choiceTokens, windowBlocks, windowChoice } from "./window.ts";

describe("工作窗口格子图", () => {
  it("128K 的模型、64K 的窗口、每轮输出 8K", () => {
    const w = windowBlocks(131072, 65536, 8192);
    assert.equal(w.unit, 4096);
    assert.equal(w.blocks.length, 32);
    assert.equal(w.blocks.filter((b) => b === "story").length, 14);
    assert.equal(w.blocks.filter((b) => b === "output").length, 2);
    assert.equal(w.blocks.filter((b) => b === "free").length, 16);
    assert.equal(w.mark, 11);
    assert.equal(w.clamped, false);
  });

  it("工作窗口超过模型上下文时按模型的上限算", () => {
    const w = windowBlocks(131072, 256000, 8192);
    assert.equal(w.used, 131072);
    assert.equal(w.free, 0);
    assert.equal(w.clamped, true);
    assert.ok(!w.blocks.includes("free"));
  });

  it("上下文很长时每格放大，最多 64 格", () => {
    const w = windowBlocks(1_048_576, 128000, 8192);
    assert.ok(w.blocks.length <= 64);
    assert.equal(w.unit, 16384);
  });

  it("没设置的工作窗口按 128K 选中", () => {
    assert.equal(windowChoice(undefined), "default");
    assert.equal(windowChoice(64000), "64000");
    assert.equal(choiceTokens("default"), 128000);
  });
});
