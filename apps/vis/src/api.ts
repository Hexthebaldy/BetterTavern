/**
 * 和 `bettertavern vis` 的接口打交道：类型和取数据的 hook（react-query，按页面定时刷新）。
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

export type LogEntry = {
  n: number;
  t: number;
  /** 哪个日志文件：api、worker，手机导出的是 phone */
  file: string;
  event: string;
  level: string;
  timestamp?: string;
  request_id?: string;
  turn_id?: string;
  playthrough_id?: string;
  user_ref?: string;
  [key: string]: unknown;
};

export type Meta = {
  env: string;
  story_allowed: boolean;
  db: boolean;
  logs: {
    directory: string;
    files: { name: string; bytes: number; modified: number }[];
    entries: number;
    skipped_lines: number;
    oldest: number | null;
    newest: number | null;
    cursor: number;
  };
  now: number;
};

export type ProblemGroup = { event: string; level: string; count: number; last_t: number; sample: LogEntry };

export type Overview = {
  hours: number;
  logs: {
    sse_drops: number;
    server_errors: number;
    requests: number;
  };
  problems: ProblemGroup[];
  db: {
    turns: { ok: number; failed: number; generating: number };
    director: {
      calls: number;
      ttft_p50: number | null;
      ttft_p95: number | null;
      latency_p50: number | null;
      input_tokens: number;
      cached_tokens: number;
      output_tokens: number;
      reasoning_tokens: number;
    };
    hourly: { hour: number; ok: number; failed: number }[];
    failed_turns: {
      id: string;
      seq: number;
      playthrough_id: string;
      title: string;
      code: string | null;
      message: string | null;
      created_at: number;
    }[];
  } | null;
  db_error?: string;
};

export type PlaythroughSummary = {
  id: string;
  user_ref: string;
  title: string;
  status: string;
  seed_source: string | null;
  scenario_name: string | null;
  turns: number;
  failed: number;
  generating: boolean;
  created_at: number;
  updated_at: number;
  last_turn_at: number | null;
};

export type RunSummary = {
  provider: string | null;
  model: string | null;
  ttft_ms: number | null;
  latency_ms: number | null;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  status: string | null;
  error_class: string | null;
};

export type Turn = {
  id: string;
  playthrough_id: string;
  playthrough_title?: string;
  user_ref?: string;
  seq: number;
  attempt: number;
  status: string;
  action: { source: string | null; option_id: string | null; text_chars: number; text?: string };
  narrative_chars: number;
  narrative?: string;
  /** 导演的隐藏备注的字数；显示故事内容时还有原文 */
  notes_chars: number;
  director_notes?: string;
  options_count: number;
  options?: string[];
  options_source: string | null;
  state_seq: number;
  usage: Record<string, number> | null;
  error: { code?: string; message?: string; retryable?: boolean } | null;
  created_at: number;
  replied_at: number | null;
  duration_ms: number | null;
  run: RunSummary | null;
  log?: { sse_drops: number; warnings: number };
};

export type PlaythroughDetail = {
  playthrough: {
    id: string;
    user_ref: string;
    title: string;
    status: string;
    seed_source: string | null;
    scenario_name: string | null;
    head_turn_id: string | null;
    active_turn_id: string | null;
    lease_owner: string | null;
    created_at: number;
    updated_at: number;
  };
  turns: Turn[];
};

/** 一次运行里的一步：调一次模型或用一次工具。不显示故事时 result 里没有 text，只有 text_chars */
export type Step = {
  step: number;
  kind: "model" | "tool";
  tool: string | null;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  latency_ms: number | null;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
};

export type Run = RunSummary & {
  id: string;
  agent: string;
  task: string;
  prompt_hash: string | null;
  result: Record<string, unknown> | null;
  created_at: number;
  steps: Step[];
};

export type Span = {
  lane: string;
  kind: string;
  start: number;
  end: number;
  status: string;
  fields: Record<string, unknown>;
  ref: number | null;
};

