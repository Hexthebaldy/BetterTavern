import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SseClient, type FetchLike, type ResponseLike, type SseClientState } from "./sseClient.ts";
import type { SseMessage } from "./sseParser.ts";

const encoder = new TextEncoder();

type Scripted = { status?: number; chunks?: (string | Error)[]; reject?: Error; hang?: boolean };

/** 按脚本回放的假 fetch：记录每次请求的头。 */
function scriptedFetch(script: Scripted[]): { fetch: FetchLike; calls: Record<string, string>[] } {
  const calls: Record<string, string>[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push(init.headers);
    const step = script.shift();
    if (!step) throw new Error("脚本用完了");
    if (step.reject) throw step.reject;
    const status = step.status ?? 200;
    const chunks = [...(step.chunks ?? [])];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (init.signal.aborted) {
          controller.error(new DOMException("aborted", "AbortError"));
          return;
        }
        const next = chunks.shift();
        if (next === undefined) {
          if (step.hang) {
            return new Promise<void>((resolve) => {
              init.signal.addEventListener(
                "abort",
                () => {
                  controller.error(new DOMException("aborted", "AbortError"));
                  resolve();
                },
                { once: true },
              );
            });
          }
          controller.close();
        } else if (next instanceof Error) {
          controller.error(next);
        } else {
          controller.enqueue(encoder.encode(next));
        }
        return undefined;
      },
    });
    const response: ResponseLike = { ok: status >= 200 && status < 300, status, body };
    return response;
  };
  return { fetch, calls };
}

