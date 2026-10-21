import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COPIES } from "../i18n/all.ts";
import { ARC_GO, ARC_STEPS, arcClass, clampStep, nextLabel, nextStep } from "./steps.ts";

describe("arcClass", () => {
  it("全景时都不变", () => {
    assert.equal(arcClass(0, "dir"), "");
    assert.equal(arcClass(0, "queue"), "");
  });

  it("其他步骤：用到的变蓝，没用到的变淡", () => {
    assert.equal(arcClass(3, "dir"), "on");
    assert.equal(arcClass(3, "rc"), "on");
    assert.equal(arcClass(3, "st"), "dim");
    assert.equal(arcClass(3, "queue"), "dim");
  });

  it("章节整理和大纲修订是同一步，都排在任务队列里", () => {
    assert.equal(ARC_GO.ch, ARC_GO.ol);
    for (const k of ["ch", "ol", "queue"] as const) assert.equal(arcClass(ARC_GO.ch, k), "on");
  });

  it("回退不调模型：导演和后台的三个 agent 都不亮", () => {
    const back = ARC_STEPS.length - 1;
    for (const k of ["dir", "st", "ch", "ol"] as const) assert.equal(arcClass(back, k), "dim");
    assert.equal(arcClass(back, "undo"), "on");
  });
});

describe("说明条上的按钮", () => {
  it("全景时“走一遍”，中间“下一步”，最后一步“回到全景”，按了以后循环", () => {
    assert.equal(nextLabel(0), "start");
    assert.equal(nextLabel(3), "next");
    assert.equal(nextLabel(ARC_STEPS.length - 1), "back");
    assert.equal(nextStep(0), 1);
    assert.equal(nextStep(ARC_STEPS.length - 1), 0);
  });

  it("超出范围的步骤按两头算", () => {
    assert.equal(clampStep(-3), 0);
    assert.equal(clampStep(99), ARC_STEPS.length - 1);
    assert.equal(clampStep(Number.NaN), 0);
  });
});

describe("文案", () => {
  it("每种语言都有八个状态的说明", () => {
    for (const copy of Object.values(COPIES)) assert.equal(copy.more.arc.steps.length, ARC_STEPS.length);
  });
});
