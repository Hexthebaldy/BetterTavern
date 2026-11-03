import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ApiError } from "../api/client.ts";
import { EMPTY_CHOICE, type SpeechContext, type SpeechLine } from "./speech.ts";
import {
  AudioLoader,
  IDLE_SPEECH,
  SpeechFailure,
  SpeechPlayer,
  speechReason,
  TurnReader,
  type SpeechEngine,
} from "./speechPlayer.ts";
import { initialPlayState, type PendingTurn, type PlayState, type StoryTurn } from "./turnMachine.ts";

/** 假的出声：speak 一直挂着，测试里 finish() 算读完、fail() 算读不出来 */
class FakeEngine implements SpeechEngine {
  spoken: string[] = [];
  prepared: string[] = [];
  rates: number[] = [];
  calls: string[] = [];
  private done: (() => void) | null = null;
  private failed: ((error: unknown) => void) | null = null;
  private started: (() => void) | null = null;

  prepare(line: SpeechLine): void {
    this.prepared.push(line.text);
  }
  speak(line: SpeechLine, rate: number, onStart: () => void): Promise<void> {
    this.spoken.push(line.text);
    this.rates.push(rate);
    this.started = onStart;
    return new Promise((resolve, reject) => {
      this.done = resolve;
      this.failed = reject;
    });
  }
  setRate(rate: number): void {
    this.calls.push(`rate:${rate}`);
  }
  pause(): void {
    this.calls.push("pause");
  }
  resume(): void {
    this.calls.push("resume");
  }
  stop(): void {
    this.calls.push("stop");
    this.done?.();
  }
  start(): void {
    this.started?.();
  }
  async finish(): Promise<void> {
    this.done?.();
    await flush();
  }
  async fail(error: unknown): Promise<void> {
    this.failed?.(error);
    await flush();
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function line(text: string, spot = text): SpeechLine {
  return { text, voice: null, language: "zh", spot };
}

test("按顺序读完一回合，读完回到没在读；提前准备下一小段", async () => {
  const engine = new FakeEngine();
  const player = new SpeechPlayer(engine);
  player.read("t1", [line("一"), line("二")]);
  await flush();
  assert.deepEqual(engine.spoken, ["一"]);
  assert.deepEqual(engine.prepared, ["二"]);
  assert.equal(player.getState().status, "loading");
  assert.equal(player.getState().turnId, "t1");
  assert.equal(player.getState().spot, "一");
  assert.equal(player.getState().paragraph, 1);
  assert.equal(player.getState().paragraphs, 2);
  engine.start();
  assert.equal(player.getState().status, "playing");
  await engine.finish();
  assert.deepEqual(engine.spoken, ["一", "二"]);
  assert.equal(player.getState().paragraph, 2);
  await engine.finish();
  assert.deepEqual(player.getState(), IDLE_SPEECH);
});

test("一段切成几小段时，第几段按段数，下一段跳过同一段剩下的小段", async () => {
  const engine = new FakeEngine();
  const player = new SpeechPlayer(engine);
  player.read("t1", [line("一", "0:0"), line("二", "0:0"), line("三", "0:1")]);
  await flush();
  assert.equal(player.getState().paragraphs, 2);
  await engine.finish();
  assert.deepEqual(engine.spoken, ["一", "二"]);
  assert.equal(player.getState().paragraph, 1);
  player.read("t2", [line("甲", "0:0"), line("乙", "0:0"), line("丙", "0:1")]);
  await flush();
  player.next();
  await flush();
  assert.equal(engine.spoken.at(-1), "丙");
  assert.equal(player.getState().paragraph, 2);
  player.next();
  await flush();
  assert.equal(player.getState().status, "idle");
});

test("暂停、继续、停止；语速传给出声的部分", async () => {
  const engine = new FakeEngine();
  const player = new SpeechPlayer(engine);
  player.setRate(1.25);
  player.read("t1", [line("一"), line("二")]);
  await flush();
  assert.equal(engine.rates[0], 1.25);
  player.pause(); // 还没开始出声：不算
  assert.equal(player.getState().status, "loading");
  engine.start();
  player.pause();
  assert.equal(player.getState().status, "paused");
  player.resume();
  assert.equal(player.getState().status, "playing");
  player.setRate(0.8);
  player.stop();
  await flush();
  assert.deepEqual(engine.calls, ["rate:1.25", "stop", "pause", "resume", "rate:0.8", "stop"]);
  assert.deepEqual(player.getState(), IDLE_SPEECH);
  assert.deepEqual(engine.spoken, ["一"]); // 停了以后不会接着读下一小段
});

test("暂停时这一小段正好读完：下一小段等继续，停止和跳段也不会卡住", async () => {
  const engine = new FakeEngine();
  const player = new SpeechPlayer(engine);
  player.read("t1", [line("一"), line("二"), line("三"), line("四"), line("五")]);
  await flush();
  engine.start();
  player.pause();
  await engine.finish();
  assert.deepEqual(engine.spoken, ["一"]); // 第二小段不开始
  assert.equal(player.getState().status, "paused");
  assert.equal(player.getState().spot, "二");
  player.resume();
  await flush();
  assert.deepEqual(engine.spoken, ["一", "二"]);
  assert.equal(player.getState().status, "loading");
  assert.ok(!engine.calls.includes("resume"));

  engine.start();
  player.pause();
  await engine.finish();
  assert.equal(player.getState().spot, "三");
  player.next(); // 等着继续的时候跳到下一段（三 还没读，跳过）
  await flush();
  assert.deepEqual(engine.spoken, ["一", "二", "四"]);
  assert.equal(player.getState().paragraph, 4);

  engine.start();
  player.pause();
  await engine.finish();
  player.stop();
  await flush();
  assert.deepEqual(player.getState(), IDLE_SPEECH);
});

test("读别的回合：当前的停下，从头读新的", async () => {
  const engine = new FakeEngine();
  const player = new SpeechPlayer(engine);
  player.read("t1", [line("一"), line("二")]);
  await flush();
  player.read("t2", [line("甲")]);
  await flush();
  assert.deepEqual(engine.spoken, ["一", "甲"]);
  assert.equal(player.getState().turnId, "t2");
  await engine.finish();
  assert.equal(player.getState().status, "idle");
});

test("读不出来：记下原因，再试一次接着这一小段", async () => {
  const engine = new FakeEngine();
  const player = new SpeechPlayer(engine);
  player.read("t1", [line("一"), line("二")]);
  await flush();
  await engine.finish();
  await engine.fail(new SpeechFailure("quota"));
  assert.equal(player.getState().status, "failed");
  assert.equal(player.getState().reason, "quota");
  player.retry();
  await flush();
  assert.deepEqual(engine.spoken, ["一", "二", "二"]);
  assert.equal(player.getState().reason, null);
});

test("回合还在写：读完写好的就等着，写出新的一段接着读，写完了读完就结束", async () => {
  const engine = new FakeEngine();
  const player = new SpeechPlayer(engine);
  player.read("t1", [line("一")], true);
  await flush();
  await engine.finish();
  assert.equal(player.getState().status, "waiting");
  assert.equal(player.getState().turnId, "t1");
  player.update("t1", [line("一")], true);
  assert.equal(player.getState().status, "waiting");
  player.update("t1", [line("一"), line("二")], true);
  await flush();
  assert.deepEqual(engine.spoken, ["一", "二"]);
  // 读第二段的时候写出了第三段：先准备好
  player.update("t1", [line("一"), line("二"), line("三")], true);
  assert.equal(engine.prepared.at(-1), "三");
  await engine.finish();
  assert.deepEqual(engine.spoken, ["一", "二", "三"]);
  await engine.finish();
  assert.equal(player.getState().status, "waiting");
  player.update("t1", [line("一"), line("二"), line("三")], false);
  assert.equal(player.getState().status, "idle");
  // 别的回合的更新不算
  player.read("t2", [line("甲")], true);
  player.update("t1", [line("不该读")], false);
  await flush();
  assert.deepEqual(engine.spoken.at(-1), "甲");
});

test("换声音来源：正在读的停下", async () => {
  const first = new FakeEngine();
  const player = new SpeechPlayer(first);
  player.read("t1", [line("一")]);
  await flush();
  const second = new FakeEngine();
  player.setEngine(second);
  assert.equal(player.getState().status, "idle");
  player.read("t2", [line("甲")]);
  await flush();
  assert.deepEqual(second.spoken, ["甲"]);
});

test("读不出来的原因", () => {
  const api = (code: string, status: number, reason?: string) =>
    new ApiError("x", {
      status,
      code,
      retryable: false,
      problem: { code, title: "x", ...(reason ? { reason } : {}) } as never,
    });
  assert.equal(speechReason(new SpeechFailure("device")), "device");
  assert.equal(speechReason(new Error("boom")), "device");
  assert.equal(speechReason(api("SPEECH_FAILED", 502, "auth")), "auth");
  assert.equal(speechReason(api("SPEECH_FAILED", 502, "奇怪")), "http");
  assert.equal(speechReason(api("SPEECH_NOT_CONFIGURED", 409)), "not_configured");
  assert.equal(speechReason(api("NOT_FOUND", 404)), "not_configured");
  assert.equal(speechReason(api("CREDENTIAL_UNREADABLE", 409)), "credential");
  assert.equal(speechReason(api("RATE_LIMITED", 429)), "rate_limited");
  assert.equal(speechReason(api("OOPS", 500)), "http");
  assert.equal(speechReason(new ApiError("x", { status: 0, code: "NETWORK", retryable: true })), "offline");
});

const context: SpeechContext = { choice: EMPTY_CHOICE, playthroughId: "p1", language: "zh", maxChars: 300 };

function story(id: string, seq: number, narrative: string): StoryTurn {
  return { id, seq, action: { source: "text", text: "走" }, narrative, options: [], segments: [] };
}

function writing(turnId: string, narrative: string): PendingTurn {
  return {
    turnId,
    seq: null,
    action: null,
    narrative,
    options: [],
    segments: [],
    buildingWorld: false,
    recalling: false,
  };
}

function page(change: Partial<PlayState>): PlayState {
  return { ...initialPlayState, phase: "idle", ...change };
}

function reader() {
  const engine = new FakeEngine();
  const player = new SpeechPlayer(engine);
  return { engine, player, turns: new TurnReader(player, () => context) };
}

test("点朗读读这一回合；回合被回退掉就停", async () => {
  const { engine, player, turns } = reader();
  const first = story("t1", 1, "第一段。\n第二段。");
  const second = story("t2", 2, "后来。");
  turns.sync(page({ turns: [first, second] }), false);
  turns.read("t2", second);
  await flush();
  assert.deepEqual(engine.spoken, ["后来。"]);
  turns.sync(page({ turns: [first, second] }), false);
  assert.equal(player.getState().turnId, "t2");
  turns.sync(page({ turns: [first] }), false);
  assert.equal(player.getState().status, "idle");
});

test("自动朗读：打开故事时写好的回合不读，新回合边写边读", async () => {
  const { engine, player, turns } = reader();
  const old = story("t1", 1, "以前写好的。");
  turns.sync(page({ phase: "loading" }), true);
  turns.sync(page({ turns: [old] }), true);
  await flush();
  assert.deepEqual(engine.spoken, []);

  // 第一段还没写完：先不读
  turns.sync(page({ phase: "streaming", turns: [old], pending: writing("t2", "第一段还") }), true);
  await flush();
  assert.equal(player.getState().status, "idle");
  turns.sync(page({ phase: "streaming", turns: [old], pending: writing("t2", "第一段写完。\n第二段") }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["第一段写完。"]);
  await engine.finish();
  assert.equal(player.getState().status, "waiting");
  turns.sync(page({ phase: "streaming", turns: [old], pending: writing("t2", "第一段写完。\n第二段写完。\n") }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["第一段写完。", "第二段写完。"]);
  await engine.finish();
  // 写完了：回合进了故事，没有新内容，读完就结束；不会再读一遍
  const done = story("t2", 2, "第一段写完。\n第二段写完。");
  turns.sync(page({ turns: [old, done] }), true);
  await flush();
  assert.equal(player.getState().status, "idle");
  assert.deepEqual(engine.spoken, ["第一段写完。", "第二段写完。"]);
});

test("自动朗读：回合写完时补上最后一段（后面没有换行）", async () => {
  const { engine, player, turns } = reader();
  turns.sync(page({ turns: [] }), true);
  turns.sync(page({ phase: "streaming", pending: writing("t1", "第一段。\n最后一段") }), true);
  await flush();
  await engine.finish();
  assert.equal(player.getState().status, "waiting");
  turns.sync(page({ turns: [story("t1", 1, "第一段。\n最后一段。")] }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["第一段。", "最后一段。"]);
});

test("自动朗读：没赶上写的过程时，读写好的新回合；回退以后不读", async () => {
  const { engine, turns } = reader();
  const first = story("t1", 1, "一。");
  const second = story("t2", 2, "二。");
  turns.sync(page({ turns: [first] }), true);
  turns.sync(page({ turns: [first, second] }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["二。"]);
  await engine.finish();
  // 回退到第一回合：不读
  turns.sync(page({ turns: [first] }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["二。"]);
  // 回退以后写出了新的第二回合：读
  turns.sync(page({ turns: [first, story("t3", 2, "新的二。")] }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["二。", "新的二。"]);
});

test("自动朗读：读完被停掉的回合不再读一遍；暂停时不替玩家接着读；关着不读", async () => {
  const { engine, player, turns } = reader();
  const old = story("t1", 1, "一。");
  turns.sync(page({ turns: [old] }), false);
  // 关着：不读
  turns.sync(page({ phase: "streaming", turns: [old], pending: writing("t2", "二。\n") }), false);
  await flush();
  assert.deepEqual(engine.spoken, []);
  // 开着：读；玩家停掉以后同一回合不再自动读
  turns.sync(page({ phase: "streaming", turns: [old], pending: writing("t3", "三。\n") }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["三。"]);
  player.stop();
  turns.sync(page({ phase: "streaming", turns: [old], pending: writing("t3", "三。\n再写。\n") }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["三。"]);
  // 读着旧回合时暂停：新回合来了不抢
  turns.read("t1", old);
  await flush();
  engine.start();
  player.pause();
  turns.sync(page({ phase: "streaming", turns: [old], pending: writing("t4", "四。\n") }), true);
  await flush();
  assert.equal(player.getState().turnId, "t1");
  assert.equal(player.getState().status, "paused");
});

test("自动朗读：新回合来了换到新回合", async () => {
  const { engine, player, turns } = reader();
  const old = story("t1", 1, "一。");
  turns.sync(page({ turns: [old] }), true);
  turns.read("t1", old);
  await flush();
  turns.sync(page({ phase: "streaming", turns: [old], pending: writing("t2", "二。\n") }), true);
  await flush();
  assert.deepEqual(engine.spoken, ["一。", "二。"]);
  assert.equal(player.getState().turnId, "t2");
});

test("点朗读读正在写的回合：写出新的接着读；失败的回合被关掉就停", async () => {
  const { engine, player, turns } = reader();
  const pending = writing("t1", "一。\n二");
  turns.sync(page({ phase: "streaming", pending }), false);
  turns.read("t1", pending, true);
  await flush();
  assert.deepEqual(engine.spoken, ["一。"]);
  await engine.finish();
  assert.equal(player.getState().status, "waiting");
  // 失败了：写到哪读到哪，读完结束
  turns.sync(page({ phase: "failed", pending: writing("t1", "一。\n二") }), false);
  await flush();
  assert.deepEqual(engine.spoken, ["一。", "二"]);
  turns.sync(page({ phase: "idle", pending: null }), false);
  assert.equal(player.getState().status, "idle");
});

test("取声音：同一段只取一次，取失败的不留，超过上限释放最早的", async () => {
  let loads = 0;
  const released: string[] = [];
  const loader = new AudioLoader<string>(
    async (key) => {
      loads += 1;
      if (key === "bad") throw new Error("no");
      return `file:${key}`;
    },
    (value) => released.push(value),
    2,
  );
  const l = line("x");
  assert.equal(await loader.get("a", l), "file:a");
  assert.equal(await loader.get("a", l), "file:a");
  assert.equal(loads, 1);
  await assert.rejects(loader.get("bad", l));
  await flush();
  await assert.rejects(loader.get("bad", l));
  assert.equal(loads, 3);
  await flush();
  await loader.get("b", l);
  await loader.get("a", l); // 用过 a：a 变成最近的
  await loader.get("c", l); // 超了：释放最早的 b
  await flush();
  assert.deepEqual(released, ["file:b"]);
  loader.clear();
  await flush();
  assert.deepEqual(released.sort(), ["file:a", "file:b", "file:c"]);
});
