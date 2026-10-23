import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SPOT,
  expandedCenter,
  insideDisc,
  pageInsets,
  parseWheelSpot,
  placeHub,
  polar,
  pressOutcome,
  sectorAt,
  sectorPath,
  snapDock,
  spotFromPoint,
  stepSector,
  WHEEL,
} from "./wheel.ts";

const view = { width: 1440, height: 900 };

describe("角度换算成第几块", () => {
  const c = { x: 500, y: 400 };

  it("从正上方开始顺时针，每块 60°", () => {
    assert.equal(sectorAt(c, { x: 500, y: 300 }), 0); // 正上：存档
    assert.equal(sectorAt(c, { x: 600, y: 340 }), 1); // 右上：剧本
    assert.equal(sectorAt(c, { x: 600, y: 460 }), 2); // 右下：角色
    assert.equal(sectorAt(c, { x: 500, y: 500 }), 3); // 正下：工作台
    assert.equal(sectorAt(c, { x: 400, y: 460 }), 4); // 左下：模型
    assert.equal(sectorAt(c, { x: 400, y: 340 }), 5); // 左上：设置
  });

  it("块与块的分界在 ±30° 处", () => {
    const r = 100;
    const at = (deg: number) => ({
      x: c.x + Math.sin((deg * Math.PI) / 180) * r,
      y: c.y - Math.cos((deg * Math.PI) / 180) * r,
    });
    assert.equal(sectorAt(c, at(29)), 0);
    assert.equal(sectorAt(c, at(31)), 1);
    assert.equal(sectorAt(c, at(-29)), 0);
    assert.equal(sectorAt(c, at(-31)), 5);
  });

  it("离圆心不到内半径时不算选中；超出扇区也按方向算", () => {
    assert.equal(sectorAt(c, { x: 500, y: 400 - WHEEL.inner + 1 }), null);
    assert.equal(sectorAt(c, { x: 500, y: 400 - WHEEL.inner }), 0);
    assert.equal(sectorAt(c, { x: 500, y: 400 - 170 }), 0);
  });

  it("圆盘范围是半径 178", () => {
    assert.equal(insideDisc(c, { x: 500 + 178, y: 400 }), true);
    assert.equal(insideDisc(c, { x: 500 + 179, y: 400 }), false);
  });
});

describe("靠边时展开，圆心往里挪", () => {
  it("贴在左边居中时，圆心挪到离左边 204", () => {
    assert.deepEqual(expandedCenter({ x: 52, y: 450 }, view), { x: 204, y: 450 });
  });

  it("离每条边都至少 204", () => {
    assert.deepEqual(expandedCenter({ x: 1400, y: 30 }, view), { x: 1440 - 204, y: 204 });
    assert.deepEqual(expandedCenter({ x: 700, y: 880 }, view), { x: 700, y: 900 - 204 });
  });

  it("离边够远就原地展开", () => {
    assert.deepEqual(expandedCenter({ x: 700, y: 450 }, view), { x: 700, y: 450 });
  });

  it("窗口太矮放不下时放在正中", () => {
    assert.deepEqual(expandedCenter({ x: 52, y: 100 }, { width: 1440, height: 380 }), { x: 204, y: 190 });
  });
});

describe("松手时贴边", () => {
  it("圆离左边或右边 40 以内就贴过去", () => {
    assert.equal(snapDock({ x: 36 + 40, y: 400 }, view), "left");
    assert.equal(snapDock({ x: 36 + 41, y: 400 }, view), null);
    assert.equal(snapDock({ x: 1440 - 36 - 40, y: 400 }, view), "right");
    assert.equal(snapDock({ x: 700, y: 400 }, view), null);
  });

  it("贴边以后圆心离边 52；没贴边就停在松手的地方", () => {
    const left = spotFromPoint({ x: 60, y: 300 }, view);
    assert.equal(left.dock, "left");
    assert.deepEqual(placeHub(left, view), { x: 52, y: 300 });
    const right = spotFromPoint({ x: 1420, y: 300 }, view);
    assert.deepEqual(placeHub(right, view), { x: 1440 - 52, y: 300 });
    const floating = spotFromPoint({ x: 700, y: 450 }, view);
    assert.equal(floating.dock, null);
    assert.deepEqual(placeHub(floating, view), { x: 700, y: 450 });
  });
});

