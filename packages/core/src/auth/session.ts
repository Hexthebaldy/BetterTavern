/**
 * 登录会话：保存令牌、按需刷新访问令牌（同一时刻只刷新一次）、刷新被拒时退出登录。
 *
 * 访问令牌 15 分钟过期，提前一分钟刷新；刷新令牌每次使用都会轮换（服务端检测重放）。
 * 刷新时网络不通不算退出：抛出网络错误，会话保留，等网络恢复再试。
 *
 * App 自己保存刷新令牌；网页用 Cookie 模式，刷新令牌在浏览器的 HttpOnly Cookie 里，这里的 refreshToken 是 null，
 * 刷新时由浏览器带上 Cookie（docs/api/auth.md 的“两种登录方式”）。
 */

import { ApiError } from "../api/client.ts";
import type { AuthResponse, RegisterResponse, User } from "../api/types.ts";

export type StoredSession = {
  user: User;
  accessToken: string;
  /** 访问令牌的过期时间（本机时钟，毫秒） */
  accessExpiresAt: number;
  /** null：刷新令牌在 Cookie 里（网页） */
  refreshToken: string | null;
};

export interface SessionStorage {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export type SessionStatus = "restoring" | "signedIn" | "signedOut";

export type SessionDeps = {
  storage: SessionStorage;
  refresh: (refreshToken: string | null) => Promise<AuthResponse>;
  now?: () => number;
  /** 离过期还有多久就提前刷新 */
  earlyRefreshMs?: number;
};

/** 注册的响应能不能直接登录：要先验证邮箱时返回 null（客户端去验证页） */
export function registeredSession(response: RegisterResponse): AuthResponse | null {
  if (
    response.verification_required ||
    response.access_token === null ||
    response.expires_in === null ||
    response.refresh_expires_at === null
  ) {
    return null;
  }
  return {
    user: response.user,
    access_token: response.access_token,
    token_type: response.token_type,
    expires_in: response.expires_in,
    refresh_token: response.refresh_token,
    refresh_expires_at: response.refresh_expires_at,
  };
}

export function sessionFromAuth(auth: AuthResponse, now: number): StoredSession {
  return {
    user: auth.user,
    accessToken: auth.access_token,
    accessExpiresAt: now + auth.expires_in * 1000,
    refreshToken: auth.refresh_token,
  };
}

/** 设备上读出来的数据不一定可信（版本升级、存储损坏）：形状不对就当没登录 */
export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<StoredSession> | null;
    if (
      data &&
      typeof data.accessToken === "string" &&
      typeof data.refreshToken === "string" &&
      typeof data.accessExpiresAt === "number" &&
      typeof data.user === "object" &&
      data.user !== null &&
      typeof data.user.id === "string"
    ) {
      return data as StoredSession;
    }
  } catch {
    // 落到下面
  }
  return null;
}

export class SessionManager {
  private readonly deps: SessionDeps;
  private session: StoredSession | null = null;
  private status: SessionStatus = "restoring";
  private refreshing: Promise<boolean> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  getUser(): User | null {
    return this.session?.user ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  async restore(): Promise<void> {
    let stored: StoredSession | null = null;
    try {
      stored = await this.deps.storage.load();
    } catch {
      stored = null;
    }
    // 恢复期间已经登录（极少见）就不覆盖
    if (this.status === "restoring") {
      this.session = stored;
      this.status = stored ? "signedIn" : "signedOut";
      this.notify();
    }
  }

  async signIn(auth: AuthResponse): Promise<void> {
    this.session = sessionFromAuth(auth, this.now());
    this.status = "signedIn";
    this.notify();
    try {
      await this.deps.storage.save(this.session);
    } catch {
      // 存不下只影响下次打开时要重新登录
    }
  }

  /** 本地退出。返回刷新令牌（网页是 null），调用方据此请服务端吊销（尽力而为）。 */
  async signOut(): Promise<string | null> {
    const token = this.session?.refreshToken ?? null;
    this.session = null;
    this.refreshing = null;
    this.status = "signedOut";
    this.notify();
    try {
      await this.deps.storage.clear();
    } catch {
      // 忽略
    }
    return token;
  }

  /** 可用的访问令牌：快过期时先刷新。没有登录返回 null；刷新时网络不通抛出网络错误。 */
  async accessToken(): Promise<string | null> {
    const session = this.session;
    if (!session) return null;
    if (session.accessExpiresAt - this.now() > (this.deps.earlyRefreshMs ?? 60_000)) {
      return session.accessToken;
    }
    const refreshed = await this.refresh();
    return refreshed ? (this.session?.accessToken ?? null) : null;
  }

  /** 强制刷新（同一时刻只发一个请求）。被服务端拒绝时退出登录并返回 false。 */
  refresh(): Promise<boolean> {
    const session = this.session;
    if (!session) return Promise.resolve(false);
    if (!this.refreshing) {
      const attempt = this.doRefresh(session);
      this.refreshing = attempt;
      const clear = (): void => {
        if (this.refreshing === attempt) this.refreshing = null;
      };
      attempt.then(clear, clear);
    }
    return this.refreshing;
  }

  private async doRefresh(session: StoredSession): Promise<boolean> {
    try {
      const auth = await this.deps.refresh(session.refreshToken);
      if (this.session !== session) return this.session !== null; // 期间已退出或重新登录
      await this.signIn(auth);
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        if (this.session === session) await this.signOut();
        return false;
      }
      throw error;
    }
  }
}
