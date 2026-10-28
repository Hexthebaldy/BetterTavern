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
  /** 邮箱验证过没有；不要求验证邮箱的服务器上注册即为 true */
  email_verified: boolean;
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

/** 注册的响应：verification_required 时还没登录（令牌都是 null），验证码已经发到邮箱 */
export type RegisterResponse = {
  user: User;
  verification_required: boolean;
  access_token: string | null;
  token_type: string;
  expires_in: number | null;
  refresh_token: string | null;
  refresh_expires_at: string | null;
};

export type CodePurpose = "verify" | "reset";

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
  /** 是不是后台整理世界状态用的模型；没有时后台用导演的模型 */
  is_background: boolean;
  /** 是不是工作台用的模型；没有时工作台用导演的模型 */
  is_workbench: boolean;
  /** 能不能调用工具：不能的模型不能用于后台整理和工作台 */
  supports_tools: boolean;
  /** 和它用同一个 Key 的其他模型 */
  shares_key_with: string[];
  window: RouteWindow;
  created_at: string;
  updated_at: string;
  /** user：自己的 Key；platform：官方模型（不用配 Key，按用量扣点数，连接不能改） */
  source: "user" | "platform";
};

/** 官方模型的点数（GET /v1/me/credits）；1 点 = 0.001 元 */
export type Credits = {
  /** 余额（点），后台整理扣过头时可能是负数 */
  balance: number;
  /** 估计每回合花多少点 */
  turn_points: number;
  /** 估计还能写多少回合 */
  turns_left: number;
  /** 这台服务器有没有官方模型 */
  platform: boolean;
  /** 现在的导演是不是官方模型 */
  uses_platform: boolean;
};

/** 次要关键词的逻辑：再命中任一个 / 全命中 / 一个都不命中 / 不全命中 */
export type LoreLogic = "any" | "all" | "not_any" | "not_all";

/** 世界书条目不常用的触发设置（照 SillyTavern）；为 null 的项按默认 */
export type LoreRules = {
  whole_words: boolean | null;
  case_sensitive: boolean | null;
  scan_depth: number | null;
  match: ("persona" | "description" | "personality" | "depth_prompt" | "scenario" | "creator_notes")[];
  exclude_recursion: boolean;
  prevent_recursion: boolean;
  delay_until_recursion: number;
  probability: number;
  groups: string[];
  group_override: boolean;
  group_weight: number;
  group_scoring: boolean | null;
  /** 粘滞、冷却、延迟按回合算 */
  sticky: number;
  cooldown: number;
  delay: number;
  triggers: ("normal" | "continue" | "impersonate" | "swipe" | "regenerate" | "quiet")[];
  ignore_budget: boolean;
};

/** 世界书条目：卡片自带的和独立世界书共用 */
export type LoreEntry = {
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  secondary_keys: string[];
  logic: LoreLogic;
  /** 优先级数字（SillyTavern 的 order）；null 时按列表位置算 */
  priority: number | null;
  /** null 时全按默认 */
  rules: LoreRules | null;
};

/** 角色卡的内容（原文，{{char}}、{{user}} 不替换）；角色卡详情和工作台的草稿共用 */
export type CharacterCard = {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  /** 历史后置指令：导演每回合放在玩家行动后面看 */
  post_history_instructions: string;
  /** 角色备注（SillyTavern 的 Character's Note）：和后置指令放在一起 */
  depth_prompt: string;
  creator_notes: string;
  alternate_greetings: string[];
  tags: string[];
  book: LoreEntry[];
  /** 下面几项不能在 BetterTavern 里改，原样保留 */
  creator: string;
  character_version: string;
  /** 导入时因为太长被截断、之后没改过的字段 */
  truncated: string[];
};

/** 自动保存草稿时发的卡片：只有能编辑的部分 */
export type CharacterCardInput = Pick<
  CharacterCard,
  | "name"
  | "description"
  | "personality"
  | "scenario"
  | "first_mes"
  | "mes_example"
  | "system_prompt"
  | "post_history_instructions"
  | "depth_prompt"
  | "creator_notes"
  | "alternate_greetings"
  | "tags"
  | "book"
