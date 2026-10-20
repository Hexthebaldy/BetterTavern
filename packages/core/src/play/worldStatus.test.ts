import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyLanguage } from "../i18n/index.ts";
import { WORLD_REFRESH_MS, worldIssue, worldProgress, worldRefreshDelay } from "./worldStatus.ts";

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

describe("面板开着时什么时候再取", () => {
  it("后台还没整理到最新一段：过一会儿再取；整理到了就不再取", () => {
    assert.equal(worldRefreshDelay({ state_seq: 3, state_issue: null }, 5), WORLD_REFRESH_MS);
    assert.equal(worldRefreshDelay({ state_seq: 5, state_issue: null }, 5), null);
    assert.equal(worldRefreshDelay(null, 5), null);
    assert.equal(worldRefreshDelay({ state_seq: -1, state_issue: null }, null), null);
  });

  it("下一段整理失败了要等下一回合再试：不一直取；跳过的回合不影响", () => {
    const failed = { seq: 4, kind: "failed" as const, reason: "timeout" };
    assert.equal(worldRefreshDelay({ state_seq: 3, state_issue: failed }, 5), null);
    const skipped = { seq: 2, kind: "skipped" as const, reason: null };
    assert.equal(worldRefreshDelay({ state_seq: 3, state_issue: skipped }, 5), WORLD_REFRESH_MS);
  });
});
