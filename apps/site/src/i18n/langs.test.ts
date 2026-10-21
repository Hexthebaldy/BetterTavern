import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { langFromBrowser, langFromHtml, langFromPath, langHref } from "./langs.ts";

describe("langFromPath", () => {
  it("en/、ja/ 结尾是英文、日文，其余是中文；放在子路径下也认得", () => {
    assert.equal(langFromPath("/"), "zh");
    assert.equal(langFromPath("/index.html"), "zh");
    assert.equal(langFromPath("/en/"), "en");
    assert.equal(langFromPath("/ja/index.html"), "ja");
    assert.equal(langFromPath("/BetterTavern/en/"), "en");
    assert.equal(langFromPath("/BetterTavern/"), "zh");
    assert.equal(langFromPath("/en"), "zh");
  });
});

describe("langFromBrowser", () => {
  it("中文和日文用对应的，其他都用英文", () => {
    assert.equal(langFromBrowser("zh-CN"), "zh");
    assert.equal(langFromBrowser("zh-TW"), "zh");
    assert.equal(langFromBrowser("ja"), "ja");
    assert.equal(langFromBrowser("ja-JP"), "ja");
    assert.equal(langFromBrowser("en-US"), "en");
    assert.equal(langFromBrowser("fr"), "en");
    assert.equal(langFromBrowser(undefined), "en");
  });
});

describe("langFromHtml", () => {
  it("按 <html lang> 认", () => {
    assert.equal(langFromHtml("zh-CN"), "zh");
    assert.equal(langFromHtml("ja"), "ja");
    assert.equal(langFromHtml("de"), null);
  });
});

describe("langHref", () => {
  it("页面之间用相对地址", () => {
    assert.equal(langHref("zh", "en"), "./en/");
    assert.equal(langHref("zh", "zh"), "./");
    assert.equal(langHref("en", "zh"), "../");
    assert.equal(langHref("en", "ja"), "../ja/");
    assert.equal(langHref("ja", "ja"), "../ja/");
  });
});
