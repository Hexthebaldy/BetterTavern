import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { byRecent } from "./recent.ts";

const at = (day: number, hour = 12) => ({
  id: `${day}-${hour}`,
  updated_at: new Date(2026, 9, day, hour).toISOString(),
});

describe("byRecent", () => {
  it("从新到旧排", () => {
    assert.deepEqual(
      byRecent([at(1), at(15, 9), at(15, 18), at(3)]).map((i) => i.id),
      ["15-18", "15-9", "3-12", "1-12"],
    );
  });

  it("不改原数组", () => {
    const items = [at(1), at(3)];
    byRecent(items);
    assert.equal(items[0]?.id, "1-12");
  });
});
