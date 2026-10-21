import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COPIES } from "../i18n/all.ts";
import { LANGS } from "../i18n/langs.ts";
import { world as W } from "../i18n/zh/story.ts";
import {
  EDGES,
  edgesShown,
  highlight,
  kindLabel,
  NODE_IDS,
  neighbors,
  nodeAria,
  relations,
  SECRET_EDGE,
} from "./graph.ts";

const sorted = (xs: Iterable<string>) => [...xs].sort();

describe("neighbors", () => {
  it("连线两头互为邻居", () => {
    const nb = neighbors(false);
    assert.deepEqual(sorted(nb.tower), ["grey", "me", "pier"]);
    assert.deepEqual(sorted(nb.me), ["tower"]);
    assert.deepEqual(sorted(nb.ship), ["bell", "chao", "pier"]);
  });

  it("每个节点都连着别的节点", () => {
    const nb = neighbors(false);
    for (const id of NODE_IDS) assert.ok(nb[id].length > 0, id);
  });

  it("秘密揭开以后，老周和旧船连上", () => {
    assert.ok(!neighbors(false).keeper.includes("ship"));
    assert.ok(neighbors(true).keeper.includes("ship"));
    assert.ok(neighbors(true).ship.includes("keeper"));
    assert.equal(edgesShown(true).length, EDGES.length + 1);
  });
});

describe("highlight", () => {
  it("没有悬停时什么都不变", () => {
    assert.equal(highlight(null, false), null);
  });

  it("悬停的节点和它的邻居亮着，其余变淡；连着它的线变亮", () => {
    const hl = highlight("tower", false)!;
    assert.deepEqual(sorted(hl.dimNodes), ["bell", "chao", "keeper", "log", "ship"]);
    assert.deepEqual(
      sorted([...hl.litEdges].map((i) => `${EDGES[i]!.a}-${EDGES[i]!.b}`)),
      ["grey-tower", "me-tower", "tower-pier"],
    );
  });

  it("秘密揭开以后，悬停老周也点亮那条虚线和旧船", () => {
    const before = highlight("keeper", false)!;
    assert.ok(before.dimNodes.has("ship"));
    const after = highlight("keeper", true)!;
    assert.ok(!after.dimNodes.has("ship"));
    assert.ok(after.litEdges.has(edgesShown(true).indexOf(SECRET_EDGE)));
  });
});

describe("relations", () => {
  it("从选中的节点这一头读", () => {
    assert.deepEqual(relations("me", false, W), [{ pre: "在", target: "灯塔", post: "", secret: false }]);
    assert.deepEqual(
      relations("tower", false, W).map((r) => `${r.pre}${r.target}${r.post}`),
      ["我在这里", "灰外套的女人在这里", "在雾港码头的尽头"],
    );
  });

  it("秘密揭开以后，老周和旧船各多一条，标成秘密", () => {
    assert.equal(relations("keeper", false, W).length, 2);
    const keeper = relations("keeper", true, W);
    assert.deepEqual(keeper.at(-1), { pre: "三十年前死在", target: "无名旧船", post: "上", secret: true });
    assert.deepEqual(relations("ship", true, W).at(-1), { pre: "", target: "老周", post: "三十年前死在这里", secret: true });
  });
});

describe("标签", () => {
  it("主角写“主角”，其余按类别", () => {
    assert.equal(kindLabel("me", W), "主角");
    assert.equal(kindLabel("log", W), "物品");
    assert.equal(nodeAria("me", W, "林深"), "我，林深，主角");
    assert.equal(nodeAria("pier", W, "林深"), "雾港码头，地点");
    assert.equal(nodeAria("me", COPIES.en.world.graph, "Rowan"), "Me, Rowan, Protagonist");
  });
});

describe("三种语言", () => {
  for (const lang of LANGS) {
    it(`${lang}：每个节点、每条线从两头读都有字`, () => {
      const g = COPIES[lang].world.graph;
      for (const id of NODE_IDS) {
        assert.ok(g.nodes[id].label && g.nodes[id].desc, id);
        // 揭开秘密以后每个节点都至少有一条关系，对方的名字不空
        const rels = relations(id, true, g);
        assert.ok(rels.length > 0, id);
        for (const r of rels) assert.ok(r.target, `${lang} ${id}`);
      }
    });
  }
});
