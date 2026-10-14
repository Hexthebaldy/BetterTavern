/** 界面上的数字和时间格式 */

/** 131072 → "128K"，32000 → "31.3K" */
export function formatTokens(n: number): string {
  if (n >= 1024 * 1024) return `${trim(n / (1024 * 1024))}M`;
  if (n >= 1024) return `${trim(n / 1024)}K`;
  return String(n);
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** 相对时间：刚刚、5 分钟前、3 小时前、昨天、10月14日 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (then.getTime() >= startOfToday - 86_400_000) return "昨天";
  const sameYear = then.getFullYear() === now.getFullYear();
  return sameYear
    ? `${then.getMonth() + 1}月${then.getDate()}日`
    : `${then.getFullYear()}年${then.getMonth() + 1}月${then.getDate()}日`;
}
