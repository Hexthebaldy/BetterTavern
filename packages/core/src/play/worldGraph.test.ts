import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WorldEntity } from "../api/types.ts";
import { layoutGraph, nodeWidth, relLabel } from "./worldGraph.ts";

function entity(id: string, name: string, extra: Partial<WorldEntity> = {}): WorldEntity {
  return {
    id,
    kind: "character",
    name,
    aliases: [],
    summary: "",
    data: {},
    importance: 1,
    is_protagonist: false,
    ...extra,
  };
}

describe("关系图布局", () => {
  const entities = [
    entity("me", "林川", { is_protagonist: true }),
    entity("shen", "沈知微", { importance: 5 }),
    entity("inn", "渡口茶馆", { kind: "location" }),
    entity("letter", "那封信", { kind: "item" }),
    entity("lonely", "没有关系的人"),
  ];
  const links = [
    { src_id: "shen", rel: "located_in", dst_id: "inn" },
    { src_id: "me", rel: "located_in", dst_id: "inn" },
    { src_id: "letter", rel: "held_by", dst_id: "me" },
    { src_id: "shen", rel: "member_of", dst_id: "ghost" },
  ];

  it("只画关系里出现的实体，连接最多的放中间", () => {
    const { nodes, edges } = layoutGraph(entities, links, 390, 300);
    assert.deepEqual(nodes.map((n) => n.id).sort(), ["inn", "letter", "me", "shen"]);
    const hub = nodes.find((n) => n.role === "hub");
    assert.equal(hub?.id, "inn");
    assert.equal(nodes.find((n) => n.id === "me")?.role, "me");
    assert.equal(edges.length, 3); // 指向不存在实体的关系不画
  });

  it("方框都在画布里", () => {
    const { nodes } = layoutGraph(entities, links, 300, 200);
    for (const n of nodes) {
      assert.ok(n.x - n.width / 2 >= 0 && n.x + n.width / 2 <= 300);
      assert.ok(n.y - 16 >= 0 && n.y + 16 <= 200);
    }
  });

  it("没有关系时什么都不画", () => {
    assert.deepEqual(layoutGraph(entities, [], 390, 300), { nodes: [], edges: [] });
  });

  it("关系名和方框宽度", () => {
    assert.equal(relLabel("held_by"), "持有者");
    assert.equal(relLabel("loves"), "loves");
    assert.ok(nodeWidth("雾里的乌篷船") > nodeWidth("林川"));
  });
});
