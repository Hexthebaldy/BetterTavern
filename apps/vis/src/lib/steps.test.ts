import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refsOf, toolCallNames, toolCalls, withRefs } from "./steps.ts";

describe("每一步的显示", () => {
  it("模型这一步调了哪些工具", () => {
    const result = {
      text: "",
      tool_calls: [{ name: "find_entity", arguments: '{"name":"老周"}' }, { name: "commit" }],
    };
    assert.deepEqual(toolCallNames(result), ["find_entity", "commit"]);
    assert.deepEqual(toolCalls(result), [
      { name: "find_entity", arguments: '{"name":"老周"}' },
      { name: "commit", arguments: null },
    ]);
    assert.deepEqual(toolCallNames({ text: "好的" }), []);
  });

  it("编号后面注上名字", () => {
    const refs = refsOf({ changes: 3, refs: { e1: "穗穗", f8: "穗穗交给青葉一张薄纸" } });
    assert.equal(
      withRefs('{"entity":"e1","about":["e1","e2"]}', refs),
      '{"entity":"e1（穗穗）","about":["e1（穗穗）","e2"]}',
    );
    assert.equal(withRefs("f8 和 f80", refs), "f8（穗穗交给青葉一张薄纸） 和 f80");
    // 不显示故事内容时没有对照表，原样显示
    assert.equal(withRefs("e1", refsOf({ changes: 3 })), "e1");
    assert.equal(refsOf(null), null);
  });
});
