/**
 * 手机上的诊断日志（“小本子”）：只存在手机上，最多保留最近 500 条，不上传；在“连接测试”页可以导出。
 *
 * 每条和服务端日志一样是一个对象：时间（本地时间带时区）、级别、固定的英文事件名，加上具体字段。
 * 请求带的单号（request_id）和服务端日志里的是同一个，拿它能把手机和服务端两边的记录对上。
 *
 * 写进来之前先脱敏，规则和服务端一样（apps/server 的 infra/observability/redact.py）：
 * - 名字像密钥的字段（authorization、api_key、token、password……）整个值换成 [REDACTED]；
 * - 故事文本字段（narrative、text、content……）整个丢掉；
 * - 字符串里像密钥的片段（Bearer 令牌、sk-…、hf_…、JWT）抹掉，邮箱打码，过长的截断。
 *
 * debug 级别只打到开发时的终端，不进小本子，免得把有用的记录挤掉。纯逻辑，node --test 可测。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogEntry = { ts: string; level: LogLevel; event: string } & LogFields;

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export const REDACTED = "[REDACTED]";
const VALUE_MAX_CHARS = 500;
const LIST_MAX_ITEMS = 20;
const MAX_DEPTH = 4;

const SECRET_KEYS = new Set([
  "authorization",
  "apikey",
  "xapikey",
  "key",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "password",
  "passwd",
  "secret",
  "cookie",
  "bearer",
]);

/** 故事文本只能放在这些字段里，默认整个丢掉 */
export const STORY_KEYS = new Set([
  "narrative",
  "text",
  "content",
  "messages",
  "prompt",
  "completion",
  "story",
  "actiontext",
  "greeting",
  "firstmes",
  "persona",
  "description",
]);

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, `sk-${REDACTED}`],
  [/\bhf_[A-Za-z0-9]{8,}/g, `hf_${REDACTED}`],
  [
    /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\s*[:=]\s*)["']?[^\s"'&,;]+/gi,
    `$1${REDACTED}`,
  ],
];
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-.]/g, "");
}

export function scrubText(text: string, limit = VALUE_MAX_CHARS): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  out = out.replace(EMAIL, "$1***@$2");
  return out.length > limit ? `${out.slice(0, limit)}…(truncated, ${out.length} chars)` : out;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean")
    return value;
  if (depth >= MAX_DEPTH) return "[REDACTED:too deep]";
  if (Array.isArray(value)) {
    const items = value.slice(0, LIST_MAX_ITEMS).map((v) => scrubValue(v, depth + 1));
    if (value.length > LIST_MAX_ITEMS) items.push(`…(${value.length - LIST_MAX_ITEMS} more)`);
    return items;
  }
  if (value instanceof Error) return scrubText(`${value.name}: ${value.message}`);
  if (typeof value === "object") return scrubFields(value as LogFields, depth + 1);
  return scrubText(String(value));
}

export function scrubFields(fields: LogFields, depth = 0): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const normalized = normalizeKey(key);
    if (SECRET_KEYS.has(normalized)) out[key] = REDACTED;
    else if (STORY_KEYS.has(normalized)) continue;
    else if (value !== undefined) out[key] = scrubValue(value, depth);
  }
  return out;
}

/** 本地时间带时区偏移，例如 2026-10-15T17:12:03.410+08:00（和服务端日志的格式一致） */
export function localIso(date: Date): string {
  const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

/** 请求单号：32 位十六进制。只用于对照日志，不需要密码学强度 */
export function newRequestId(random: () => number = Math.random): string {
  return Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join("");
}

function isEntry(value: unknown): value is LogEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ts === "string" && typeof v.event === "string" && typeof v.level === "string" && v.level in RANK
  );
}

export type DiagnosticsOptions = {
  capacity?: number;
  /** 这个级别及以上才进小本子 */
  keepLevel?: LogLevel;
  now?: () => Date;
};

export class DiagnosticsLog {
  private entries: LogEntry[] = [];
  private readonly listeners = new Set<(entries: readonly LogEntry[]) => void>();
  private readonly capacity: number;
  private readonly keepLevel: LogLevel;
  private readonly now: () => Date;
  private console: ((entry: LogEntry) => void) | null = null;

  constructor(options: DiagnosticsOptions = {}) {
    this.capacity = options.capacity ?? 500;
    this.keepLevel = options.keepLevel ?? "info";
    this.now = options.now ?? (() => new Date());
  }

  /** 开发时把每一条（包括 debug）同时打到 Metro 终端 */
  setConsole(sink: ((entry: LogEntry) => void) | null): void {
    this.console = sink;
  }

  log(level: LogLevel, event: string, fields: LogFields = {}): void {
    const entry: LogEntry = {
      ...scrubFields(fields),
      ts: localIso(this.now()),
      level,
      event: scrubText(event, 120),
    };
    this.console?.(entry);
    if (RANK[level] < RANK[this.keepLevel]) return;
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
    this.notify();
  }

  debug(event: string, fields?: LogFields): void {
    this.log("debug", event, fields);
  }

  info(event: string, fields?: LogFields): void {
    this.log("info", event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.log("warn", event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.log("error", event, fields);
  }

  all(): readonly LogEntry[] {
    return this.entries;
  }

  /** App 启动时把上次存下的记录接到前面（格式不对的丢掉），总数仍不超过上限 */
  restore(saved: unknown[]): void {
    const valid = saved.filter(isEntry);
    this.entries = [...valid, ...this.entries].slice(-this.capacity);
    this.notify();
  }

  clear(): void {
    this.entries = [];
    this.notify();
  }

  subscribe(listener: (entries: readonly LogEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.entries);
  }
}

export type ExportInfo = { clientVersion: string; platform: string; server: string };

/** 导出成文字：开头几行说明（英文，和服务端日志一样），后面每行一条 JSON，可以直接拖进 vis 和服务端日志合在一起看 */
export function exportText(entries: readonly LogEntry[], info: ExportInfo, now: Date = new Date()): string {
  const header = [
    "# BetterTavern diagnostics",
    `# Exported ${localIso(now)}`,
    `# App ${info.clientVersion} · ${info.platform} · server ${scrubText(info.server)}`,
    `# ${entries.length} entries; no story text or keys`,
  ];
  return [...header, ...entries.map((e) => JSON.stringify(e))].join("\n");
}

/** App 里共用的一本 */
export const diagnostics = new DiagnosticsLog();
