/**
 * 工作台页面的状态（手机和网页共用的纯逻辑）：草稿、对话记录，加上推送事件带来的“正在发生的事”——
 * agent 正在说的话（delta 拼起来）、正在写的字段（field_delta 拼起来）、正在用的工具、进度清单。
 *
 * - message 事件按序号插入或替换（改动对比的决定会把同一条整条替换）；agent 说完一段话，
 *   会来一条 kind 为 text 的 message，那时清掉正在说的话；
 * - draft 事件只说明草稿变了：needsRefresh 置位，由页面重新读草稿（GET /v1/workbench/drafts/{id}）；
 * - status 事件更新 agent_status、stage、awaiting；一轮结束（done）时清掉正在写的字段和工具。
 */

import type {
  AgentStatus,
  Awaiting,
  Draft,
  DraftStage,
  Todo,
  WorkbenchEvent,
  WorkbenchMessage,
} from "../api/types.ts";

export type FieldStream = { target: string; text: string };

export type WorkbenchState = {
  draft: Draft;
  messages: WorkbenchMessage[];
  agentStatus: AgentStatus;
  stage: DraftStage;
  awaiting: Awaiting | null;
  todos: Todo[];
  /** agent 正在说的话（还没成为一条 message） */
  speaking: string;
  /** 正在写的字段：target 是 field:description 或 lore:条目名 */
  writing: FieldStream | null;
  /** 正在用的工具（界面显示“正在搜索……”） */
  tool: { name: string; detail: string } | null;
  /** 草稿内容在服务端变了，要重新读 */
  needsRefresh: boolean;
};

export function initialState(draft: Draft, messages: WorkbenchMessage[]): WorkbenchState {
  return {
    draft,
    messages: [...messages].sort((a, b) => a.seq - b.seq),
    agentStatus: draft.draft.agent_status,
    stage: draft.draft.stage,
    awaiting: draft.draft.awaiting,
    todos: draft.todos,
    speaking: "",
    writing: null,
    tool: null,
    needsRefresh: false,
  };
}

export function upsertMessage(messages: WorkbenchMessage[], message: WorkbenchMessage): WorkbenchMessage[] {
  const index = messages.findIndex((m) => m.seq === message.seq);
  if (index >= 0) {
    const next = [...messages];
    next[index] = message;
    return next;
  }
  const next = [...messages, message];
  next.sort((a, b) => a.seq - b.seq);
  return next;
}

function targetKey(target: { field: string } | { lore: string }): string {
  return "field" in target ? `field:${target.field}` : `lore:${target.lore}`;
}

export function applyEvent(state: WorkbenchState, event: WorkbenchEvent): WorkbenchState {
  switch (event.event) {
    case "delta":
      return { ...state, speaking: state.speaking + event.data.text, tool: null };
    case "field_delta": {
      const key = targetKey(event.data.target);
      const text = state.writing?.target === key ? state.writing.text + event.data.text : event.data.text;
      return { ...state, writing: { target: key, text } };
    }
    case "tool":
      return {
        ...state,
        tool: {
          name: event.data.name,
          detail: event.data.query ?? (event.data.urls !== undefined ? String(event.data.urls) : ""),
        },
      };
    case "message": {
      const message = event.data;
      const spoke = message.role === "assistant" && message.kind === "text";
      return {
        ...state,
        messages: upsertMessage(state.messages, message),
        speaking: spoke ? "" : state.speaking,
      };
    }
    case "todos":
      return { ...state, todos: event.data.todos };
    case "draft":
      return {
        ...state,
        // 正在写的那个字段写完了：草稿里已经是全文
        writing: null,
        needsRefresh: event.data.version > state.draft.draft.version || state.needsRefresh,
      };
    case "status": {
      const data = event.data;
      const next: WorkbenchState = {
        ...state,
        agentStatus: data.agent_status ?? state.agentStatus,
        stage: data.stage ?? state.stage,
        awaiting: data.awaiting !== undefined ? data.awaiting : state.awaiting,
      };
      if (data.agent_status === "running" && state.agentStatus !== "running") next.awaiting = null;
      if (data.done) {
        next.speaking = "";
        next.writing = null;
        next.tool = null;
        next.needsRefresh = true;
      }
      return next;
    }
    default:
      return state;
  }
}

/** 重新读到草稿以后：换上新的草稿，清掉 needsRefresh */
export function withDraft(state: WorkbenchState, draft: Draft): WorkbenchState {
  return {
    ...state,
    draft,
    todos: draft.todos.length ? draft.todos : state.todos,
    needsRefresh: false,
    // 服务端的状态以最新读到的为准（事件可能漏了，例如转了轮询）
    agentStatus: draft.draft.agent_status,
    stage: draft.draft.stage,
    awaiting: draft.draft.awaiting,
  };
}

/** 现在在等用户回答的那条问卷、方案或改动（不是在等时为 null） */
export function awaitedMessage(state: WorkbenchState): WorkbenchMessage | null {
  if (state.agentStatus !== "awaiting_user" || !state.awaiting) return null;
  const seq = state.awaiting.seq;
  return state.messages.find((m) => m.seq === seq) ?? null;
}
