import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkCardFile, MAX_CARD_BYTES } from "./rules.ts";

describe("checkCardFile", () => {
  it("只收 PNG 和 JSON，不分大小写", () => {
    assert.equal(checkCardFile({ name: "阿苓.PNG", size: 10 }), null);
    assert.equal(checkCardFile({ name: "card.json", size: 10 }), null);
    assert.deepEqual(checkCardFile({ name: "notes.txt", size: 10 }), {
      title: "notes.txt 不是角色卡",
      message: "只支持 PNG 或 JSON，最大 16 MB。",
    });
  });

  it("超过 16 MB 太大了", () => {
    assert.equal(checkCardFile({ name: "big.png", size: MAX_CARD_BYTES }), null);
    assert.equal(checkCardFile({ name: "big.png", size: MAX_CARD_BYTES + 1 })?.title, "big.png 太大了");
  });
});
