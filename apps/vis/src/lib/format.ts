/**
 * 把数字换成人能直接看的样子：毫秒 → 秒、token 数 → 1.2k、字节 → KB、时间戳 → 本地时间。纯函数。
 */

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "–";
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(ms)} 毫秒`;
  if (abs < 60_000) return `${(ms / 1000).toFixed(abs < 10_000 ? 2 : 1)} 秒`;
  const minutes = Math.floor(abs / 60_000);
  const seconds = Math.round((abs % 60_000) / 1000);
  return `${ms < 0 ? "-" : ""}${minutes} 分 ${seconds} 秒`;
}

/** 时间线上的相对时间：+1.84 秒 */
export function offset(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)} 毫秒`;
  return `+${(ms / 1000).toFixed(2)} 秒`;
}

export function tokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** "huihui-ai/Huihui-Qwen3.8-27B:featherless-ai" → "Huihui-Qwen3.8-27B"：去掉组织前缀和服务商后缀 */
export function modelName(model: string | null | undefined): string {
  if (!model) return "–";
  const name = model.slice(model.lastIndexOf("/") + 1);
  const colon = name.indexOf(":");
  return colon > 0 ? name.slice(0, colon) : name;
}

/** 路径里的 UUID 只留前 8 位：/v1/turns/9f2c4e1a…/events */
export function shortPath(path: string | null | undefined): string {
  if (!path) return "";
  return path.replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "$1…");
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function percent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "–";
  return `${(ratio * 100).toFixed(digits)}%`;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** 本地时间：今天的只显示时分秒，否则带日期 */
export function clock(ms: number | null | undefined, now: number = Date.now()): string {
  if (ms === null || ms === undefined) return "–";
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? time : `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}

/** 精确到毫秒，日志列表用 */
export function clockMs(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function ago(ms: number | null | undefined, now: number = Date.now()): string {
  if (ms === null || ms === undefined) return "–";
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

/** 长编号只显示前 8 位 */
export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return "–";
  return id.length > length ? id.slice(0, length) : id;
}

/** 时间轴刻度：大约 count 个，间隔取 1、2、5 × 10^n 毫秒 */
export function ticks(total: number, count = 6): number[] {
  if (total <= 0) return [0];
  const raw = total / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = 0; t <= total + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
