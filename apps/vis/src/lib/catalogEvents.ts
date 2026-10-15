/**
 * 中文目录的事件部分：服务端和手机日志里每个事件的中文名、分类和一句话写法。纯数据和纯函数。
 * 对外统一从 catalog.ts 引用；服务端的事件清单见 docs/testing.md 第 1 节。
 */

import { bytes, percent, shortPath, tokens } from "./format.ts";
import {
  type Category,
  errorClass,
  errorCode,
  type Fields,
  ms,
  num,
  OPTION_SOURCES,
  PARSE_STAGES,
  plus,
  routeName,
  str,
  WINDOW_SOURCES,
} from "./catalogCodes.ts";

export type EventInfo = { label: string; category: Category; say?: (f: Fields) => string };

export const EVENTS: Record<string, EventInfo> = {
  "http.request": {
    label: "请求",
    category: "request",
    say: (f) =>
      plus(
        `${routeName(f.method, f.route, f.path)}：${f.aborted ? "客户端提前断开" : `HTTP ${str(f.status)}`}`,
        f.error_code ? errorCode(f.error_code) : null,
        ms(f.duration_ms) && `耗时 ${ms(f.duration_ms)}`,
      ),
  },
  "http.error": { label: "服务端出错", category: "request", say: (f) => `处理 ${shortPath(str(f.path))} 时抛出了没处理的异常` },
  "auth.registered": { label: "注册成功", category: "account" },
  "auth.login": { label: "登录成功", category: "account" },
  "auth.login_failed": {
    label: "登录失败",
    category: "account",
    say: (f) => `登录失败：${f.reason === "unknown_email" ? "邮箱没注册" : "密码不对"}`,
  },
  "auth.refresh": { label: "刷新登录", category: "account" },
  "auth.refresh_invalid": {
    label: "刷新登录失败",
    category: "account",
    say: (f) => `刷新令牌失效（${str(f.reason)}）`,
  },
  "auth.refresh_reused": {
    label: "令牌被重复使用",
    category: "account",
    say: () => "用过的刷新令牌又出现了，可能被盗，已整族吊销",
  },
  "auth.logout": { label: "退出登录", category: "account" },
  "account.deleted": { label: "删除账户", category: "account" },
  "account.delete_rejected": { label: "删除账户被拒绝", category: "account", say: () => "删除账户时密码不对" },
  "route.created": {
    label: "添加模型",
    category: "route",
    say: (f) =>
      plus(
        `添加了 ${str(f.provider)} 的 ${str(f.model)}（端点 ${str(f.endpoint_host)}）`,
        f.copied_key ? "复用了别的模型的 Key" : null,
        f.window_source ? `窗口来自${WINDOW_SOURCES[str(f.window_source)] ?? str(f.window_source)}` : null,
        f.director ? "设为导演" : null,
      ),
  },
  "route.updated": {
    label: "修改模型",
    category: "route",
    say: (f) =>
      plus(
        `修改了 ${str(f.model)}：${Array.isArray(f.fields_changed) ? f.fields_changed.join("、") : ""}`,
        num(f.same_key_updated) ? `另外 ${str(f.same_key_updated)} 个模型一起换了 Key` : null,
      ),
  },
  "route.deleted": { label: "删除模型", category: "route" },
  "route.key_unreadable": { label: "Key 解不开", category: "route", say: () => "模型的 Key 无法解密，主密钥可能变了" },
  "route.probe": {
    label: "测试模型",
    category: "route",
    say: (f) => plus(`测试 ${str(f.model)}：${f.ok ? "通过" : `没通过（${errorClass(f.fatal)}）`}`, ms(f.duration_ms)),
  },
  "route.window_learned": {
    label: "纠正上下文窗口",
    category: "route",
    say: (f) => `服务商说这个模型最多 ${tokens(num(f.window))} token，以后按它算`,
  },
  "models.listed": {
    label: "拉取模型列表",
    category: "route",
    say: (f) => plus(`拿到 ${str(f.count)} 个模型`, ms(f.duration_ms)),
  },
  "models.list_failed": {
    label: "拉取模型列表失败",
    category: "route",
    say: (f) => plus(`拉取模型列表失败：${errorClass(f.error_class)}`, f.status ? `HTTP ${str(f.status)}` : null),
  },
  "models.list_skipped": {
    label: "保存时没拉到模型列表",
    category: "route",
    say: (f) => `保存时没拉到模型列表（${errorClass(f.error_class)}），窗口先按别的来源算`,
  },
  "scenario.imported": {
    label: "导入角色卡",
    category: "import",
    say: (f) =>
      plus(
        f.duplicate ? "重复导入，返回已有的剧本" : "导入了角色卡",
        `${bytes(num(f.bytes))}`,
        `世界书 ${str(f.book_entries)} 条`,
        Array.isArray(f.truncated_fields) && f.truncated_fields.length > 0
          ? `被截断：${f.truncated_fields.join("、")}`
          : null,
      ),
  },
  "scenario.import_failed": { label: "导入失败", category: "import", say: (f) => `角色卡导入失败：${str(f.reason)}` },
  "scenario.deleted": { label: "删除剧本", category: "import" },
  "turn.submitted": {
    label: "提交行动",
    category: "turn",
    say: (f) =>
      plus(
        `收到提交：${f.source === "option" ? "点选项" : f.source === "opening" ? "开场" : "自己写"}`,
        num(f.text_chars) ? `${str(f.text_chars)} 字` : null,
      ),
  },
  "turn.replayed": { label: "重复提交", category: "turn", say: () => "同一个幂等键又提交了一次，返回已有的回合" },
  "turn.started": { label: "开始生成", category: "turn" },
  "turn.barrier_waited": {
    label: "等上一轮",
    category: "turn",
    say: (f) => plus(`等上一轮的状态写完`, ms(f.duration_ms), f.lag ? "没等到" : null),
  },
  "world.build.started": { label: "开始搭建世界", category: "turn" },
  "world.build.done": {
    label: "世界搭好",
    category: "turn",
    say: (f) =>
      plus(
        f.source === "minimal" ? "世界用最小设定（模型没成功）" : "模型搭好了世界",
        `${str(f.entities)} 个实体`,
        ms(f.duration_ms),
        f.error_class ? errorClass(f.error_class) : null,
      ),
  },
  "context.assembled": {
    label: "组装上下文",
    category: "turn",
    say: (f) =>
      plus(
        `组装提示词：约 ${tokens(num(f.estimated_tokens))} token`,
        `占窗口 ${percent(num(f.usage_ratio))}`,
        num(f.dropped_turns) ? `丢掉 ${str(f.dropped_turns)} 个旧回合` : null,
      ),
  },
  "turn.context_overflow_retry": {
    label: "超窗重试",
    category: "model",
    say: (f) =>
      num(f.learned_window)
        ? `服务商说上下文超了，最多 ${tokens(num(f.learned_window))} token，按它重新装配后重试`
        : "服务商说上下文超了，截短后重试",
  },
  "turn.window_note_failed": { label: "没记下学到的窗口", category: "model" },
  "turn.fallback": {
    label: "换备用模型",
    category: "model",
    say: (f) => `${errorClass(f.error_class)}，换成备用模型 ${str(f.to_model)}`,
  },
  "provider.slot_wait": {
    label: "等并发槽位",
    category: "model",
    say: (f) => `同一把密钥的并发满了，等了 ${ms(f.duration_ms)}`,
  },
  "provider.slot_timeout": { label: "等槽位超时", category: "model", say: () => "等并发槽位超时" },
  "provider.request": {
    label: "调模型",
    category: "model",
    say: (f) => `第 ${str(f.attempt)} 次调用 ${str(f.provider)} / ${str(f.model)}`,
  },
  "provider.first_token": {
    label: "第一个字",
    category: "model",
    say: (f) => `模型吐出第一个字，等了 ${ms(f.ttft_ms)}`,
  },
  "provider.retry": {
    label: "重试",
    category: "model",
    say: (f) =>
      plus(
        `第 ${str(f.attempt)} 次失败：${errorClass(f.error_class)}`,
        f.status ? `HTTP ${str(f.status)}` : null,
        `${str(f.retry_in_s)} 秒后重试`,
      ),
  },
  "provider.response": {
    label: "模型写完",
    category: "model",
    say: (f) =>
      plus(
        `模型写完`,
        `输入 ${tokens(num(f.prompt_tokens))}（缓存 ${tokens(num(f.cached_tokens))}）`,
        `输出 ${tokens(num(f.completion_tokens))}`,
        num(f.reasoning_tokens) ? `思考 ${tokens(num(f.reasoning_tokens))}` : null,
        ms(f.duration_ms) && `共 ${ms(f.duration_ms)}`,
      ),
  },
  "provider.failed": {
    label: "调模型失败",
    category: "model",
    say: (f) =>
      plus(
        `调模型失败：${errorClass(f.error_class)}`,
        f.status ? `HTTP ${str(f.status)}` : null,
        f.partial ? "已经写了一部分" : null,
      ),
  },
  "director.parse": {
    label: "检查格式",
    category: "turn",
    say: (f) => `检查格式：${PARSE_STAGES[str(f.stage)] ?? str(f.stage)}`,
  },
  "options.repair": {
    label: "补选项",
    category: "turn",
    say: (f) => plus(`另调模型补选项，拿到 ${str(f.produced)} 个`, ms(f.duration_ms)),
  },
  "options.repair_failed": { label: "补选项失败", category: "turn", say: (f) => `补选项失败：${str(f.error_class)}` },
  "turn.committed": {
    label: "保存",
    category: "turn",
    say: (f) =>
      plus(
        "保存成功",
        `回合共 ${ms(f.duration_ms)}`,
        f.options_source ? `选项来自${OPTION_SOURCES[str(f.options_source)] ?? str(f.options_source)}` : null,
      ),
  },
  "turn.commit_rejected": { label: "保存被拒绝", category: "turn", say: () => "保存时租约已经被收回，结果作废" },
  "turn.failed": {
    label: "回合失败",
    category: "turn",
    say: (f) => plus(`回合失败：${errorCode(f.code)}`, f.cancel_reason ? `取消原因 ${str(f.cancel_reason)}` : null),
  },
  "turn.crashed": { label: "回合崩溃", category: "turn", say: () => "执行回合时抛出了没处理的异常" },
  "turn.cancel_requested": { label: "停止生成", category: "turn", say: () => "玩家点了停止" },
  "turn.lease_expired": { label: "租约过期", category: "turn", say: () => "生成进程没了，回合被标为失败" },
  "turn.lease_renew_failed": { label: "续租失败", category: "turn" },
  "turn.fail_mark_failed": { label: "标记失败出错", category: "turn" },
  "sse.subscribe": {
    label: "订阅推送",
    category: "sse",
    say: (f) =>
      f.mode === "snapshot"
        ? "缓冲已过期，等回合结束后一次给全"
        : plus("实时订阅", num(f.backlog) ? `先补发 ${str(f.backlog)} 条` : null),
  },
  "sse.open": {
    label: "推送连接",
    category: "sse",
    say: (f) => (num(f.resumed_from) ? `手机重新连上，从第 ${str(f.resumed_from)} 条之后续传` : "手机连上推送"),
  },
  "sse.close": {
    label: "推送断开",
    category: "sse",
    say: (f) =>
      plus(
        SSE_REASONS[str(f.reason)] ?? str(f.reason),
        `发了 ${str(f.events_sent)} 条`,
        ms(f.duration_ms) && `连了 ${ms(f.duration_ms)}`,
      ),
  },
  "job.started": { label: "任务开始", category: "job" },
  "job.done": { label: "任务完成", category: "job", say: (f) => `任务完成，${ms(f.duration_ms)}` },
  "job.failed": {
    label: "任务失败",
    category: "job",
    say: (f) => plus(`任务失败：${str(f.error_class)}`, f.will_retry ? `${str(f.retry_in_s)} 秒后重试` : "不再重试"),
  },
  "job.released": { label: "任务归还", category: "job" },
  "job.lock_lost": { label: "任务锁丢失", category: "job" },
  "job.reaped": { label: "回收超时任务", category: "job" },
  "job.claim_failed": { label: "领取任务失败", category: "job" },
  "job.renew_failed": { label: "任务续锁失败", category: "job" },
  "worker.started": { label: "worker 启动", category: "app" },
  "worker.stopped": { label: "worker 退出", category: "app" },
  "worker.draining": { label: "worker 等任务收尾", category: "app" },
  "app.started": {
    label: "服务启动",
    category: "app",
    say: (f) => plus(`服务启动`, f.version ? `版本 ${str(f.version)}` : null, str(f.env)),
  },
  "app.stopping": { label: "服务关闭", category: "app" },
  "scheduler.task_failed": { label: "定时任务失败", category: "app", say: (f) => `定时任务 ${str(f.task)} 失败` },
  "secrets.dev_generated": { label: "开发密钥", category: "app", say: () => "开发环境使用自动生成的密钥" },
  "queue.listen_failed": { label: "监听失败", category: "job" },
  "queue.listen_restored": { label: "监听恢复", category: "job" },
  "queue.listen_retry_failed": { label: "监听重连失败", category: "job" },
  "events.swept": { label: "清理事件缓冲", category: "app" },
};

