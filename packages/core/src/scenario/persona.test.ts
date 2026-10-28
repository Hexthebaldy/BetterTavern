import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Persona, ScenarioSetup } from "../api/types.ts";
import {
  BLANK,
  choiceName,
  initialOfName,
  setupChoice,
  setupFields,
  startChoice,
  startFields,
} from "./persona.ts";

function persona(id: string, name: string, extra: Partial<Persona> = {}): Persona {
  return {
    id,
    name,
    description: "",
    avatar_blob_id: null,
    is_default: false,
    scenario_count: 0,
    created_at: "",
    updated_at: "",
    ...extra,
  };
}

function setup(extra: Partial<ScenarioSetup> = {}): ScenarioSetup {
  return {
    persona_id: null,
    protagonist: { name: "", summary: "" },
    preferences: { length: "medium", style: "", boundaries: "" },
    opening: null,
    lightning: false,
    ...extra,
  };
}

const LIN = persona("lin", "林川", { is_default: true, description: "一名信使" });
const SHEN = persona("shen", "沈砚", { description: "字".repeat(500) });

describe("人设：先选哪个", () => {
  it("开新故事：剧本选的人设 → 旧的默认主角 → 默认人设 → 空着", () => {
    assert.deepEqual(startChoice(setup({ persona_id: "shen" }), [LIN, SHEN]), { kind: "persona", id: "shen" });
    const legacy = setup({ protagonist: { name: "路人", summary: "过客" } });
    assert.deepEqual(startChoice(legacy, [LIN, SHEN]), { kind: "custom", name: "路人", summary: "过客" });
    assert.deepEqual(startChoice(setup(), [LIN, SHEN]), { kind: "persona", id: "lin" });
    // 剧本选的人设删掉了：用默认人设
    assert.deepEqual(startChoice(setup({ persona_id: "gone" }), [LIN]), { kind: "persona", id: "lin" });
    assert.deepEqual(startChoice(setup(), [SHEN]), BLANK);
    // 更新前的服务端没有 persona_id
    assert.deepEqual(startChoice(undefined, []), BLANK);
  });

  it("剧本设置：不拿默认人设去填", () => {
    assert.deepEqual(setupChoice(setup(), [LIN]), BLANK);
    assert.deepEqual(setupChoice(setup({ persona_id: "lin" }), [LIN]), { kind: "persona", id: "lin" });
  });

  it("拼回接口字段", () => {
    assert.deepEqual(startFields({ kind: "persona", id: "lin" }), { persona_id: "lin" });
    assert.deepEqual(startFields({ kind: "custom", name: " 路人 ", summary: " 过客 " }), {
      protagonist: { name: "路人", summary: "过客" },
    });
    // 选人设：默认主角写成它的副本，描述截到 400 字
    const fields = setupFields({ kind: "persona", id: "shen" }, [SHEN]);
    assert.equal(fields.persona_id, "shen");
    assert.equal(fields.protagonist.name, "沈砚");
    assert.equal(fields.protagonist.summary.length, 400);
    assert.deepEqual(setupFields(BLANK, [SHEN]), { persona_id: null, protagonist: { name: "", summary: "" } });
    assert.equal(choiceName({ kind: "persona", id: "lin" }, [LIN]), "林川");
    assert.equal(choiceName({ kind: "persona", id: "gone" }, [LIN]), "");
    assert.equal(initialOfName(" amy"), "A");
    assert.equal(initialOfName(""), "?");
  });
});
