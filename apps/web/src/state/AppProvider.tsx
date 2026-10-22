/**
 * 全局的服务与登录状态：ApiClient、各接口、会话、回合事件流的连接方式。用 useApp() 取。
 *
 * 网页和接口同源（开发时 Vite 转发，部署时反向代理），请求地址都是相对路径。
 * 登录用 Cookie 模式：刷新令牌在浏览器的 HttpOnly Cookie 里，访问令牌只在内存中；
 * 打开页面时凭 Cookie 换一个访问令牌，换不到就是没登录（docs/api/auth.md 的“两种登录方式”）。
 */

import { useQueryClient } from "@tanstack/react-query";
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

import { ApiClient, ApiError } from "@bettertavern/core/api/client";
import { createApi, type Api } from "@bettertavern/core/api/endpoints";
import { sseTurnConnector, type TurnConnector } from "@bettertavern/core/api/turnStream";
import { sseWorkbenchConnector, type WorkbenchConnector } from "@bettertavern/core/api/workbenchStream";
import type { AuthResponse, User } from "@bettertavern/core/api/types";
import {
  SessionManager,
  sessionFromAuth,
  type SessionStatus,
  type SessionStorage,
} from "@bettertavern/core/auth/session";
import { diagnostics } from "@bettertavern/core/observability/log";
import { requestFields, requestLevel } from "@bettertavern/core/observability/requests";

import { CLIENT_VERSION } from "../config.ts";

type Services = {
  api: Api;
  session: SessionManager;
  connectTurn: TurnConnector;
  connectWorkbench: WorkbenchConnector;
  authHeaders: () => Promise<Record<string, string>>;
  restore: () => Promise<void>;
};

/** 网页不在本地保存会话：“读出会话”就是凭 Cookie 换一组令牌；没有 Cookie 或被拒就是没登录 */
function cookieSession(api: Api): SessionStorage {
  return {
    load: async () => {
      try {
        return sessionFromAuth(await api.auth.refresh(null), Date.now());
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
        throw error;
      }
    },
    save: async () => undefined,
    clear: async () => undefined,
  };
}

function createServices(): Services {
  // session 和 api 互相引用：api 带令牌要问 session，session 刷新令牌要调 api
  let session: SessionManager | null = null;
  const client = new ApiClient({
    baseUrl: () => "",
    fetch: (url, init) => fetch(url, init),
    clientVersion: CLIENT_VERSION,
    onRequest: (record) =>
      diagnostics.log(requestLevel(record), "api.request", requestFields(record, window.location.origin)),
    auth: {
      accessToken: () => session?.accessToken() ?? Promise.resolve(null),
      refresh: () => session?.refresh() ?? Promise.resolve(false),
    },
  });
  const api = createApi(client, { authMode: "cookie" });
  const manager = new SessionManager({ storage: cookieSession(api), refresh: () => api.auth.refresh(null) });
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
  const connectTurn = sseTurnConnector({
    url: (turnId) => api.turns.eventsPath(turnId),
    fetch: (url, init) => fetch(url, init),
    headers: authHeaders,
    onUnauthorized: () => manager.refresh().catch(() => false),
    log: (level, event, fields) => diagnostics.log(level, event, fields),
  });
  const connectWorkbench = sseWorkbenchConnector({
    url: (draftId) => api.workbench.eventsPath(draftId),
    fetch: (url, init) => fetch(url, init),
    headers: authHeaders,
    onUnauthorized: () => manager.refresh().catch(() => false),
    log: (level, event, fields) => diagnostics.log(level, event, fields),
  });
  // 开发时 React 的严格模式会把 effect 跑两遍：恢复只做一次
  let restoring: Promise<void> | null = null;
  const restore = (): Promise<void> => (restoring ??= manager.restore());
  return { api, session: manager, connectTurn, connectWorkbench, authHeaders, restore };
}

export type AppContextValue = {
  api: Api;
  connectTurn: TurnConnector;
  connectWorkbench: WorkbenchConnector;
  authHeaders: () => Promise<Record<string, string>>;
  status: SessionStatus;
  user: User | null;
  signIn: (auth: AuthResponse) => Promise<void>;
  signOut: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [services] = useState(createServices);
  const queries = useQueryClient();
  const { session } = services;
  const status = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getStatus(),
  );
  const user = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getUser(),
  );

  useEffect(() => {
    void services.restore();
  }, [services]);

  // 退出（包括刷新被拒的被动退出）后清掉缓存的数据，换账户登录时不会闪出上一个人的故事
  useEffect(() => {
    if (status === "signedOut") queries.clear();
  }, [status, queries]);

  const signIn = useCallback((auth: AuthResponse) => session.signIn(auth), [session]);

  // 先请服务端吊销并删掉 Cookie，再本地退出：服务端没收到时 Cookie 还在，刷新页面会重新登录上
  const signOut = useCallback(async () => {
    await services.api.auth.logout(null).catch(() => undefined);
    await session.signOut();
  }, [services, session]);

  const value = useMemo<AppContextValue>(
    () => ({
      api: services.api,
      connectTurn: services.connectTurn,
      connectWorkbench: services.connectWorkbench,
      authHeaders: services.authHeaders,
      status,
      user,
      signIn,
      signOut,
    }),
    [services, status, user, signIn, signOut],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
