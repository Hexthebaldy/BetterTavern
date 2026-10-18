/**
 * ApiClient：JSON 与 multipart 请求、problem+json 错误、超时，以及访问令牌。
 *
 * 带令牌的请求遇到 401 时先让会话刷新一次令牌再重试一次；还是 401 就把错误交给调用方
 * （会话那边刷新失败时已经退出登录）。只用标准 fetch 接口，Node 测试里也能跑。
 *
 * 每个请求带一个请求单号（X-Request-ID），服务端这次请求的日志都带着它；ApiError 上也有，
 * 意外的错误（连不上、5xx、返回内容看不懂）在界面上会附上单号的前 8 位，方便去日志里查。
 * 每个请求结束时调用 onRequest，App 用它把失败和慢的请求记进诊断日志。
 */

import { currentLanguage, i18n, lookup } from "../i18n/index.ts";
import { newRequestId } from "../observability/log.ts";
import type { Problem, TurnError } from "./types.ts";

export type HttpRequestInit = {
  method: string;
  headers: Record<string, string>;
  body?: string | FormData;
  signal: AbortSignal;
};

export type HttpResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type HttpFetch = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

export type AuthHooks = {
  /** 当前可用的访问令牌（快过期时先刷新）；没有登录时返回 null */
  accessToken(): Promise<string | null>;
  /** 服务端认为令牌无效：强制刷新一次，成功返回 true */
  refresh(): Promise<boolean>;
};

export type ApiErrorInit = {
  status: number;
  code: string;
  retryable: boolean;
  problem?: Problem | null;
  timedOut?: boolean;
  requestId?: string | null;
};

export class ApiError extends Error {
  /** HTTP 状态码；0 表示没有拿到响应（网络不通、超时） */
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly problem: Problem | null;
  readonly timedOut: boolean;
  /** 出错的那个请求的单号；不是请求引起的错误为 null */
  readonly requestId: string | null;

