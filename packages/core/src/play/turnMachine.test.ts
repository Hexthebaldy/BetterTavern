import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TurnEvent } from "../api/types.ts";
import { makeTurn, opts } from "./testing.ts";
import {
  actionNote,
  canAct,
  canRetry,
  canSubmit,
  displayAction,
  headTurn,
  initialPlayState,
  isBusy,
  isEnded,
  needsOpening,
  rollbackStatus,
  playReducer,
  retryAction,
  unsentSubmission,
  type PlayEvent,
  type PlayState,
} from "./turnMachine.ts";

function run(events: PlayEvent[], state: PlayState = initialPlayState): PlayState {
  return events.reduce(playReducer, state);
}

const stream = (event: TurnEvent): PlayEvent => ({ type: "stream", event });

/** 服务端为“选第二项”建的回合 */
const chosen = (overrides: Parameters<typeof makeTurn>[1] = {}) =>
  makeTurn(2, {
    status: "generating",
    narrative: "",
    options: [],
    action: { source: "option", text: "乙1", option_id: "o2" },
    ...overrides,
  });

function idleWithTwoTurns(): PlayState {
  return run([{ type: "loaded", turns: [makeTurn(1), makeTurn(0)], active: null, lastFailed: null }]);
}

function submitOption(state: PlayState, optionId = "o2"): PlayState {
  const head = headTurn(state);
  return playReducer(state, {
    type: "submit",
    submission: {
      key: "k1",
      parentTurnId: head?.id ?? null,
      action: { source: "option", option_id: optionId },
    },
    display: displayAction({ source: "option", option_id: optionId }, head?.options ?? []),
  });
}

