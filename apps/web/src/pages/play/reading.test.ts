import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { draftKey, isSendKey, nextFollow, parseDraft } from "./reading.ts";

describe("跟随新文字", () => {
  it("到了底部就跟随", () => {
    assert.deepEqual(nextFollow({ following: false, lastY: 100 }, { y: 900, distance: 10 }), {
      following: true,
      lastY: 900,
    });
  });

  it("往上翻就停止跟随", () => {
    assert.deepEqual(nextFollow({ following: true, lastY: 900 }, { y: 600, distance: 300 }), {
      following: false,
      lastY: 600,
    });
  });

  it("往下翻但没到底：保持原样（程序滚动、平滑滚动的中途不算翻走）", () => {
    assert.equal(nextFollow({ following: true, lastY: 600 }, { y: 700, distance: 200 }).following, true);
    assert.equal(nextFollow({ following: false, lastY: 600 }, { y: 700, distance: 200 }).following, false);
  });
});

describe("Enter 发送", () => {
  const key = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };

  it("Enter 发送，Shift + Enter 换行", () => {
    assert.equal(isSendKey(key), true);
    assert.equal(isSendKey({ ...key, shiftKey: true }), false);
    assert.equal(isSendKey({ ...key, key: "a", keyCode: 65 }), false);
  });

  it("输入法组字时的 Enter 是确认候选词", () => {
    assert.equal(isSendKey({ ...key, isComposing: true }), false);
    assert.equal(isSendKey({ ...key, keyCode: 229 }), false);
  });
});

describe("草稿", () => {
  it("每个故事一份，读到的不是文字就当没有", () => {
    assert.equal(draftKey("p1"), "bt.draft.p1");
    assert.equal(parseDraft("我推开门"), "我推开门");
    assert.equal(parseDraft(null), "");
    assert.equal(parseDraft(3), "");
  });
});
