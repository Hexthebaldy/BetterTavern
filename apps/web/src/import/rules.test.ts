import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkCardFile, failureNotice, importSummary, MAX_CARD_BYTES, type ImportOutcome } from "./rules.ts";

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

describe("导入的汇总", () => {
  const ok = (name: string): ImportOutcome => ({ kind: "imported", id: name, name });
  const dup = (name: string): ImportOutcome => ({ kind: "duplicate", id: name, name });
  const bad = (title: string): ImportOutcome => ({ kind: "failed", problem: { title, message: "…" } });

  it("浮条说导入了几张、几张之前导入过", () => {
    assert.equal(importSummary([ok("a"), ok("b"), ok("c")]), "导入了 3 张角色卡");
    assert.equal(
      importSummary([ok("a"), dup("b"), bad("c 太大了")]),
      "导入了 1 张角色卡，1 张之前已经导入过",
    );
    assert.equal(importSummary([dup("b")]), "1 张之前已经导入过");
    assert.equal(importSummary([bad("c 太大了")]), null);
  });

  it("失败的合成一条红色提示", () => {
    assert.equal(failureNotice([ok("a")]), null);
    assert.deepEqual(failureNotice([ok("a"), bad("c 太大了")]), { title: "c 太大了", message: "…" });
    assert.deepEqual(failureNotice([bad("c 太大了"), bad("d.txt 不是角色卡")]), {
      title: "有 2 张没有导入",
      message: "c 太大了；d.txt 不是角色卡",
    });
  });
});
