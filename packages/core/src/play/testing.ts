/** 测试用的回合构造器（只在 *.test.ts 里用） */

import type { Turn, TurnOption } from "../api/types.ts";

let counter = 0;

export function opts(seq: number): TurnOption[] {
  return [
    { id: "o1", text: `甲${seq}` },
    { id: "o2", text: `乙${seq}` },
  ];
}

export function makeTurn(seq: number, overrides: Partial<Turn> = {}): Turn {
  counter += 1;
  return {
    id: overrides.id ?? `t${seq}-${counter}`,
    playthrough_id: "p1",
    seq,
    attempt: 1,
    status: "committed",
    action:
      seq === 0
        ? { source: "opening", text: "" }
        : { source: "option", text: `甲${seq - 1}`, option_id: "o1" },
    narrative: `第${seq}段。`,
    options: opts(seq),
    options_source: "model",
    state_lag: false,
    error: null,
    created_at: "2026-10-14T00:00:00Z",
    replied_at: "2026-10-14T00:00:01Z",
    ...overrides,
  };
}
