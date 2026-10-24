import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "../api/client.ts";
import type { NewAction, PlaythroughDetail, Turn, TurnEvent } from "../api/types.ts";
import type { StreamOutcome, TurnStream, TurnStreamHandlers } from "../api/turnStream.ts";
import { PlaySession, type PlayApi } from "./playSession.ts";
import { makeTurn, opts } from "./testing.ts";
import { canRollbackTo, headTurn, turnsAfter } from "./turnMachine.ts";

/** 可以手动推进的假事件流 */
class FakeStream implements TurnStream {
  readonly turnId: string;
  readonly handlers: TurnStreamHandlers;
  lastEventId: string | undefined;
  closed = false;
  private resolve: (outcome: StreamOutcome) => void = () => undefined;
  private readonly done: Promise<StreamOutcome>;
  private seq = 0;

  constructor(turnId: string, handlers: TurnStreamHandlers) {
    this.turnId = turnId;
    this.handlers = handlers;
    this.lastEventId = handlers.lastEventId;
    this.done = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  run(): Promise<StreamOutcome> {
    this.handlers.onState("open");
    return this.done;
  }

  close(): void {
    this.closed = true;
    this.resolve("closed");
  }

  emit(event: TurnEvent): void {
    this.seq += 1;
    this.lastEventId = `${this.turnId}:${this.seq}`;
    this.handlers.onEvent(event);
    if (event.event === "turn.completed" || event.event === "turn.failed") this.resolve("completed");
  }

  finish(outcome: StreamOutcome): void {
    this.resolve(outcome);
  }
}

type Submitted = { body: { parent_turn_id: string | null; action: NewAction }; key: string };

class FakeApi implements PlayApi {
  detailQueue: PlaythroughDetail[] = [];
  historyQueue: Turn[][] = [];
  submitResults: (Turn | Error)[] = [];
  turnResults: (Turn | Error)[] = [];
  submitted: Submitted[] = [];
  cancelled: string[] = [];
  rolledBack: string[] = [];
  rollbackError: Error | null = null;
  detailCalls = 0;

  async detail(): Promise<PlaythroughDetail> {
    this.detailCalls += 1;
    const next = this.detailQueue.length > 1 ? this.detailQueue.shift() : this.detailQueue[0];
    if (!next) throw new Error("没有准备详情");
    return next;
  }

  async history(_id: string, afterSeq: number): Promise<Turn[]> {
    const all = (this.historyQueue.length > 1 ? this.historyQueue.shift() : this.historyQueue[0]) ?? [];
    return all.filter((t) => t.seq > afterSeq);
  }

  async submit(_id: string, body: Submitted["body"], key: string) {
    this.submitted.push({ body, key });
    const next = this.submitResults.shift();
    if (!next) throw new Error("没有准备提交结果");
    if (next instanceof Error) throw next;
    return { turn: next, events_url: `/v1/turns/${next.id}/events` };
  }

  async turn(): Promise<Turn> {
    const next = this.turnResults.shift();
    if (!next) throw new Error("没有准备回合");
    if (next instanceof Error) throw next;
    return next;
  }

  async cancel(turnId: string): Promise<Turn> {
    this.cancelled.push(turnId);
    return makeTurn(9);
  }

