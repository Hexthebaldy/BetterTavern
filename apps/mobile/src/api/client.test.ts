import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiClient, ApiError, type HttpFetch, type HttpRequestInit, type HttpResponse } from "./client.ts";
import { createApi } from "./endpoints.ts";

type Reply = { status: number; body?: unknown; text?: string } | Error | "hang";

function scripted(replies: Reply[]): { fetch: HttpFetch; calls: { url: string; init: HttpRequestInit }[] } {
  const calls: { url: string; init: HttpRequestInit }[] = [];
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (reply === undefined) throw new Error("脚本用完了");
    if (reply instanceof Error) throw reply;
    if (reply === "hang") {
      return new Promise<HttpResponse>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
    }
    const text = reply.text ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: () => null },
      text: async () => text,
    };
  };
  return { fetch, calls };
}

const problem = (status: number, code: string, title: string, extra: object = {}) => ({
  status,
  body: { type: "about:blank", title, status, code, retryable: false, ...extra },
});

function client(fetch: HttpFetch, tokens = { current: "t1", next: "t2", refreshes: 0, ok: true }) {
  return new ApiClient({
    baseUrl: () => "http://server",
    fetch,
    clientVersion: "test",
    auth: {
      accessToken: async () => tokens.current,
      refresh: async () => {
        tokens.refreshes += 1;
        if (tokens.ok) tokens.current = tokens.next;
        return tokens.ok;
      },
    },
  });
}

describe("ApiClient", () => {
  it("带上令牌和客户端版本，解析 JSON", async () => {
    const { fetch, calls } = scripted([{ status: 200, body: { id: "u1" } }]);
    const data = await client(fetch).get<{ id: string }>("/v1/me");
    assert.deepEqual(data, { id: "u1" });
    assert.equal(calls[0]?.url, "http://server/v1/me");
    assert.equal(calls[0]?.init.headers.Authorization, "Bearer t1");
    assert.equal(calls[0]?.init.headers["X-Client-Version"], "test");
  });

  it("401 时刷新一次令牌再重试", async () => {
    const tokens = { current: "old", next: "new", refreshes: 0, ok: true };
    const { fetch, calls } = scripted([
      problem(401, "UNAUTHENTICATED", "登录已过期"),
      { status: 200, body: [] },
    ]);
    assert.deepEqual(await client(fetch, tokens).get("/v1/credentials"), []);
    assert.equal(tokens.refreshes, 1);
    assert.deepEqual(
      calls.map((c) => c.init.headers.Authorization),
      ["Bearer old", "Bearer new"],
    );
  });

  it("刷新失败就把 401 交给调用方", async () => {
    const tokens = { current: "old", next: "new", refreshes: 0, ok: false };
    const { fetch, calls } = scripted([problem(401, "UNAUTHENTICATED", "登录已过期")]);
    await assert.rejects(
      client(fetch, tokens).get("/v1/me"),
      (e: unknown) => e instanceof ApiError && e.status === 401,
    );
    assert.equal(calls.length, 1);
  });

  it("problem+json 变成带错误码和附加字段的 ApiError", async () => {
    const { fetch } = scripted([
      problem(409, "TURN_IN_PROGRESS", "上一轮还在生成中", { active_turn_id: "t9" }),
    ]);
    await assert.rejects(client(fetch).post("/v1/playthroughs/p/turns", {}), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 409);
      assert.equal(e.code, "TURN_IN_PROGRESS");
      assert.equal(e.message, "上一轮还在生成中");
      assert.equal(e.field("active_turn_id"), "t9");
      return true;
    });
  });

  it("代理返回的错误页（不是 JSON）按状态码给出中文说明", async () => {
    const { fetch } = scripted([{ status: 502, text: "<html>Bad Gateway</html>" }]);
    await assert.rejects(client(fetch).get("/v1/me"), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "HTTP_502");
      assert.ok(e.retryable);
      return true;
    });
  });

  it("网络不通和超时都是 status 0、可重试", async () => {
    const offline = scripted([new TypeError("Network request failed")]);
    await assert.rejects(client(offline.fetch).get("/v1/me"), (e: unknown) => {
      assert.ok(e instanceof ApiError && e.isNetwork && e.retryable);
      assert.equal(e.code, "NETWORK");
      return true;
    });
    const slow = scripted(["hang"]);
    const api = new ApiClient({
      baseUrl: () => "http://server",
      fetch: slow.fetch,
      clientVersion: "test",
      timeoutMs: 20,
    });
    await assert.rejects(api.get("/v1/me", { auth: false }), (e: unknown) => {
      assert.ok(e instanceof ApiError && e.isNetwork && e.timedOut);
      assert.equal(e.code, "TIMEOUT");
      return true;
    });
  });

  it("204 没有响应体；登录等接口不带令牌", async () => {
    const { fetch, calls } = scripted([{ status: 204 }]);
    const api = createApi(client(fetch));
    assert.equal(await api.auth.logout("rt_x"), undefined);
    assert.equal(calls[0]?.init.headers.Authorization, undefined);
    assert.equal(calls[0]?.init.body, JSON.stringify({ refresh_token: "rt_x" }));
  });

  it("提交行动带 Idempotency-Key；历史接口取出 turns", async () => {
    const { fetch, calls } = scripted([
      { status: 201, body: { turn: { id: "t2" }, events_url: "/v1/turns/t2/events" } },
      { status: 200, body: { turns: [{ id: "t1" }] } },
    ]);
    const api = createApi(client(fetch));
    await api.turns.submit(
      "p1",
      { parent_turn_id: "t1", action: { source: "option", option_id: "o1" } },
      "key-1",
    );
    assert.equal(calls[0]?.init.headers["Idempotency-Key"], "key-1");
    const turns = await api.turns.history("p1", 3, 50);
    assert.deepEqual(turns, [{ id: "t1" }]);
    assert.equal(calls[1]?.url, "http://server/v1/playthroughs/p1/turns?after_seq=3&limit=50");
  });
});
