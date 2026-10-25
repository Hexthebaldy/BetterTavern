/**
 * 各个接口的薄封装（路径、方法、类型）。接口说明见 docs/backend.md 第 9 节。
 */

import type { ApiClient } from "./client.ts";
import type {
  AuthResponse,
  CodePurpose,
  Credits,
  ModelInfo,
  ModelRoute,
  NewAction,
  Playthrough,
  PlaythroughCreated,
  PlaythroughDetail,
  Preferences,
  ProbeReport,
  Provider,
  RegisterResponse,
  RouteParams,
  Asset,
  CardDetail,
  CardRevision,
  CardSummary,
  LoreEntry,
  LorebookDetail,
  LorebookImport,
  LorebookSummary,
  CharacterCardInput,
  Draft,
  DraftImport,
  DraftMode,
  DraftSave,
  DraftSummary,
  NewMessage,
  NewScenario,
  NewToolRoute,
  Scenario,
  ScenarioPatch,
  ToolProvider,
  ToolRoute,
  ToolRoutePatch,
  Transcript,
  WorkbenchMessage,
  Turn,
  TurnCreated,
  User,
  WorldView,
} from "./types.ts";

/** 添加模型：每次都填一个新的 Key */
export type NewModelRoute = {
  provider: string;
  model: string;
  label?: string;
  api_key: string;
  /** 空串表示服务商的默认地址 */
  base_url?: string | null;
  manual_window?: number | null;
  params?: RouteParams;
  director?: boolean;
  workbench?: boolean;
};

/** 只改给出的字段；manual_window 传 null 表示清空 */
export type ModelRoutePatch = {
  label?: string;
  model?: string;
  api_key?: string;
  apply_to_same_key?: boolean;
  /** 空串表示恢复服务商的默认地址 */
  base_url?: string;
  manual_window?: number | null;
  params?: RouteParams;
  director?: boolean;
  background?: boolean;
  workbench?: boolean;
};

/** 导入一张卡：已经导入过同一个文件时默认不建草稿，返回那张卡（allowDuplicate 为真时另起一份） */
export type ImportOptions = { language: string; allowDuplicate?: boolean };

export type SaveOptions = { new_scenario?: boolean; on_conflict?: "overwrite" | "copy" };

export type CoverRequest = {
  prompt: string;
  style?: string;
  count?: number;
  aspect?: "portrait" | "square" | "landscape";
};

export type ModelListQuery = { api_key: string; base_url?: string | null };

export type NewPlaythrough = {
  scenario_id: string;
  /** 不传时用剧本设置里的默认主角 */
  protagonist?: { name: string; summary?: string };
  title?: string;
  preferences?: Partial<Preferences>;
  /** 这一局给 agent 的提示词用哪种语言：传当前的界面语言（docs/i18n.md 第 4 节）；不传按 zh */
  language?: "zh" | "en" | "ja";
};

const enc = encodeURIComponent;

/**
 * 刷新令牌放在哪：body 是 App（在请求体和响应体里，自己保存）；cookie 是网页（在浏览器的 HttpOnly Cookie 里，
 * 请求带 X-Auth-Mode: cookie，刷新和退出不带请求体）。见 docs/api/auth.md 的“两种登录方式”。
 */
export type AuthMode = "body" | "cookie";

/** 刷新、退出的请求体：Cookie 模式下令牌由浏览器带上，不放进请求体 */
function tokenBody(mode: AuthMode, refreshToken: string | null): { refresh_token: string } | undefined {
  if (mode === "cookie" || refreshToken === null) return undefined;
  return { refresh_token: refreshToken };
}

