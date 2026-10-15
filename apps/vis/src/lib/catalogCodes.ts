/**
 * 中文目录的基础部分：错误码、接口名、各种状态和来源的代号，以及拼句子用的小工具。纯数据和纯函数。
 * 对外统一从 catalog.ts 引用。
 */

import { duration } from "./format.ts";

export type Category = "request" | "turn" | "model" | "sse" | "account" | "credential" | "import" | "job" | "app";

export type Fields = Record<string, unknown>;

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const plus = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join("，");
export const ms = (v: unknown): string | null => (num(v) === null ? null : duration(num(v)));

// ---- 错误 ------------------------------------------------------------------------------

/** 接口错误码和回合失败码 */
export const ERROR_CODES: Record<string, string> = {
  BAD_REQUEST: "请求体无法解析",
  UNAUTHENTICATED: "没有登录或登录已过期",
  INVALID_CREDENTIALS: "邮箱或密码不对",
  REFRESH_INVALID: "刷新令牌失效，需要重新登录",
  REFRESH_REUSED: "用过的刷新令牌又出现了，已全部吊销",
  NOT_FOUND: "资源不存在",
  METHOD_NOT_ALLOWED: "接口不支持这个方法",
  EMAIL_TAKEN: "邮箱已经注册过",
  CREDENTIAL_UNREADABLE: "密钥无法解密，需要重新填写",
  ROUTE_MISSING: "还没有配置导演模型",
  TURN_IN_PROGRESS: "上一轮还在生成",
  STALE_PARENT: "故事已经更新，需要先刷新",
  OPENING_PENDING: "开场还没写完就提交了行动",
  TURN_NOT_LOCAL: "要停止的回合不在这个服务实例上",
  PAYLOAD_TOO_LARGE: "请求体或文件太大",
  VALIDATION_ERROR: "参数不符合要求",
  ENDPOINT_NOT_ALLOWED: "接口地址没有通过安全检查",
  WINDOW_TOO_SMALL: "模型的上下文窗口太小",
  CARD_INVALID: "角色卡无法解析",
  IDEMPOTENCY_KEY_REUSED: "同一个幂等键对应了不同的请求",
  OPENING_EXISTS: "已经有开场了",
  OPTION_NOT_FOUND: "选项不存在",
  CREDENTIAL_INVALID: "服务商拒绝了这把密钥",
  RATE_LIMITED: "请求太频繁，被限流",
  INTERNAL_ERROR: "服务端出错",
  PROVIDER_ERROR: "模型服务商出错",
  UNAVAILABLE: "服务正在重启",
  MODEL_NOT_FOUND: "模型名不对",
  CONTENT_BLOCKED: "被服务商的内容策略拦截",
  CONTEXT_TOO_LARGE: "上下文装不进模型的窗口",
  NARRATIVE_MISSING: "模型这次没写出叙述",
  CANCELLED: "被停止（玩家停止或服务重启）",
  RUNNER_LOST: "生成进程意外中止",
  TURN_ARCHIVED: "这一轮已被回退",
  NETWORK: "连不上服务器",
  TIMEOUT: "服务器响应超时",
  BAD_RESPONSE: "服务器返回的内容无法解析",
};

/** provider 层的错误类别 */
export const ERROR_CLASSES: Record<string, string> = {
  auth: "密钥无效",
  billing: "欠费或额度用完",
  rate_limit: "被服务商限流",
  overloaded: "服务商繁忙",
  server_error: "服务商出错（5xx）",
  timeout: "超时",
  connection: "连接失败",
  context_overflow: "上下文超出窗口",
  payload_too_large: "请求太大",
  model_not_found: "模型不存在",
  content_policy_blocked: "被内容策略拦截",
  format_error: "请求格式不对",
  unsupported_feature: "模型不支持这个功能",
  endpoint_not_allowed: "接口地址不允许",
  stream_interrupted: "生成中途断流",
  invalid_response: "服务商返回的内容看不懂",
  cancelled: "被取消",
  unknown: "未知错误",
  narrative_missing: "没写出叙述",
  StructuredOutputError: "结构化输出失败",
  LimiterTimeout: "等并发槽位超时",
};

