import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError } from "../api/client.ts";
import type { AuthResponse } from "../api/types.ts";
import { parseStoredSession, SessionManager, type SessionStorage, type StoredSession } from "./session.ts";

const USER = { id: "u1", email: "lin@example.com", display_name: "林川", locale: "zh-CN", created_at: "" };

function auth(n: number, expiresIn = 900): AuthResponse {
  return {
    user: USER,
    access_token: `access-${n}`,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: `refresh-${n}`,
    refresh_expires_at: "",
  };
}

class MemoryStorage implements SessionStorage {
  value: StoredSession | null;
  constructor(value: StoredSession | null = null) {
    this.value = value;
  }
  async load() {
    return this.value;
  }
  async save(session: StoredSession) {
    this.value = session;
  }
  async clear() {
    this.value = null;
  }
}

function manager(
  storage: SessionStorage,
  refresh: (token: string) => Promise<AuthResponse>,
  clock = { t: 0 },
) {
  return new SessionManager({ storage, refresh, now: () => clock.t });
}

describe("SessionManager", () => {
  it("恢复已保存的会话；令牌还新鲜时不刷新", async () => {
    const storage = new MemoryStorage({
      user: USER,
      accessToken: "a",
      accessExpiresAt: 900_000,
      refreshToken: "r",
    });
    let refreshes = 0;
    const session = manager(storage, async () => {
      refreshes += 1;
      return auth(1);
    });
    assert.equal(session.getStatus(), "restoring");
    await session.restore();
    assert.equal(session.getStatus(), "signedIn");
    assert.equal(await session.accessToken(), "a");
    assert.equal(refreshes, 0);
  });

  it("快过期时刷新；并发请求只刷新一次，新令牌写回存储", async () => {
    const clock = { t: 0 };
    const storage = new MemoryStorage();
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = manager(
      storage,
      async (token) => {
        seen.push(token);
        await gate;
        return auth(2);
      },
      clock,
    );
    await session.signIn(auth(1));
    clock.t = 860_000; // 离过期不到一分钟
    const pending = [session.accessToken(), session.accessToken(), session.accessToken()];
    release();
    assert.deepEqual(await Promise.all(pending), ["access-2", "access-2", "access-2"]);
    assert.deepEqual(seen, ["refresh-1"]);
    assert.equal(storage.value?.refreshToken, "refresh-2");
  });

  it("刷新被拒（令牌失效或被盗用检测吊销）：退出登录", async () => {
    const storage = new MemoryStorage();
    const session = manager(storage, async () => {
      throw new ApiError("登录已失效，请重新登录", { status: 401, code: "REFRESH_REUSED", retryable: false });
    });
    await session.signIn(auth(1, 0));
    const states: string[] = [];
    session.subscribe(() => states.push(session.getStatus()));
    assert.equal(await session.accessToken(), null);
    assert.equal(session.getStatus(), "signedOut");
    assert.equal(storage.value, null);
    assert.deepEqual(states, ["signedOut"]);
    assert.equal(await session.refresh(), false);
  });

  it("刷新时网络不通：抛出网络错误，会话保留", async () => {
    let fail = true;
    const session = manager(new MemoryStorage(), async () => {
      if (fail) throw new ApiError("连不上服务器", { status: 0, code: "NETWORK", retryable: true });
      return auth(2);
    });
    await session.signIn(auth(1, 0));
    await assert.rejects(session.accessToken(), (e: unknown) => e instanceof ApiError && e.isNetwork);
    assert.equal(session.getStatus(), "signedIn");
    fail = false;
    assert.equal(await session.accessToken(), "access-2");
  });

  it("退出返回刷新令牌，供服务端吊销", async () => {
    const storage = new MemoryStorage();
    const session = manager(storage, async () => auth(2));
    await session.signIn(auth(1));
    assert.equal(await session.signOut(), "refresh-1");
    assert.equal(session.getStatus(), "signedOut");
    assert.equal(await session.accessToken(), null);
    assert.equal(storage.value, null);
  });

  it("存储里的数据形状不对就当没登录", () => {
    assert.equal(parseStoredSession(null), null);
    assert.equal(parseStoredSession("{oops"), null);
    assert.equal(parseStoredSession(JSON.stringify({ accessToken: "a" })), null);
    const ok = { user: USER, accessToken: "a", accessExpiresAt: 1, refreshToken: "r" };
    assert.deepEqual(parseStoredSession(JSON.stringify(ok)), ok);
  });
});
