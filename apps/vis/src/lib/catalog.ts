/**
 * 中文目录：日志事件、字段、错误码、接口、时间线、问题，全部在这里翻译成人话。纯数据和纯函数。
 * 认不出来的代号原样显示，不会出错。服务端的事件清单见 docs/testing.md 第 1 节。
 * 这里是门面：错误码和代号在 catalogCodes.ts，事件在 catalogEvents.ts，字段、时间线、问题在本文件。
 */

import { bytes, duration, percent, tokens } from "./format.ts";
import { errorClass, errorCode, type Fields, ms, num, PARSE_STAGES, plus, str } from "./catalogCodes.ts";

export * from "./catalogCodes.ts";
export * from "./catalogEvents.ts";

// ---- 字段 ------------------------------------------------------------------------------

export const FIELD_LABELS: Record<string, string> = {
  timestamp: "时间",
  level: "级别",
  event: "事件",
  logger: "来源模块",
  process: "进程",
  request_id: "请求单号",
  user_ref: "用户",
  playthrough_id: "故事",
  turn_id: "回合",
  seq: "第几回合",
  turn_attempt: "第几次尝试",
  job_id: "任务",
  job_kind: "任务类型",
  method: "方法",
  path: "路径",
  route: "接口",
  status: "状态",
  duration_ms: "耗时",
  client_version: "App 版本",
  error_code: "错误码",
  error_class: "错误类别",
  code: "失败码",
  message: "说明",
  provider: "服务商",
  model: "模型",
  attempt: "第几次",
  ttft_ms: "首字等待",
  prompt_tokens: "输入 token",
  cached_tokens: "缓存命中 token",
  completion_tokens: "输出 token",
  reasoning_tokens: "思考 token",
  finish_reason: "结束原因",
  retry_in_s: "重试等待（秒）",
  estimated_tokens: "预估 token",
  usage_ratio: "占窗口",
  window: "上下文窗口",
  dropped_turns: "丢掉的旧回合",
  prompt_hash: "提示词指纹",
  stage: "格式检查",
  repairs: "修补",
  notes: "备注",
  reason: "原因",
  events_sent: "发出条数",
  resumed_from: "从第几条续传",
  backlog: "补发条数",
  exception: "异常",
  source: "来源",
  text_chars: "文字长度",
  idempotent: "带幂等键",
  streamed_chars: "已推送字数",
  // 模型配置
  route_id: "模型编号",
  endpoint_host: "端点主机",
  fields_changed: "改了哪些",
  window_source: "窗口来源",
  learned_window: "学到的窗口",
  copied_key: "复用了 Key",
  same_key_updated: "一起换 Key 的模型数",
  director: "设为导演",
  reset: "要重新确认",
  // 下面是手机日志里的字段
  server: "服务器",
  detail: "细节",
  version: "版本",
  platform: "平台",
  runtime: "运行环境",
  fatal: "是否崩溃",
  error: "错误",
  stack: "调用栈",
  from: "从",
  to: "到",
  phase: "阶段",
  state: "状态",
  reconnects: "重连次数",
  resume_from: "从第几条续传",
};

export const fieldLabel = (key: string): string => FIELD_LABELS[key] ?? key;

/** 字段值的人话写法；对象和数组交给调用方原样展示 */
export function fieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "–";
  if (typeof value === "boolean") return value ? "是" : "否";
  const n = num(value);
  if (n !== null) {
    if (key.endsWith("_ms")) return duration(n);
    if (key.endsWith("_tokens") || key === "window") return tokens(n);
    if (key === "usage_ratio" || key === "ratio") return percent(n, 1);
    if (key === "bytes") return bytes(n);
    return String(n);
  }
  if (key === "error_class") return `${errorClass(value)}（${str(value)}）`;
  if (key === "code" || key === "error_code") return `${errorCode(value)}（${str(value)}）`;
  if (key === "stage") return PARSE_STAGES[str(value)] ?? str(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// ---- 时间线 -----------------------------------------------------------------------------

export const SPAN_LABELS: Record<string, string> = {
  http: "请求",
  turn: "整个回合",
  world: "搭建世界",
  commit: "保存",
  repair: "补选项",
  slot_wait: "等并发槽位",
  provider_wait: "等第一个字",
  provider_stream: "吐字",
  provider_failed: "调用失败",
  sse: "推送连接",
};

export const MARKER_LABELS: Record<string, string> = {
  context: "组装上下文",
  parse: "检查格式",
  context_overflow_retry: "超窗重试",
  replayed: "重复提交",
  cancel_requested: "停止生成",
  commit_rejected: "保存被拒绝",
  crashed: "崩溃",
  lease_expired: "租约过期",
};

export function laneLabel(lane: string): string {
  if (lane.startsWith("sse:")) return `推送 ${lane.slice(4)}`;
  return { request: "请求", turn: "回合", world: "世界", steps: "步骤", model: "模型" }[lane] ?? lane;
}

const LANE_ORDER = ["request", "turn", "world", "steps", "model"];

export function laneRank(lane: string): number {
  const i = LANE_ORDER.indexOf(lane);
  if (i >= 0) return i;
  if (lane.startsWith("sse:")) return LANE_ORDER.length + Number(lane.slice(4));
  return 100;
}

// ---- 问题 ------------------------------------------------------------------------------

export function issueText(code: string, f: Fields): string {
  switch (code) {
    case "turn_failed":
      return plus(`回合失败：${errorCode(f.code)}`, f.message ? str(f.message) : null);
    case "commit_rejected":
      return "保存时租约已被收回，这一轮的结果作废了";
    case "turn_crashed":
      return "执行回合时服务端抛出了没处理的异常";
    case "lease_expired":
      return "生成进程没了（服务重启或卡死），回合被标为失败";
    case "provider_failed":
      return plus(`调模型失败：${errorClass(f.error_class)}`, f.status ? `HTTP ${str(f.status)}` : null);
    case "slot_timeout":
      return "等并发槽位超时（同一把密钥同时在跑的请求太多）";
    case "slot_wait":
      return `等并发槽位等了 ${ms(f.duration_ms)}`;
    case "slow_first_token":
      return `第一个字等了 ${ms(f.ttft_ms)}，明显偏慢`;
    case "slow_turn":
      return `整个回合花了 ${ms(f.duration_ms)}`;
    case "parse_narrative_missing":
      return "模型没写出叙述";
    case "parse_repaired":
      return "模型给的选项不完整，另调模型补了选项";
    case "parse_fallback":
      return "选项补救失败，用了兜底文案";
    case "parse_salvaged":
      return "模型输出的格式有小问题，自动修补了";
    case "repair_failed":
      return `补选项失败：${str(f.error_class)}`;
    case "context_overflow":
      return "上下文超出了模型窗口，截短后重试";
    case "context_tight":
      return `提示词占了窗口的 ${percent(num(f.usage_ratio))}，快装不下了`;
    case "low_cache":
      return `前缀缓存只命中了 ${percent(num(f.ratio))}，这一轮更慢也更贵`;
    case "world_minimal":
      return plus("世界没让模型搭成，用了只含角色卡原文的最小设定", f.error_class ? errorClass(f.error_class) : null);
    case "sse_dropped":
      return `手机的推送连接中途断了 ${str(f.count)} 次（之后续传了）`;
    case "sse_snapshot":
      return "推送缓冲已过期，手机是等回合结束后一次拿到全部内容的";
    case "slow_request":
      return `请求本身花了 ${ms(f.duration_ms)}`;
    case "no_logs":
      return "日志里找不到这个回合（日志可能已经轮转删掉，或者当时没写日志文件）";
    default:
      return code;
  }
}