export const errorCode = (code: unknown): string => ERROR_CODES[str(code)] ?? str(code);
export const errorClass = (value: unknown): string => ERROR_CLASSES[str(value)] ?? str(value);

// ---- 接口 ------------------------------------------------------------------------------

const ROUTES: Record<string, string> = {
  "POST /v1/auth/register": "注册",
  "POST /v1/auth/login": "登录",
  "POST /v1/auth/refresh": "刷新登录",
  "POST /v1/auth/logout": "退出登录",
  "GET /v1/me": "读账户",
  "DELETE /v1/me": "删除账户",
  "POST /v1/scenarios/import": "导入角色卡",
  "GET /v1/scenarios": "剧本列表",
  "GET /v1/scenarios/{scenario_id}": "剧本详情",
  "PATCH /v1/scenarios/{scenario_id}": "重命名剧本",
  "DELETE /v1/scenarios/{scenario_id}": "删除剧本",
  "GET /v1/blobs/{blob_id}": "下载图片",
  "GET /v1/providers": "服务商列表",
  "GET /v1/credentials": "密钥列表",
  "POST /v1/credentials": "添加密钥",
  "GET /v1/credentials/{credential_id}": "密钥详情",
  "PATCH /v1/credentials/{credential_id}": "修改密钥",
  "DELETE /v1/credentials/{credential_id}": "删除密钥",
  "POST /v1/credentials/{credential_id}/probe": "测试模型",
  "GET /v1/credentials/{credential_id}/models": "拉取模型列表",
  "GET /v1/model-routes": "模型路由",
  "PUT /v1/model-routes/{task}": "设置模型路由",
  "DELETE /v1/model-routes/{task}": "取消模型路由",
  "POST /v1/playthroughs": "开局",
  "GET /v1/playthroughs": "故事列表",
  "GET /v1/playthroughs/{playthrough_id}": "打开故事",
  "PATCH /v1/playthroughs/{playthrough_id}": "重命名故事",
  "DELETE /v1/playthroughs/{playthrough_id}": "删除故事",
  "GET /v1/playthroughs/{playthrough_id}/turns": "读历史回合",
  "POST /v1/playthroughs/{playthrough_id}/turns": "提交行动",
  "GET /v1/playthroughs/{playthrough_id}/world": "世界状态",
  "GET /v1/turns/{turn_id}": "读回合",
  "POST /v1/turns/{turn_id}/cancel": "停止生成",
  "GET /v1/turns/{turn_id}/events": "接收推送",
  "GET /health": "健康检查",
  "GET /ready": "就绪检查",
};

export function routeName(method: unknown, route: unknown, path?: unknown): string {
  const key = `${str(method)} ${str(route)}`;
  return ROUTES[key] ?? (str(path) || str(route) || "请求");
}

// ---- 状态与来源 ------------------------------------------------------------------------

export const PARSE_STAGES: Record<string, string> = {
  ok: "直接合格",
  salvaged: "小修补后合格",
  repaired: "另调模型补了选项",
  fallback: "用了兜底选项",
  narrative_missing: "没写出叙述",
};

export const OPTION_SOURCES: Record<string, string> = { model: "模型", repaired: "补选项", fallback: "兜底文案" };

export const SEVERITY_LABELS: Record<string, string> = { error: "出错", warn: "注意", info: "提示" };

export const TURN_STATUS: Record<string, string> = {
  generating: "生成中",
  replied: "已回复",
  committed: "完成",
  failed: "失败",
  archived: "已回退",
};

export const ACTION_SOURCES: Record<string, string> = { option: "选项", text: "自己写", opening: "开场" };
