/**
 * 接口类型（与服务端 api/schemas 对应）。M1 先手写；接口契约工具链（OpenAPI 生成 TS 类型）
 * 接入后由 src/api/generated/ 取代，见 docs/backend.md 第 9 节。
 */

export type Problem = {
  type: string;
  title: string;
  status: number;
  code: string;
  retryable?: boolean;
  [key: string]: unknown;
};

export type User = {
  id: string;
  email: string;
  display_name: string;
  locale: string;
  created_at: string;
};

export type AuthResponse = {
  user: User;
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_at: string;
};

export type Provider = {
  id: string;
  display_name: string;
  default_base_url: string | null;
  requires_base_url: boolean;
};

export type ProbeCheck = { name: string; ok: boolean | null; detail: string; latency_ms: number | null };

export type ProbedModel = {
  model: string;
  probed_at: string;
  ok: boolean;
  fatal_error: string | null;
  checks: ProbeCheck[];
};

export type Credential = {
  id: string;
  provider: string;
  label: string;
  base_url: string | null;
  key_last4: string;
  extra_header_names: string[];
  extra_body: Record<string, unknown>;
  status: "unverified" | "ok" | "invalid";
  last_ok_at: string | null;
  probed_models: ProbedModel[];
  created_at: string;
  updated_at: string;
};

export type ProbeReport = {
  provider: string;
  model: string;
  probed_at: string;
  fatal_error: string | null;
  checks: ProbeCheck[];
  caps_overlay: Record<string, unknown>;
};

export type ModelInfo = { id: string; context_window: number | null; owned_by: string | null };

export type RouteParams = {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  thinking?: boolean;
  working_window?: number;
};

export type RouteWindow = {
  model_window: number;
  working_cap: number;
  max_tokens: number;
  effective_window: number;
  warnings: string[];
};

export type ModelRoute = {
  id: string;
  task: string;
  credential_id: string;
  provider: string;
  credential_label: string;
  model: string;
  params: RouteParams;
  caps_override: Record<string, unknown>;
  fallback_route_id: string | null;
  window: RouteWindow;
  updated_at: string;
};

export type Scenario = {
  id: string;
  name: string;
  source_kind: string;
  avatar_blob_id: string | null;
  description_preview: string;
  first_mes_preview: string;
  creator: string;
  tags: string[];
  book_entries: number;
  alternate_greetings: number;
  truncated_fields: string[];
  created_at: string;
  updated_at: string;
  duplicate: boolean;
};

export type TurnOption = { id: string; text: string };

export type TurnAction = { source: "option" | "text" | "opening"; text: string; option_id?: string };

export type TurnError = { code: string; message: string; retryable: boolean; partial?: boolean };

export type TurnStatus = "generating" | "replied" | "committed" | "failed" | "archived";

export type Turn = {
  id: string;
  playthrough_id: string;
  seq: number;
  attempt: number;
  status: TurnStatus;
  action: TurnAction;
  narrative: string;
  options: TurnOption[];
  options_source: "model" | "repaired" | "fallback" | null;
  state_lag: boolean;
  error: TurnError | null;
  created_at: string;
  replied_at: string | null;
};

export type Preferences = { length: "short" | "medium" | "long"; style: string; boundaries: string };

export type Playthrough = {
  id: string;
  title: string;
  status: "building" | "active";
  scenario_id: string | null;
  protagonist_name: string;
  preferences: Partial<Preferences>;
  head_turn_id: string | null;
  head_seq: number | null;
  head_excerpt: string;
  active_turn_id: string | null;
  rollback_floor_seq: number;
  seed_source: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaythroughDetail = {
  playthrough: Playthrough;
  head: Turn | null;
  active_turn: Turn | null;
  last_failed: Turn | null;
};

export type PlaythroughCreated = { playthrough: Playthrough; turn: Turn; events_url: string };

export type TurnCreated = { turn: Turn; events_url: string };

export type WorldEntity = {
  id: string;
  kind: string;
  name: string;
  aliases: string[];
  summary: string;
  data: Record<string, unknown>;
  importance: number;
  is_protagonist: boolean;
};

export type WorldFact = {
  id: string;
  text: string;
  entity_ids: string[];
  importance: number;
  secret: boolean;
};

export type WorldView = {
  entities: WorldEntity[];
  links: { src_id: string; rel: string; dst_id: string }[];
  facts: WorldFact[];
  hidden_facts: number;
};

export type NewAction =
  | { source: "option"; option_id: string }
  | { source: "text"; text: string }
  | { source: "opening" };

/** 回合事件流里的事件（data 已解析） */
export type TurnEvent =
  | { event: "turn.created"; data: { turn_id: string; seq: number; attempt: number } }
  | { event: "world.building"; data: Record<string, never> }
  | { event: "world.ready"; data: { source: string; entities: number } }
  | { event: "turn.waiting_state"; data: { waited_ms: number; done?: boolean; lag?: boolean } }
  | { event: "narrative.delta"; data: { text: string } }
  | { event: "narrative.done"; data: { chars: number; rewritten?: boolean } }
  | { event: "options.ready"; data: { options: TurnOption[]; source: string } }
  | {
      event: "turn.completed";
      data: {
        turn: {
          id: string;
          seq: number;
          attempt: number;
          status: TurnStatus;
          narrative: string;
          options: TurnOption[];
          options_source: string | null;
          state_lag: boolean;
        };
        usage: Record<string, number> | null;
      };
    }
  | { event: "turn.failed"; data: TurnError }
  | { event: "snapshot"; data: { narrative: string; options: TurnOption[]; source: string | null } };