export function createApi(client: ApiClient, options: { authMode?: AuthMode } = {}) {
  const mode = options.authMode ?? "body";
  const authHeaders: Record<string, string> = mode === "cookie" ? { "X-Auth-Mode": "cookie" } : {};
  return {
    auth: {
      /** 要验证邮箱时不登录（verification_required），用 registeredSession 判断 */
      register: (body: { email: string; password: string; display_name?: string; locale?: string }) =>
        client.post<RegisterResponse>("/v1/auth/register", body, { auth: false, headers: authHeaders }),
      /** 重发注册验证码（verify）、找回密码（reset）。邮箱没注册过时也成功（不透露） */
      sendCode: (body: { email: string; purpose: CodePurpose; locale?: string }) =>
        client.post<void>("/v1/auth/send-code", body, { auth: false }),
      verifyEmail: (body: { email: string; code: string }) =>
        client.post<AuthResponse>("/v1/auth/verify-email", body, { auth: false, headers: authHeaders }),
      resetPassword: (body: { email: string; code: string; new_password: string }) =>
        client.post<AuthResponse>("/v1/auth/reset-password", body, { auth: false, headers: authHeaders }),
      /** 改密码：其他设备退出，这台设备拿到新令牌（调用方要 signIn 换上） */
      changePassword: (body: { current_password: string; new_password: string }) =>
        client.post<AuthResponse>("/v1/me/password", body, { headers: authHeaders }),
      login: (body: { email: string; password: string }) =>
        client.post<AuthResponse>("/v1/auth/login", body, { auth: false, headers: authHeaders }),
      /** 网页（Cookie 模式）传 null */
      refresh: (refreshToken: string | null) =>
        client.post<AuthResponse>("/v1/auth/refresh", tokenBody(mode, refreshToken), {
          auth: false,
          headers: authHeaders,
        }),
      logout: (refreshToken: string | null) =>
        client.post<void>("/v1/auth/logout", tokenBody(mode, refreshToken), {
          auth: false,
          headers: authHeaders,
          timeoutMs: 5_000,
        }),
      me: () => client.get<User>("/v1/me"),
      deleteAccount: (password: string) => client.delete<void>("/v1/me", { password }),
      /** 官方模型的点数余额 */
      credits: () => client.get<Credits>("/v1/me/credits"),
    },
    models: {
      providers: () => client.get<Provider[]>("/v1/providers"),
      /** 用还没保存的 Key 拉模型列表（添加模型的表单用） */
      preview: (provider: string, body: ModelListQuery) =>
        client.post<ModelInfo[]>(`/v1/providers/${enc(provider)}/models`, body, { timeoutMs: 30_000 }),
      list: () => client.get<ModelRoute[]>("/v1/model-routes"),
      get: (id: string) => client.get<ModelRoute>(`/v1/model-routes/${enc(id)}`),
      // 保存时服务端可能要拉一次模型列表来确定窗口（最多 15 秒）
      create: (body: NewModelRoute) =>
        client.post<ModelRoute>("/v1/model-routes", body, { timeoutMs: 30_000 }),
      update: (id: string, body: ModelRoutePatch) =>
        client.patch<ModelRoute>(`/v1/model-routes/${enc(id)}`, body, { timeoutMs: 30_000 }),
      remove: (id: string) => client.delete<void>(`/v1/model-routes/${enc(id)}`),
      /** 把官方模型加回来（已经有就原样返回）；服务器没有官方模型时 503 PLATFORM_UNAVAILABLE */
      addPlatform: () => client.post<ModelRoute>("/v1/model-routes/platform"),
      // 测试会真的调几次模型，给足时间
      probe: (id: string) =>
        client.post<ProbeReport>(`/v1/model-routes/${enc(id)}/probe`, undefined, { timeoutMs: 90_000 }),
      listModels: (id: string) =>
        client.get<ModelInfo[]>(`/v1/model-routes/${enc(id)}/models`, { timeoutMs: 30_000 }),
    },
    cards: {
      list: () => client.get<CardSummary[]>("/v1/cards"),
      get: (id: string) => client.get<CardDetail>(`/v1/cards/${enc(id)}`),
      /** 有剧本在用时是 409 CARD_IN_USE（带 scenarios） */
      remove: (id: string) => client.delete<void>(`/v1/cards/${enc(id)}`),
      revisions: (id: string) => client.get<CardRevision[]>(`/v1/cards/${enc(id)}/revisions`),
      restore: (id: string, version: number) =>
        client.post<CardDetail>(`/v1/cards/${enc(id)}/revisions/${version}/restore`),
      exportPath: (id: string, format: "png" | "json") => `/v1/cards/${enc(id)}/export?format=${format}`,
    },
    scenarios: {
      list: () => client.get<Scenario[]>("/v1/scenarios"),
      get: (id: string) => client.get<Scenario>(`/v1/scenarios/${enc(id)}`),
      create: (body: NewScenario) => client.post<Scenario>("/v1/scenarios", body),
      /** 带 version 时检查有没有在别处改过（409 SCENARIO_CHANGED） */
      update: (id: string, body: ScenarioPatch) => client.patch<Scenario>(`/v1/scenarios/${enc(id)}`, body),
      remove: (id: string) => client.delete<void>(`/v1/scenarios/${enc(id)}`),
    },
    lorebooks: {
      list: () => client.get<LorebookSummary[]>("/v1/lorebooks"),
      get: (id: string) => client.get<LorebookDetail>(`/v1/lorebooks/${enc(id)}`),
      create: (name: string, description = "") =>
        client.post<LorebookDetail>("/v1/lorebooks", { name, description }),
      /** 同一个文件导入过、又没让另起一本时 lorebook 是 null、existing 是已有的那本。
       * 书名取文件里的名字，没有就用 filename */
      importFile: (file: Blob, options: { allowDuplicate: boolean; filename?: string }) => {
        const form = new FormData();
        if (options.filename) form.append("file", file, options.filename);
        else form.append("file", file);
        form.append("allow_duplicate", options.allowDuplicate ? "true" : "false");
        return client.request<LorebookImport>("POST", "/v1/lorebooks/import", { form, timeoutMs: 120_000 });
      },
      /** 带 version 时检查有没有在别处改过（409 LOREBOOK_CHANGED） */
      update: (id: string, body: { name?: string; description?: string; version?: number }) =>
        client.patch<LorebookDetail>(`/v1/lorebooks/${enc(id)}`, body),
      /** 编辑条目的自动保存：整本的条目；版本号对不上是 409 LOREBOOK_CHANGED */
      saveBook: (id: string, version: number, book: LoreEntry[]) =>
        client.put<LorebookDetail>(`/v1/lorebooks/${enc(id)}/book`, { version, book }, { timeoutMs: 60_000 }),
      remove: (id: string) => client.delete<void>(`/v1/lorebooks/${enc(id)}`),
    },
    blobPath: (blobId: string) => `/v1/blobs/${enc(blobId)}`,
    workbench: {
      list: () => client.get<DraftSummary[]>("/v1/workbench/drafts"),
      get: (id: string) => client.get<Draft>(`/v1/workbench/drafts/${enc(id)}`),
      createManual: (language: string) =>
        client.post<Draft>("/v1/workbench/drafts", { origin: "manual", language }),
      /** 从仓库打开一张卡：这张卡已经有草稿就返回那一份 */
      openCard: (cardId: string, language: string) =>
        client.post<Draft>("/v1/workbench/drafts", { origin: "edit_card", card_id: cardId, language }),
      /** 从聊天框开始：同时开 agent 的第一轮 */
      startAgent: (text: string, language: string) =>
        client.post<Draft>("/v1/workbench/drafts", { origin: "agent", text, language }),
      importFile: (file: Blob, options: ImportOptions) => {
        const form = new FormData();
        // SDK 57 的全局 fetch 是 expo/fetch，不认 RN 的 { uri, name, type }，只认能读出字节的对象：
        // 调用方传 expo-file-system 的 File。服务端按内容识别 PNG 或 JSON，不看文件名
        form.append("file", file);
        form.append("language", options.language);
        form.append("allow_duplicate", options.allowDuplicate ? "true" : "false");
        return client.request<DraftImport>("POST", "/v1/workbench/drafts/import", { form, timeoutMs: 120_000 });
      },
      /** 自动保存：版本号对不上是 409 DRAFT_CHANGED。整张卡可能接近 1 MB，超时放宽 */
      saveCard: (id: string, version: number, name: string, card: CharacterCardInput) =>
        client.put<Draft>(`/v1/workbench/drafts/${enc(id)}/card`, { version, name, card }, { timeoutMs: 60_000 }),
      setMode: (id: string, mode: DraftMode) => client.patch<Draft>(`/v1/workbench/drafts/${enc(id)}`, { mode }),
      uploadAsset: (id: string, file: Blob) => {
        const form = new FormData();
        form.append("file", file);
        return client.request<Asset>("POST", `/v1/workbench/drafts/${enc(id)}/assets`, {
          form,
          timeoutMs: 120_000,
        });
      },
      setCover: (id: string, assetId: string | null, personalUse = false) =>
        client.put<Draft>(`/v1/workbench/drafts/${enc(id)}/cover`, {
          asset_id: assetId,
          personal_use: personalUse,
        }),
      /** 封面面板里直接出图（不经过 agent），可能要一两分钟 */
      generateCovers: (id: string, body: CoverRequest) =>
        client.post<Asset[]>(`/v1/workbench/drafts/${enc(id)}/covers`, body, { timeoutMs: 180_000 }),
      save: (id: string, options: SaveOptions = {}) =>
        client.post<DraftSave>(`/v1/workbench/drafts/${enc(id)}/save`, options, { timeoutMs: 60_000 }),
      remove: (id: string) => client.delete<void>(`/v1/workbench/drafts/${enc(id)}`),
      messages: (id: string) => client.get<Transcript>(`/v1/workbench/drafts/${enc(id)}/messages`),
      /** 说话、交问卷、回复方案；agent 还在跑时是 409 DRAFT_BUSY */
      post: (id: string, message: NewMessage) =>
        client.post<WorkbenchMessage>(`/v1/workbench/drafts/${enc(id)}/messages`, message),
      decide: (
        id: string,
        seq: number,
        body: { accept?: string[]; reject?: string[]; all?: "accept" | "reject" },
      ) => client.post<{ message: WorkbenchMessage; draft: Draft }>(`/v1/workbench/drafts/${enc(id)}/changes/${seq}`, body),
      stop: (id: string) => client.post<{ stopped: boolean }>(`/v1/workbench/drafts/${enc(id)}/stop`),
      continue: (id: string) => client.post<Draft>(`/v1/workbench/drafts/${enc(id)}/continue`),
      eventsPath: (id: string) => `/v1/workbench/drafts/${enc(id)}/events`,
    },
    tools: {
      providers: () => client.get<ToolProvider[]>("/v1/tool-providers"),
      list: () => client.get<ToolRoute[]>("/v1/tool-routes"),
      create: (body: NewToolRoute) => client.post<ToolRoute>("/v1/tool-routes", body),
      update: (id: string, body: ToolRoutePatch) => client.patch<ToolRoute>(`/v1/tool-routes/${enc(id)}`, body),
      remove: (id: string) => client.delete<void>(`/v1/tool-routes/${enc(id)}`),
      /** 真的搜一个词、读一个页面或者出一张小图，最多 60 秒 */
      test: (id: string) => client.post<ToolRoute>(`/v1/tool-routes/${enc(id)}/test`, undefined, { timeoutMs: 90_000 }),
    },
    playthroughs: {
      create: (body: NewPlaythrough) => client.post<PlaythroughCreated>("/v1/playthroughs", body),
      list: () => client.get<Playthrough[]>("/v1/playthroughs"),
      get: (id: string) => client.get<PlaythroughDetail>(`/v1/playthroughs/${enc(id)}`),
      rename: (id: string, title: string) =>
        client.patch<Playthrough>(`/v1/playthroughs/${enc(id)}`, { title }),
      remove: (id: string) => client.delete<void>(`/v1/playthroughs/${enc(id)}`),
      /** 回退到更早的一回合；返回回退后的详情 */
      rollback: (id: string, turnId: string) =>
        client.post<PlaythroughDetail>(`/v1/playthroughs/${enc(id)}/rollback`, { turn_id: turnId }),
      world: (id: string, reveal = false) =>
        client.get<WorldView>(`/v1/playthroughs/${enc(id)}/world${reveal ? "?reveal=true" : ""}`),
    },
    turns: {
      history: async (playthroughId: string, afterSeq: number, limit: number) =>
        (
          await client.get<{ turns: Turn[] }>(
            `/v1/playthroughs/${enc(playthroughId)}/turns?after_seq=${afterSeq}&limit=${limit}`,
          )
        ).turns,
      submit: (
        playthroughId: string,
        body: { parent_turn_id: string | null; action: NewAction },
        idempotencyKey: string,
      ) =>
        client.post<TurnCreated>(`/v1/playthroughs/${enc(playthroughId)}/turns`, body, {
          headers: { "Idempotency-Key": idempotencyKey },
        }),
      get: (turnId: string) => client.get<Turn>(`/v1/turns/${enc(turnId)}`),
      cancel: (turnId: string) => client.post<Turn>(`/v1/turns/${enc(turnId)}/cancel`),
      eventsPath: (turnId: string) => `/v1/turns/${enc(turnId)}/events`,
    },
  };
}

export type Api = ReturnType<typeof createApi>;