const SSE_REASONS: Record<string, string> = {
  completed: "回合结束，推送完毕",
  client_gone: "手机断开",
  shutdown: "服务重启，主动断开",
};

/** 手机诊断日志里的事件（apps/mobile/src/observability）；和服务端同名的事件含义不同，按来源分开 */
export const PHONE_EVENTS: Record<string, EventInfo> = {
  "app.started": {
    label: "App 启动",
    category: "app",
    say: (f) => plus("App 启动", f.version ? `版本 ${str(f.version)}` : null, str(f.platform)),
  },
  "app.error": {
    label: "App 报错",
    category: "app",
    say: (f) => plus(f.fatal ? "App 崩溃" : "App 报错", `${str(f.error)}：${str(f.message)}`),
  },
  "api.request": {
    label: "手机请求",
    category: "request",
    say: (f) =>
      plus(
        `${str(f.method)} ${shortPath(str(f.path))}：${num(f.status) === 0 ? `没拿到响应（${errorCode(f.code)}）` : `HTTP ${str(f.status)}`}`,
        f.code && num(f.status) !== 0 ? errorCode(f.code) : null,
        ms(f.duration_ms) && `耗时 ${ms(f.duration_ms)}`,
        f.detail ? str(f.detail) : null,
        f.server ? `服务器 ${str(f.server)}` : null,
      ),
  },
  "sse.state": {
    label: "推送状态",
    category: "sse",
    say: (f) =>
      ({
        connecting: "推送：正在连接",
        open: "推送：已连上",
        reconnecting: `推送：断了，正在重连（已重连 ${str(f.reconnects)} 次）`,
        polling: "推送：收不到数据，改成轮询",
        closed: "推送：关闭",
        idle: "推送：空闲",
      })[str(f.state)] ?? `推送：${str(f.state)}`,
  },
  "sse.error": {
    label: "推送出错",
    category: "sse",
    say: (f) =>
      plus(`推送出错：${str(f.error)}`, f.status ? `HTTP ${str(f.status)}` : null, f.detail ? str(f.detail) : null),
  },
  "sse.finished": {
    label: "推送结束",
    category: "sse",
    say: (f) =>
      plus(
        {
          completed: "推送结束：回合完成",
          polling: "推送结束：改成轮询",
          closed: "推送结束：页面关了",
          unauthorized: "推送结束：登录失效",
        }[str(f.outcome)] ?? `推送结束：${str(f.outcome)}`,
        num(f.reconnects) ? `重连 ${str(f.reconnects)} 次` : null,
      ),
  },
  "turn.phase": {
    label: "回合状态",
    category: "turn",
    say: (f) => plus(`回合状态：${str(f.from)} → ${str(f.to)}`, f.code ? errorCode(f.code) : null),
  },
  "session.status": { label: "登录状态", category: "account", say: (f) => `登录状态：${str(f.from)} → ${str(f.to)}` },
  "server.changed": { label: "换服务器", category: "app", say: (f) => `服务器从 ${str(f.from)} 换成 ${str(f.to)}` },
};

