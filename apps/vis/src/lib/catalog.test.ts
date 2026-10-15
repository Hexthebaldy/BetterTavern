import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eventInfo, fieldValue, issueText, laneLabel, laneRank, routeName, sentence } from "./catalog.ts";
import { ago, clock, duration, modelName, shortId, shortPath, ticks, tokens } from "./format.ts";

describe("格式化", () => {
  it("毫秒、token、编号换成人能看的样子", () => {
    assert.equal(duration(840), "840 毫秒");
    assert.equal(duration(1840), "1.84 秒");
    assert.equal(duration(23_400), "23.4 秒");
    assert.equal(duration(125_000), "2 分 5 秒");
    assert.equal(tokens(812), "812");
    assert.equal(tokens(1234), "1.2k");
    assert.equal(tokens(56_789), "57k");
    assert.equal(shortId("9f2c4e1a7b3d4e5f"), "9f2c4e1a");
  });

  it("模型名去掉组织前缀和服务商后缀", () => {
    assert.equal(modelName("huihui-ai/Huihui-Qwen3.8-27B:featherless-ai"), "Huihui-Qwen3.8-27B");
    assert.equal(modelName("deepseek-chat"), "deepseek-chat");
    assert.equal(modelName(null), "–");
  });

  it("路径里的长编号缩短", () => {
    assert.equal(shortPath("/v1/turns/69932488-5e36-41a0-9b7e-f1d062753bf8/events"), "/v1/turns/69932488…/events");
    assert.equal(shortPath("/v1/playthroughs"), "/v1/playthroughs");
  });

  it("今天的时间不带日期，过去的带", () => {
    const now = new Date(2026, 9, 15, 18, 0, 0).getTime();
    assert.equal(clock(new Date(2026, 9, 15, 17, 2, 3).getTime(), now), "17:02:03");
    assert.equal(clock(new Date(2026, 9, 14, 9, 0, 0).getTime(), now), "10月14日 09:00:00");
    assert.equal(ago(now - 90_000, now), "1 分钟前");
  });

  it("时间轴刻度取 1、2、5 的整数倍", () => {
    assert.deepEqual(ticks(12_000, 6), [0, 2000, 4000, 6000, 8000, 10000, 12000]);
    assert.deepEqual(ticks(0), [0]);
  });
});

describe("中文目录", () => {
  it("事件写成一句人话，认不出来的原样显示", () => {
    assert.equal(
      sentence("provider.retry", { attempt: 1, error_class: "rate_limit", status: 429, retry_in_s: 2 }),
      "第 1 次失败：被服务商限流，HTTP 429，2 秒后重试",
    );
    assert.equal(sentence("provider.first_token", { ttft_ms: 1840 }), "模型吐出第一个字，等了 1.84 秒");
    assert.equal(
      sentence("http.request", {
        method: "POST",
        route: "/v1/playthroughs/{playthrough_id}/turns",
        status: 201,
        duration_ms: 35,
      }),
      "提交行动：HTTP 201，耗时 35 毫秒",
    );
    assert.equal(sentence("something.new", {}), "something.new");
    assert.equal(eventInfo("provider.whatever").category, "model");
  });

  it("字段值按名字换单位，错误码翻译", () => {
    assert.equal(fieldValue("ttft_ms", 1840), "1.84 秒");
    assert.equal(fieldValue("cached_tokens", 8000), "8.0k");
    assert.equal(fieldValue("usage_ratio", 0.912), "91.2%");
    assert.equal(fieldValue("error_class", "rate_limit"), "被服务商限流（rate_limit）");
    assert.equal(fieldValue("code", "RUNNER_LOST"), "生成进程意外中止（RUNNER_LOST）");
    assert.equal(fieldValue("dropped", true), "是");
  });

  it("接口名、时间线的行", () => {
    assert.equal(routeName("GET", "/v1/turns/{turn_id}/events"), "接收推送");
    assert.equal(routeName("GET", null, "/v1/unknown"), "/v1/unknown");
    assert.equal(laneLabel("sse:2"), "推送 2");
    assert.ok(laneRank("model") < laneRank("sse:1") && laneRank("sse:1") < laneRank("sse:2"));
  });

  it("问题写成中文", () => {
    assert.equal(
      issueText("provider_retry", { count: 3, classes: { rate_limit: 2, timeout: 1 } }),
      "调模型重试了 3 次（被服务商限流 2 次、超时 1 次）",
    );
    assert.equal(issueText("low_cache", { ratio: 0.12 }), "前缀缓存只命中了 12%，这一轮更慢也更贵");
  });
});
