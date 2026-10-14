import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_READING, lineHeightFor, parseReadingPrefs, readingSize, stepSize } from "./reading.ts";

describe("阅读设置", () => {
  it("默认宋体、跟随系统字号", () => {
    assert.deepEqual(DEFAULT_READING, { font: "serif", size: null });
    assert.equal(readingSize(DEFAULT_READING), 17.5);
    assert.equal(lineHeightFor(17.5), 31);
  });

  it("按档位调大调小，到头不变", () => {
    assert.equal(stepSize(DEFAULT_READING, 1), 19);
    assert.equal(stepSize(DEFAULT_READING, -1), 16);
    assert.equal(stepSize({ font: "serif", size: 24 }, 1), 24);
    assert.equal(stepSize({ font: "serif", size: 15 }, -1), 15);
    assert.equal(stepSize({ font: "serif", size: 18 }, 1), 19);
  });

  it("存储内容不对时退回默认", () => {
    assert.deepEqual(parseReadingPrefs(null), DEFAULT_READING);
    assert.deepEqual(parseReadingPrefs({ font: "sans", size: 99 }), { font: "sans", size: null });
    assert.deepEqual(parseReadingPrefs({ font: "x", size: 19 }), { font: "serif", size: 19 });
  });
});
