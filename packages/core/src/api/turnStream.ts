/**
 * 用 SseClient 打开回合事件流，给 PlaySession 用。断线续传、转轮询的策略都在 SseClient 里。
 *
 * 每次连接（包括重连）带一个新的请求单号（X-Request-ID），和服务端的 sse.open / sse.close 日志对得上。
 * 连接状态变化、出错、最后的结果通过 log 记进诊断日志。
 */

import { newRequestId, type LogFields, type LogLevel } from "../observability/log.ts";
import { parseTurnEvent } from "./events.ts";
import {
  HttpStatusError,
  SseClient,
  StalledError,
  type FetchLike,
  type HeadersSource,
  type SseClientState,
  type SseOutcome,
} from "./sse/sseClient.ts";
import type { TurnEvent } from "./types.ts";

export type StreamOutcome = SseOutcome;

export type TurnStream = {
  run(): Promise<StreamOutcome>;
  close(): void;
  readonly lastEventId: string | undefined;
};

export type TurnStreamHandlers = {
  /** 从这个事件之后续传；不传就从头重放 */
  lastEventId?: string;
  onEvent(event: TurnEvent): void;
  onState(state: "open" | "reconnecting"): void;
};

/** 打开一个回合的事件流（App 里是 SseClient，测试里是假的） */
export type TurnConnector = (turnId: string, handlers: TurnStreamHandlers) => TurnStream;

export type TurnStreamOptions = {
  /** 回合事件流的完整地址 */
  url: (turnId: string) => string;
  fetch: FetchLike;
  headers: HeadersSource;
  onUnauthorized: () => Promise<boolean>;
  /** 重连退避用的等待（测试里替换） */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** 写诊断日志 */
  log?: (level: LogLevel, event: string, fields: LogFields) => void;
  /** 生成请求单号（测试里替换） */
  newRequestId?: () => string;
};

const STATE_LEVEL: Record<SseClientState, LogLevel> = {
  idle: "debug",
  connecting: "debug",
  open: "info",
  reconnecting: "warn",
  polling: "warn",
  closed: "debug",
};

function describeSseError(error: unknown): LogFields {
  if (error instanceof HttpStatusError) return { error: "http", status: error.status };
  if (error instanceof StalledError) return { error: "stalled", detail: error.message };
  if (error instanceof Error) return { error: error.name, detail: error.message };
  return { error: String(error) };
}

export function sseTurnConnector(options: TurnStreamOptions): TurnConnector {
  const log = options.log ?? (() => undefined);
  const makeId = options.newRequestId ?? newRequestId;
  return (turnId, handlers) => {
    let requestId = "";
    // 每次连接前取一次请求头：换上最新的令牌，再带一个新的单号
    const headers = async (): Promise<Record<string, string>> => {
      const base = typeof options.headers === "function" ? await options.headers() : options.headers;
      requestId = makeId();
      return { ...base, "X-Request-ID": requestId };
    };
    const client = new SseClient({
      url: options.url(turnId),
      fetch: options.fetch,
      headers,
      ...(handlers.lastEventId !== undefined ? { lastEventId: handlers.lastEventId } : {}),
      onUnauthorized: options.onUnauthorized,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      // 终止事件要能解析才算结束；解析不了就当断线，后面靠重连或轮询拿到结果
      isTerminal: (message) =>
        (message.event === "turn.completed" || message.event === "turn.failed") &&
        parseTurnEvent(message) !== null,
      onEvent: (message) => {
        const event = parseTurnEvent(message);
        if (event) handlers.onEvent(event);
      },
      onStateChange: (state) => {
        log(STATE_LEVEL[state], "sse.state", {
          turn_id: turnId,
          state,
          request_id: requestId || null,
          reconnects: client.reconnectCount,
        });
        if (state === "open" || state === "reconnecting") handlers.onState(state);
      },
      onError: (error, failures) => {
        log("warn", "sse.error", {
          turn_id: turnId,
          request_id: requestId || null,
          failures,
          ...describeSseError(error),
        });
      },
    });
    log("debug", "sse.connect", { turn_id: turnId, resume_from: handlers.lastEventId ?? null });
    return {
      run: async () => {
        const outcome = await client.run();
        // completed 回合结束；polling 转轮询；closed 页面关了；unauthorized 登录失效
        log(outcome === "completed" || outcome === "closed" ? "info" : "warn", "sse.finished", {
          turn_id: turnId,
          outcome,
          reconnects: client.reconnectCount,
        });
        return outcome;
      },
      close: () => client.close(),
      get lastEventId() {
        return client.lastEventId;
      },
    };
  };
}
