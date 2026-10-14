/**
 * 最近用过的服务器（存在设备上）：登录、注册成功或手动保存时记一次，连不上时记下失败时间。
 * 服务器面板按最近使用排在前面，最多留 5 个。
 */

export type RecentServer = {
  url: string;
  lastUsedAt: string;
  /** 最近一次连不上的时间；之后成功用过一次就清掉 */
  failedAt?: string | null;
};

export const MAX_RECENT_SERVERS = 5;

/** 用过一次：移到最前面，清掉失败记录 */
export function rememberServer(list: RecentServer[], url: string, now: Date): RecentServer[] {
  if (!url) return list;
  const rest = list.filter((s) => s.url !== url);
  return [{ url, lastUsedAt: now.toISOString(), failedAt: null }, ...rest].slice(0, MAX_RECENT_SERVERS);
}

/** 连不上：记下时间，不改变顺序；不在列表里的先加到最前面 */
export function markServerFailed(list: RecentServer[], url: string, now: Date): RecentServer[] {
  if (!url) return list;
  if (!list.some((s) => s.url === url)) {
    return [{ url, lastUsedAt: now.toISOString(), failedAt: now.toISOString() }, ...list].slice(
      0,
      MAX_RECENT_SERVERS,
    );
  }
  return list.map((s) => (s.url === url ? { ...s, failedAt: now.toISOString() } : s));
}

/** 面板里要列出的服务器：当前的那个一定在，其余按最近使用 */
export function serverChoices(list: RecentServer[], current: string): RecentServer[] {
  if (list.some((s) => s.url === current)) return list;
  return [{ url: current, lastUsedAt: "" }, ...list].slice(0, MAX_RECENT_SERVERS);
}

/** 显示用：去掉 http:// 和末尾斜杠，https 保留协议以便区分 */
export function displayServer(url: string): string {
  return url.replace(/^http:\/\//i, "").replace(/\/+$/, "");
}

/** 从存储里读出来的值不可信：只保留格式正确的项 */
export function parseRecentServers(raw: unknown): RecentServer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is RecentServer =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as RecentServer).url === "string" &&
        typeof (s as RecentServer).lastUsedAt === "string",
    )
    .map((s) => ({
      url: s.url,
      lastUsedAt: s.lastUsedAt,
      failedAt: typeof s.failedAt === "string" ? s.failedAt : null,
    }))
    .slice(0, MAX_RECENT_SERVERS);
}
