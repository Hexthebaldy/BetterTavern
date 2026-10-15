import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RequestRecord } from "../api/client.ts";
import { requestFields, requestLevel, serverHost } from "./requests.ts";

const record = (status: number, durationMs = 100, code: string | null = null): RequestRecord => ({
  method: "GET",
  path: "/v1/playthroughs",
  status,
  durationMs,
  requestId: "r1",
  code,
});

describe("请求记录的级别", () => {
  it("失败和慢的请求进小本子，正常的只到终端", () => {
    assert.equal(requestLevel(record(200)), "debug");
    assert.equal(requestLevel(record(200, 3500)), "info");
    assert.equal(requestLevel(record(401, 50, "UNAUTHENTICATED")), "info");
    assert.equal(requestLevel(record(409, 50, "TURN_IN_PROGRESS")), "warn");
    assert.equal(requestLevel(record(0, 30000, "TIMEOUT")), "warn");
    assert.equal(requestLevel(record(502)), "error");
  });

  it("连不上时记下连的是哪个服务器（只留主机和端口）", () => {
    assert.equal(serverHost("http://100.121.178.33:8000"), "100.121.178.33:8000");
    assert.equal(requestFields(record(0), "http://192.168.1.3:8000/").server, "192.168.1.3:8000");
    assert.equal(requestFields(record(200), "http://192.168.1.3:8000").server, undefined);
  });
});
