/**
 * 阅读页的会话控制（与界面无关，Node 里可测）：加载故事、提交行动、订阅回合事件流、
 * 流不可用时转轮询，并把这些结果按 turnMachine 的事件归并成界面状态。
 *
 * 提交：每次提交生成一个 Idempotency-Key；网络错误和服务端的临时错误用同一个键退避重试。
 * 409 TURN_IN_PROGRESS 直接订阅进行中的那一轮；STALE_PARENT 等说明故事已被推进，重新加载。
 * 退出页面只关闭连接，不取消服务端的生成。
 */

import { ApiError, describeError } from "../api/client.ts";
import type { StreamOutcome, TurnConnector, TurnStream, TurnStreamHandlers } from "../api/turnStream.ts";
import type { NewAction, PlaythroughDetail, Turn, TurnCreated, TurnError } from "../api/types.ts";
import {
  canSubmit,
  displayAction,
  headTurn,
  initialPlayState,
  isLive,
  playReducer,
  retryAction,
  unsentSubmission,
  type PlayEvent,
  type PlayState,
  type Submission,
} from "./turnMachine.ts";

export type PlayApi = {
  detail(playthroughId: string): Promise<PlaythroughDetail>;
  history(playthroughId: string, afterSeq: number, limit: number): Promise<Turn[]>;
  submit(
    playthroughId: string,
    body: { parent_turn_id: string | null; action: NewAction },
    idempotencyKey: string,
  ): Promise<TurnCreated>;
  turn(turnId: string): Promise<Turn>;
  cancel(turnId: string): Promise<Turn>;
};

export type PlaySessionDeps = {
  api: PlayApi;
  connect: TurnConnector;
  newKey: () => string;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** 轮询降级时查询回合状态的间隔 */
  pollIntervalMs?: number;
  /** 提交遇到网络错误时的退避；用完还失败就交给玩家点“重试” */
  submitBackoffMs?: readonly number[];
  historyPageSize?: number;
};

const TERMINAL = new Set(["replied", "committed", "failed", "archived"]);
const RESYNC_CODES = new Set(["STALE_PARENT", "OPENING_PENDING", "OPENING_EXISTS"]);

