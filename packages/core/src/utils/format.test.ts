import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatBytes, formatDate, formatTokens } from "./format.ts";

describe("数字格式", () => {
  it("token 数：二进制的整数和十进制的整千都显示成整数 K", () => {
    assert.equal(formatTokens(131072), "128K");
    assert.equal(formatTokens(128000), "128K");
    assert.equal(formatTokens(32000), "32K");
    assert.equal(formatTokens(1048576), "1M");
    assert.equal(formatTokens(8192), "8K");
    assert.equal(formatTokens(65536 + 512), "64.5K");
    assert.equal(formatTokens(500), "500");
  });

  it("日期", () => {
    assert.equal(formatDate("2026-09-03T08:00:00"), "2026 年 9 月 3 日");
    assert.equal(formatDate("不是日期"), "");
  });

  it("文件大小", () => {
    assert.equal(formatBytes(2.4 * 1024 * 1024), "2.4 MB");
    assert.equal(formatBytes(830 * 1024), "830 KB");
  });
});
