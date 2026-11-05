/**
 * 更新提示：线上更新前 10 分钟，部署任务在网站根目录放一个 notice.json（docs/ops.md 第 3 节），
 * 开着的网页和 App 每分钟读一次，在页面顶部显示横幅。文件里只有类型和时间，文字由客户端按界面语言显示。
 * 读不到（没有更新时返回 204；自己部署的服务器上这个地址是网页）都当作没有提示。
 */

/** 客户端在前台时多久读一次 */
export const NOTICE_POLL_MS = 60_000;
const LOAD_TIMEOUT_MS = 10_000;
/** 部署任务意外中断、文件没撤掉时，过了更新时间这么久就不再显示 */
const EXPIRES_AFTER_MS = 15 * 60_000;

export type UpdateNotice = { at: number };

export type UpdateNoticeView = {
  /** 更新时间，关掉横幅时用它认出“这一次” */
  at: number;
  phase: "upcoming" | "updating";
  /** 用户所在时区的时分，比如 06:00 */
  time: string;
};

export type NoticeFetch = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export function parseUpdateNotice(data: unknown): UpdateNotice | null {
  if (typeof data !== "object" || data === null) return null;
  const { kind, at } = data as Record<string, unknown>;
  if (kind !== "update" || typeof at !== "string") return null;
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : { at: time };
}

export function noticeView(notice: UpdateNotice | null, now: number): UpdateNoticeView | null {
  if (!notice || now > notice.at + EXPIRES_AFTER_MS) return null;
  const date = new Date(notice.at);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return { at: notice.at, phase: now < notice.at ? "upcoming" : "updating", time };
}

/** 不走 ApiClient：这个文件每分钟读一次，大多数时候没有，不该记进诊断日志 */
export async function loadUpdateNotice(baseUrl: string, fetcher: NoticeFetch): Promise<UpdateNotice | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const response = await fetcher(`${baseUrl}/notice.json`, { signal: controller.signal });
    if (response.status !== 200) return null;
    return parseUpdateNotice(JSON.parse(await response.text()));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
