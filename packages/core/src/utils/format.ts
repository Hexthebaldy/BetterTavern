/** 界面上的数字和时间格式（时间的写法随界面语言变） */

import { i18n } from "../i18n/index.ts";

/** 131072 → "128K"，1048576 → "1M"；整千的按十进制：32000 → "32K"，128000 → "128K" */
export function formatTokens(n: number): string {
  const decimal = n % 1000 === 0;
  const k = decimal ? 1000 : 1024;
  if (n >= k * k) return `${trim(n / (k * k))}M`;
  if (n >= k) return `${trim(n / k)}K`;
  return String(n);
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** 月份的写法：中文是数字，英文是缩写（Jan、Feb……） */
function month(d: Date): string {
  return i18n.t("time.months").split(" ")[d.getMonth()] ?? String(d.getMonth() + 1);
}

/** 相对时间：刚刚、5 分钟前、3 小时前、昨天、10月14日（英文：Just now、5 min ago、Yesterday、Oct 14） */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return i18n.t("time.justNow");
  if (minutes < 60) return i18n.t("time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("time.hoursAgo", { count: hours });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (then.getTime() >= startOfToday - 86_400_000) return i18n.t("time.yesterday");
  const parts = { year: then.getFullYear(), month: month(then), day: then.getDate() };
  return then.getFullYear() === now.getFullYear()
    ? i18n.t("time.monthDay", parts)
    : i18n.t("time.yearMonthDay", parts);
}

/** 文件大小：2.4 MB、830 KB */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${trim(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** 日期：2026 年 9 月 3 日（英文：Sep 3, 2026） */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return i18n.t("time.date", { year: d.getFullYear(), month: month(d), day: d.getDate() });
}