const event = (id: number, name: string, data: object): string =>
  `id: s:${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

const noSleep = async (): Promise<void> => undefined;

describe("SseClient", () => {
  it("正常读到终止事件就结束", async () => {
    const { fetch } = scriptedFetch([
      {
        chunks: [
          event(1, "narrative.delta", { text: "我" }),
          ": keepalive\n\n",
          event(2, "turn.completed", {}),
        ],
      },
    ]);
    const seen: SseMessage[] = [];
    const states: SseClientState[] = [];
    const client = new SseClient({
      url: "http://x/events",
      fetch,
      onEvent: (m) => seen.push(m),
      onStateChange: (s) => states.push(s),
      sleep: noSleep,
    });
    assert.equal(await client.run(), "completed");
    assert.deepEqual(
      seen.map((m) => m.event),
      ["narrative.delta", "turn.completed"],
    );
    assert.deepEqual(states, ["connecting", "open", "closed"]);
    assert.equal(client.lastEventId, "s:2");
  });

  it("中途断开后带 Last-Event-ID 重连，不重不漏", async () => {
    const { fetch, calls } = scriptedFetch([
      { chunks: [event(1, "narrative.delta", { text: "我" }), new TypeError("network lost")] },
      { chunks: [event(2, "narrative.delta", { text: "推门" }), event(3, "turn.completed", {})] },
    ]);
    const seen: string[] = [];
    const delays: number[] = [];
    const client = new SseClient({
      url: "http://x/events",
      fetch,
      onEvent: (m) => seen.push(m.id ?? ""),
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    assert.equal(await client.run(), "completed");
    assert.deepEqual(seen, ["s:1", "s:2", "s:3"]);
    assert.equal(calls[0]?.["Last-Event-ID"], undefined);
    assert.equal(calls[1]?.["Last-Event-ID"], "s:1");
    assert.deepEqual(delays, [500]);
    assert.equal(client.reconnectCount, 1);
  });

  it("断网不会转轮询：退避 0.5、1、2、4 秒后一直按 10 秒重试，恢复后续传", async () => {
    const offline = (): Scripted => ({ reject: new TypeError("Network request failed") });
    const { fetch, calls } = scriptedFetch([
      offline(),
      offline(),
      offline(),
      offline(),
      offline(),
      offline(),
      { chunks: [event(2, "turn.completed", {})] },
    ]);
    const delays: number[] = [];
    const client = new SseClient({
      url: "http://x/events",
      fetch,
      lastEventId: "s:1",
      onEvent: () => undefined,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    assert.equal(await client.run(), "completed");
    assert.deepEqual(delays, [500, 1000, 2000, 4000, 10000, 10000]);
    assert.ok(calls.every((headers) => headers["Last-Event-ID"] === "s:1"));
  });

  it("连上却拿不到数据（HTTP 错误）连续 3 次转为轮询", async () => {
    const { fetch } = scriptedFetch([{ status: 502 }, { status: 503 }, { status: 502 }]);
    const errors: number[] = [];
    const client = new SseClient({
      url: "http://x/events",
      fetch,
      onEvent: () => undefined,
      onError: (_e, failures) => errors.push(failures),
      sleep: noSleep,
    });
    assert.equal(await client.run(), "polling");
    assert.deepEqual(errors, [1, 2, 3]);
  });

  it("超过空闲时限没有任何字节（被缓冲或半开连接）算卡住，连续 3 次转轮询", async () => {
    const hang = (): Scripted => ({ chunks: [], hang: true });
    const { fetch } = scriptedFetch([hang(), hang(), hang()]);
    const client = new SseClient({
      url: "http://x/events",
      fetch,
      onEvent: () => undefined,
      idleTimeoutMs: 30,
      sleep: noSleep,
    });
    assert.equal(await client.run(), "polling");
    assert.equal(client.reconnectCount, 2);
  });

  it("keepalive 注释会刷新空闲计时", async () => {
    const { fetch } = scriptedFetch([
      { chunks: [": keepalive\n\n", ": keepalive\n\n", event(1, "turn.completed", {})] },
    ]);
    const client = new SseClient({
      url: "http://x/events",
      fetch,
      onEvent: () => undefined,
      idleTimeoutMs: 1000,
      sleep: noSleep,
    });
    assert.equal(await client.run(), "completed");
  });

  it("收到事件后失败计数清零", async () => {
    const { fetch } = scriptedFetch([
      { status: 502 },
      { status: 502 },
      { chunks: [event(1, "narrative.delta", { text: "a" }), new TypeError("lost")] },
      { status: 502 },
      { status: 502 },
      { chunks: [event(2, "turn.completed", {})] },
    ]);
    const client = new SseClient({ url: "http://x/events", fetch, onEvent: () => undefined, sleep: noSleep });
    assert.equal(await client.run(), "completed");
  });

  it("404（缓冲已过期）直接转轮询", async () => {
    const { fetch } = scriptedFetch([{ status: 404 }]);
    const client = new SseClient({ url: "http://x/events", fetch, onEvent: () => undefined, sleep: noSleep });
    assert.equal(await client.run(), "polling");
  });

  it("连上后一个事件都没有就结束，也算卡住", async () => {
    const { fetch } = scriptedFetch([{ chunks: [] }, { chunks: [] }, { chunks: [] }]);
    const client = new SseClient({ url: "http://x/events", fetch, onEvent: () => undefined, sleep: noSleep });
    assert.equal(await client.run(), "polling");
  });

  it("流在终止事件前正常结束也算断线", async () => {
    const { fetch, calls } = scriptedFetch([
      { chunks: [event(1, "narrative.delta", { text: "a" })] },
      { chunks: [event(2, "turn.completed", {})] },
    ]);
    const client = new SseClient({ url: "http://x/events", fetch, onEvent: () => undefined, sleep: noSleep });
    assert.equal(await client.run(), "completed");
    assert.equal(calls[1]?.["Last-Event-ID"], "s:1");
  });

  it("dropConnection 立即重连且不计失败", async () => {
    const { fetch, calls } = scriptedFetch([
      { chunks: [event(1, "narrative.delta", { text: "a" })], hang: true },
      { chunks: [event(2, "turn.completed", {})] },
    ]);
    const delays: number[] = [];
    const client = new SseClient({
      url: "http://x/events",
      fetch,
      onEvent: (m) => {
        if (m.id === "s:1") setTimeout(() => client.dropConnection(), 0);
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    assert.equal(await client.run(), "completed");
    assert.deepEqual(delays, []);
    assert.equal(calls[1]?.["Last-Event-ID"], "s:1");
  });

  it("close 之后不再重连", async () => {
    const { fetch, calls } = scriptedFetch([
      { chunks: [event(1, "narrative.delta", { text: "a" })], hang: true },
    ]);
    const client = new SseClient({
      url: "http://x/events",
      fetch,
      onEvent: () => setTimeout(() => client.close(), 0),
      sleep: noSleep,
    });
    assert.equal(await client.run(), "closed");
    assert.equal(calls.length, 1);
    assert.equal(client.currentState, "closed");
  });
});
