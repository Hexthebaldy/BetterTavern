import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { byRecent, recentGroups } from "./recent.ts";

// 2026-10-15 是周四，这一周从 10-12（周一）开始
const now = new Date(2026, 9, 15, 20, 0);
const at = (day: number, hour = 12) => ({
  id: `${day}-${hour}`,
  updated_at: new Date(2026, 9, day, hour).toISOString(),
});

describe("recentGroups", () => {
  it("按今天、本周（周一起）、更早分组，组内从新到旧", () => {
    const groups = recentGroups([at(15, 9), at(12), at(13), at(15, 18), at(1)], now);
    assert.deepEqual(
      groups.map((g) => [g.key, g.items.map((i) => i.id)]),
      [
        ["today", ["15-18", "15-9"]],
        ["week", ["13-12", "12-12"]],
        ["earlier", ["1-12"]],
      ],
    );
  });

  it("空的组不出现", () => {
    assert.deepEqual(
      recentGroups([at(2)], now).map((g) => g.key),
      ["earlier"],
    );
    assert.deepEqual(recentGroups([], now), []);
  });

  it("周日算在这一周里（周一开始）", () => {
    const sunday = new Date(2026, 9, 18, 10, 0);
    assert.deepEqual(
      recentGroups([at(12), at(11)], sunday).map((g) => [g.key, g.items.length]),
      [
        ["week", 1],
        ["earlier", 1],
      ],
    );
  });

  it("byRecent 不改原数组", () => {
    const items = [at(1), at(3)];
    assert.deepEqual(
      byRecent(items).map((i) => i.id),
      ["3-12", "1-12"],
    );
    assert.equal(items[0]?.id, "1-12");
  });
});