describe("按住多久算拖动", () => {
  it("按住满 0.4 秒就拿起来", () => {
    assert.equal(pressOutcome({ heldMs: 399, moved: 0, released: false }), "pending");
    assert.equal(pressOutcome({ heldMs: 400, moved: 0, released: false }), "drag");
  });

  it("不到 0.4 秒就松手是点按，就挪开了不算拖", () => {
    assert.equal(pressOutcome({ heldMs: 200, moved: 2, released: true }), "tap");
    assert.equal(pressOutcome({ heldMs: 200, moved: 20, released: false }), "cancel");
  });

  it("拿起来以后怎么挪都还是拖", () => {
    assert.equal(pressOutcome({ heldMs: 900, moved: 300, released: false }), "drag");
  });
});

describe("位置的存和取", () => {
  it("默认贴着左边、上下居中", () => {
    assert.deepEqual(placeHub(DEFAULT_SPOT, view), { x: 52, y: 450 });
    assert.deepEqual(parseWheelSpot(undefined), DEFAULT_SPOT);
    assert.deepEqual(parseWheelSpot("left"), DEFAULT_SPOT);
  });

  it("存的是比例，窗口变了按比例换算", () => {
    const spot = spotFromPoint({ x: 720, y: 300 }, view);
    assert.deepEqual(placeHub(spot, { width: 1920, height: 1200 }), { x: 960, y: 400 });
  });

  it("窗口变小时夹回窗口里，整个圆露出来", () => {
    const spot = { dock: null, x: 0.99, y: 0.99 } as const;
    assert.deepEqual(placeHub(spot, { width: 1000, height: 700 }), { x: 1000 - 52, y: 700 - 52 });
    assert.deepEqual(placeHub({ dock: "right", x: 0, y: 0 }, { width: 1000, height: 700 }), { x: 948, y: 52 });
  });

  it("存储里的值不对时用默认值，越界的比例夹到 0–1", () => {
    assert.deepEqual(parseWheelSpot({ dock: "top", x: "a", y: 3 }), { dock: "left", x: 0, y: 1 });
    assert.deepEqual(parseWheelSpot({ dock: null, x: 0.3, y: 0.2 }), { dock: null, x: 0.3, y: 0.2 });
    assert.deepEqual(parseWheelSpot({ dock: "right", x: -1, y: 0.5 }), { dock: "right", x: 0, y: 0.5 });
  });
});

describe("键盘在六块之间转", () => {
  it("→ ↓ 顺时针，← ↑ 逆时针，首尾相接", () => {
    assert.equal(stepSector(0, "ArrowRight"), 1);
    assert.equal(stepSector(5, "ArrowDown"), 0);
    assert.equal(stepSector(0, "ArrowLeft"), 5);
    assert.equal(stepSector(3, "ArrowUp"), 2);
  });

  it("还没有选中时先落在起点（当前页）", () => {
    assert.equal(stepSector(null, "ArrowRight", 2), 2);
    assert.equal(stepSector(null, "ArrowLeft", 4), 4);
  });

  it("别的键不动", () => {
    assert.equal(stepSector(3, "Enter"), 3);
  });
});

describe("页面留边", () => {
  it("贴着的那一边 112，另一边 40；没贴边两边 40", () => {
    assert.deepEqual(pageInsets("left"), { left: 112, right: 40 });
    assert.deepEqual(pageInsets("right"), { left: 40, right: 112 });
    assert.deepEqual(pageInsets(null), { left: 40, right: 40 });
  });
});

describe("圆盘的几何", () => {
  it("扇区中线上的位置：正上方在 y 负方向，第二块在右上 60°", () => {
    assert.deepEqual(polar(0, 102), { x: 0, y: -102 });
    assert.deepEqual(polar(1, 100), { x: 86.6, y: -50 });
    assert.deepEqual(polar(3, 10), { x: 0, y: 10 });
  });

  it("第一块扇环从左边 −30° 的内圈画到外圈，再沿外弧到 +30°", () => {
    assert.equal(
      sectorPath(0, 208, 208),
      "M182 162.97L130 72.9A156 156 0 0 1 286 72.9L234 162.97A52 52 0 0 0 182 162.97Z",
    );
  });
});
