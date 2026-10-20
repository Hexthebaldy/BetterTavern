# 数据模型：运行基础设施

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](story.md) · [世界状态](world.md) · [运行基础设施](infra.md)

模型调用的账本，以及后台任务队列。

## 表

### `agent_runs`

调用账本：模型调用的记录，用于排错、用量统计和审计。M1 只记两种 agent：
- 导演：回合成功时记一行，没写出叙述（`NARRATIVE_MISSING`）时也记一行；服务商返回错误的调用不记。
- WorldBuilder：成功时记一行；超时、服务商出错、结构化输出失败、等不到并发槽位时记一行 `failed`（等槽位超时时其实没有调用模型）；
  被取消、或者世界已经建好（重试开场时）就不记。`task` 记的是 `world_builder`，即使实际用的是导演的路由。
- 补选项（OptionsRepair）的调用不记。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `playthrough_id` | uuid | 是 |  | → `playthroughs.id`，级联删除 |
| `turn_id` | uuid | 是 |  | 无外键，指向 `turns.id` |
| `agent` | text | 否 |  | `director`、`world_builder`（M2 起还会有 `state_keeper` 等） |
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

### `jobs`

后台任务队列。M0 建好，M1 的热路径不使用；M2 的 StateKeeper 等后台车道使用。同一个 `ordering_key` 的任务严格按 `id` 顺序串行执行，不同键之间并行执行。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 否 | 自增（`BIGSERIAL`） | 主键，也决定同一个键里的执行顺序 |
| `kind` | text | 否 |  | 任务类型，worker 按它找到处理函数 |
| `ordering_key` | text | 否 |  | 串行键，约定为 `{playthrough_id}:{lane}`，lane 是 `state`、`summary`、`outline` 之一 |
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
| WorldBuilder，成功 | `{ "mode", "attempts", "characters", "locations", "facts" }`；`mode` 是实际用上的结构化输出方式（`json_schema` / `tool_call` / `json_object` / `prompt_json`） |
| WorldBuilder，失败 | `{ "detail" }`：错误说明，最多 300 字 |

## 状态

`jobs.status`：
- `pending` → `running` → `done`。
- `running` 失败后，还有次数就回到 `pending`（推迟 `run_after`）；次数用完，或者处理器抛出 `PermanentJobError`（明确不该重试），就变成 `failed`。
- 优雅退出时归还的任务回到 `pending`，不计次数。
- 锁超时被回收的任务，还有次数就回到 `pending`，否则变成 `failed`。
