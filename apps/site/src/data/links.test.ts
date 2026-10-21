import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { androidApkHref } from "./links.ts";

describe("androidApkHref", () => {
  it("安装包在站点根目录下的 downloads/：中文首页在根目录，英文、日文页要先退一级", () => {
    assert.equal(androidApkHref("zh"), "./downloads/BetterTavern.apk");
    assert.equal(androidApkHref("en"), "../downloads/BetterTavern.apk");
    assert.equal(androidApkHref("ja"), "../downloads/BetterTavern.apk");
  });
});
