import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FetchLike, ResponseLike } from "../api/sse/sseClient.ts";
import { ProbeSession, percentile, type ProbeDeps } from "./probeSession.ts";

const encoder = new TextEncoder();

/** 内存里的假探针服务：一条 6 段的流，第一次连接读到第 3 段时断网，之后续传。 */
function fakeServer(options: { offlineStatusCalls?: number } = {}) {
  let clock = 1_000_000; // 本机时间与服务端时间相同（偏差 0）
  const pieces = ["雨夜", "的酒", "馆🌧️", "里，", "𠮷野", "家。"];
  const text = pieces.join("");
  const sentAt = pieces.map((_, i) => 1_000_000 + i * 50);
  let streamCalls = 0;
  let offlineStatus = options.offlineStatusCalls ?? 0;
  const lastIds: (string | undefined)[] = [];

  const event = (seq: number, name: string, data: object): string =>
    `id: p1:${seq}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

  const streamFetch: FetchLike = async (_url, init) => {
    streamCalls += 1;
    lastIds.push(init.headers["Last-Event-ID"]);
    const after = Number(init.headers["Last-Event-ID"]?.split(":")[1] ?? 0);
    const all = [
      event(1, "turn.created", {}),
      ...pieces.map((p, i) => event(i + 2, "narrative.delta", { text: p, sent_at: sentAt[i] })),
      event(8, "turn.completed", { chars: [...text].length }),
    ];
    const chunks = all.slice(after);
    const first = streamCalls === 1;
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (first && index === 4) {
          controller.error(new TypeError("network lost"));
          return;
        }
        const chunk = chunks[index];
        index += 1;
        if (chunk === undefined) {
          controller.close();
          return;
        }
        // 第一次连接：每段在发出后 20 毫秒到达；续传时积压的段落晚到 2 秒
        clock = Math.max(clock, (first ? 20 : 2000) + 1_000_000 + index * 50);
        controller.enqueue(encoder.encode(chunk));
      },
    });
    const response: ResponseLike = { ok: true, status: 200, body };
    return response;
  };

  const jsonFetch: ProbeDeps["jsonFetch"] = async (url) => {
    const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (url.endsWith("/time")) return reply({ server_time_ms: clock });
    if (url.endsWith("/streams")) {
      return reply({
        stream_id: "p1",
        events_url: "/v1/probe/streams/p1/events",
        status_url: "/v1/probe/streams/p1",
      });
    }
    if (offlineStatus > 0) {
      offlineStatus -= 1;
      throw new TypeError("Network request failed");
    }
    return reply({ status: "completed", text, sha256: "x" });
  };

  return {
    deps: { streamFetch, jsonFetch, now: () => clock, sleep: async () => undefined } satisfies ProbeDeps,
    lastIds,
    text,
  };
}

describe("ProbeSession", () => {
  it("断线续传后文本一致，积压的段落不计入延迟", async () => {
    const server = fakeServer({ offlineStatusCalls: 2 });
    const session = new ProbeSession("http://server/", server.deps);
    const report = await session.run({ durationS: 1, eventsPerSecond: 20, charsPerEvent: 2 });
    assert.equal(report.mode, "sse");
    assert.equal(report.integrityOk, true);
    assert.equal(report.duplicateOrMissing, 0);
    assert.equal(report.reconnects, 1);
    assert.deepEqual(server.lastIds, [undefined, "p1:4"]);
    assert.equal(report.chars, [...server.text].length);
    assert.ok(report.backlogEvents > 0);
    assert.ok(report.latencyP95Ms !== null && report.latencyP95Ms < 300);
    assert.equal(report.passed, true);
  });

  it("percentile", () => {
    assert.equal(percentile([], 0.5), null);
    assert.equal(percentile([5, 1, 3], 0.5), 3);
    assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
  });
});
