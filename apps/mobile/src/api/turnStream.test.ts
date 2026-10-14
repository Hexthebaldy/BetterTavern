import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PlaySession } from "../features/play/playSession.ts";
import { makeTurn } from "../features/play/testing.ts";
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
