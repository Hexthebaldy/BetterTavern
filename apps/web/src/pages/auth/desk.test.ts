import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contours, inside, lake, random, rays, smoothPath, strips, zigzag } from "./desk.ts";

const MAP = { width: 455, height: 355 };

describe("random", () => {
  it("同一个种子给出同一串数，都在 [0, 1) 里", () => {
    const a = random(7);
    const b = random(7);
    const xs = Array.from({ length: 50 }, () => a());
    assert.deepEqual(
      xs,
      Array.from({ length: 50 }, () => b()),
    );
    assert.ok(xs.every((x) => x >= 0 && x < 1));
  });

  it("种子不同，数也不同", () => {
    assert.notEqual(random(1)(), random(2)());
  });
});

describe("contours", () => {
  it("同一个种子画出来一样，换个种子不一样", () => {
    const at = { x: 121, y: 111 };
    assert.deepEqual(contours(11, at, 80, 76, 5), contours(11, at, 80, 76, 5));
    assert.notDeepEqual(contours(11, at, 80, 76, 5), contours(12, at, 80, 76, 5));
  });

  it("一圈比一圈小，所有点都在地图里", () => {
    const rings = contours(11, { x: 121, y: 111 }, 80, 76, 5);
    assert.equal(rings.length, 5);
    const span = (ring: { x: number }[]) => Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x));
    for (let i = 1; i < rings.length; i++) assert.ok(span(rings[i]!) < span(rings[i - 1]!));
    for (const [seed, x, y, rx, ry] of [
      [11, 121, 111, 80, 76],
      [12, 329, 253, 76, 65],
      [13, 360, 69, 41, 42],
    ] as const) {
      for (let s = seed; s < seed + 40; s++) {
        for (const ring of contours(s, { x, y }, rx, ry, 5)) assert.ok(ring.every((p) => inside(p, MAP)));
      }
    }
  });
});

describe("lake", () => {
  it("同一个种子一样，点都在地图里", () => {
    assert.deepEqual(lake(21, { x: 251, y: 118 }, 34), lake(21, { x: 251, y: 118 }, 34));
    for (let s = 0; s < 40; s++) assert.ok(lake(s, { x: 251, y: 118 }, 34).every((p) => inside(p, MAP)));
  });
});

describe("smoothPath", () => {
  it("穿过每一个点，闭合的以 Z 结尾", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ];
    const open = smoothPath(pts, false);
    assert.ok(open.startsWith("M0 0"));
    assert.ok(open.includes(" 10 5C") && open.endsWith(" 20 0"));
    assert.ok(smoothPath(pts, true).endsWith("Z"));
  });
});

describe("strips", () => {
  it("同一个种子一样；宽度在范围里，不超过下沿，每段第一行深一档", () => {
    const opts = { top: 30, bottom: 300, lines: 16, min: 72, max: 217 };
    const a = strips(31, opts);
    assert.deepEqual(a, strips(31, opts));
    assert.ok(a.length > 0 && a.length <= 16);
    assert.ok(a.every((s) => s.width >= 72 && s.width <= 217 && s.y + 6 <= 300));
    assert.equal(a[0]?.dark, true);
    for (let i = 1; i < a.length; i++) {
      const gap = a[i]!.y - a[i - 1]!.y;
      assert.ok(gap === 18 || gap === 32);
      assert.equal(a[i]!.dark, gap === 32);
    }
  });
});

describe("rays", () => {
  it("同一个种子一样；尖都在中间空出来的圈外，底边远在格子外面", () => {
    const opts = { count: 170, inner: 300, spread: 135, outer: 1035, minWidth: 9, maxWidth: 41 };
    const a = rays(41, opts);
    assert.deepEqual(a, rays(41, opts));
    assert.equal(a.length, 170);
    for (const [tip, b1, b2] of a) {
      assert.ok(Math.hypot(tip.x, tip.y) >= 299.9);
      assert.ok(Math.hypot(b1.x, b1.y) > 700 && Math.hypot(b2.x, b2.y) > 700);
    }
  });
});

describe("zigzag", () => {
  it("从 x0 开始每 14 一折，上下摆 3，不超过 x1", () => {
    assert.equal(zigzag(34, 80, 152), "M34 155L48 152L62 158L76 152");
  });
});
