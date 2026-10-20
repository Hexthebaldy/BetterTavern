/**
 * SseClient：基于 fetch 流式读取的 SSE 客户端（App 里用 expo/fetch）。
 *
 * 断线分两种处理：
 * - 网络不通（fetch 直接失败、读取中途断开）：按 0.5、1、2、4 秒退避，上限 10 秒，一直重连，
 *   带 Last-Event-ID 续传。断网不会让客户端放弃 SSE；
 * - 连上了却拿不到数据（HTTP 错误、超过 idleTimeoutMs 没有任何字节、连上后一个事件都没有就结束）：
 *   说明这一跳可能在缓冲 SSE，连续 3 次就转为轮询，由调用方接手。
 * 服务端返回 404（回合不存在或不在本服务）时直接转轮询。收到任何事件都会把失败计数清零。
 * 401：先让调用方刷新访问令牌（onUnauthorized），刷新成功就立即重连；刷新失败或连续出现就结束，
 * 结果为 "unauthorized"。请求头可以是函数，每次连接前取一次，保证带的是最新的令牌。
 * close() 只断开连接，不取消服务端的生成。
 */

import { SseParser, type SseMessage } from "./sseParser.ts";

export type ResponseLike = {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
};

export type FetchLike = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal },
) => Promise<ResponseLike>;

export type SseClientState = "idle" | "connecting" | "open" | "reconnecting" | "polling" | "closed";

export type SseOutcome = "completed" | "polling" | "closed" | "unauthorized";

export type HeadersSource =
  Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

export type SseClientOptions = {
  url: string;
  fetch: FetchLike;
  headers?: HeadersSource;
  lastEventId?: string;
  onEvent: (message: SseMessage) => void;
  onStateChange?: (state: SseClientState) => void;
  onError?: (error: unknown, failures: number) => void;
  /** 收到 401 时调用：返回 true 表示令牌已刷新，可以立即重连 */
  onUnauthorized?: () => Promise<boolean>;
  /** 收到这些事件就认为流已结束，不再重连 */
  isTerminal?: (message: SseMessage) => boolean;
  backoffMs?: readonly number[];
  maxBackoffMs?: number;
  /** 连上却拿不到数据的情况连续出现几次后转轮询 */
  maxStalls?: number;
  /** 多久收不到任何字节（含服务端每 15 秒一次的 keepalive）就判定连接卡住 */
  idleTimeoutMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export const DEFAULT_BACKOFF_MS = [500, 1000, 2000, 4000] as const;

export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

export class StalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StalledError";
  }
}

const MAX_AUTH_RETRIES = 2;

const defaultTerminal = (message: SseMessage): boolean =>
  message.event === "turn.completed" || message.event === "turn.failed";

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
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

type ReadResult = { outcome: "completed" | "ended"; events: number };

export class SseClient {
  private readonly options: SseClientOptions;
  private readonly lifetime = new AbortController();
  private connection: AbortController | null = null;
  private state: SseClientState = "idle";
  private lastId: string | undefined;
  private reconnects = 0;

  constructor(options: SseClientOptions) {
    this.options = options;
    this.lastId = options.lastEventId;
  }

  get lastEventId(): string | undefined {
    return this.lastId;
  }

  /** 已经发生的重连次数（不含第一次连接） */
  get reconnectCount(): number {
    return this.reconnects;
  }

  get currentState(): SseClientState {
    return this.state;
  }

  /** 关闭连接、不再重连。服务端的生成不受影响。 */
  close(): void {
    this.lifetime.abort();
    this.connection?.abort();
    this.setState("closed");
  }

  /** 主动断开当前连接并立即重连（探针用来模拟断网）。 */
  dropConnection(): void {
    this.connection?.abort();
  }