/** 一条记录的人话，按来源（服务端 / 手机）选目录 */
export function describeEntry(entry: { event: string; file?: string } & Fields): string {
  if (entry.file === "phone") {
    const info = PHONE_EVENTS[entry.event];
    if (info?.say) {
      try {
        return info.say(entry);
      } catch {
        return info.label;
      }
    }
    return info?.label ?? entry.event;
  }
  return sentence(entry.event, entry);
}

export function entryInfo(entry: { event: string; file?: string }): EventInfo {
  return (entry.file === "phone" ? PHONE_EVENTS[entry.event] : undefined) ?? eventInfo(entry.event);
}

export function eventInfo(event: string): EventInfo {
  return EVENTS[event] ?? { label: event, category: guessCategory(event) };
}

function guessCategory(event: string): Category {
  const head = event.split(".", 1)[0] ?? "";
  if (head === "provider") return "model";
  if (head === "sse") return "sse";
  if (head === "auth" || head === "account") return "account";
  if (head === "job" || head === "queue" || head === "worker") return "job";
  if (head === "turn" || head === "world" || head === "director" || head === "options") return "turn";
  if (head === "http") return "request";
  if (head === "route" || head === "models") return "route";
  return "app";
}

/** 一条记录的人话；没有专门的写法就用事件的中文名，第三方库的日志用它自己的文字 */
export function sentence(event: string, fields: Fields): string {
  const info = EVENTS[event];
  if (info?.say) {
    try {
      return info.say(fields);
    } catch {
      return info.label;
    }
  }
  return info?.label ?? event;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  request: "请求",
  turn: "回合",
  model: "模型",
  sse: "推送",
  account: "账户",
  route: "模型配置",
  import: "导入",
  job: "后台任务",
  app: "服务",
};
