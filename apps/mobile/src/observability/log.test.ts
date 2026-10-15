import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DiagnosticsLog, exportText, localIso, newRequestId, REDACTED, scrubFields } from "./log.ts";

describe("手机诊断日志", () => {
  it("密钥字段整个抹掉，故事字段丢掉，字符串里的令牌和邮箱也处理", () => {
    const out = scrubFields({
      api_key: "sk-abcdefghijk",
      Authorization: "Bearer xyz",
      narrative: "她抬起眼。",
      text: "我坐下",
      detail: "failed with token=abcdef123 for lin@example.com",
      nested: { refreshToken: "r", ok: true },
      skipped: undefined,
    });
    assert.equal(out.api_key, REDACTED);
    assert.equal(out.Authorization, REDACTED);
    assert.ok(!("narrative" in out) && !("text" in out) && !("skipped" in out));
    assert.ok(!String(out.detail).includes("abcdef123"));
    assert.ok(String(out.detail).includes("l***@example.com"));
    assert.deepEqual(out.nested, { refreshToken: REDACTED, ok: true });
  });

  it("只保留最近的条数，debug 只给终端不进小本子", () => {
    const seen: string[] = [];
    const log = new DiagnosticsLog({ capacity: 3, now: () => new Date(2026, 9, 15, 17, 12, 3, 410) });
    log.setConsole((e) => seen.push(e.event));
    log.debug("sse.state", { state: "connecting" });
    for (let i = 0; i < 5; i += 1) log.info("api.request", { n: i });
    assert.deepEqual(
      log.all().map((e) => e.n),
      [2, 3, 4],
    );
    assert.equal(seen[0], "sse.state");
    assert.equal(seen.length, 6);
  });

  it("恢复上次存下的记录时放在前面，格式不对的丢掉", () => {
    const log = new DiagnosticsLog({ capacity: 3 });
    log.warn("api.request", { n: 9 });
    log.restore([
      { ts: "t", level: "info", event: "app.started" },
      { nonsense: true },
      { ts: "t", level: "loud", event: "x" },
    ]);
    assert.deepEqual(
      log.all().map((e) => e.event),
      ["app.started", "api.request"],
    );
  });

  it("时间是本地时间加时区偏移，单号是 32 位十六进制", () => {
    const iso = localIso(new Date(2026, 9, 15, 17, 12, 3, 4));
    assert.match(iso, /^2026-10-15T17:12:03\.004[+-]\d{2}:\d{2}$/);
    const id = newRequestId();
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.notEqual(id, newRequestId());
  });

  it("导出时开头是说明，后面每行一条 JSON", () => {
    const log = new DiagnosticsLog();
    log.error("app.error", { message: "boom" });
    const text = exportText(log.all(), {
      clientVersion: "0.1.0",
      platform: "ios 26",
      server: "http://100.1.2.3:8000",
    });
    const lines = text.split("\n");
    assert.ok(lines[0]?.startsWith("# BetterTavern"));
    const last = JSON.parse(lines[lines.length - 1] ?? "{}");
    assert.equal(last.event, "app.error");
  });
});