>;

export type CardSource = "card_v1" | "card_v2" | "card_v3" | "manual" | "agent";

/** 角色卡仓库的一张卡 */
export type CardSummary = {
  id: string;
  name: string;
  character_name: string;
  source: CardSource;
  cover_blob_id: string | null;
  description_preview: string;
  creator: string;
  tags: string[];
  book_entries: number;
  greetings: number;
  made_by: "agent" | "manual" | "mixed";
  ip: { work: string; character: string } | null;
  /** 几个剧本在用（大于 0 时不能删） */
  scenario_count: number;
  /** 有没保存修改的草稿时，是那份草稿 */
  draft_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type CardDetail = {
  card: CardSummary;
  content: CharacterCard;
  sources: { url: string; title: string; used_in: string[] }[];
  scenarios: { id: string; name: string }[];
};

export type CardRevision = {
  version: number;
  name: string;
  note: string;
  cover_blob_id: string | null;
  from_draft: boolean;
  created_at: string;
};

/** 剧本的设置：开新故事时预填 */
export type ScenarioSetup = {
  /** 默认人设（docs/personas.md）：开新故事时先替玩家选好它；更新前的服务端没有这一项 */
  persona_id?: string | null;
  /** 默认主角。选了默认人设时是它的副本（服务端写，给旧版 App 读） */
  protagonist: { name: string; summary: string };
  preferences: Preferences;
  /** 用哪张卡的哪条开场白开场（0 是 first_mes，1 起是备选开场白）；null 时由导演写开场 */
  opening: { card_id: string; greeting: number } | null;
  /** 闪电模式：这个剧本开的新故事花费更少、没有世界状态；只影响之后开始的故事 */
  lightning: boolean;
};

/** 人设：玩家扮演的“我”（docs/personas.md） */
export type Persona = {
  id: string;
  name: string;
  description: string;
  /** 头像（正方形）；没有时画名字的第一个字 */
  avatar_blob_id: string | null;
  is_default: boolean;
  /** 几个剧本选了它当默认人设 */
  scenario_count: number;
  created_at: string;
  updated_at: string;
};

export type PersonaImport = { personas: Persona[]; created: number; skipped: number };

export type Scenario = {
  id: string;
  name: string;
  /** 用了哪几张卡，按顺序；第一张是主角色卡 */
  cards: { card_id: string; name: string; cover_blob_id: string | null }[];
  cover_blob_id: string | null;
  setup: ScenarioSetup;
  description_preview: string;
  version: number;
  created_at: string;
  updated_at: string;
  /** 挂的世界书，按顺序 */
  lorebooks: ScenarioLorebook[];
};

export type ScenarioLorebook = { lorebook_id: string; name: string; entries: number };

export type NewScenario = {
  name?: string | null;
  card_ids: string[];
  setup?: ScenarioSetup;
  /** 最多 4 本 */
  lorebook_ids?: string[];
};

export type ScenarioPatch = {
  name?: string;
  card_ids?: string[];
  setup?: ScenarioSetup;
  /** 整个替换；空数组是全部摘掉 */
  lorebook_ids?: string[];
  version?: number;
};

// ---- 世界书仓库 ----------------------------------------------------------------------------

export type LorebookSource = "st_world" | "lorebook" | "manual";

/** 导入报告：只有数字 */
export type LorebookReport = {
  entries: number;
  constant: number;
  disabled: number;
  dropped_empty: number;
  dropped_unreachable: number;
  dropped_over_limit: number;
  vectorized: number;
  character_filter: number;
  bad_regex: number;
  other_macros: number;
};

/** 世界书仓库的一本（不带条目） */
export type LorebookSummary = {
  id: string;
  name: string;
  description: string;
  source: LorebookSource;
  entries: number;
  constant: number;
  scenario_count: number;
  /** 新建的是 null */
  report: LorebookReport | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type LorebookDetail = {
  lorebook: LorebookSummary;
  book: LoreEntry[];
  scenarios: { id: string; name: string }[];
};

export type LorebookImport = { lorebook: LorebookDetail | null; existing: LorebookSummary | null };

// ---- 工作台 ------------------------------------------------------------------------------

export type DraftOrigin = "agent" | "manual" | "import_file" | "edit_card";
export type DraftMode = "agent" | "manual";
export type DraftStage = "start" | "research" | "questions" | "plan" | "build" | "check" | "done" | "revise";
export type AgentStatus = "idle" | "running" | "awaiting_user";
export type Awaiting = { kind: "questions" | "plan" | "changes"; seq: number };

export type DraftSummary = {
  id: string;
  name: string;
  character_name: string;
  origin: DraftOrigin;
  card_id: string | null;
  cover_blob_id: string | null;
  mode: DraftMode;
  stage: DraftStage;
  agent_status: AgentStatus;
  awaiting: Awaiting | null;
  version: number;
  saved_version: number | null;
  unsaved: boolean;
  created_at: string;
  updated_at: string;
};

/** 按保存的规则检查出的一个问题；code 见 docs/api/workbench.md 的 IssueOut */
export type Issue = {
  field: string;
  code: string;
  level: "error" | "warning";
  params: Record<string, string | number>;
};

export type ImageLicense = "public_domain" | "copyrighted" | "unknown" | "own";

export type Asset = {
  id: string;
  blob_id: string;
  source: "search" | "generated" | "upload" | "card";
  license: ImageLicense;
  source_url: string | null;
  prompt: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  personal_use: boolean;
  created_at: string;
};

export type Note = {
  id: string;
  text: string;
  url: string;
  title: string;
  site: string;
  used_in: string[];
};

export type Todo = { key: string; text: string; state: "todo" | "doing" | "done"; detail: string };

export type Draft = {
  draft: DraftSummary;
  card: CharacterCard;
  cover_asset_id: string | null;
  base_version: number | null;
  todos: Todo[];
  language: string;
  issues: Issue[];
  assets: Asset[];
  notes: Note[];
};

export type DraftImport = { draft: Draft | null; existing_card: CardSummary | null };

export type DraftSave = { card: CardSummary; draft: Draft; scenario: Scenario | null };

export type Question = {
  qid: string;
  question: string;
  choices: string[];
  recommended: number | null;
  multi: boolean;
};

export type Plan = {
  names: string[];
  pitch: string;
  sections: { key: string; heading: string; body: string }[];
  lore: string[];
  opening: string;
  cover: { mode: "generate" | "search" | "upload" | "none"; count: number; style: string; note: string };
  sources: { url: string; title: string }[];
  estimate: { searches: number; pages: number; images: number };
  language: string;
  ip: { work: string; character: string } | null;
};

export type HunkTarget =
  | { field: string }
  | { greeting: number }
  | { lore: number }
  | { lore_new: { name: string; keys: string[]; constant: boolean } };

export type Hunk = {
  id: string;
  target: HunkTarget;
  before: string;
  after: string | null;
  summary: string;
  state: "pending" | "accepted" | "rejected" | "stale";
};

/** 对话记录的一条；content 随 kind 变 */
export type WorkbenchMessage =
  | MessageBase<"text", { text: string }>
  | MessageBase<"questions", { intro: string; questions: Question[]; skippable: boolean }>
  | MessageBase<
      "answers",
      { answers: Record<string, string | string[]>; delegated: boolean; questions_seq?: number }
    >
  | MessageBase<"plan", Plan>
  | MessageBase<"plan_reply", { approved: boolean; name?: string; text?: string; plan_seq?: number }>
  | MessageBase<"changes", { intro: string; hunks: Hunk[] }>
  | MessageBase<"images", { asset_ids: string[]; purpose: "cover_candidates" | "references"; note: string }>
  | MessageBase<
      "progress",
      { fields: string[]; lore: { added: number }; cover: boolean; complete: boolean; stopped: boolean }
    >
  | MessageBase<"research", { searches: string[]; pages: string[]; images: number }>
  | MessageBase<"error", { code: string; message: string; reason: string | null }>;

type MessageBase<K extends string, C> = {
  seq: number;
  role: "user" | "assistant";
  kind: K;
  content: C;
  created_at: string;
};

export type Transcript = { messages: WorkbenchMessage[]; last_event_id: number };

export type NewMessage =
  | { kind: "text"; text: string }
  | { kind: "answers"; answers: Record<string, string | string[]>; delegated?: boolean }
  | { kind: "plan_reply"; approved: true; name?: string }
  | { kind: "plan_reply"; approved: false; text: string };

/** 工作台推送事件（data 已解析） */
export type WorkbenchEvent =
  | {
      event: "status";
      data: {
        agent_status?: AgentStatus;
        stage?: DraftStage;
        awaiting?: Awaiting | null;
        trigger?: string;
        mode?: string;
        done?: boolean;
      };
    }
  | { event: "delta"; data: { text: string } }
  | { event: "field_delta"; data: { target: { field: string } | { lore: string }; text: string } }
  | { event: "tool"; data: { name: string; state: string; query?: string; urls?: number; count?: number } }
  | { event: "message"; data: WorkbenchMessage }
  | { event: "todos"; data: { todos: Todo[] } }
  | { event: "draft"; data: { version: number; fields: string[] } };

// ---- 外部服务 ----------------------------------------------------------------------------

export type ToolKind = "search" | "fetch" | "image";

export type ToolProvider = {
  id: string;
  kinds: ToolKind[];
  can_search: boolean;
  can_images: boolean;
  can_fetch: boolean;
  needs_key: boolean;
  needs_base_url: boolean;
  needs_model: boolean;
  max_references: number;
};

export type ToolRoute = {
  id: string;
  kind: ToolKind;
  provider: string;
  label: string;
  base_url: string | null;
  key_last4: string;
  has_key: boolean;
  model: string | null;
  params: Record<string, unknown>;
  status: "unverified" | "ok" | "invalid";
  probe: { ok?: boolean; detail?: string; latency_ms?: number; tested_at?: string };
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type NewToolRoute = {
  kind: ToolKind;
  provider: string;
  label?: string;
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
  params?: Record<string, unknown>;
  default?: boolean;
};

export type ToolRoutePatch = Partial<Omit<NewToolRoute, "kind" | "provider">>;

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
  /** missing：补选项两次都没补齐，选项不足 2 个，玩家自己写；fallback 只出现在早先的回合 */
  options_source: "model" | "repaired" | "fallback" | "missing" | null;
  /** 写这一回合时，世界状态截至第几回合（-1 是开局时的样子） */
  state_seq: number;
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
  /** lightning：闪电模式，没有世界状态（不显示世界状态的入口）；开局时定下 */
  mode: "standard" | "lightning";
  protagonist_name: string;
  /** 开局时用的人设，用来显示头像（人设删了就找不到）；临时填的为 null，更新前的服务端没有这一项 */
  persona_id?: string | null;
  preferences: Partial<Preferences>;
  head_turn_id: string | null;
  head_seq: number | null;
  head_excerpt: string;
  active_turn_id: string | null;
  /** 世界状态已整理到第几回合，-1 表示还是开局时的样子 */
  state_seq: number;
  /** 这个存档还能回退几次 */
  rollbacks_left: number;
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

/** 整理世界状态时遇到的问题：failed 是这一回合失败了、下一回合会再试；skipped 是失败两次后跳过了 */
export type WorldStateIssue = { seq: number; kind: "failed" | "skipped"; reason: string | null };

export type WorldView = {
  entities: WorldEntity[];
  links: { src_id: string; rel: string; dst_id: string }[];
  facts: WorldFact[];
  hidden_facts: number;
  /** 世界状态已整理到第几回合，-1 表示还是开局时的样子 */
  state_seq: number;
  state_issue: WorldStateIssue | null;
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
  /** 导演在写之前先查更早的回合；round 是第几轮（最多两轮） */
  | { event: "director.recalling"; data: { round: number } }
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
          state_seq: number;
        };
        usage: Record<string, number> | null;
      };
    }
  | { event: "turn.failed"; data: TurnError }
  | { event: "snapshot"; data: { narrative: string; options: TurnOption[]; source: string | null } };
