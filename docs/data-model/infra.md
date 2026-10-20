# 数据模型：运行基础设施

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](story.md) · [世界状态](world.md) · [运行基础设施](infra.md)

模型调用的账本（每次 agent 运行一行，运行里的每一步一行），以及后台任务队列。

## 表

### `agent_runs`

调用账本：每次 agent 运行记一行，用于排错、用量统计和审计；运行里的每一步记在 `agent_steps`。现在记三种 agent：
- 导演：回合成功时记一行；没写出叙述（`NARRATIVE_MISSING`）、服务商出错、碰到总时长或总字数上限时也记一行 `failed`；
  玩家取消或进程关闭打断时记 `cancelled`。
- WorldBuilder：成功时记一行；超时、服务商出错、结构化输出失败、等不到并发槽位时记一行 `failed`（等槽位超时时其实没有调用模型）；
  被取消、或者世界已经建好（重试开场时）就不记。`task` 记的是 `world_builder`，即使实际用的是导演的路由。
- 补选项（`options_repair`）：真的调用了才记，成功是 `ok`，出错是 `failed`，超过时限被打断是 `cancelled`；和导演那一行属于同一个回合。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `playthrough_id` | uuid | 是 |  | → `playthroughs.id`，级联删除 |
| `turn_id` | uuid | 是 |  | 无外键，指向 `turns.id` |
| `agent` | text | 否 |  | `director`、`world_builder`、`options_repair`（以后还会有 `state_keeper`、`outline`、`consolidator`） |
| `task` | text | 否 |  | 使用的路由槽位，取值同 `model_routes.task` |
| `provider` | text | 是 |  | 服务商 |
| `model` | text | 是 |  | 模型名 |
| `prompt_hash` | text | 是 |  | 提示词的指纹：导演是整个请求消息的 SHA-256 的前 16 位。用来检查前缀缓存是否稳定 |
| `input_tokens` | integer | 是 |  | 输入 token 数（服务商报告的） |
| `cached_tokens` | integer | 是 |  | 输入中命中前缀缓存的 token 数 |
| `output_tokens` | integer | 是 |  | 输出 token 数 |
| `reasoning_tokens` | integer | 是 |  | 思考 token 数 |
| `ttft_ms` | integer | 是 |  | 首个 token 的延迟（毫秒） |
| `latency_ms` | integer | 是 |  | 总耗时（毫秒） |
| `status` | text | 否 |  | `ok` / `failed` / `stale`（提交时被围栏拒绝，M2 起）/ `cancelled` |
| `error_class` | text | 是 |  | 失败类别，例如 `timeout`、`narrative_missing`，或 provider 层的错误类别 |
| `result` | jsonb | 是 |  | 调用摘要，不含故事文本，结构见下文“JSON 列” |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：`status` 的 CHECK；`agent_runs_turn_idx (turn_id, agent)`；`agent_runs_pt_idx (playthrough_id, created_at)`。

### `agent_steps`

一次 agent 运行里的每一步：每调一次模型、每用一次工具记一行（[agent-runtime.md](../agent-runtime.md) 第 5 节“记录与重放”）。
参数和结果里有故事文字（模型写出的原文、工具查到的内容），所以只存在这里，不写日志。随 `agent_runs` 的行级联删除。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `run_id` | uuid | 否 |  | → `agent_runs.id`，级联删除 |
| `step` | smallint | 否 |  | 第几步，从 0 开始；CHECK 不小于 0 |
| `kind` | text | 否 |  | `model`（调一次模型）/ `tool`（用一次工具） |
| `tool` | text | 是 |  | `kind` 为 `tool` 时是工具名 |
| `args` | jsonb | 否 | `'{}'` | 这一步的参数，结构见下文“JSON 列” |
| `result` | jsonb | 否 | `'{}'` | 这一步的结果，结构见下文“JSON 列” |
| `latency_ms` | integer | 是 |  | 这一步的耗时（毫秒） |
| `input_tokens` | integer | 是 |  | 调模型时的输入 token 数 |
| `cached_tokens` | integer | 是 |  | 其中命中前缀缓存的 token 数 |
| `output_tokens` | integer | 是 |  | 输出 token 数 |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：主键 `(run_id, step)`（`agent_steps_pkey`）；`kind` 的 CHECK。

### `jobs`

