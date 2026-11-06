import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainAgentText } from "./labels.ts";

describe("plainAgentText", () => {
  it("去掉模型写的加粗和标题记号，列表和普通文字照旧", () => {
    const text = "## 写好了\n- **林黛玉**：描述、性格都齐了\n- __封面__：生成了一张";
    assert.equal(plainAgentText(text), "写好了\n- 林黛玉：描述、性格都齐了\n- 封面：生成了一张");
  });

  it("单个星号、下划线和字段名不动", () => {
    assert.equal(plainAgentText("first_mes 和 {{user}} 里的 * 号"), "first_mes 和 {{user}} 里的 * 号");
  });
});
