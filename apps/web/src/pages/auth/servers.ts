/**
 * 登录、注册页的“换一个服务器”（网页端，只在自己部署的网页上有）。网页和接口必须同源（Cookie 登录），
 * 所以不是改接口地址，而是打开另一台服务器自己的网页：账户、登录状态都在那边。
 * 打开过的地址存在这个网站的 localStorage（bt.servers），按最近打开排，最多 5 个。
 */

export const OFFICIAL_SITE = "https://bettertavern.com";
export const SERVERS_KEY = "bt.servers";
export const MAX_RECENT_SITES = 5;

export type RecentSite = { url: string; openedAt: string };

/**
 * 用户填的地址 → 网站的根地址（协议、主机、端口）；不认的返回 null。
 * 没写协议时补 http://（自己的服务器多半在局域网，没有证书）；只认 http 和 https；带账号密码的不认。
 * 路径丢掉：网页只能部署在根路径上（接口固定是 /v1）。
 */
export function siteOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.origin;
}

/** 官方网站（bettertavern.com）上不放服务器行：用官方服务的人用不着换，自己部署的网页上才有 */
export function offersServerSwitch(origin: string): boolean {
  return origin !== OFFICIAL_SITE;
}

/** 显示用：去掉 http://，https 留着以便区分（同 App 的服务器面板） */
export function displaySite(origin: string): string {
  return origin.replace(/^http:\/\//i, "");
}

/** 打开过一次：移到最前面 */
export function rememberSite(list: RecentSite[], url: string, now: Date): RecentSite[] {
  const rest = list.filter((s) => s.url !== url);
  return [{ url, openedAt: now.toISOString() }, ...rest].slice(0, MAX_RECENT_SITES);
}

/** 对话框里列出的地址：官方服务在最前（正在官方时不列），再是最近打开过的；正在用的这个不列 */
export function siteChoices(list: RecentSite[], current: string): string[] {
  const recent = list.map((s) => s.url).filter((url) => url !== current && url !== OFFICIAL_SITE);
  return current === OFFICIAL_SITE ? recent : [OFFICIAL_SITE, ...recent];
}

/** 从存储里读出来的值不可信：只留格式对、能解析成网站根地址的项 */
export function parseRecentSites(raw: unknown): RecentSite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is RecentSite =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as RecentSite).url === "string" &&
        typeof (s as RecentSite).openedAt === "string" &&
        siteOrigin((s as RecentSite).url) === (s as RecentSite).url,
    )
    .map((s) => ({ url: s.url, openedAt: s.openedAt }))
    .slice(0, MAX_RECENT_SITES);
}