  async run(): Promise<SseOutcome> {
    const {
      maxStalls = 3,
      backoffMs = DEFAULT_BACKOFF_MS,
      maxBackoffMs = 10_000,
      sleep = abortableSleep,
    } = this.options;
    const isTerminal = this.options.isTerminal ?? defaultTerminal;
    let failures = 0; // 连续失败次数，决定退避时长
    let stalls = 0; // 连续“连上却拿不到数据”的次数，决定是否转轮询
    let authRetries = 0; // 连续因 401 刷新令牌的次数
    let attempt = 0;
    while (!this.lifetime.signal.aborted) {
      if (attempt > 0) this.reconnects += 1;
      attempt += 1;
      this.setState(attempt === 1 ? "connecting" : "reconnecting");
      const connection = new AbortController();
      this.connection = connection;
      const forward = (): void => connection.abort();
      this.lifetime.signal.addEventListener("abort", forward, { once: true });
      try {
        const result = await this.readOnce(connection, isTerminal, () => {
          failures = 0;
          stalls = 0;
          authRetries = 0;
        });
        if (result.outcome === "completed") {
          this.setState("closed");
          return "completed";
        }
        // 流在终止事件之前结束：收到过事件就当普通断线，否则说明这一跳在缓冲
        failures += 1;
        if (result.events === 0) stalls += 1;
      } catch (error) {
        if (this.lifetime.signal.aborted) break;
        if (error instanceof HttpStatusError && error.status === 404) {
          this.setState("polling");
          return "polling";
        }
        if (error instanceof HttpStatusError && error.status === 401) {
          authRetries += 1;
          const refreshed =
            authRetries <= MAX_AUTH_RETRIES && this.options.onUnauthorized
              ? await this.options.onUnauthorized().catch(() => false)
              : false;
          if (this.lifetime.signal.aborted) break;
          if (!refreshed) {
            this.setState("closed");
            return "unauthorized";
          }
          continue; // 令牌已刷新：立即重连，不计失败
        }
        const dropped = connection.signal.aborted && !(error instanceof StalledError);
        if (!dropped) {
          // 主动 dropConnection() 不算失败
          failures += 1;
          if (error instanceof HttpStatusError || error instanceof StalledError) stalls += 1;
          this.options.onError?.(error, failures);
        }
      } finally {
        this.lifetime.signal.removeEventListener("abort", forward);
      }
      if (stalls >= maxStalls) {
        this.setState("polling");
        return "polling";
      }
      if (failures > 0) {
        const step = backoffMs[Math.min(failures - 1, backoffMs.length - 1)] ?? maxBackoffMs;
        const delay = failures > backoffMs.length ? maxBackoffMs : Math.min(step, maxBackoffMs);
        await sleep(delay, this.lifetime.signal);
      }
    }
    this.setState("closed");
    return "closed";
  }

  private async readOnce(
    connection: AbortController,
    isTerminal: (message: SseMessage) => boolean,
    onEvent: () => void,
  ): Promise<ReadResult> {
    const { idleTimeoutMs = 45_000 } = this.options;
    const source = this.options.headers;
    const extra = typeof source === "function" ? await source() : source;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      ...extra,
    };
    if (this.lastId) headers["Last-Event-ID"] = this.lastId;

    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armIdleTimer = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        connection.abort();
      }, idleTimeoutMs);
    };
    let events = 0;
    armIdleTimer();
    try {
      const response = await this.options.fetch(this.options.url, {
        method: "GET",
        headers,
        signal: connection.signal,
      });
      if (!response.ok) throw new HttpStatusError(response.status);
      if (!response.body) throw new Error("Response has no body: streaming is not supported here");
      this.setState("open");
      armIdleTimer();
      const parser = new SseParser();
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (!done) armIdleTimer();
          const messages = done ? parser.end() : parser.feed(value);
          for (const message of messages) {
            events += 1;
            onEvent();
            if (message.id !== undefined) this.lastId = message.id;
            this.options.onEvent(message);
            if (isTerminal(message)) return { outcome: "completed", events };
          }
          if (done) return { outcome: "ended", events };
        }
      } finally {
        reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (stalled) throw new StalledError(`No data for ${idleTimeoutMs} ms`);
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private setState(state: SseClientState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}
