import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { font, serifFor } from "./fonts.ts";

describe("正文宋体", () => {
  it("日文的局用日文子集，其他语言用中文子集", () => {
    assert.equal(serifFor("ja"), font.serifJa);
    assert.equal(serifFor("zh"), font.serif);
    assert.equal(serifFor("en"), font.serif);
    assert.notEqual(font.serif, font.serifJa);
  });

  it("不认识或缺失的语言按中文", () => {
    for (const language of ["fr", "", null, undefined, "JA"]) assert.equal(serifFor(language), font.serif);
  });
});
