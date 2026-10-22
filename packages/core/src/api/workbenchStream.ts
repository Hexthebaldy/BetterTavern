/**
 * 工作台的推送事件（SSE）：GET /v1/workbench/drafts/{id}/events。一直开着，不会自己结束；
 * 断线续传、转轮询的策略都在 SseClient 里。转轮询（中间的代理在缓冲 SSE）时由调用方定期重新读草稿和对话记录。
 *
 * 不认识的事件（以后的版本新增的）直接忽略。每次连接带一个新的请求单号（X-Request-ID）。
 */

import { newRequestId, type LogFields, type LogLevel } from "../observability/log.ts";
import { SseClient, type FetchLike, type HeadersSource, type SseOutcome } from "./sse/sseClient.ts";
import type { SseMessage } from "./sse/sseParser.ts";
import type { WorkbenchEvent } from "./types.ts";

const KNOWN = new Set<string>(["status", "delta", "field_delta", "tool", "message", "todos", "draft"]);

export function parseWorkbenchEvent(message: SseMessage): WorkbenchEvent | null {
  if (!KNOWN.has(message.event)) return null;
  let data: unknown;
  try {
    data = message.data === "" ? {} : JSON.parse(message.data);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const event = { event: message.event, data } as WorkbenchEvent;
  switch (event.event) {
    case "delta":
    case "field_delta":
      return typeof event.data.text === "string" ? event : null;
    case "message":
      return typeof event.data.seq === "number" && typeof event.data.kind === "string" ? event : null;
    case "todos":
      return Array.isArray(event.data.todos) ? event : null;
    default:
      return event;
  }
}

export type WorkbenchStream = {
  run(): Promise<SseOutcome>;
  close(): void;
};

export type WorkbenchStreamHandlers = {
  /** 从这个事件之后续传（对话记录接口返回的 last_event_id，或者上次收到的事件 id） */
  lastEventId?: string;
  onEvent(event: WorkbenchEvent): void;
  onState?(state: "open" | "reconnecting" | "polling"): void;
};

export type WorkbenchConnector = (draftId: string, handlers: WorkbenchStreamHandlers) => WorkbenchStream;

export type WorkbenchStreamOptions = {
  url: (draftId: string) => string;
  fetch: FetchLike;
  headers: HeadersSource;
  onUnauthorized: () => Promise<boolean>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (level: LogLevel, event: string, fields: LogFields) => void;
  newRequestId?: () => string;
};

export function sseWorkbenchConnector(options: WorkbenchStreamOptions): WorkbenchConnector {
  const log = options.log ?? (() => undefined);
  const makeId = options.newRequestId ?? newRequestId;
  return (draftId, handlers) => {
    let requestId = "";
    const headers = async (): Promise<Record<string, string>> => {
      const base = typeof options.headers === "function" ? await options.headers() : options.headers;
      requestId = makeId();
      return { ...base, "X-Request-ID": requestId };
    };
    const client = new SseClient({
      url: options.url(draftId),
      fetch: options.fetch,
      headers,
      ...(handlers.lastEventId !== undefined ? { lastEventId: handlers.lastEventId } : {}),
      onUnauthorized: options.onUnauthorized,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      // 工作台的事件流不会自己结束
      isTerminal: () => false,
      onEvent: (message) => {
        const event = parseWorkbenchEvent(message);
        if (event) handlers.onEvent(event);
      },
      onStateChange: (state) => {
        log(state === "reconnecting" || state === "polling" ? "warn" : "debug", "workbench.sse_state", {
          draft_id: draftId,
          state,
          request_id: requestId || null,
        });
        if (state === "open" || state === "reconnecting" || state === "polling") handlers.onState?.(state);
      },
      onError: (error, failures) => {
        log("warn", "workbench.sse_error", {
          draft_id: draftId,
          request_id: requestId || null,
          failures,
          error: error instanceof Error ? error.name : String(error),
        });
      },
    });
    return { run: () => client.run(), close: () => client.close() };
  };
}
