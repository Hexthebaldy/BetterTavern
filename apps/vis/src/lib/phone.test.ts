import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeByTime, parsePhoneLog, phoneRequestIds } from "./phone.ts";

describe("手机导出的诊断日志", () => {
  it("跳过说明行和坏行，级别换成服务端的写法", () => {
    const text = [
      "# BetterTavern 诊断日志",
      "# App 版本 0.1.0",
      '{"ts":"2026-10-15T17:12:03.410+08:00","level":"warn","event":"api.request","request_id":"r1","status":0}',
      "not json",
      '{"level":"info","event":"no.time"}',
      '{"ts":"2026-10-15T17:12:04.000+08:00","level":"info","event":"sse.state","state":"open"}',
    ].join("\n");
    const log = parsePhoneLog(text);
    assert.deepEqual(log.header, ["BetterTavern 诊断日志", "App 版本 0.1.0"]);
    assert.equal(log.skipped, 2);
    assert.equal(log.entries.length, 2);
    const first = log.entries[0];
    assert.equal(first?.level, "warning");
    assert.equal(first?.file, "phone");
    assert.equal(first?.request_id, "r1");
    assert.equal(first?.t, Date.parse("2026-10-15T17:12:03.410+08:00"));
    assert.ok((first?.n ?? 0) < 0);
  });

  it("按前缀找手机日志里的单号，服务端没收到的请求也能搜到", () => {
    const log = parsePhoneLog(
      [
        '{"ts":"2026-10-15T17:00:01.000+08:00","event":"api.request","request_id":"Ab12cd34ef"}',
        '{"ts":"2026-10-15T17:00:02.000+08:00","event":"sse.state","request_id":"ab12cd34ef"}',
        '{"ts":"2026-10-15T17:00:03.000+08:00","event":"api.request","request_id":"ab12cd99zz"}',
        '{"ts":"2026-10-15T17:00:04.000+08:00","event":"api.request","request_id":"Ab12cd34ef"}',
      ].join("\n"),
    );
    assert.deepEqual(phoneRequestIds(log, "ab12cd"), ["Ab12cd34ef", "ab12cd34ef", "ab12cd99zz"]);
    assert.deepEqual(phoneRequestIds(log, "ab12cd3"), ["Ab12cd34ef", "ab12cd34ef"]);
    assert.deepEqual(phoneRequestIds(log, "ab12"), []);
    assert.deepEqual(phoneRequestIds(null, "ab12cd"), []);
  });

  it("和服务端的记录按时间合并", () => {
    const phone = parsePhoneLog(
      '{"ts":"2026-10-15T17:00:02.000+08:00","level":"info","event":"api.request"}',
    ).entries;
    const server = [
      { n: 1, t: Date.parse("2026-10-15T17:00:01.000+08:00"), file: "api", event: "a", level: "info" },
      { n: 2, t: Date.parse("2026-10-15T17:00:03.000+08:00"), file: "api", event: "b", level: "info" },
    ];
    assert.deepEqual(
      mergeByTime(server, phone).map((e) => e.event),
      ["a", "api.request", "b"],
    );
  });
});
