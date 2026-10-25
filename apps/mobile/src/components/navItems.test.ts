import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activeItem, RAIL_ITEMS, railTarget, TAB_ITEMS } from "./navItems.ts";

const rail = (key: string) => {
  const item = RAIL_ITEMS.find((i) => i.key === key);
  assert.ok(item, key);
  return item;
};

describe("导航的几块", () => {
  it("底部 4 块各占一个标签页；侧栏 6 块都指向这 4 个页面", () => {
    assert.deepEqual(
      TAB_ITEMS.map((i) => i.route),
      ["playthroughs", "library", "workbench", "settings"],
    );
    assert.equal(RAIL_ITEMS.length, 6);
    for (const item of RAIL_ITEMS) {
      assert.ok(TAB_ITEMS.some((t) => t.route === item.route), item.key);
    }
  });

  it("侧栏的选中项跟着路由和参数走", () => {
    assert.equal(activeItem(RAIL_ITEMS, "playthroughs", {}), "saves");
    assert.equal(activeItem(RAIL_ITEMS, "library", {}), "scenarios");
    assert.equal(activeItem(RAIL_ITEMS, "library", { tab: "cards" }), "characters");
    assert.equal(activeItem(RAIL_ITEMS, "library", { tab: "lorebooks" }), "characters");
    assert.equal(activeItem(RAIL_ITEMS, "settings", undefined), "settings");
    assert.equal(activeItem(RAIL_ITEMS, "settings", { section: "models" }), "models");
    // 不认识的参数值当作没带
    assert.equal(activeItem(RAIL_ITEMS, "library", { tab: "scenarios" }), "scenarios");
    assert.equal(activeItem(RAIL_ITEMS, "play", {}), null);
  });

  it("底部 4 块不看参数：库带着 tab=cards 也是“库”", () => {
    assert.equal(activeItem(TAB_ITEMS, "library", { tab: "cards" }), "library");
    assert.equal(activeItem(TAB_ITEMS, "settings", { section: "models" }), "settings");
  });

  it("点同一个页面的另一块：带着新参数再导航一次；点已经选中的不动", () => {
    assert.deepEqual(railTarget(rail("characters"), "library", {}), {
      route: "library",
      params: { tab: "cards" },
    });
    assert.deepEqual(railTarget(rail("scenarios"), "library", { tab: "cards" }), {
      route: "library",
      params: { tab: undefined },
    });
    assert.deepEqual(railTarget(rail("models"), "playthroughs", {}), {
      route: "settings",
      params: { section: "models" },
    });
    assert.equal(railTarget(rail("characters"), "library", { tab: "cards" }), null);
    assert.equal(railTarget(rail("characters"), "library", { tab: "lorebooks" }), null);
    assert.equal(railTarget(rail("saves"), "playthroughs", {}), null);
  });
});