export type Marker = {
  lane: string;
  kind: string;
  at: number;
  status: string;
  fields: Record<string, unknown>;
  ref: number | null;
};

export type Issue = {
  severity: "error" | "warn" | "info";
  code: string;
  fields: Record<string, unknown>;
  ref: number | null;
};

export type TurnDetail = {
  turn: Turn | null;
  runs: Run[];
  neighbours: { id: string; seq: number; attempt: number; status: string }[];
  timeline: { origin: number | null; end: number | null; spans: Span[]; markers: Marker[] };
  issues: Issue[];
  entries: LogEntry[];
  db_error: string | null;
};

export type RequestRow = {
  n: number;
  t: number;
  method: string | null;
  path: string | null;
  route: string | null;
  status: number | null;
  duration_ms: number | null;
  request_id: string | null;
  user_ref: string | null;
  error_code: string | null;
  aborted: boolean;
  client_version: string | null;
  turn_ids: string[];
};

export type RequestDetail = { request_id: string; request: LogEntry | null; turn_ids: string[]; entries: LogEntry[] };

export type LogPage = { entries: LogEntry[]; cursor: number; files: string[] };

export type SearchResult = { kind: "request" | "turn" | "playthrough"; id: string; title?: string; seq?: number };

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new HttpError(0, "连不上 vis 服务：确认 bettertavern vis 还在运行");
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new HttpError(response.status, "vis 服务返回的内容看不懂");
  }
  if (!response.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    throw new HttpError(response.status, typeof detail === "string" ? detail : `HTTP ${response.status}`);
  }
  return data as T;
}

/** 每 3 秒刷新一次；404（没有这条）就停，不然会一直刷 */
const LIVE = (query: { state: { error: Error | null } }): number | false => {
  const { error } = query.state;
  return error instanceof HttpError && error.status === 404 ? false : 3000;
};

export const useMeta = (): UseQueryResult<Meta> =>
  useQuery({ queryKey: ["meta"], queryFn: () => getJson<Meta>("/api/meta"), refetchInterval: 10_000 });

export const useOverview = (hours: number): UseQueryResult<Overview> =>
  useQuery({
    queryKey: ["overview", hours],
    queryFn: () => getJson<Overview>(`/api/overview?hours=${hours}`),
    refetchInterval: LIVE,
  });

export const usePlaythroughs = (): UseQueryResult<{ playthroughs: PlaythroughSummary[] }> =>
  useQuery({ queryKey: ["playthroughs"], queryFn: () => getJson("/api/playthroughs"), refetchInterval: LIVE });

export const usePlaythrough = (id: string, story: boolean): UseQueryResult<PlaythroughDetail> =>
  useQuery({
    queryKey: ["playthrough", id, story],
    queryFn: () => getJson<PlaythroughDetail>(`/api/playthroughs/${id}${story ? "?story=1" : ""}`),
    refetchInterval: LIVE,
  });

export const useTurn = (id: string, story: boolean): UseQueryResult<TurnDetail> =>
  useQuery({
    queryKey: ["turn", id, story],
    queryFn: () => getJson<TurnDetail>(`/api/turns/${id}${story ? "?story=1" : ""}`),
    // 生成中每秒刷新，结束后放慢
    refetchInterval: (query) => (query.state.data?.turn?.status === "generating" ? 1000 : 5000),
  });

export const useRequests = (kind: string): UseQueryResult<{ requests: RequestRow[] }> =>
  useQuery({
    queryKey: ["requests", kind],
    queryFn: () => getJson(`/api/requests?kind=${kind}`),
    refetchInterval: LIVE,
  });

export const useRequest = (id: string): UseQueryResult<RequestDetail> =>
  useQuery({
    queryKey: ["request", id],
    queryFn: () => getJson<RequestDetail>(`/api/requests/${id}`),
    refetchInterval: LIVE,
  });