export function toTurnError(error: unknown): TurnError {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, retryable: error.retryable || error.isNetwork };
  }
  return { code: "UNKNOWN", message: describeError(error), retryable: true };
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class PlaySession {
  readonly playthroughId: string;
  private readonly deps: PlaySessionDeps;
  private state: PlayState = initialPlayState;
  private readonly listeners = new Set<(state: PlayState) => void>();
  private readonly lifetime = new AbortController();
  private stream: TurnStream | null = null;
  private streamTurnId: string | null = null;
  private loads = 0;

  constructor(playthroughId: string, deps: PlaySessionDeps) {
    this.playthroughId = playthroughId;
    this.deps = deps;
  }

  getState(): PlayState {
    return this.state;
  }

  subscribe(listener: (state: PlayState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private get disposed(): boolean {
    return this.lifetime.signal.aborted;
  }

  private dispatch(event: PlayEvent): void {
    if (this.disposed) return;
    const next = playReducer(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private sleep(ms: number): Promise<void> {
    return (this.deps.sleep ?? defaultSleep)(ms, this.lifetime.signal);
  }

  /** 离开页面：关闭连接、停止轮询。服务端的生成继续。 */
  dispose(): void {
    this.lifetime.abort();
    this.detach();
    this.listeners.clear();
  }

  // ---- 加载 ---------------------------------------------------------------------------

  /** 拉取详情和整条故事；有进行中的回合就接上它的事件流 */
  async load(): Promise<void> {
    const ticket = (this.loads += 1);
    this.detach();
    try {
      const detail = await this.deps.api.detail(this.playthroughId);
      const turns = await this.fetchHistory();
      if (this.disposed || ticket !== this.loads) return;
      this.dispatch({
        type: "loaded",
        turns,
        active: detail.active_turn,
        lastFailed: detail.last_failed,
        title: detail.playthrough.title,
        protagonist: detail.playthrough.protagonist_name,
        scenarioId: detail.playthrough.scenario_id,
        language: detail.playthrough.language,
      });
      const pending = this.state.pending;
      if (this.state.phase === "streaming" && pending?.turnId) this.attach(pending.turnId);
    } catch (error) {
      if (this.disposed || ticket !== this.loads) return;
      this.dispatch({ type: "load_failed", error: toTurnError(error) });
    }
  }

  private async fetchHistory(): Promise<Turn[]> {
    const pageSize = this.deps.historyPageSize ?? 200;
    const turns: Turn[] = [];
    let after = -1;
    for (;;) {
      const page = await this.deps.api.history(this.playthroughId, after, pageSize);
      turns.push(...page);
      const last = page[page.length - 1];
      if (page.length < pageSize || last === undefined) return turns;
      after = last.seq;
    }
  }

  // ---- 提交 ---------------------------------------------------------------------------

  /** 点选项、自由输入或生成开场 */
  async submit(action: NewAction): Promise<void> {
    if (!canSubmit(this.state)) return;
    const head = headTurn(this.state);
    const submission: Submission = { key: this.deps.newKey(), parentTurnId: head?.id ?? null, action };
    this.dispatch({ type: "submit", submission, display: displayAction(action, head?.options ?? []) });
    await this.send(submission);
  }

  /** 失败后重试：没送达的请求用原来的键重发；生成失败的那一轮用新键重新生成 */
  async retry(): Promise<void> {
    const unsent = unsentSubmission(this.state);
    if (unsent) {
      this.dispatch({ type: "submit", submission: unsent, display: this.state.pending?.action ?? null });
      await this.send(unsent);
      return;
    }
    const action = retryAction(this.state);
    if (action) await this.submit(action);
  }

  dismissError(): void {
    this.dispatch({ type: "dismiss_error" });
  }

  /** 停止生成：服务端结束后事件流会送来 turn.failed（CANCELLED） */
  async cancel(): Promise<void> {
    const turnId = this.state.pending?.turnId;
    if (!turnId) return;
    try {
      await this.deps.api.cancel(turnId);
    } catch {
      // 不在当前服务实例上等情况：租约到期后会自动结束，界面继续等事件流
    }
  }

  private async send(submission: Submission): Promise<void> {
    const backoff = this.deps.submitBackoffMs ?? [500, 1000, 2000, 4000, 8000];
    const body = { parent_turn_id: submission.parentTurnId, action: submission.action };
    for (let attempt = 0; ; attempt += 1) {
      if (this.disposed) return;
      let created: TurnCreated;
      try {
        created = await this.deps.api.submit(this.playthroughId, body, submission.key);
      } catch (error) {
        if (this.disposed || this.state.submission?.key !== submission.key) return;
        const transient =
          error instanceof ApiError && (error.isNetwork || (error.status >= 500 && error.retryable));
        const delay = backoff[attempt];
        if (transient && delay !== undefined) {
          await this.sleep(delay);
          continue;
        }
        await this.onSubmitError(error);
        return;
      }
      if (this.disposed || this.state.submission?.key !== submission.key) return;
      this.dispatch({ type: "submitted", turn: created.turn });
      this.attach(created.turn.id);
      return;
    }
  }

  private async onSubmitError(error: unknown): Promise<void> {
    if (error instanceof ApiError && error.code === "TURN_IN_PROGRESS") {
      // 上一轮（可能是另一台设备提交的）还在生成：接上它
      const activeId = error.field("active_turn_id");
      if (typeof activeId === "string") {
        try {
          const turn = await this.deps.api.turn(activeId);
          if (this.disposed) return;
          this.dispatch({ type: "submitted", turn });
          this.attach(turn.id);
          return;
        } catch {
          // 取不到就整页重新加载
        }
      }
      this.dispatch({ type: "stale" });
      await this.load();
      return;
    }
    if (error instanceof ApiError && RESYNC_CODES.has(error.code)) {
      this.dispatch({ type: "stale" });
      await this.load();
      return;
    }
    this.dispatch({ type: "submit_failed", error: toTurnError(error) });
  }

  // ---- 事件流 -------------------------------------------------------------------------

  private attach(turnId: string, lastEventId?: string): void {
    if (this.disposed) return;
    if (this.stream && this.streamTurnId === turnId) return;
    this.detach();
    const handlers: TurnStreamHandlers = {
      onEvent: (event) => {
        if (this.stream === stream) this.dispatch({ type: "stream", event });
      },
      onState: (state) => {
        if (this.stream === stream) this.dispatch({ type: "connection", state });
      },
    };
    if (lastEventId !== undefined) handlers.lastEventId = lastEventId;
    const stream = this.deps.connect(turnId, handlers);
    this.stream = stream;
    this.streamTurnId = turnId;
    stream.run().then(
      (outcome) => this.afterStream(stream, turnId, outcome),
      () => this.afterStream(stream, turnId, "polling"),
    );
  }

  private detach(): void {
    const stream = this.stream;
    this.stream = null;
    this.streamTurnId = null;
    stream?.close();
  }

  /** App 回到前台：连接如果正在退避重连，立刻带 Last-Event-ID 重连一次 */
  resume(): void {
    const stream = this.stream;
    const turnId = this.streamTurnId;
    if (!stream || !turnId || this.state.phase !== "reconnecting") return;
    const lastEventId = stream.lastEventId;
    this.detach();
    this.attach(turnId, lastEventId);
  }

  private async afterStream(stream: TurnStream, turnId: string, outcome: StreamOutcome): Promise<void> {
    if (this.stream !== stream) return; // 已经被替换或关闭
    this.stream = null;
    this.streamTurnId = null;
    // 流说结束了，界面却还在等这一轮（终止事件没能解析之类）：用轮询把结果对齐，不能卡在“生成中”
    const stillWaiting = outcome === "completed" && this.waitingFor(turnId);
    if (outcome === "polling" || stillWaiting) {
      this.dispatch({ type: "connection", state: "polling" });
      await this.poll(turnId);
    } else if (outcome === "unauthorized") {
      this.dispatch({
        type: "load_failed",
        error: { code: "UNAUTHENTICATED", message: "Session expired", retryable: false },
      });
    }
  }

  private waitingFor(turnId: string): boolean {
    return this.state.pending?.turnId === turnId && isLive(this.state);
  }

  /** 轮询降级：直到回合进入终态；网络错误时继续等 */
  private async poll(turnId: string): Promise<void> {
    const interval = this.deps.pollIntervalMs ?? 1500;
    while (!this.disposed && this.state.pending?.turnId === turnId) {
      try {
        const turn = await this.deps.api.turn(turnId);
        this.dispatch({ type: "polled", turn });
        if (TERMINAL.has(turn.status)) return;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          await this.load();
          return;
        }
      }
      await this.sleep(interval);
    }
  }
}