  async rollback(_id: string, turnId: string): Promise<PlaythroughDetail> {
    this.rolledBack.push(turnId);
    if (this.rollbackError) throw this.rollbackError;
    return this.detail();
  }
}

function detail(head: Turn | null, extra: Partial<PlaythroughDetail> = {}): PlaythroughDetail {
  return {
    playthrough: {
      id: "p1",
      title: "雨夜",
      status: "active",
      scenario_id: "s1",
      language: "zh",
      mode: "standard",
      protagonist_name: "林川",
      preferences: {},
      head_turn_id: head?.id ?? null,
      head_seq: head?.seq ?? null,
      head_excerpt: "",
      active_turn_id: null,
      state_seq: -1,
      rollbacks_left: 1,
      seed_source: "model",
      created_at: "",
      updated_at: "",
    },
    head,
    active_turn: null,
    last_failed: null,
    ...extra,
  };
}

function setup() {
  const api = new FakeApi();
  const streams: FakeStream[] = [];
  let keys = 0;
  const sleeps: number[] = [];
  const session = new PlaySession("p1", {
    api,
    connect: (turnId, handlers) => {
      const stream = new FakeStream(turnId, handlers);
      streams.push(stream);
      return stream;
    },
    newKey: () => `key-${(keys += 1)}`,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    pollIntervalMs: 1,
  });
  return { api, streams, session, sleeps };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function completed(turn: Turn, narrative = turn.narrative): TurnEvent {
  return {
    event: "turn.completed",
    data: {
      turn: {
        id: turn.id,
        seq: turn.seq,
        attempt: turn.attempt,
        status: "committed",
        narrative,
        options: opts(turn.seq),
        options_source: "model",
        state_seq: -1,
      },
      usage: null,
    },
  };
}

const network = (): ApiError => new ApiError("连不上服务器", { status: 0, code: "NETWORK", retryable: true });

describe("PlaySession", () => {
  it("加载时接上进行中的开场，生成完成后可以行动", async () => {
    const { api, streams, session } = setup();
    const opening = makeTurn(0, { status: "generating", narrative: "", options: [] });
    api.detailQueue = [detail(null, { active_turn: opening })];
    api.historyQueue = [[]];
    await session.load();
    assert.equal(session.getState().phase, "streaming");
    assert.equal(streams.length, 1);
    const stream = streams[0]!;
    assert.equal(stream.turnId, opening.id);
    assert.equal(stream.handlers.lastEventId, undefined); // 从头重放
    stream.emit({ event: "world.building", data: {} });
    stream.emit({ event: "narrative.delta", data: { text: "雨夜，" } });
    stream.emit({ event: "narrative.delta", data: { text: "酒馆里只剩我。" } });
    stream.emit(completed(opening, "雨夜，酒馆里只剩我。"));
    await tick();
    const state = session.getState();
    assert.equal(state.phase, "idle");
    assert.equal(headTurn(state)?.narrative, "雨夜，酒馆里只剩我。");
    assert.equal(state.title, "雨夜");
  });

  it("历史分页拉全", async () => {
    const api = new FakeApi();
    const session = new PlaySession("p1", {
      api,
      connect: (turnId, handlers) => new FakeStream(turnId, handlers),
      newKey: () => "k",
      historyPageSize: 2,
    });
    const turns = [0, 1, 2, 3, 4].map((seq) => makeTurn(seq));
    api.detailQueue = [detail(turns[4]!)];
    api.historyQueue = [turns];
    await session.load();
    assert.deepEqual(
      session.getState().turns.map((t) => t.seq),
      [0, 1, 2, 3, 4],
    );
  });

  it("提交选项：带上头部 id 和幂等键；网络错误用同一个键退避重试", async () => {
    const { api, streams, session, sleeps } = setup();
    const head = makeTurn(1);
    api.detailQueue = [detail(head)];
    api.historyQueue = [[makeTurn(0), head]];
    await session.load();
    const created = makeTurn(2, {
      status: "generating",
      action: { source: "option", text: "乙1", option_id: "o2" },
    });
    api.submitResults = [network(), network(), created];
    await session.submit({ source: "option", option_id: "o2" });
    assert.equal(api.submitted.length, 3);
    assert.ok(api.submitted.every((s) => s.key === "key-1"));
    assert.deepEqual(api.submitted[0]?.body, {
      parent_turn_id: head.id,
      action: { source: "option", option_id: "o2" },
    });
    assert.deepEqual(sleeps, [500, 1000]);
    assert.equal(session.getState().phase, "streaming");
    assert.equal(streams[0]?.turnId, created.id);
    streams[0]!.emit(completed(created, "新的一段"));
    await tick();
    assert.equal(headTurn(session.getState())?.id, created.id);
  });

  it("重试次数用完：失败，重试时沿用原来的键（服务端可能已经收到）", async () => {
    const { api, session } = setup();
    const head = makeTurn(1);
    api.detailQueue = [detail(head)];
    api.historyQueue = [[makeTurn(0), head]];
    await session.load();
    api.submitResults = [network(), network(), network(), network(), network(), network()];
    await session.submit({ source: "text", text: "我坐下" });
    let state = session.getState();
    assert.equal(state.phase, "failed");
    assert.equal(state.error?.code, "NETWORK");
    assert.deepEqual(state.pending?.action, { source: "text", text: "我坐下" });
    const replayed = makeTurn(2, { status: "generating", action: { source: "text", text: "我坐下" } });
    api.submitResults = [replayed];
    await session.retry();
    state = session.getState();
    assert.equal(state.phase, "streaming");
    assert.equal(api.submitted.at(-1)?.key, "key-1");
  });

  it("生成失败后重试：用新键重新生成同一个行动", async () => {
    const { api, streams, session } = setup();
    const head = makeTurn(1);
    api.detailQueue = [detail(head)];
    api.historyQueue = [[makeTurn(0), head]];
    await session.load();
    const first = makeTurn(2, {
      status: "generating",
      action: { source: "option", text: "甲1", option_id: "o1" },
    });
    api.submitResults = [first];
    await session.submit({ source: "option", option_id: "o1" });
    streams[0]!.emit({
      event: "turn.failed",
      data: { code: "PROVIDER_ERROR", message: "模型出错", retryable: true },
    });
    await tick();
    assert.equal(session.getState().phase, "failed");
    const second = makeTurn(2, { status: "generating", attempt: 2, action: first.action });
    api.submitResults = [second];
    await session.retry();
    assert.equal(api.submitted.length, 2);
    assert.equal(api.submitted[1]?.key, "key-2");
    assert.deepEqual(api.submitted[1]?.body.action, { source: "option", option_id: "o1" });
    assert.equal(streams[1]?.turnId, second.id);
  });

  it("409 TURN_IN_PROGRESS：接上正在生成的那一轮", async () => {
    const { api, streams, session } = setup();
    const head = makeTurn(1);
    api.detailQueue = [detail(head)];
    api.historyQueue = [[makeTurn(0), head]];
    await session.load();
    const other = makeTurn(2, {
      status: "generating",
      action: { source: "text", text: "另一台设备上的行动" },
    });
    api.submitResults = [
      new ApiError("上一轮还在生成中", {
        status: 409,
        code: "TURN_IN_PROGRESS",
        retryable: false,
        problem: {
          type: "about:blank",
          title: "上一轮还在生成中",
          status: 409,
          code: "TURN_IN_PROGRESS",
          active_turn_id: other.id,
        },
      }),
    ];
    api.turnResults = [other];
    await session.submit({ source: "option", option_id: "o1" });
    const state = session.getState();
    assert.equal(state.phase, "streaming");
    assert.equal(state.pending?.turnId, other.id);
    assert.equal(state.pending?.action?.text, "另一台设备上的行动");
    assert.equal(streams[0]?.turnId, other.id);
  });

  it("409 STALE_PARENT：重新加载拿到最新的头部", async () => {
    const { api, session } = setup();
    const head = makeTurn(1);
    const newer = makeTurn(2);
    api.detailQueue = [detail(head), detail(newer)];
    api.historyQueue = [
      [makeTurn(0), head],
      [makeTurn(0), head, newer],
    ];
    await session.load();
    api.submitResults = [
      new ApiError("故事已经更新，请先刷新", { status: 409, code: "STALE_PARENT", retryable: false }),
    ];
    await session.submit({ source: "option", option_id: "o1" });
    const state = session.getState();
    assert.equal(state.phase, "idle");
    assert.equal(headTurn(state)?.id, newer.id);
    assert.equal(api.detailCalls, 2);
  });

  it("回到更早的一回合：撤销之后的回合，重新加载", async () => {
    const { api, session } = setup();
    const [t0, t1, t2] = [makeTurn(0), makeTurn(1), makeTurn(2)];
    const after = detail(t1);
    after.playthrough.rollbacks_left = 0;
    api.detailQueue = [detail(t2), after];
    api.historyQueue = [
      [t0, t1, t2],
      [t0, t1],
    ];
    await session.load();
    let state = session.getState();
    assert.ok(canRollbackTo(state, t1.id) && canRollbackTo(state, t0.id));
    assert.ok(!canRollbackTo(state, t2.id), "最新一回合不能回退");
    assert.equal(turnsAfter(state, t0.id), 2);
    assert.equal(await session.rollback(t1.id), null);
    assert.deepEqual(api.rolledBack, [t1.id]);
    state = session.getState();
    assert.equal(headTurn(state)?.id, t1.id);
    assert.equal(state.rollbacksLeft, 0);
    // 次数用完：不再发请求
    assert.ok(!canRollbackTo(state, t0.id));
    assert.equal(await session.rollback(t0.id), null);
    assert.deepEqual(api.rolledBack, [t1.id]);
  });

  it("服务端拒绝回退：返回原因，并重新加载和服务端保持一致", async () => {
    const { api, session } = setup();
    const [t0, t1] = [makeTurn(0), makeTurn(1)];
    api.detailQueue = [detail(t1)];
    api.historyQueue = [[t0, t1]];
    await session.load();
    api.rollbackError = new ApiError("No rollbacks left", {
      status: 409,
      code: "ROLLBACK_LIMIT_REACHED",
      retryable: false,
    });
    const failure = await session.rollback(t0.id);
    assert.equal(failure?.code, "ROLLBACK_LIMIT_REACHED");
    assert.equal(api.detailCalls, 2);
  });

  it("不可重试的错误（没有配置模型）：失败且不给重试", async () => {
    const { api, session } = setup();
    api.detailQueue = [detail(null)];
    api.historyQueue = [[]];
    await session.load();
    api.submitResults = [
      new ApiError("还没有配置导演用的模型", { status: 409, code: "ROUTE_MISSING", retryable: false }),
    ];
    await session.submit({ source: "opening" });
    const state = session.getState();
    assert.equal(state.phase, "failed");
    assert.equal(state.error?.code, "ROUTE_MISSING");
    assert.equal(state.error?.retryable, false);
  });

  it("事件流转轮询：查到终态为止", async () => {
    const { api, streams, session } = setup();
    const active = makeTurn(2, { status: "generating", narrative: "", options: [] });
    api.detailQueue = [detail(makeTurn(1), { active_turn: active })];
    api.historyQueue = [[makeTurn(0), makeTurn(1)]];
    await session.load();
    api.turnResults = [
      active,
      network(),
      { ...active, status: "committed", narrative: "轮询拿到的叙述", options: opts(2) },
    ];
    streams[0]!.finish("polling");
    for (let i = 0; i < 20 && session.getState().phase !== "idle"; i += 1) await tick();
    const state = session.getState();
    assert.equal(state.phase, "idle");
    assert.equal(headTurn(state)?.narrative, "轮询拿到的叙述");
  });

  it("流说结束了但没送来能用的终止事件：转轮询拿结果，不会卡在生成中", async () => {
    const { api, streams, session } = setup();
    const active = makeTurn(2, { status: "generating", narrative: "", options: [] });
    api.detailQueue = [detail(makeTurn(1), { active_turn: active })];
    api.historyQueue = [[makeTurn(0), makeTurn(1)]];
    await session.load();
    api.turnResults = [{ ...active, status: "committed", narrative: "完整的一段", options: opts(2) }];
    streams[0]!.emit({ event: "narrative.delta", data: { text: "完整的" } });
    streams[0]!.finish("completed");
    for (let i = 0; i < 20 && session.getState().phase !== "idle"; i += 1) await tick();
    const state = session.getState();
    assert.equal(state.phase, "idle");
    assert.equal(headTurn(state)?.narrative, "完整的一段");
  });

  it("回到前台时，正在重连的流立即带 Last-Event-ID 重连", async () => {
    const { api, streams, session } = setup();
    const active = makeTurn(2, { status: "generating", narrative: "", options: [] });
    api.detailQueue = [detail(makeTurn(1), { active_turn: active })];
    api.historyQueue = [[makeTurn(0), makeTurn(1)]];
    await session.load();
    const first = streams[0]!;
    first.emit({ event: "narrative.delta", data: { text: "前半段" } });
    first.handlers.onState("reconnecting");
    assert.equal(session.getState().phase, "reconnecting");
    session.resume();
    assert.ok(first.closed);
    const second = streams[1]!;
    assert.equal(second.handlers.lastEventId, first.lastEventId);
    second.emit({ event: "narrative.delta", data: { text: "后半段" } });
    assert.equal(session.getState().pending?.narrative, "前半段后半段");
    // 旧连接迟到的事件被忽略
    first.handlers.onEvent({ event: "narrative.delta", data: { text: "重复" } });
    assert.equal(session.getState().pending?.narrative, "前半段后半段");
  });

  it("停止生成：调用取消接口，结果由事件流送来", async () => {
    const { api, streams, session } = setup();
    const active = makeTurn(2, { status: "generating", narrative: "", options: [] });
    api.detailQueue = [detail(makeTurn(1), { active_turn: active })];
    api.historyQueue = [[makeTurn(0), makeTurn(1)]];
    await session.load();
    await session.cancel();
    assert.deepEqual(api.cancelled, [active.id]);
    streams[0]!.emit({
      event: "turn.failed",
      data: { code: "CANCELLED", message: "生成已取消", retryable: true },
    });
    await tick();
    assert.equal(session.getState().phase, "failed");
  });

  it("离开页面后关闭连接，之后的事件不再改变状态", async () => {
    const { api, streams, session } = setup();
    const active = makeTurn(2, { status: "generating", narrative: "", options: [] });
    api.detailQueue = [detail(makeTurn(1), { active_turn: active })];
    api.historyQueue = [[makeTurn(0), makeTurn(1)]];
    await session.load();
    const before = session.getState();
    session.dispose();
    assert.ok(streams[0]?.closed);
    streams[0]!.handlers.onEvent({ event: "narrative.delta", data: { text: "迟到" } });
    assert.equal(session.getState(), before);
  });

  it("加载失败进入 load_failed，重新加载后恢复", async () => {
    const { api, session } = setup();
    await session.load(); // 没有准备详情：抛错
    assert.equal(session.getState().phase, "load_failed");
    api.detailQueue = [detail(makeTurn(0))];
    api.historyQueue = [[makeTurn(0)]];
    await session.load();
    assert.equal(session.getState().phase, "idle");
  });

  it("登录失效时流结束，提示重新登录", async () => {
    const { api, streams, session } = setup();
    const active = makeTurn(2, { status: "generating", narrative: "", options: [] });
    api.detailQueue = [detail(makeTurn(1), { active_turn: active })];
    api.historyQueue = [[makeTurn(0), makeTurn(1)]];
    await session.load();
    streams[0]!.finish("unauthorized");
    await tick();
    const state = session.getState();
    assert.equal(state.phase, "load_failed");
    assert.equal(state.error?.code, "UNAUTHENTICATED");
  });
});