后台任务队列。M0 建好，M1 的热路径不使用；agent runtime 的 state、memory 两条后台队列使用。同一个 `ordering_key` 的任务严格按 `id` 顺序串行执行，不同键之间并行执行。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 否 | 自增（`BIGSERIAL`） | 主键，也决定同一个键里的执行顺序 |
| `kind` | text | 否 |  | 任务类型，worker 按它找到处理函数 |
| `ordering_key` | text | 否 |  | 串行键，约定为 `{playthrough_id}:{lane}`，lane 是 `state`、`memory` 之一 |
| `payload` | jsonb | 否 | `'{}'` | 任务参数 |
| `status` | text | 否 | `'pending'` | `pending` / `running` / `done` / `failed` |
| `run_after` | timestamptz | 否 | `now()` | 最早可以执行的时间，用于入队延迟和失败后退避 |
| `attempts` | integer | 否 | `0` | 已被领取的次数；优雅退出时归还的那次不算 |
| `max_attempts` | integer | 否 | `5` | 次数上限，CHECK 大于 0；用完后任务变成 `failed` |
| `locked_by` | text | 是 |  | 领取这个任务的 worker；完成、失败、续期时都要求它没变（围栏） |
| `locked_at` | timestamptz | 是 |  | 领取或最近一次续期的时间；超过锁超时（默认 300 秒）的任务会被回收 |
| `last_error` | text | 是 |  | 最近一次失败、归还或被回收的原因；任务完成时清空 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `finished_at` | timestamptz | 是 |  | 变成 `done` 或 `failed` 的时间 |

约束与索引：
- `status` 的 CHECK；`max_attempts > 0`。
- `jobs_ready_idx (run_after, id) WHERE status = 'pending'`。
- `jobs_open_by_key_idx (ordering_key, id) WHERE status IN ('pending', 'running')`。
- `jobs_running_lock_idx (locked_at) WHERE status = 'running'`。

领取规则（`infra/queue/sql.py`）：
- 只有某个键“最早的未完成任务”可以被领取。
- `FOR UPDATE SKIP LOCKED` 让多个 worker 互不阻塞。
- 入队前先拿这个键的事务级咨询锁，保证同一个键的 `id` 按提交顺序分配。
- 入队和业务写入在同一个事务里完成；`NOTIFY bt_jobs` 在事务提交时送达。

## JSON 列

### `agent_runs.result`

| 调用 | 结构 |
| --- | --- |
| 导演，成功 | `{ "route_id", "finish_reason", "estimated_tokens", "usage_ratio", "dropped_turns", "prompt_versions": { 模板名: 版本 }, "stage", "repairs": [], "notes": [] }`；`stage` 是 `ok` / `salvaged` / `repaired` / `fallback` |
| 导演，`NARRATIVE_MISSING` | 同上，但没有 `stage`、`repairs`、`notes` |
| 导演，服务商出错或碰到上限 | `{ "route_id", "estimated_tokens", "usage_ratio", "dropped_turns", "prompt_versions" }` |
| 补选项 | `{ "existing", "produced" }`：调用前已有几个合格选项、这次补出了几个 |
| WorldBuilder，成功 | `{ "mode", "attempts", "characters", "locations", "facts" }`；`mode` 是实际用上的结构化输出方式（`json_schema` / `tool_call` / `json_object` / `prompt_json`） |
| WorldBuilder，失败 | `{ "detail" }`：错误说明，最多 300 字 |

## 状态

`jobs.status`：
- `pending` → `running` → `done`。
- `running` 失败后，还有次数就回到 `pending`（推迟 `run_after`）；次数用完，或者处理器抛出 `PermanentJobError`（明确不该重试），就变成 `failed`。
- 优雅退出时归还的任务回到 `pending`，不计次数。
- 锁超时被回收的任务，还有次数就回到 `pending`，否则变成 `failed`。

### `agent_steps.args` 与 `agent_steps.result`

| 步骤 | `args` | `result` |
| --- | --- | --- |
| 导演调模型 | `{ "provider", "model", "route_id", "messages", "tools": [], "prompt_hash", "estimated_tokens" }`；`messages` 是发出的消息条数，`tools` 是这一轮提供的工具名 | 成功：`{ "text", "finish_reason", "ttft_ms" }`，`text` 是模型写出的原文（含标签）；失败：`{ "error", "status", "partial", "text" }` 或 `{ "error": "slot_timeout" }`；碰到上限：`{ "error": "timeout" / "too_long", "text" }` |
| WorldBuilder 调模型 | `{ "model", "mode", "attempt" }`：用哪种结构化输出方式、第几次尝试 | 成功：`{ "text" }`；格式不合格：`{ "text", "invalid" }`，`invalid` 是校验错误的摘要；服务商出错：`{ "error", "status" }` |
| 补选项调模型 | `{ "model", "json_object" }` | 成功：`{ "text", "finish_reason" }`；服务商出错：`{ "error", "status" }` |
| 用工具 | 解析后的参数；参数解析不了时是 `{ "raw" }` | `{ "text", "error" }`：交回模型的内容；`error` 是 `unknown_tool` / `bad_arguments` / `failed`，成功时为 null |

`text` 最多存 40000 字。
