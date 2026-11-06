import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ToolProvider, ToolRoute } from "../api/types.ts";
import { newToolRoute, toolFormFrom, toolFormReady, toolPatch } from "./tools.ts";

const route: ToolRoute = {
  id: "r1",
  kind: "image",
  provider: "openai_images",
  label: "",
  base_url: "https://api.siliconflow.cn/v1",
  key_last4: "jefo",
  has_key: true,
  model: "Kwai-Kolors/Kolors",
  params: { sizes: { portrait: "768x1024" } },
  status: "ok",
  probe: {},
  is_default: true,
  created_at: "2026-11-06T00:00:00Z",
  updated_at: "2026-11-06T00:00:00Z",
};

const provider: ToolProvider = {
  id: "openai_images",
  kinds: ["image"],
  can_search: false,
  can_images: false,
  can_fetch: false,
  needs_key: true,
  needs_base_url: false,
  needs_model: true,
  max_references: 1,
};

describe("toolPatch", () => {
  it("什么都没改时是空的，不用再测", () => {
    assert.deepEqual(toolPatch(route, toolFormFrom(route)), { patch: {}, retest: false });
  });

  it("只发改了的地址和模型名，存好再测一次；Key 留空不换", () => {
    const form = { ...toolFormFrom(route), baseUrl: " https://api.siliconflow.com/v1 ", model: "Qwen/Qwen-Image" };
    assert.deepEqual(toolPatch(route, form), {
      patch: { base_url: "https://api.siliconflow.com/v1", model: "Qwen/Qwen-Image" },
      retest: true,
    });
  });

  it("清空地址发空串（改用默认地址）；只改备注名不用再测", () => {
    assert.deepEqual(toolPatch(route, { ...toolFormFrom(route), baseUrl: "" }).patch, { base_url: "" });
    assert.deepEqual(toolPatch(route, { ...toolFormFrom(route), label: "硅基" }), {
      patch: { label: "硅基" },
      retest: false,
    });
  });

  it("填了新 Key 就换", () => {
    assert.deepEqual(toolPatch(route, { ...toolFormFrom(route), key: "sk-new" }), {
      patch: { api_key: "sk-new" },
      retest: true,
    });
  });

  it("朗读改默认声音：其他参数照旧，清空声音就去掉这一项", () => {
    const speech: ToolRoute = { ...route, kind: "speech", provider: "openai_speech", params: { voice: "alex", extra_body: { speed: 1 } } };
    assert.equal(toolFormFrom(speech).voice, "alex");
    assert.deepEqual(toolPatch(speech, { ...toolFormFrom(speech), voice: "bella" }).patch, {
      params: { voice: "bella", extra_body: { speed: 1 } },
    });
    assert.deepEqual(toolPatch(speech, { ...toolFormFrom(speech), voice: "" }).patch, { params: { extra_body: { speed: 1 } } });
  });
});

describe("toolFormReady", () => {
  it("添加时要 Key；编辑时已经有 Key 就可以留空", () => {
    const empty = { ...toolFormFrom(route), key: "" };
    assert.equal(toolFormReady(provider, { ...toolFormFrom(), model: "m" }), false);
    assert.equal(toolFormReady(provider, empty, route), true);
  });

  it("要模型名的不能清空", () => {
    assert.equal(toolFormReady(provider, { ...toolFormFrom(route), model: " " }, route), false);
  });
});

describe("newToolRoute", () => {
  it("空的字段不发，朗读的默认声音放进参数", () => {
    const form = { ...toolFormFrom(), key: " k ", model: "m", voice: "alex" };
    assert.deepEqual(newToolRoute("speech", "openai_speech", form), {
      kind: "speech",
      provider: "openai_speech",
      label: undefined,
      api_key: "k",
      base_url: null,
      model: "m",
      params: { voice: "alex" },
    });
  });
});
