/**
 * 各个接口的薄封装（路径、方法、类型）。接口说明见 docs/backend.md 第 9 节。
 */

import type { ApiClient } from "./client.ts";
import type {
  AuthResponse,
  Credential,
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
  Turn,
  TurnCreated,
  User,
  WorldView,
} from "./types.ts";

export type NewCredential = {
  provider: string;
  label?: string;
  api_key: string;
  base_url?: string | null;
};

export type CredentialPatch = { label?: string; api_key?: string; base_url?: string };

export type RouteInput = {
  credential_id: string;
  model: string;
  params?: RouteParams;
  caps_override?: Record<string, unknown>;
  fallback_route_id?: string | null;
};

export type NewPlaythrough = {
  scenario_id: string;
  protagonist: { name: string; summary?: string };
  title?: string;
  preferences?: Partial<Preferences>;
};

const enc = encodeURIComponent;

export function createApi(client: ApiClient) {
  return {
    auth: {
      register: (body: { email: string; password: string; display_name?: string }) =>
        client.post<AuthResponse>("/v1/auth/register", body, { auth: false }),
      login: (body: { email: string; password: string }) =>
        client.post<AuthResponse>("/v1/auth/login", body, { auth: false }),
      refresh: (refreshToken: string) =>
        client.post<AuthResponse>("/v1/auth/refresh", { refresh_token: refreshToken }, { auth: false }),
      logout: (refreshToken: string) =>
        client.post<void>(
          "/v1/auth/logout",
          { refresh_token: refreshToken },
          { auth: false, timeoutMs: 5_000 },
        ),
      me: () => client.get<User>("/v1/me"),
      deleteAccount: (password: string) => client.delete<void>("/v1/me", { password }),
    },
    credentials: {
      providers: () => client.get<Provider[]>("/v1/providers"),
      list: () => client.get<Credential[]>("/v1/credentials"),
      get: (id: string) => client.get<Credential>(`/v1/credentials/${enc(id)}`),
      create: (body: NewCredential) => client.post<Credential>("/v1/credentials", body),
      update: (id: string, body: CredentialPatch) =>
        client.patch<Credential>(`/v1/credentials/${enc(id)}`, body),
      remove: (id: string) => client.delete<void>(`/v1/credentials/${enc(id)}`),
      // 探测会真的调一次模型，给足时间
      probe: (id: string, model: string) =>
        client.post<ProbeReport>(`/v1/credentials/${enc(id)}/probe`, { model }, { timeoutMs: 90_000 }),
      models: (id: string) =>
        client.get<ModelInfo[]>(`/v1/credentials/${enc(id)}/models`, { timeoutMs: 30_000 }),
    },
    routes: {
      list: () => client.get<ModelRoute[]>("/v1/model-routes"),
      put: (task: string, body: RouteInput) => client.put<ModelRoute>(`/v1/model-routes/${enc(task)}`, body),
      remove: (task: string) => client.delete<void>(`/v1/model-routes/${enc(task)}`),
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
