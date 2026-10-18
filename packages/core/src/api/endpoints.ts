/**
 * 各个接口的薄封装（路径、方法、类型）。接口说明见 docs/backend.md 第 9 节。
 */

import type { ApiClient } from "./client.ts";
import type {
  AuthResponse,
  ModelInfo,
  ModelRoute,
  NewAction,
  Playthrough,
  PlaythroughCreated,
  PlaythroughDetail,
  Preferences,
  ProbeReport,
  Provider,
  RouteParams,
  Scenario,
  ScenarioCard,
  ScenarioCardInput,
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
};

/** 只改给出的字段；manual_window、fallback_route_id 传 null 表示清空 */
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
  fallback_route_id?: string | null;
};

export type ModelListQuery = { api_key: string; base_url?: string | null };

export type NewPlaythrough = {
  scenario_id: string;
  protagonist: { name: string; summary?: string };
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
      register: (body: { email: string; password: string; display_name?: string }) =>
        client.post<AuthResponse>("/v1/auth/register", body, { auth: false, headers: authHeaders }),
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
      // 测试会真的调几次模型，给足时间
      probe: (id: string) =>
        client.post<ProbeReport>(`/v1/model-routes/${enc(id)}/probe`, undefined, { timeoutMs: 90_000 }),
      listModels: (id: string) =>
        client.get<ModelInfo[]>(`/v1/model-routes/${enc(id)}/models`, { timeoutMs: 30_000 }),
    },
    scenarios: {
      importFile: (file: Blob) => {
        const form = new FormData();
        // SDK 57 的全局 fetch 是 expo/fetch，不认 RN 的 { uri, name, type }，只认能读出字节的对象：
        // 调用方传 expo-file-system 的 File。服务端按内容识别 PNG 或 JSON，不看文件名
        form.append("file", file);
        return client.request<Scenario>("POST", "/v1/scenarios/import", { form, timeoutMs: 120_000 });
      },
      list: () => client.get<Scenario[]>("/v1/scenarios"),
      get: (id: string) => client.get<Scenario>(`/v1/scenarios/${enc(id)}`),
      rename: (id: string, name: string) => client.patch<Scenario>(`/v1/scenarios/${enc(id)}`, { name }),
      /** 编辑页：能编辑的那部分卡片和版本号 */
      card: (id: string) => client.get<ScenarioCard>(`/v1/scenarios/${enc(id)}/card`),
      /** 保存编辑；版本号对不上（别处改过）时是 409 CARD_CHANGED。整张卡可能接近 1 MB，超时放宽 */
      saveCard: (id: string, input: ScenarioCardInput) =>
        client.put<ScenarioCard>(`/v1/scenarios/${enc(id)}/card`, input, { timeoutMs: 60_000 }),
      /** 恢复成导入时的内容（显示名不变） */
      resetCard: (id: string) => client.post<ScenarioCard>(`/v1/scenarios/${enc(id)}/card/reset`),
      remove: (id: string) => client.delete<void>(`/v1/scenarios/${enc(id)}`),
      blobPath: (blobId: string) => `/v1/blobs/${enc(blobId)}`,
    },
    playthroughs: {
      create: (body: NewPlaythrough) => client.post<PlaythroughCreated>("/v1/playthroughs", body),
      list: () => client.get<Playthrough[]>("/v1/playthroughs"),
      get: (id: string) => client.get<PlaythroughDetail>(`/v1/playthroughs/${enc(id)}`),
      rename: (id: string, title: string) =>
        client.patch<Playthrough>(`/v1/playthroughs/${enc(id)}`, { title }),
      remove: (id: string) => client.delete<void>(`/v1/playthroughs/${enc(id)}`),
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
