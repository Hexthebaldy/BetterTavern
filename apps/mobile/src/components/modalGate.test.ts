import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DISMISS_TIMEOUT_MS, ModalGate } from "./modalGate.ts";

/** 手动拨动的假时钟：run(ms) 执行到期的定时器 */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    run(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    get pendingTimers() {
      return timers.size;
    },
  };
}

function gateWith(onTimeout?: (id: string, waitedMs: number) => void) {
  const clock = fakeClock();
  const gate = new ModalGate({
    onTimeout,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
  });
  return { gate, clock };
}

describe("ModalGate", () => {
  it("没有正在收回的 Modal：马上执行", () => {
    const { gate } = gateWith();
    let ran = 0;
    gate.whenNoneDismissing(() => ran++);
    assert.equal(ran, 1);
  });

  it("有 Modal 正在收回：等它收回（onDismiss）再执行，并清掉保底定时器", () => {
    const { gate, clock } = gateWith();
    gate.beginDismiss("sheet#1");
    let ran = 0;
    gate.whenNoneDismissing(() => ran++);
    clock.run(180);
    assert.equal(ran, 0);
    gate.endDismiss("sheet#1");
    assert.equal(ran, 1);
    assert.equal(gate.pending, 0);
    assert.equal(clock.pendingTimers, 0);
  });

  it("几个同时收回：最后一个收回后才执行", () => {
    const { gate } = gateWith();
    gate.beginDismiss("sheet#1");
    gate.beginDismiss("dialog#2");
    let ran = 0;
    gate.whenNoneDismissing(() => ran++);
    gate.endDismiss("sheet#1");
    assert.equal(ran, 0);
    gate.endDismiss("dialog#2");
    assert.equal(ran, 1);
  });

  it("同一个 Modal 重复登记只算一次；没登记过的 endDismiss 什么都不做", () => {
    const { gate } = gateWith();
    gate.beginDismiss("sheet#1");
    gate.beginDismiss("sheet#1");
    assert.equal(gate.pending, 1);
    gate.endDismiss("nobody#9");
    assert.equal(gate.pending, 1);
    gate.endDismiss("sheet#1");
    assert.equal(gate.pending, 0);
  });

  it("取消等待后不再执行", () => {
    const { gate } = gateWith();
    gate.beginDismiss("sheet#1");
    let ran = 0;
    const cancel = gate.whenNoneDismissing(() => ran++);
    cancel();
    gate.endDismiss("sheet#1");
    assert.equal(ran, 0);
  });

  it("一直没有 onDismiss：保底超时当作已收回，调用 onForced、记日志、放行等待的人", () => {
    const timeouts: [string, number][] = [];
    const { gate, clock } = gateWith((id, waited) => timeouts.push([id, waited]));
    let forced = 0;
    gate.beginDismiss("sheet#1", () => forced++);
    let ran = 0;
    gate.whenNoneDismissing(() => ran++);
    clock.run(DISMISS_TIMEOUT_MS - 1);
    assert.equal(ran, 0);
    clock.run(1);
    assert.deepEqual(timeouts, [["sheet#1", DISMISS_TIMEOUT_MS]]);
    assert.equal(forced, 1);
    assert.equal(ran, 1);
    // 超时之后迟到的 onDismiss 不再重复放行
    gate.endDismiss("sheet#1");
    assert.equal(ran, 1);
  });

  it("按时收回的不会触发保底超时", () => {
    const timeouts: string[] = [];
    const { gate, clock } = gateWith((id) => timeouts.push(id));
    gate.beginDismiss("sheet#1");
    clock.run(200);
    gate.endDismiss("sheet#1");
    clock.run(DISMISS_TIMEOUT_MS * 2);
    assert.deepEqual(timeouts, []);
  });
});