  constructor(message: string, init: ApiErrorInit) {
    super(message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable;
    this.problem = init.problem ?? null;
    this.timedOut = init.timedOut ?? false;
    this.requestId = init.requestId ?? null;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** problem 里随错误附带的字段，比如 TURN_IN_PROGRESS 的 active_turn_id */
  field(name: string): unknown {
    return this.problem?.[name];
  }
}

export function networkError(cause: unknown, timedOut: boolean, requestId: string | null = null): ApiError {
  const error = new ApiError(timedOut ? "Server timed out" : "Can't reach the server", {
    status: 0,
    code: timedOut ? "TIMEOUT" : "NETWORK",
    retryable: true,
    timedOut,
    requestId,
  });
  (error as { cause?: unknown }).cause = cause;
  return error;
}

function isProblem(data: unknown): data is Problem {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.code === "string" && typeof d.title === "string";
}

/** 把非 2xx 响应变成 ApiError：优先用服务端的 problem+json，其次（比如代理返回的 HTML）按状态码 */
export function errorFromResponse(status: number, data: unknown, requestId: string | null = null): ApiError {
  if (isProblem(data)) {
    return new ApiError(data.title, {
      status,
      code: data.code,
      retryable: data.retryable === true,
      problem: data,
      requestId: typeof data.request_id === "string" ? data.request_id : requestId,
    });
  }
  return new ApiError(`HTTP ${status}`, {
    status,
    code: `HTTP_${status}`,
    retryable: status >= 500 || status === 429,
    requestId,
  });
}

/** 一个请求的结果，给诊断日志用（不含请求体和响应体） */
export type RequestRecord = {
  method: string;
  /** 不带查询参数的路径 */
  path: string;
  /** 0 表示没有拿到响应 */
  status: number;
  durationMs: number;
  requestId: string;
  /** 出错时的错误码 */
  code: string | null;
  /** 连不上时底层异常的类型和说明（例如 TypeError: Network request failed） */
  detail?: string;
};

export type RequestOptions = {
  /** JSON 请求体 */
  body?: unknown;
  /** multipart 请求体（上传文件）；与 body 二选一 */
  form?: FormData;
  headers?: Record<string, string>;
  /** 默认带访问令牌；登录、注册、刷新令牌时传 false */
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ApiClientOptions = {
  baseUrl: () => string;
  fetch: HttpFetch;
  clientVersion: string;
  auth?: AuthHooks;
  timeoutMs?: number;
  /** 每个请求结束时调用（包括连不上的） */
  onRequest?: (record: RequestRecord) => void;
  /** 生成请求单号（测试里替换） */
  newRequestId?: () => string;
};

type RawResponse = { status: number; ok: boolean; text: string; requestId: string; durationMs: number };

export class ApiClient {
  private readonly options: ApiClientOptions;

  constructor(options: ApiClientOptions) {
    this.options = options;
  }

  get baseUrl(): string {
    return this.options.baseUrl();
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth === false ? undefined : this.options.auth;
    let raw = await this.send(method, path, options, auth);
    if (raw.status === 401 && auth) {
      this.report(method, path, raw, "UNAUTHENTICATED");
      const refreshed = await auth.refresh().catch(() => false);
      if (refreshed) raw = await this.send(method, path, options, auth);
    }
    try {
      const data = parse<T>(raw);
      this.report(method, path, raw, null);
      return data;
    } catch (error) {
      this.report(method, path, raw, error instanceof ApiError ? error.code : "UNKNOWN");
      throw error;
    }
  }

  private report(method: string, path: string, raw: RawResponse, code: string | null): void {
    this.options.onRequest?.({
      method,
      path: path.split("?")[0] ?? path,
      status: raw.status,
      durationMs: raw.durationMs,
      requestId: raw.requestId,
      code,
    });
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, { ...options, body });
  }

  private async send(
    method: string,
    path: string,
    options: RequestOptions,
    auth: AuthHooks | undefined,
  ): Promise<RawResponse> {
    const requestId = (this.options.newRequestId ?? newRequestId)();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Client-Version": this.options.clientVersion,
      "X-Request-ID": requestId,
      ...options.headers,
    };
    let body: string | FormData | undefined;
    if (options.form !== undefined) {
      body = options.form; // multipart 的 Content-Type（含 boundary）由 fetch 自己生成
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    if (auth) {
      const token = await auth.accessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const outer = options.signal;
    const forward = (): void => controller.abort();
    outer?.addEventListener("abort", forward, { once: true });
    let timedOut = false;
    const started = Date.now();
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      options.timeoutMs ?? this.options.timeoutMs ?? 30_000,
    );
    try {
      const init: HttpRequestInit = { method, headers, signal: controller.signal };
      if (body !== undefined) init.body = body;
      const response = await this.options.fetch(`${this.options.baseUrl()}${path}`, init);
      const text = response.status === 204 ? "" : await response.text();
      return { status: response.status, ok: response.ok, text, requestId, durationMs: Date.now() - started };
    } catch (error) {
      if (outer?.aborted) throw error; // 调用方主动取消：原样抛出，由调用方忽略
      // 界面上一律显示“连不上服务器”；原始异常的类型和说明记进诊断日志，便于区分真断网和请求没发出去
      const failed = networkError(error, timedOut, requestId);
      this.options.onRequest?.({
        method,
        path: path.split("?")[0] ?? path,
        status: 0,
        durationMs: Date.now() - started,
        requestId,
        code: failed.code,
        detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      throw failed;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", forward);
    }
  }
}

function parse<T>(raw: RawResponse): T {
  let data: unknown;
  if (raw.text !== "") {
    try {
      data = JSON.parse(raw.text);
    } catch {
      data = undefined;
    }
  }
  if (!raw.ok) throw errorFromResponse(raw.status, data, raw.requestId);
  if (raw.text !== "" && data === undefined) {
    // 常见原因：服务器地址填成了别的服务（比如 Expo 的 8081 端口），返回的是网页
    throw new ApiError("Unreadable response", {
      status: raw.status,
      code: "BAD_RESPONSE",
      retryable: false,
      requestId: raw.requestId,
    });
  }
  return data as T;
}

/** 出乎意料的错误：连不上、服务端 5xx、返回内容看不懂。这些在界面上附上单号，方便查日志 */
function unexpected(error: ApiError): boolean {
  return error.status === 0 || error.status >= 500 || error.code === "BAD_RESPONSE";
}

/**
 * 界面上显示的错误文字，按错误码翻译成界面语言（docs/i18n.md 第 3 节）。服务端的说明（message）是英文：
 * 只在英文界面、又没有对应的翻译时直接用；中文、日文界面这时按 HTTP 状态码给一句通用的，不夹英文。
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const text = apiErrorText(error);
    return unexpected(error) && error.requestId
      ? i18n.t("errors.withRef", { text, ref: error.requestId.slice(0, 8) })
      : text;
  }
  if (error instanceof Error && error.message) return error.message;
  return i18n.t("errors.generic");
}

function apiErrorText(error: ApiError): string {
  if (error.code === "NETWORK") return i18n.t("errors.network");
  if (error.code === "TIMEOUT") return i18n.t("errors.timeout");
  if (error.code === "BAD_RESPONSE") return i18n.t("errors.badResponse");
  const english = currentLanguage() === "en" && error.problem !== null && error.message !== "";
  if (error.code === "VALIDATION_ERROR") {
    // 业务校验带 field：按字段说；不认识的字段，英文界面用服务端更具体的说明
    const field = error.field("field");
    const byField = typeof field === "string" ? lookup(`errors.field.${field}`) : null;
    if (byField) return byField;
    if (english) return error.message;
  }
  const byCode = error.problem ? lookup(`errors.api.${error.code}`) : null;
  if (byCode) return byCode;
  if (english) return error.message;
  return lookup(`errors.status.${error.status}`) ?? i18n.t("errors.httpStatus", { status: error.status });
}

/**
 * 回合失败（turn.failed 事件、回合详情里的 error）的说明：先按服务商错误的原因（reason），
 * 再按回合失败码，最后按接口错误码；都没有时英文界面用服务端的说明，中文、日文界面说“生成失败”。
 */
export function describeTurnError(error: Pick<TurnError, "code" | "message" | "reason">): string {
  return (
    (error.reason ? lookup(`errors.reason.${error.reason}`) : null) ??
    lookup(`errors.turn.${error.code}`) ??
    lookup(`errors.api.${error.code}`) ??
    (currentLanguage() === "en" && error.message ? error.message : i18n.t("errors.turnFailed"))
  );
}
