/**
 * 回合状态机（纯 reducer，可单测）：把提交、事件流、连接状态和轮询结果归并成阅读页的界面状态。
 *
 * 状态：loading → idle ⇄ submitting → streaming（→ reconnecting / polling）→ idle 或 failed；
 * 故事被别的设备推进时进入 syncing，由调用方重新拉取后回到 idle；加载失败是 load_failed。
 * 见 docs/client.md 第 1 节。
 */

import type { NewAction, Turn, TurnAction, TurnError, TurnEvent, TurnOption } from "../../api/types.ts";

export type Phase =
  | "loading"
  | "load_failed"
  | "idle"
  | "submitting"
  | "streaming"
  | "reconnecting"
  | "polling"
  | "syncing"
  | "failed";

/** 故事流里一个已经落定的回合 */
export type StoryTurn = {
  id: string;
  seq: number;
  action: TurnAction;
  narrative: string;
  options: TurnOption[];
};

/** 正在生成（或刚失败）的回合 */
export type PendingTurn = {
  turnId: string | null;
  seq: number | null;
  action: TurnAction | null;
  narrative: string;
  options: TurnOption[];
  buildingWorld: boolean;
  waitingState: boolean;
};

export type Submission = {
  /** 网络错误时用同一个 Idempotency-Key 重试，服务端不会生成两个回合 */
  key: string;
  parentTurnId: string | null;
  action: NewAction;
};

export type PlayState = {
  phase: Phase;
  /** 游玩记录的标题（加载后才有） */
  title: string;
  /** 主角名和剧本 ID（阅读页顶上的书名页用；加载后才有） */
  protagonist: string;
  scenarioId: string | null;
  turns: StoryTurn[];
  pending: PendingTurn | null;
  error: TurnError | null;
  submission: Submission | null;
};

export type PlayEvent =
  | {
      type: "loaded";
      turns: Turn[];
      active: Turn | null;
      lastFailed: Turn | null;
      title?: string;
      protagonist?: string;
      scenarioId?: string | null;
    }
  | { type: "load_failed"; error: TurnError }
  | { type: "submit"; submission: Submission; display: TurnAction | null }
  | { type: "submitted"; turn: Turn }
  | { type: "submit_failed"; error: TurnError }
  | { type: "stale" }
  | { type: "stream"; event: TurnEvent }
  | { type: "connection"; state: "open" | "reconnecting" | "polling" }
  | { type: "polled"; turn: Turn }
  | { type: "dismiss_error" };

export const initialPlayState: PlayState = {
  phase: "loading",
  title: "",
  protagonist: "",
  scenarioId: null,
  turns: [],
  pending: null,
  error: null,
  submission: null,
};

function storyTurn(turn: Turn): StoryTurn {
  return {
    id: turn.id,
    seq: turn.seq,
    action: turn.action,
    narrative: turn.narrative,
    options: turn.options,
  };
}

function pendingFrom(turn: Turn): PendingTurn {
  return {
    turnId: turn.id,
    seq: turn.seq,
    action: turn.action,
    // 正在生成的回合会从事件流的开头重放，叙述从空开始拼，避免重复
    narrative: turn.status === "generating" ? "" : turn.narrative,
    options: [],
    buildingWorld: false,
    waitingState: false,
  };
}

const LIVE: ReadonlySet<Phase> = new Set(["submitting", "streaming", "reconnecting", "polling"]);

function complete(state: PlayState, finished: StoryTurn): PlayState {
  const turns = state.turns.filter((t) => t.seq < finished.seq);
  turns.push(finished);
  return { ...state, phase: "idle", turns, pending: null, error: null, submission: null };
}

function fail(state: PlayState, error: TurnError): PlayState {
  return { ...state, phase: "failed", error, submission: null };
}

export function playReducer(state: PlayState, event: PlayEvent): PlayState {
  switch (event.type) {
    case "loaded": {
      const turns = [...event.turns].sort((a, b) => a.seq - b.seq).map(storyTurn);
      const base: PlayState = {
        ...state,
        title: event.title ?? state.title,
        protagonist: event.protagonist ?? state.protagonist,
        scenarioId: event.scenarioId !== undefined ? event.scenarioId : state.scenarioId,
        turns,
        error: null,
        submission: null,
      };
      // 先取详情后取历史：这中间生成完的回合已经在历史里了，不再当作进行中
      const active = event.active && !turns.some((t) => t.id === event.active?.id) ? event.active : null;
      if (active) return { ...base, phase: "streaming", pending: pendingFrom(active) };
      if (event.lastFailed) {
        return {
          ...base,
          phase: "failed",
          pending: pendingFrom(event.lastFailed),
          error: event.lastFailed.error ?? { code: "UNKNOWN", message: "生成失败", retryable: true },
        };
      }
      return { ...base, phase: "idle", pending: null };
    }
    case "load_failed":
      return { ...state, phase: "load_failed", error: event.error, pending: null, submission: null };
    case "submit":
      return {
        ...state,
        phase: "submitting",
        error: null,
        submission: event.submission,
        pending: {
          turnId: null,
          seq: null,
          action: event.display,
          narrative: "",
          options: [],
          buildingWorld: false,
          waitingState: false,
        },
      };
    case "submitted":
      return {
        ...state,
        phase: state.phase === "submitting" ? "streaming" : state.phase,
        pending: {
          ...(state.pending ?? pendingFrom(event.turn)),
          turnId: event.turn.id,
          seq: event.turn.seq,
          action: event.turn.action,
        },
      };
    case "submit_failed":
      // 保留待发的行动和幂等键：“重试”用同一个键重发，服务端不会生成两个回合
      return { ...state, phase: "failed", error: event.error };
    case "stale":
      return { ...state, phase: "syncing", pending: null, submission: null };
    case "connection": {
      if (!LIVE.has(state.phase)) return state;
      const phase = event.state === "open" ? "streaming" : event.state;
      return state.phase === phase ? state : { ...state, phase };
    }
    case "polled": {
      const turn = event.turn;
      if (!state.pending || state.pending.turnId !== turn.id) return state;
      if (turn.status === "committed" || turn.status === "replied") return complete(state, storyTurn(turn));
      if (turn.status === "failed" || turn.status === "archived") {
        return fail(
          { ...state, pending: { ...state.pending, narrative: turn.narrative } },
          turn.error ?? { code: "UNKNOWN", message: "生成失败", retryable: true },
        );
      }
      return state;
    }
    case "dismiss_error":
      return state.phase === "failed"
        ? { ...state, phase: "idle", error: null, pending: null, submission: null }
        : state;
    case "stream":
      return onStream(state, event.event);
  }
}

