import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyLanguage } from "../i18n/index.ts";
import { worldIssue, worldProgress } from "./worldStatus.ts";

describe("世界状态整理到哪", () => {
  it("开局和第几回合", () => {
    applyLanguage("zh");
    assert.equal(worldProgress({ state_seq: -1 }), "开局时的样子");
    assert.equal(worldProgress({ state_seq: 7 }), "截至第 7 回合");
  });

  it("整理失败和跳过的提示带上原因", () => {
    applyLanguage("zh");
    assert.equal(worldIssue({ state_issue: null }), null);
    const failed = worldIssue({ state_issue: { seq: 8, kind: "failed", reason: "tools_unsupported" } });
    assert.ok(failed?.includes("第 8 回合") && failed.includes("不能调用工具"));
    const skipped = worldIssue({ state_issue: { seq: 5, kind: "skipped", reason: "rate_limit" } });
    assert.ok(skipped?.includes("第 5 回合") && skipped.includes("限流"));
    const unknown = worldIssue({ state_issue: { seq: 5, kind: "skipped", reason: "something_new" } });
    assert.ok(unknown?.includes("第 5 回合"));
  });

  it("跟着界面语言", () => {
    applyLanguage("en");
    assert.equal(worldProgress({ state_seq: 3 }), "As of turn 3");
    applyLanguage("zh");
  });
});
