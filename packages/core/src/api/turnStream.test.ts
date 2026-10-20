import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PlaySession } from "../play/playSession.ts";
import { makeTurn } from "../play/testing.ts";
import { sseTurnConnector } from "./turnStream.ts";
import type { FetchLike } from "./sse/sseClient.ts";

const encoder = new TextEncoder();

function body(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(encoder.encode(next));
    },
  });
}

const COMPLETED =
  'id: T:3\nevent: turn.completed\ndata: {"turn":{"id":"T","seq":1,"attempt":1,"status":"committed",' +
  '"narrative":"我推开门","options":[],"options_source":"model","state_lag":false},"usage":null}\n\n';

describe("回合事件流（SseClient + PlaySession）", () => {
  it("终止事件在流的中途被截断：丢弃半截事件，带 Last-Event-ID 重连拿到完整的结果", async () => {
    const head = makeTurn(0);
    const generating = makeTurn(1, { id: "T", status: "generating", narrative: "" });
    const lastIds: (string | undefined)[] = [];
    const fetch: FetchLike = async (_url, init) => {
      lastIds.push(init.headers["Last-Event-ID"]);
      const chunks =
        lastIds.length === 1
          ? [
              'id: T:1\nevent: turn.created\ndata: {"turn_id":"T","seq":1,"attempt":1}\n\n',
              'id: T:2\nevent: narrative.delta\ndata: {"text":"我推开门"}\n\n',
              'id: T:3\nevent: turn.completed\ndata: {"turn":{"id":"T","seq":1,"narr', // 干净的 EOF
            ]
          : [COMPLETED];
      return { ok: true, status: 200, body: body(chunks) };
    };
    const session = new PlaySession("p1", {
      api: {
        detail: async () => ({
          playthrough: { title: "雨夜" } as never,
          head,
          active_turn: generating,
          last_failed: null,
        }),
        history: async () => [head],
        rollback: async () => {
          throw new Error("不应回退");
        },
        submit: async () => {
          throw new Error("不应提交");
        },
        turn: async () => {
          throw new Error("不应轮询");
        },
        cancel: async () => generating,
      },
      connect: sseTurnConnector({
        url: (id) => `http://server/v1/turns/${id}/events`,
        fetch,
        headers: {},
        onUnauthorized: async () => false,
        sleep: async () => undefined,
      }),
      newKey: () => "k",
      sleep: async () => undefined,
    });
    await session.load();
    for (let i = 0; i < 50 && session.getState().phase !== "idle"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const state = session.getState();
    assert.equal(state.phase, "idle");
    assert.deepEqual(lastIds, [undefined, "T:2"]);
    assert.equal(state.turns.at(-1)?.narrative, "我推开门");
    session.dispose();
  });
});

describe("回合事件流的诊断日志", () => {
  it("每次连接带新的单号；断线、重连、结束都记下来", async () => {
    const ids: (string | undefined)[] = [];
    let calls = 0;
    const fetch: FetchLike = async (_url, init) => {
      ids.push(init.headers["X-Request-ID"]);
      calls += 1;
      if (calls === 1) throw new TypeError("Network request failed");
      return { ok: true, status: 200, body: body([COMPLETED]) };
    };
    const logs: [string, string, Record<string, unknown>][] = [];
    let n = 0;
    const connect = sseTurnConnector({
      url: (id) => `http://server/v1/turns/${id}/events`,
      fetch,
      headers: async () => ({ Authorization: "Bearer t" }),
      onUnauthorized: async () => false,
      sleep: async () => undefined,
      log: (level, event, fields) => logs.push([level, event, fields]),
      newRequestId: () => `sse-${(n += 1)}`,
    });
    const stream = connect("T", { onEvent: () => undefined, onState: () => undefined });
    assert.equal(await stream.run(), "completed");
    assert.deepEqual(ids, ["sse-1", "sse-2"]);
    const error = logs.find(([, event]) => event === "sse.error");
    assert.equal(error?.[0], "warn");
    assert.equal(error?.[2].request_id, "sse-1");
    assert.equal(error?.[2].error, "TypeError");
    const reconnecting = logs.find(([, event, f]) => event === "sse.state" && f.state === "reconnecting");
    assert.equal(reconnecting?.[0], "warn");
    const finished = logs.find(([, event]) => event === "sse.finished");
    assert.deepEqual(finished?.[2], { turn_id: "T", outcome: "completed", reconnects: 1 });
  });
});
