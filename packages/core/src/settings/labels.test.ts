import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ModelInfo, ModelRoute, RouteWindow } from "../api/types.ts";
import { manualWindowChoice, modelTitle, needsManualWindow, windowNote } from "./labels.ts";

function route(id: string, provider: string, last4: string, shares: string[] = [], label = ""): ModelRoute {
  const window: RouteWindow = {
    model_window: 32768,
    source: "default",
    working_cap: 128000,
    max_tokens: 4096,
    effective_window: 28016,
    warnings: [],
  };
  return {
    id,
    label,
    provider,
    model: `model-${id}`,
    base_url: null,
    key_last4: last4,
    extra_header_names: [],
    extra_body: {},
    manual_window: null,
    params: { thinking: false },
    caps_override: {},
    status: "ok",
    last_ok_at: null,
    last_probe: null,
    is_director: false,
    is_background: false,
    supports_tools: true,
    shares_key_with: shares,
    window,
    created_at: "2026-10-15T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
  };
}

describe("添加模型", () => {
  it("服务商列表或内置资料知道窗口时不用填", () => {
    const models: ModelInfo[] = [
      { id: "org/listed", context_window: 32768, window_source: "listed", owned_by: null },
      { id: "deepseek-chat", context_window: 1_000_000, window_source: "table", owned_by: null },
      { id: "org/unknown", context_window: null, window_source: null, owned_by: null },
    ];
    assert.equal(needsManualWindow(models, "org/listed"), false);
    assert.equal(needsManualWindow(models, "deepseek-chat"), false);
    assert.equal(needsManualWindow(models, "org/listed:novita"), false);
    assert.equal(needsManualWindow(models, "org/unknown"), true);
    assert.equal(needsManualWindow(models, "typed-by-hand"), true);
    assert.equal(needsManualWindow(null, "typed-by-hand"), true);
    assert.equal(needsManualWindow(models, "  "), false);
  });

  it("手填窗口的选项", () => {
    assert.equal(manualWindowChoice(null), "unknown");
    assert.equal(manualWindowChoice(131072), "131072");
    assert.equal(manualWindowChoice(99999), "unknown");
  });
});

describe("模型详情", () => {
  it("名字用备注名，没有就用模型名", () => {
    assert.equal(modelTitle({ label: "", model: "deepseek-chat" }), "deepseek-chat");
    assert.equal(modelTitle({ label: "主力", model: "deepseek-chat" }), "主力");
  });

  it("只有估计值、手填和纠正过的窗口要额外说明", () => {
    const base = route("a", "huggingface", "1111").window;
    assert.match(windowNote(base) ?? "", /先按 32K 估计/);
    assert.match(windowNote({ ...base, source: "learned" }) ?? "", /最多 32K/);
    assert.equal(windowNote({ ...base, source: "listed" }), null);
  });
});