describe("turnMachine", () => {
  it("加载后按 seq 排好，空闲且可以行动", () => {
    const state = idleWithTwoTurns();
    assert.equal(state.phase, "idle");
    assert.deepEqual(
      state.turns.map((t) => t.seq),
      [0, 1],
    );
    assert.ok(canAct(state));
    assert.ok(!needsOpening(state));
    assert.equal(headTurn(state)?.seq, 1);
  });

  it("加载时记下标题、主角名、剧本和这一局的语言；重新加载没带的字段保留原值", () => {
    assert.equal(initialPlayState.language, "zh");
    let state = run([
      {
        type: "loaded",
        turns: [makeTurn(0)],
        active: null,
        lastFailed: null,
        title: "雨夜渡口",
        protagonist: "林川",
        scenarioId: "s1",
        language: "ja",
      },
    ]);
    const fields = (s: typeof state) => [s.title, s.protagonist, s.scenarioId, s.language];
    assert.deepEqual(fields(state), ["雨夜渡口", "林川", "s1", "ja"]);
    state = playReducer(state, { type: "loaded", turns: [makeTurn(0)], active: null, lastFailed: null });
    assert.deepEqual(fields(state), ["雨夜渡口", "林川", "s1", "ja"]);
  });

  it("有进行中的回合就进入 streaming，叙述从空开始拼（事件流会从头重放）", () => {
    const active = makeTurn(2, { status: "generating", narrative: "旧的半截", options: [] });
    const state = run([{ type: "loaded", turns: [makeTurn(0), makeTurn(1)], active, lastFailed: null }]);
    assert.equal(state.phase, "streaming");
    assert.equal(state.pending?.turnId, active.id);
    assert.equal(state.pending?.narrative, "");
    assert.ok(isBusy(state) && !canAct(state));
  });

  it("进行中的回合已经出现在历史里（取详情和取历史之间完成了）就不再当作进行中", () => {
    const done = makeTurn(1);
    const state = run([
      {
        type: "loaded",
        turns: [makeTurn(0), done],
        active: { ...done, status: "generating" },
        lastFailed: null,
      },
    ]);
    assert.equal(state.phase, "idle");
    assert.equal(state.pending, null);
  });

  it("上一轮失败：显示半截叙述和错误，重试等于用同一个行动重新生成", () => {
    const failed = makeTurn(2, {
      status: "failed",
      narrative: "写到一半",
      action: { source: "option", text: "乙1", option_id: "o2" },
      error: { code: "PROVIDER_TIMEOUT", message: "模型响应超时", retryable: true },
    });
    const state = run([
      { type: "loaded", turns: [makeTurn(0), makeTurn(1)], active: null, lastFailed: failed },
    ]);
    assert.equal(state.phase, "failed");
    assert.equal(state.pending?.narrative, "写到一半");
    assert.ok(canRetry(state) && canSubmit(state));
    assert.deepEqual(retryAction(state), { source: "option", option_id: "o2" });
    assert.equal(unsentSubmission(state), null); // 服务端已经接收过：重试要用新键
  });

  it("一轮完整的提交：先显示玩家行动，流式追加叙述，完成后成为新的头部", () => {
    let state = submitOption(idleWithTwoTurns());
    assert.equal(state.phase, "submitting");
    assert.deepEqual(state.pending?.action, { source: "option", text: "乙1", option_id: "o2" });
    const turn = chosen();
    state = run(
      [
        { type: "submitted", turn },
        stream({ event: "turn.created", data: { turn_id: turn.id, seq: 2, attempt: 1 } }),
        stream({ event: "narrative.delta", data: { text: "雨停了，" } }),
        stream({ event: "narrative.delta", data: { text: "我推开门。" } }),
        stream({ event: "narrative.done", data: { chars: 9 } }),
        stream({ event: "options.ready", data: { options: opts(2), source: "model" } }),
      ],
      state,
    );
    assert.equal(state.phase, "streaming");
    assert.equal(state.pending?.narrative, "雨停了，我推开门。");
    assert.equal(state.pending?.options.length, 2);
    state = playReducer(
      state,
      stream({
        event: "turn.completed",
        data: {
          turn: {
            id: turn.id,
            seq: 2,
            attempt: 1,
            status: "committed",
            narrative: "雨停了，我推开门。",
            options: opts(2),
            options_source: "model",
            state_seq: -1,
          },
          usage: null,
        },
      }),
    );
    assert.equal(state.phase, "idle");
    assert.equal(state.pending, null);
    assert.equal(state.submission, null);
    assert.equal(headTurn(state)?.id, turn.id);
    assert.equal(headTurn(state)?.action.text, "乙1");
    assert.ok(canAct(state));
  });

  it("连接状态只在进行中时生效", () => {
    let state = playReducer(submitOption(idleWithTwoTurns()), {
      type: "submitted",
      turn: makeTurn(2, { status: "generating" }),
    });
    state = playReducer(state, { type: "connection", state: "reconnecting" });
    assert.equal(state.phase, "reconnecting");
    state = playReducer(state, { type: "connection", state: "open" });
    assert.equal(state.phase, "streaming");
    state = playReducer(state, { type: "connection", state: "polling" });
    assert.equal(state.phase, "polling");
    const idle = idleWithTwoTurns();
    assert.equal(playReducer(idle, { type: "connection", state: "reconnecting" }), idle);
  });

  it("世界构建的提示", () => {
    let state = playReducer(submitOption(idleWithTwoTurns()), {
      type: "submitted",
      turn: makeTurn(2, { status: "generating" }),
    });
    state = playReducer(state, stream({ event: "world.building", data: {} }));
    assert.ok(state.pending?.buildingWorld);
    state = playReducer(state, stream({ event: "world.ready", data: { source: "model", entities: 5 } }));
    assert.ok(!state.pending?.buildingWorld);
  });

  it("导演先查旧回合时提示“正在回想”，叙述一到就不再提示", () => {
    let state = playReducer(submitOption(idleWithTwoTurns()), {
      type: "submitted",
      turn: makeTurn(2, { status: "generating" }),
    });
    assert.ok(!state.pending?.recalling);
    state = playReducer(state, stream({ event: "director.recalling", data: { round: 1 } }));
    assert.ok(state.pending?.recalling);
    state = playReducer(state, stream({ event: "narrative.delta", data: { text: "雨停了。" } }));
    assert.ok(!state.pending?.recalling);
    assert.equal(state.pending?.narrative, "雨停了。");
  });

  it("生成失败保留半截叙述，可以重试", () => {
    const turn = chosen();
    const state = run(
      [
        { type: "submitted", turn },
        stream({ event: "narrative.delta", data: { text: "半截" } }),
        stream({
          event: "turn.failed",
          data: { code: "PROVIDER_ERROR", message: "模型出错", retryable: true, partial: true },
        }),
      ],
      submitOption(idleWithTwoTurns()),
    );
    assert.equal(state.phase, "failed");
    assert.equal(state.pending?.narrative, "半截");
    assert.equal(state.error?.code, "PROVIDER_ERROR");
    assert.ok(canRetry(state));
    assert.deepEqual(retryAction(state), { source: "option", option_id: "o2" });
    assert.equal(unsentSubmission(state), null);
  });

  it("请求没送达：保留行动和幂等键，重试沿用原来的键；关掉错误回到空闲", () => {
    const state = playReducer(submitOption(idleWithTwoTurns()), {
      type: "submit_failed",
      error: { code: "NETWORK", message: "连不上服务器", retryable: true },
    });
    assert.equal(state.phase, "failed");
    assert.equal(unsentSubmission(state)?.key, "k1");
    assert.ok(canRetry(state));
    const dismissed = playReducer(state, { type: "dismiss_error" });
    assert.equal(dismissed.phase, "idle");
    assert.equal(dismissed.pending, null);
    assert.equal(dismissed.submission, null);
    assert.ok(canAct(dismissed));
  });

  it("不可重试的错误不给重试按钮，但可以换一个行动", () => {
    const state = playReducer(submitOption(idleWithTwoTurns()), {
      type: "submit_failed",
      error: { code: "ROUTE_MISSING", message: "还没有配置导演用的模型", retryable: false },
    });
    assert.ok(!canRetry(state));
    assert.ok(canSubmit(state));
  });

  it("故事被别处推进：进入 syncing，等重新加载", () => {
    const state = playReducer(submitOption(idleWithTwoTurns()), { type: "stale" });
    assert.equal(state.phase, "syncing");
    assert.equal(state.pending, null);
    assert.ok(isBusy(state));
  });

  it("轮询到终态：完成或失败", () => {
    const turn = makeTurn(2, { status: "generating" });
    const base = run(
      [
        { type: "submitted", turn },
        { type: "connection", state: "polling" },
      ],
      submitOption(idleWithTwoTurns()),
    );
    assert.equal(base.phase, "polling");
    assert.equal(playReducer(base, { type: "polled", turn }), base);
    const done = playReducer(base, {
      type: "polled",
      turn: { ...turn, status: "committed", narrative: "完整" },
    });
    assert.equal(done.phase, "idle");
    assert.equal(headTurn(done)?.narrative, "完整");
    const failed = playReducer(base, {
      type: "polled",
      turn: {
        ...turn,
        status: "failed",
        narrative: "半",
        error: { code: "RUNNER_LOST", message: "中止", retryable: true },
      },
    });
    assert.equal(failed.phase, "failed");
    assert.equal(failed.pending?.narrative, "半");
    assert.equal(failed.error?.code, "RUNNER_LOST");
    // 别的回合的轮询结果不影响当前状态
    assert.equal(playReducer(base, { type: "polled", turn: makeTurn(9) }), base);
  });

  it("缓冲过期时的快照替换已拼的叙述", () => {
    const state = run(
      [
        { type: "submitted", turn: makeTurn(2, { status: "generating" }) },
        stream({ event: "narrative.delta", data: { text: "重复的" } }),
        stream({ event: "snapshot", data: { narrative: "完整的叙述", options: opts(2), source: "model" } }),
      ],
      submitOption(idleWithTwoTurns()),
    );
    assert.equal(state.pending?.narrative, "完整的叙述");
    assert.equal(state.pending?.options.length, 2);
  });

  it("没有开场：显示生成开场；开场失败后重试仍是开场", () => {
    const empty = run([{ type: "loaded", turns: [], active: null, lastFailed: null }]);
    assert.ok(needsOpening(empty) && !canAct(empty));
    const opening = playReducer(empty, {
      type: "submit",
      submission: { key: "k", parentTurnId: null, action: { source: "opening" } },
      display: displayAction({ source: "opening" }, []),
    });
    const failed = run(
      [
        { type: "submitted", turn: makeTurn(0, { status: "generating" }) },
        stream({
          event: "turn.failed",
          data: { code: "WORLD_BUILD_FAILED", message: "构建失败", retryable: true },
        }),
      ],
      opening,
    );
    assert.ok(!needsOpening(failed));
    assert.deepEqual(retryAction(failed), { source: "opening" });
  });

  it("加载失败是单独的状态：不能提交，只能重新加载", () => {
    const state = playReducer(initialPlayState, {
      type: "load_failed",
      error: { code: "NETWORK", message: "连不上服务器", retryable: true },
    });
    assert.equal(state.phase, "load_failed");
    assert.ok(!canSubmit(state) && !canRetry(state) && !needsOpening(state));
  });

  it("自由输入直接显示原文；选项按 id 找文字", () => {
    assert.deepEqual(displayAction({ source: "text", text: "我坐下" }, []), {
      source: "text",
      text: "我坐下",
    });
    assert.deepEqual(displayAction({ source: "option", option_id: "o1" }, opts(3)), {
      source: "option",
      text: "甲3",
      option_id: "o1",
    });
  });

  it("写结局：先显示“写结局”，完成后故事结束，不能再提交任何行动", () => {
    const action = { source: "ending" as const, text: "  和阿苓离开  " };
    let state = playReducer(idleWithTwoTurns(), {
      type: "submit",
      submission: { key: "k-end", parentTurnId: "t1", action },
      display: displayAction(action, []),
    });
    assert.deepEqual(state.pending?.action, { source: "ending", text: "和阿苓离开" });
    assert.equal(actionNote(state.pending?.action ?? null), "写结局：和阿苓离开");
    const turn = makeTurn(2, {
      status: "generating",
      narrative: "",
      options: [],
      action: { source: "ending", text: "和阿苓离开" },
    });
    state = run(
      [
        { type: "submitted", turn },
        stream({ event: "narrative.delta", data: { text: "雨停了。" } }),
        stream({ event: "options.ready", data: { options: [], source: null } }),
        stream({
          event: "turn.completed",
          data: {
            turn: {
              id: turn.id,
              seq: 2,
              attempt: 1,
              status: "committed",
              narrative: "雨停了。",
              options: [],
              options_source: null,
              state_seq: -1,
            },
            usage: null,
          },
        }),
      ],
      state,
    );
    assert.equal(state.phase, "idle");
    assert.deepEqual(headTurn(state)?.options, []);
    assert.ok(isEnded(state));
    assert.ok(!canAct(state) && !canSubmit(state));
  });

  it("重新打开已完结的故事：最新一段是结局", () => {
    const ending = makeTurn(2, { options: [], options_source: null, action: { source: "ending", text: "" } });
    const state = run([
      { type: "loaded", turns: [makeTurn(0), makeTurn(1), ending], active: null, lastFailed: null },
    ]);
    assert.ok(isEnded(state) && !canAct(state));
    assert.ok(!isEnded(idleWithTwoTurns()));
  });

  it("结局写失败：故事没有结束，重试仍是写结局，也可以换个行动", () => {
    const failed = makeTurn(2, {
      status: "failed",
      narrative: "",
      options: [],
      action: { source: "ending", text: "圆满" },
      error: { code: "PROVIDER_ERROR", message: "模型服务暂时繁忙", retryable: true },
    });
    const state = run([
      { type: "loaded", turns: [makeTurn(0), makeTurn(1)], active: null, lastFailed: failed },
    ]);
    assert.ok(!isEnded(state));
    assert.deepEqual(retryAction(state), { source: "ending", text: "圆满" });
    assert.ok(canRetry(state) && canSubmit(state));
  });

  it("“我的行动”那一行：开场没有，结局没写方向时只写“写结局”", () => {
    assert.equal(actionNote({ source: "opening", text: "" }), null);
    assert.equal(actionNote({ source: "ending", text: "" }), "写结局");
    assert.equal(actionNote({ source: "text", text: "我坐下" }), "我坐下");
    assert.equal(actionNote(null), null);
  });
});

describe("回到更早的一段", () => {
  it("入口的样子：能用、正在生成、次数用完、还没有更早的一段", () => {
    const loaded = run([
      { type: "loaded", turns: [makeTurn(1), makeTurn(0)], active: null, lastFailed: null, rollbacksLeft: 1 },
    ]);
    assert.equal(rollbackStatus(loaded), "ready");
    assert.equal(rollbackStatus({ ...loaded, phase: "streaming" }), "busy");
    assert.equal(rollbackStatus({ ...loaded, rollbacksLeft: 0 }), "used_up");
    assert.equal(rollbackStatus({ ...loaded, turns: loaded.turns.slice(0, 1) }), "none");
    // 加载时没给次数（旧的事件）就沿用之前的
    assert.equal(idleWithTwoTurns().rollbacksLeft, 0);
  });
});
