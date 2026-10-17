import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyLanguage } from "../i18n/index.ts";
import {
  ApiClient,
  ApiError,
  describeError,
  describeTurnError,
  type HttpFetch,
  type HttpRequestInit,
  type HttpResponse,
  type RequestRecord,
} from "./client.ts";
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
    assert.deepEqual(await client(fetch, tokens).get("/v1/model-routes"), []);
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

  it("代理返回的错误页（不是 JSON）按状态码给出说明", async () => {
    const { fetch } = scripted([{ status: 502, text: "<html>Bad Gateway</html>" }]);
    await assert.rejects(client(fetch).get("/v1/me"), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "HTTP_502");
      assert.ok(e.retryable);
      assert.equal(describeError(e).split("（")[0], "服务器暂时不可用");
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

  it("网页的 Cookie 模式：认证请求带 X-Auth-Mode，刷新和退出不带请求体", async () => {
    const { fetch, calls } = scripted([
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 204 },
    ]);
    const api = createApi(client(fetch), { authMode: "cookie" });
    await api.auth.login({ email: "lin@example.com", password: "pw" });
    await api.auth.refresh(null);
    await api.auth.logout(null);
    for (const call of calls) {
      assert.equal(call.init.headers["X-Auth-Mode"], "cookie");
      assert.equal(call.init.headers.Authorization, undefined);
    }
    assert.equal(calls[0]?.init.body, JSON.stringify({ email: "lin@example.com", password: "pw" }));
    assert.equal(calls[1]?.init.body, undefined);
    assert.equal(calls[2]?.init.body, undefined);
    // App 不带这个请求头
    const app = scripted([{ status: 200, body: {} }]);
    await createApi(client(app.fetch)).auth.refresh("rt_x");
    assert.equal(app.calls[0]?.init.headers["X-Auth-Mode"], undefined);
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

describe("请求单号", () => {
  function recorded(fetch: HttpFetch) {
    const records: RequestRecord[] = [];
    let n = 0;
    const api = new ApiClient({
      baseUrl: () => "http://server",
      fetch,
      clientVersion: "test",
      onRequest: (record) => records.push(record),
      newRequestId: () => `req-${String((n += 1)).padStart(8, "0")}`,
    });
    return { api, records };
  }

  it("每个请求带一个新的单号，结束时报告状态、耗时、错误码", async () => {
    const { fetch, calls } = scripted([
      { status: 200, body: { ok: true } },
      problem(409, "TURN_IN_PROGRESS", "上一轮还在生成中"),
    ]);
    const { api, records } = recorded(fetch);
    await api.get("/v1/playthroughs?limit=20");
    await assert.rejects(api.post("/v1/playthroughs/p1/turns", {}));
    assert.equal(calls[0]?.init.headers["X-Request-ID"], "req-00000001");
    assert.equal(calls[1]?.init.headers["X-Request-ID"], "req-00000002");
    assert.deepEqual(
      records.map((r) => [r.method, r.path, r.status, r.code, r.requestId]),
      [
        ["GET", "/v1/playthroughs", 200, null, "req-00000001"],
        ["POST", "/v1/playthroughs/p1/turns", 409, "TURN_IN_PROGRESS", "req-00000002"],
      ],
    );
    assert.ok(records.every((r) => r.durationMs >= 0));
  });

  it("错误带单号：优先用服务端错误体里的，连不上时用自己生成的", async () => {
    const { fetch } = scripted([
      problem(500, "INTERNAL_ERROR", "服务端出错了", { request_id: "server-side-id-1" }),
      new TypeError("Network request failed"),
    ]);
    const { api, records } = recorded(fetch);
    const internal = await api.get("/v1/me").catch((e: unknown) => e);
    const offline = await api.get("/v1/me").catch((e: unknown) => e);
    assert.ok(internal instanceof ApiError && offline instanceof ApiError);
    assert.equal(internal.requestId, "server-side-id-1");
    assert.equal(offline.requestId, "req-00000002");
    assert.equal(records[1]?.status, 0);
    assert.equal(records[1]?.code, "NETWORK");
  });

  it("意外的错误在提示里附上单号的前 8 位，业务错误不附", async () => {
    const network = new ApiError("Can't reach the server", {
      status: 0,
      code: "NETWORK",
      retryable: true,
      requestId: "9f2c4e1a7b3d",
    });
    const garbled = new ApiError("Unreadable response", {
      status: 200,
      code: "BAD_RESPONSE",
      retryable: false,
      requestId: "abcdef1234",
    });
    const conflict = serverError(409, "TURN_IN_PROGRESS", "The previous turn is still being written");
    assert.equal(describeError(network), "连不上服务器，请检查网络和服务器地址（单号 9f2c4e1a）");
    assert.equal(describeError(garbled), "服务器返回的内容无法解析（单号 abcdef12）");
    assert.equal(describeError(conflict), "上一段还在写");
  });
});

function serverError(
  status: number,
  code: string,
  title: string,
  extra: Record<string, unknown> = {},
): ApiError {
  return new ApiError(title, {
    status,
    code,
    retryable: false,
    problem: { type: "about:blank", title, status, code, retryable: false, ...extra },
    requestId: "r1",
  });
}

describe("错误说明按错误码翻译", () => {
  it("中文界面：按错误码、按字段，没有对应翻译时按状态码", () => {
    assert.equal(describeError(serverError(409, "EMAIL_TAKEN", "Email taken")), "这个邮箱已经注册过了");
    const field = serverError(422, "VALIDATION_ERROR", "Enter a name", { field: "protagonist_name" });
    assert.equal(describeError(field), "请填写主角的名字");
    const unknownField = serverError(422, "VALIDATION_ERROR", "Bad thing", { field: "mystery" });
    assert.equal(describeError(unknownField), "填写的内容有误");
    assert.equal(describeError(serverError(418, "TEAPOT", "I'm a teapot")), "服务器返回了错误（HTTP 418）");
  });

  it("英文界面：没有对应翻译时用服务端的英文说明", () => {
    applyLanguage("en");
    try {
      assert.equal(
        describeError(serverError(409, "EMAIL_TAKEN", "Email taken")),
        "That email is already registered.",
      );
      const unknownField = serverError(422, "VALIDATION_ERROR", "Tags can have at most 32 items", {
        field: "tags",
      });
      assert.equal(describeError(unknownField), "Tags can have at most 32 items");
      assert.equal(describeError(serverError(418, "TEAPOT", "I'm a teapot")), "I'm a teapot");
      const network = new ApiError("x", {
        status: 0,
        code: "NETWORK",
        retryable: true,
        requestId: "9f2c4e1a7b",
      });
      assert.equal(
        describeError(network),
        "Can't reach the server. Check your network and the server address. (ref 9f2c4e1a)",
      );
    } finally {
      applyLanguage("zh");
    }
  });

  it("回合失败：先看原因，再看失败码", () => {
    const billing = { code: "PROVIDER_ERROR", message: "Out of credit", reason: "billing" };
    assert.equal(describeTurnError(billing), "模型服务商提示额度不足或欠费");
    assert.equal(
      describeTurnError({ code: "PROVIDER_ERROR", message: "x", reason: null }),
      "模型服务出错了，请稍后重试",
    );
    assert.equal(
      describeTurnError({ code: "STORY_ENDED", message: "x" }),
      "这个故事已经写完结局，不能再继续了",
    );
    assert.equal(describeTurnError({ code: "SOMETHING_NEW", message: "Server said so" }), "生成失败");
    applyLanguage("en");
    try {
      assert.equal(describeTurnError({ code: "SOMETHING_NEW", message: "Server said so" }), "Server said so");
      assert.equal(
        describeTurnError(billing),
        "The model provider says you're out of credit or have an unpaid balance.",
      );
    } finally {
      applyLanguage("zh");
    }
  });
});
