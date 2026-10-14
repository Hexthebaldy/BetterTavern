/**
 * 用 SseClient 打开回合事件流，给 PlaySession 用。断线续传、转轮询的策略都在 SseClient 里。
 */

import { parseTurnEvent } from "./events.ts";
import { SseClient, type FetchLike, type HeadersSource, type SseOutcome } from "./sse/sseClient.ts";
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
};

export function sseTurnConnector(options: TurnStreamOptions): TurnConnector {
  return (turnId, handlers) => {
    const client = new SseClient({
      url: options.url(turnId),
      fetch: options.fetch,
      headers: options.headers,
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
        if (state === "open" || state === "reconnecting") handlers.onState(state);
      },
    });
    return {
      run: () => client.run(),
      close: () => client.close(),
      get lastEventId() {
        return client.lastEventId;
      },
    };
  };
}
