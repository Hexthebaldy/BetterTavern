/**
 * ApiClient：JSON 与 multipart 请求、problem+json 错误、超时，以及访问令牌。
 *
 * 带令牌的请求遇到 401 时先让会话刷新一次令牌再重试一次；还是 401 就把错误交给调用方
 * （会话那边刷新失败时已经退出登录）。只用标准 fetch 接口，Node 测试里也能跑。
 */

import type { Problem } from "./types.ts";

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
};

export class ApiError extends Error {
  /** HTTP 状态码；0 表示没有拿到响应（网络不通、超时） */
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly problem: Problem | null;
  readonly timedOut: boolean;

  constructor(message: string, init: ApiErrorInit) {
    super(message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable;
    this.problem = init.problem ?? null;
    this.timedOut = init.timedOut ?? false;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** problem 里随错误附带的字段，比如 TURN_IN_PROGRESS 的 active_turn_id */
  field(name: string): unknown {
    return this.problem?.[name];
  }
}

export function networkError(cause: unknown, timedOut: boolean): ApiError {
  const error = new ApiError(timedOut ? "服务器响应超时" : "连不上服务器，请检查网络和服务器地址", {
    status: 0,
    code: timedOut ? "TIMEOUT" : "NETWORK",
    retryable: true,
    timedOut,
  });
  (error as { cause?: unknown }).cause = cause;
  return error;
}

function isProblem(data: unknown): data is Problem {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.code === "string" && typeof d.title === "string";
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "请求有误",
  401: "需要登录",
  403: "没有权限",
  404: "要找的内容不存在",
  409: "操作冲突，请刷新后再试",
  413: "文件太大",
  422: "填写的内容有误",
  429: "请求太频繁，请稍后再试",
  502: "服务器暂时不可用",
  503: "服务器暂时不可用",
  504: "服务器响应超时",
};

/** 把非 2xx 响应变成 ApiError：优先用服务端的 problem+json，其次（比如代理返回的 HTML）按状态码 */
export function errorFromResponse(status: number, data: unknown): ApiError {
  if (isProblem(data)) {
    return new ApiError(data.title, {
      status,
      code: data.code,
      retryable: data.retryable === true,
      problem: data,
    });
  }
  return new ApiError(STATUS_MESSAGES[status] ?? `服务器返回了错误（HTTP ${status}）`, {
    status,
    code: `HTTP_${status}`,
    retryable: status >= 500 || status === 429,
  });
}

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
};

type RawResponse = { status: number; ok: boolean; text: string };

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
      const refreshed = await auth.refresh().catch(() => false);
      if (refreshed) raw = await this.send(method, path, options, auth);
    }
    return parse<T>(raw);
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
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Client-Version": this.options.clientVersion,
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
      return { status: response.status, ok: response.ok, text };
    } catch (error) {
      if (outer?.aborted) throw error; // 调用方主动取消：原样抛出，由调用方忽略
      throw networkError(error, timedOut);
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
  if (!raw.ok) throw errorFromResponse(raw.status, data);
  if (raw.text !== "" && data === undefined) {
    throw new ApiError("服务器返回的内容无法解析", {
      status: raw.status,
      code: "BAD_RESPONSE",
      retryable: false,
    });
  }
  return data as T;
}

/** 界面上显示的错误文字 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "出了点问题，请重试";
}
