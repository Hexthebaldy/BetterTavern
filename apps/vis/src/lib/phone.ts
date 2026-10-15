/**
 * 手机导出的诊断日志（“连接测试”页的“导出”）：开头几行 # 说明，后面每行一条 JSON。
 * 解析成和服务端日志一样的记录（来源记作 phone），这样能按单号和服务端的记录放在一起看。纯函数。
 */

import type { LogEntry } from "../api.ts";

const LEVELS: Record<string, string> = { debug: "debug", info: "info", warn: "warning", error: "error" };

export type PhoneLog = { entries: LogEntry[]; skipped: number; header: string[] };

export function parsePhoneLog(text: string): PhoneLog {
  const entries: LogEntry[] = [];
  const header: string[] = [];
  let skipped = 0;
  let n = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      header.push(line.replace(/^#\s*/, ""));
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      skipped += 1;
      continue;
    }
    const record = data as Record<string, unknown>;
    const ts = typeof record.ts === "string" ? record.ts : null;
    const t = ts ? Date.parse(ts) : Number.NaN;
    if (typeof record.event !== "string" || Number.isNaN(t)) {
      skipped += 1;
      continue;
    }
    const { ts: _ts, level, ...rest } = record;
    entries.push({
      ...rest,
      event: record.event,
      level: LEVELS[String(level)] ?? "info",
      timestamp: ts ?? undefined,
      t,
      // 手机的记录用负数编号，不和服务端的冲突
      n: n--,
      file: "phone",
      logger: "手机",
    } as LogEntry);
  }
  return { entries, skipped, header };
}

/** 手机日志里以 prefix 开头的请求单号（不分大小写），按出现顺序去重 */
export function phoneRequestIds(log: PhoneLog | null, prefix: string): string[] {
  const value = prefix.trim().toLowerCase();
  if (!log || value.length < 6) return [];
  const ids = new Set<string>();
  for (const entry of log.entries) {
    const id = entry.request_id;
    if (typeof id === "string" && id.toLowerCase().startsWith(value)) ids.add(id);
  }
  return [...ids];
}

/** 按时间合并服务端和手机的记录 */
export function mergeByTime(a: LogEntry[], b: LogEntry[]): LogEntry[] {
  return [...a, ...b].sort((x, y) => x.t - y.t || x.n - y.n);
}
