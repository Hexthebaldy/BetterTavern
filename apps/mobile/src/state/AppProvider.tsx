/**
 * 全局的服务与登录状态：ApiClient、各接口、会话、回合事件流的连接方式，以及服务器地址。
 * 用 useApp() 取。登录状态变化（包括刷新令牌失败被动退出）会触发路由守卫切换页面。
 */

import { fetch as expoFetch } from "expo/fetch";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { ApiClient } from "@bettertavern/core/api/client";
import { createApi, type Api } from "@bettertavern/core/api/endpoints";
import type { FetchLike } from "@bettertavern/core/api/sse/sseClient";
import { sseTurnConnector, type TurnConnector } from "@bettertavern/core/api/turnStream";
import type { AuthResponse, User } from "@bettertavern/core/api/types";
import { SessionManager, type SessionStatus } from "@bettertavern/core/auth/session";
import { diagnostics } from "@bettertavern/core/observability/log";
import { requestFields, requestLevel, serverHost } from "@bettertavern/core/observability/requests";

import { CLIENT_VERSION, DEFAULT_SERVER_URL, normalizeServerUrl } from "../config.ts";
import { loadServerUrl, saveServerUrl, secureSessionStorage } from "../storage/secure.ts";

type Services = {
  api: Api;
  session: SessionManager;
  connectTurn: TurnConnector;
  authHeaders: () => Promise<Record<string, string>>;
  serverUrl: { current: string };
};

function createServices(): Services {
  const serverUrl = { current: DEFAULT_SERVER_URL };
  // session 和 api 互相引用：api 带令牌要问 session，session 刷新令牌要调 api
  let session: SessionManager | null = null;
  const client = new ApiClient({
    baseUrl: () => serverUrl.current,
    fetch: (url, init) => fetch(url, init),
    clientVersion: CLIENT_VERSION,
    // 失败的和慢的请求记进诊断日志，正常的只在开发时打到终端
    onRequest: (record) =>
      diagnostics.log(requestLevel(record), "api.request", requestFields(record, serverUrl.current)),
    auth: {
      accessToken: () => session?.accessToken() ?? Promise.resolve(null),
      refresh: () => session?.refresh() ?? Promise.resolve(false),
    },
  });
  const api = createApi(client);
  const manager = new SessionManager({
    storage: secureSessionStorage,
    refresh: (token) => api.auth.refresh(token),
  });
  session = manager;
  let lastStatus = manager.getStatus();
  manager.subscribe(() => {
    const next = manager.getStatus();
    if (next === lastStatus) return;
    diagnostics.info("session.status", { from: lastStatus, to: next });
    lastStatus = next;
  });
  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await manager.accessToken();
    return token ? { Authorization: `Bearer ${token}`, "X-Client-Version": CLIENT_VERSION } : {};
  };
  // 流式读取用 expo/fetch（支持 response.body.getReader()）
  const streamFetch: FetchLike = (url, init) => expoFetch(url, init);
  const connectTurn = sseTurnConnector({
    url: (turnId) => `${serverUrl.current}${api.turns.eventsPath(turnId)}`,
    fetch: streamFetch,
    headers: authHeaders,
    onUnauthorized: () => manager.refresh().catch(() => false),
    log: (level, event, fields) => diagnostics.log(level, event, fields),
  });
  return { api, session: manager, connectTurn, authHeaders, serverUrl };
}

export type AppContextValue = {
  api: Api;
  connectTurn: TurnConnector;
  authHeaders: () => Promise<Record<string, string>>;
  status: SessionStatus;
  user: User | null;
  serverUrl: string;
  setServerUrl: (url: string) => Promise<void>;
  signIn: (auth: AuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [services] = useState(createServices);
  const { session } = services;
  const status = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getStatus(),
  );
  const user = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getUser(),
  );
  const [serverUrl, setServerUrlState] = useState(DEFAULT_SERVER_URL);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const saved = await loadServerUrl();
      if (alive && saved) {
        services.serverUrl.current = saved;
        setServerUrlState(saved);
      }
      await session.restore();
    })();
    return () => {
      alive = false;
    };
  }, [services, session]);

  const setServerUrl = useCallback(
    async (raw: string) => {
      const url = normalizeServerUrl(raw) || DEFAULT_SERVER_URL;
      diagnostics.info("server.changed", {
        from: serverHost(services.serverUrl.current),
        to: serverHost(url),
      });
      services.serverUrl.current = url;
      setServerUrlState(url);
      await saveServerUrl(url === DEFAULT_SERVER_URL ? null : url).catch(() => undefined);
    },
    [services],
  );

  const signIn = useCallback((auth: AuthResponse) => session.signIn(auth), [session]);

  const signOut = useCallback(async () => {
    const token = await session.signOut();
    // 服务端吊销刷新令牌：尽力而为，失败不影响本地退出
    if (token) await services.api.auth.logout(token).catch(() => undefined);
  }, [services, session]);

  const value = useMemo<AppContextValue>(
    () => ({
      api: services.api,
      connectTurn: services.connectTurn,
      authHeaders: services.authHeaders,
      status,
      user,
      serverUrl,
      setServerUrl,
      signIn,
      signOut,
    }),
    [services, status, user, serverUrl, setServerUrl, signIn, signOut],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