function onStream(state: PlayState, event: TurnEvent): PlayState {
  const pending = state.pending;
  if (!pending) return state;
  switch (event.event) {
    case "turn.created":
      return {
        ...state,
        phase: state.phase === "submitting" ? "streaming" : state.phase,
        pending: { ...pending, turnId: pending.turnId ?? event.data.turn_id, seq: event.data.seq },
      };
    case "world.building":
      return { ...state, pending: { ...pending, buildingWorld: true } };
    case "world.ready":
      return { ...state, pending: { ...pending, buildingWorld: false } };
    case "turn.waiting_state":
      return { ...state, pending: { ...pending, waitingState: event.data.done !== true } };
    case "narrative.delta":
      return {
        ...state,
        pending: { ...pending, narrative: pending.narrative + event.data.text, waitingState: false },
      };
    case "narrative.done":
      return state;
    case "options.ready":
      return { ...state, pending: { ...pending, options: event.data.options } };
    case "snapshot":
      return {
        ...state,
        pending: { ...pending, narrative: event.data.narrative, options: event.data.options },
      };
    case "turn.completed": {
      const t = event.data.turn;
      return complete(state, {
        id: t.id,
        seq: t.seq,
        action: pending.action ?? { source: "opening", text: "" },
        narrative: t.narrative,
        options: t.options,
      });
    }
    case "turn.failed":
      return fail(state, event.data);
  }
}

// ---- 派生 -------------------------------------------------------------------------------

export function headTurn(state: PlayState): StoryTurn | null {
  return state.turns.length > 0 ? (state.turns[state.turns.length - 1] ?? null) : null;
}

/** 可以点选项或自由输入了 */
export function canAct(state: PlayState): boolean {
  return state.phase === "idle" && headTurn(state) !== null;
}

/** 可以提交新的行动（空闲，或上一轮失败后换一个行动） */
export function canSubmit(state: PlayState): boolean {
  return state.phase === "idle" || state.phase === "failed";
}

/** 还没有开场，也没有失败的开场可以重试：显示“生成开场” */
export function needsOpening(state: PlayState): boolean {
  return state.turns.length === 0 && state.phase === "idle";
}

/** 失败后可以重试：重发没送达的请求，或重新生成失败的那一轮 */
export function canRetry(state: PlayState): boolean {
  return state.phase === "failed" && state.pending?.action != null && state.error?.retryable !== false;
}

/** 失败的请求从没被服务端接收（没有回合 id）：重试时沿用原来的幂等键 */
export function unsentSubmission(state: PlayState): Submission | null {
  return state.phase === "failed" && state.pending?.turnId == null ? state.submission : null;
}

/** 有一轮正在进行（提交中、生成中、重连或轮询中） */
export function isLive(state: PlayState): boolean {
  return LIVE.has(state.phase);
}

export function isBusy(state: PlayState): boolean {
  return LIVE.has(state.phase) || state.phase === "loading" || state.phase === "syncing";
}

/** 失败后“重试”要提交的行动：与失败的那一轮相同 */
export function retryAction(state: PlayState): NewAction | null {
  if (state.phase !== "failed" || !state.pending?.action) return null;
  const action = state.pending.action;
  if (action.source === "opening") return { source: "opening" };
  if (action.source === "option" && action.option_id)
    return { source: "option", option_id: action.option_id };
  return { source: "text", text: action.text };
}

/** 提交前在界面上先显示玩家的行动（选项按 id 找文字） */
export function displayAction(action: NewAction, options: TurnOption[]): TurnAction | null {
  if (action.source === "opening") return { source: "opening", text: "" };
  if (action.source === "text") return { source: "text", text: action.text };
  const option = options.find((o) => o.id === action.option_id);
  return { source: "option", text: option?.text ?? "", option_id: action.option_id };
}
