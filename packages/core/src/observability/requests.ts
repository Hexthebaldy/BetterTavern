/**
 * 哪些请求值得记进诊断日志、记成什么级别。小本子只留 500 条，正常又快的请求只在开发时打到终端（debug），
 * 不占位置；失败的和慢的才进小本子。纯逻辑，node --test 可测。
 */

import type { RequestRecord } from "../api/client.ts";
import type { LogFields, LogLevel } from "./log.ts";

/** 超过这个毫秒数算慢请求 */
export const SLOW_MS = 2000;

export function requestLevel(record: RequestRecord): LogLevel {
  if (record.status >= 500) return "error";
  // 连不上（status 0）在手机上很常见（切网络、进电梯），记成警告
  if (record.status === 0) return "warn";
  // 401 多半是访问令牌过期，客户端会自动刷新
  if (record.status === 401) return "info";
  if (record.status >= 400) return "warn";
  if (record.durationMs >= SLOW_MS) return "info";
  return "debug";
}

/** 服务器地址只留主机和端口 */
export function serverHost(url: string): string {
  return /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url;
}

export function requestFields(record: RequestRecord, server: string): LogFields {
  return {
    method: record.method,
    path: record.path,
    status: record.status,
    duration_ms: record.durationMs,
    request_id: record.requestId,
    code: record.code,
    detail: record.detail,
    // 连不上的时候，记下当时连的是哪个服务器，常见原因就是地址填错或网络不通
    server: record.status === 0 ? serverHost(server) : undefined,
  };
}
