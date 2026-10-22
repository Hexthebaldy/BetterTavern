import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Draft, WorkbenchMessage } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";
import { draftStatus, progressSteps } from "./progress.ts";
import { answersSummary, defaultAnswers, toPayload, toggle, writeOther } from "./questionnaire.ts";
import { applyEvent, awaitedMessage, initialState, withDraft } from "./session.ts";

const DRAFT: Draft = {
  draft: {
    id: "d1",
    name: "",
    character_name: "",
    origin: "agent",
    card_id: null,
    cover_blob_id: null,
    mode: "agent",
    stage: "start",
    agent_status: "running",
    awaiting: null,
    version: 1,
    saved_version: null,
    unsaved: true,
    created_at: "2026-10-22T00:00:00Z",
    updated_at: "2026-10-22T00:00:00Z",
  },
  card: {
    name: "",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    system_prompt: "",
    creator_notes: "",
    alternate_greetings: [],
    tags: [],
    book: [],
    creator: "",
    character_version: "",
    post_history_instructions: "",
    truncated: [],
  },
  cover_asset_id: null,
  base_version: null,
  todos: [],
  language: "zh",
  issues: [],
  assets: [],
  notes: [],
};

const USER: WorkbenchMessage = {
  seq: 1,
  role: "user",
  kind: "text",
  content: { text: "做个掌柜" },
  created_at: "2026-10-22T00:00:00Z",
};

const QUESTIONS: WorkbenchMessage = {
  seq: 3,
  role: "assistant",
  kind: "questions",
  content: {
    intro: "",
    skippable: true,
    questions: [
      { qid: "q0", question: "基调", choices: ["悬疑", "温情"], recommended: 0, multi: false },
      { qid: "q1", question: "不要", choices: ["血腥", "惊吓", "粗口"], recommended: null, multi: true },
    ],
  },
  created_at: "2026-10-22T00:00:00Z",
};

describe("工作台的页面状态", () => {
  it("说的话一边推一边拼，成为一条消息以后清掉", () => {
    let state = initialState(DRAFT, [USER]);
    state = applyEvent(state, { event: "delta", data: { text: "好的，" } });
    state = applyEvent(state, { event: "delta", data: { text: "先问几件事。" } });
    assert.equal(state.speaking, "好的，先问几件事。");
    state = applyEvent(state, {
      event: "message",
      data: { seq: 2, role: "assistant", kind: "text", content: { text: "好的，先问几件事。" }, created_at: "" },
    });
    assert.equal(state.speaking, "");
    assert.deepEqual(
      state.messages.map((m) => m.seq),
      [1, 2],
    );
  });

  it("正在写的字段按目标拼起来；草稿变了以后要重新读", () => {
    let state = initialState(DRAFT, []);
    state = applyEvent(state, { event: "field_delta", data: { target: { field: "first_mes" }, text: "客官" } });
    state = applyEvent(state, { event: "field_delta", data: { target: { field: "first_mes" }, text: "，当什么？" } });
    assert.deepEqual(state.writing, { target: "field:first_mes", text: "客官，当什么？" });
    state = applyEvent(state, { event: "field_delta", data: { target: { lore: "规矩" }, text: "三不当" } });
    assert.deepEqual(state.writing, { target: "lore:规矩", text: "三不当" });
    state = applyEvent(state, { event: "draft", data: { version: 2, fields: ["first_mes"] } });
    assert.equal(state.writing, null);
    assert.equal(state.needsRefresh, true);
    state = withDraft(state, { ...DRAFT, draft: { ...DRAFT.draft, version: 2, agent_status: "running" } });
    assert.equal(state.needsRefresh, false);
  });

  it("一轮结束：在等回答的问卷；同一序号的消息整条替换", () => {
    let state = initialState(DRAFT, [USER]);
    state = applyEvent(state, { event: "message", data: QUESTIONS });
    state = applyEvent(state, {
      event: "status",
      data: { agent_status: "awaiting_user", stage: "questions", awaiting: { kind: "questions", seq: 3 }, done: true },
    });
    assert.equal(awaitedMessage(state)?.seq, 3);
    assert.equal(state.needsRefresh, true);
    const replaced = { ...QUESTIONS, content: { ...QUESTIONS.content, intro: "改过" } } as WorkbenchMessage;
    state = applyEvent(state, { event: "message", data: replaced });
    assert.equal(state.messages.length, 2);
    // 新一轮开始：不再等
    state = applyEvent(state, { event: "status", data: { agent_status: "running" } });
    assert.equal(awaitedMessage(state), null);
  });
});

describe("问卷", () => {
  const questions = QUESTIONS.kind === "questions" ? QUESTIONS.content.questions : [];

  it("推荐项预先选好；单选换选项，多选切换；其他自己写", () => {
    let answers = defaultAnswers(questions);
    assert.deepEqual(answers.q0, { picked: ["悬疑"], other: "" });
    assert.deepEqual(answers.q1, { picked: [], other: "" });
    answers = { ...answers, q0: toggle(questions[0]!, answers.q0!, "温情") };
    answers = { ...answers, q1: toggle(questions[1]!, answers.q1!, "血腥") };
    answers = { ...answers, q1: writeOther(questions[1]!, answers.q1!, "猫狗死亡") };
    assert.deepEqual(toPayload(questions, answers), { q0: "温情", q1: ["血腥", "猫狗死亡"] });
    answers = { ...answers, q0: writeOther(questions[0]!, answers.q0!, "黑色幽默") };
    assert.equal(toPayload(questions, answers).q0, "黑色幽默");
    assert.equal(answersSummary(questions, { q0: "温情", q1: ["血腥", "粗口"] }), "温情 · 血腥、粗口");
  });
});

describe("进度和状态说明", () => {
  it("原创四步，查过资料五步；手动开始的只有动手和检查", () => {
    void i18n.changeLanguage("zh");
    const states = (steps: ReturnType<typeof progressSteps>) => steps.map((s) => `${s.key}:${s.state}`);
    assert.deepEqual(states(progressSteps("agent", "plan", false)), [
      "questions:done",
      "plan:doing",
      "build:todo",
      "check:todo",
    ]);
    assert.deepEqual(states(progressSteps("agent", "research", true)).slice(0, 2), ["research:doing", "questions:todo"]);
    assert.deepEqual(states(progressSteps("agent", "done", true)), [
      "research:done",
      "questions:done",
      "plan:done",
      "build:done",
      "check:done",
    ]);
    assert.deepEqual(states(progressSteps("manual", "build", false)), ["build:doing", "check:todo"]);
    assert.equal(
      draftStatus({ agent_status: "awaiting_user", awaiting: { kind: "questions", seq: 3 }, stage: "questions", mode: "agent", unsaved: true, card_id: null }, 6),
      "等你回答 6 个问题",
    );
    assert.equal(
      draftStatus({ agent_status: "awaiting_user", awaiting: { kind: "plan", seq: 4 }, stage: "plan", mode: "agent", unsaved: true, card_id: null }),
      "方案等你确认",
    );
  });
});
