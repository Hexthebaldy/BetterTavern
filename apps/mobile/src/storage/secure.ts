/**
 * 设备上的安全存储（iOS 钥匙串 / Android Keystore）：登录令牌、自定义的服务器地址和界面偏好。
 * 模型的 API Key 不在设备上保存，只在服务端加密存放。
 */

import * as SecureStore from "expo-secure-store";

import { parseStoredSession, type SessionStorage, type StoredSession } from "../auth/session.ts";

const SESSION_KEY = "bt.session";
const SERVER_KEY = "bt.server";

export const secureSessionStorage: SessionStorage = {
  async load(): Promise<StoredSession | null> {
    return parseStoredSession(await SecureStore.getItemAsync(SESSION_KEY));
  },
  async save(session: StoredSession): Promise<void> {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};

export async function loadServerUrl(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SERVER_KEY);
  } catch {
    return null;
  }
}

export async function saveServerUrl(url: string | null): Promise<void> {
  if (url) await SecureStore.setItemAsync(SERVER_KEY, url);
  else await SecureStore.deleteItemAsync(SERVER_KEY);
}

const PREFS_KEY = "bt.prefs";

/** 界面偏好（最近用过的服务器、阅读设置、剧本库视图），读不到时返回 null */
export async function loadPrefs(): Promise<unknown> {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export async function savePrefs(prefs: unknown): Promise<void> {
  await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs));
}
