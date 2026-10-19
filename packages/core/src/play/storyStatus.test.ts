import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listRefreshInterval, storyStatus, WRITING_REFRESH_MS } from "./storyStatus.ts";

const idle = {
  status: "active",
  active_turn_id: null,
  head_turn_id: "t9",
  head_excerpt: "雨还在下。",
} as const;

describe("storyStatus", () => {
  it("平时没有状态", () => {
    assert.equal(storyStatus(idle), null);
  });

  it("正在生成：开场还是下一段", () => {
    assert.deepEqual(storyStatus({ ...idle, active_turn_id: "t10" }), {
      kind: "writing",
      label: "正在写下一段",
    });
    assert.deepEqual(storyStatus({ ...idle, active_turn_id: "t1", head_turn_id: null, head_excerpt: "" }), {
      kind: "writing",
      label: "正在写开场",
    });
  });

  it("开场没写成、也没有在写", () => {
    assert.deepEqual(storyStatus({ ...idle, head_turn_id: null, head_excerpt: "" }), {
      kind: "noOpening",
      label: "开场还没有写好",
    });
  });

  it("写完结局：已完结", () => {
    assert.deepEqual(storyStatus({ ...idle, status: "ended" }), { kind: "ended", label: "已完结" });
  });
});

describe("listRefreshInterval", () => {
  it("有故事正在写时定时刷新，没有时不刷新", () => {
    assert.equal(listRefreshInterval([idle, { ...idle, active_turn_id: "t10" }]), WRITING_REFRESH_MS);
    assert.equal(listRefreshInterval([idle, idle]), false);
    assert.equal(listRefreshInterval([]), false);
    assert.equal(listRefreshInterval(undefined), false);
  });
});
