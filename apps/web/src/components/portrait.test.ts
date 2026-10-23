import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDarkTone, PORTRAIT_TONES, portraitGlyph, portraitTone } from "./portrait.ts";

describe("portraitGlyph", () => {
  it("一般取名字的第一个字", () => {
    assert.equal(portraitGlyph("沈知微"), "沈");
    assert.equal(portraitGlyph("  温九 "), "温");
  });
  it("称呼开头时取下一个字", () => {
    assert.equal(portraitGlyph("阿澄"), "澄");
    assert.equal(portraitGlyph("老陈"), "陈");
    assert.equal(portraitGlyph("小"), "小");
  });
  it("拉丁字母取大写，跳过开头的标点", () => {
    assert.equal(portraitGlyph("rowan"), "R");
    assert.equal(portraitGlyph("“林川”"), "林");
  });
  it("没有字时是问号", () => {
    assert.equal(portraitGlyph(""), "?");
    assert.equal(portraitGlyph("……"), "?");
  });
});

describe("portraitTone", () => {
  it("同一个 ID 总是同一种底，且是五种之一", () => {
    assert.equal(portraitTone("card-1"), portraitTone("card-1"));
    assert.ok(PORTRAIT_TONES.includes(portraitTone("card-1")));
  });
  it("不同的 ID 能分到不同的底", () => {
    const tones = new Set(Array.from({ length: 30 }, (_, i) => portraitTone(`card-${i}`)));
    assert.ok(tones.size >= 4);
  });
  it("墨底和蓝底上的字反白", () => {
    assert.equal(isDarkTone("ink"), true);
    assert.equal(isDarkTone("blue"), true);
    assert.equal(isDarkTone("dots"), false);
  });
});
