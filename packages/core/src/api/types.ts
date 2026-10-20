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
  /** 这次请求的单号（和响应头 X-Request-ID 相同），拿它去服务端日志里查 */
  request_id?: string;
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
  /** Cookie 模式（网页）下是 null：刷新令牌只在 HttpOnly Cookie 里 */
  refresh_token: string | null;
  refresh_expires_at: string;
};

export type Provider = {
  id: string;
  display_name: string;
  default_base_url: string | null;
  requires_base_url: boolean;
};

export type ProbeCheck = { name: string; ok: boolean | null; detail: string; latency_ms: number | null };

export type ProbeReport = {
  provider: string;
  model: string;
  probed_at: string;
  fatal_error: string | null;
  checks: ProbeCheck[];
  caps_overlay: Record<string, unknown>;
};

/** 服务商模型列表里的一项 */
export type ModelInfo = {
  id: string;
  context_window: number | null;
  /** context_window 从哪来：listed 服务商的列表，table 内置能力表；null 表示都不知道 */
  window_source: "listed" | "table" | null;
  owned_by: string | null;
};

export type RouteParams = {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  thinking?: boolean;
  working_window?: number;
};

/** 模型窗口从哪来：服务商列表、内置能力表、手填、运行中学到的、32K 估计 */
export type WindowSource = "listed" | "table" | "manual" | "learned" | "default";

export type RouteWindow = {
  model_window: number;
  source: WindowSource;
  working_cap: number;
  max_tokens: number;
  effective_window: number;
  warnings: string[];
};

/** 玩家配好的一个模型：Key、端点、模型名、窗口和写法设置，其中一个是导演 */
export type ModelRoute = {
  id: string;
  label: string;
  provider: string;
  model: string;
  base_url: string | null;
  key_last4: string;
  extra_header_names: string[];
  extra_body: Record<string, unknown>;
  manual_window: number | null;
  params: RouteParams;
  caps_override: Record<string, unknown>;
  status: "unverified" | "ok" | "invalid";
  last_ok_at: string | null;
  last_probe: ProbeReport | null;
  is_director: boolean;
  /** 和它用同一个 Key 的其他模型 */
  shares_key_with: string[];
  window: RouteWindow;
  created_at: string;
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
  /** 版本号：改名、编辑卡片、恢复都会加 1；保存编辑时带回去 */
  version: number;
  /** 最近一次编辑卡片的时间；没编辑过（或恢复成导入时的内容之后）是 null */
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  duplicate: boolean;
};

/** 角色卡自带的世界书条目 */
export type LoreEntry = {
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
};

/** 能编辑的那部分角色卡（原文，{{char}}、{{user}} 不替换） */
export type CharacterCard = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  tags: string[];
  book: LoreEntry[];
};

/** GET / PUT /v1/scenarios/{id}/card 的响应 */
export type ScenarioCard = {
  scenario_id: string;
  version: number;
  edited_at: string | null;
  display_name: string;
  card: CharacterCard;
  truncated_fields: string[];
};

/** PUT /v1/scenarios/{id}/card 的请求体：完整的可编辑内容，加读取时的版本号 */
export type ScenarioCardInput = {
  version: number;
  display_name: string;
  card: CharacterCard;
};

export type TurnOption = { id: string; text: string };

/** 写结局时 source 是 ending，text 是玩家写的结局方向（没写时是空串） */
export type TurnAction = {
  source: "option" | "text" | "opening" | "ending";
  text: string;
  option_id?: string;
};

export type TurnError = {
  code: string;
  /** 服务端的说明（英文）；界面上显示 describeTurnError() 按错误码翻译的文字 */
  message: string;
  retryable: boolean;
  partial?: boolean;
  /** 服务商错误的类别（auth、billing、rate_limit……）；不是服务商错误时为 null，旧的服务端不带 */
  reason?: string | null;
};

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
  /** ended：已经写完结局，不能再提交行动 */
  status: "building" | "active" | "ended";
  scenario_id: string | null;
  /** 提示词的语言，开局时定下 */
  language: "zh" | "en" | "ja";
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
  is_protagonist: boolean;
};

export type WorldFact = {
  id: string;
  text: string;
  entity_ids: string[];
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
  | { source: "opening" }
  | { source: "ending"; text?: string };

/** 回合事件流里的事件（data 已解析） */
export type TurnEvent =
  | { event: "turn.created"; data: { turn_id: string; seq: number; attempt: number } }
  | { event: "world.building"; data: Record<string, never> }
  | { event: "world.ready"; data: { source: string; entities: number } }
  | { event: "turn.waiting_state"; data: { waited_ms: number; done?: boolean; lag?: boolean } }
  | { event: "narrative.delta"; data: { text: string } }
  | { event: "narrative.done"; data: { chars: number; rewritten?: boolean } }
  /** 结局那一轮 options 是空的、source 是 null */
  | { event: "options.ready"; data: { options: TurnOption[]; source: string | null } }
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
