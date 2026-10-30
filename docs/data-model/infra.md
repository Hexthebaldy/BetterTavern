# 数据模型：运行基础设施

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [点数](credits.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [人设库](personas.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

模型调用的账本（每次 agent 运行一行，运行里的每一步一行），以及后台任务队列。

## 表

### `agent_runs`

调用账本：每次 agent 运行记一行，用于排错、用量统计和审计；运行里的每一步记在 `agent_steps`。现在记六种 agent：
- 导演：回合成功时记一行；没写出叙述（`NARRATIVE_MISSING`）、服务商出错、碰到总时长或总字数上限时也记一行 `failed`；
  玩家取消或进程关闭打断时记 `cancelled`。
- WorldBuilder：成功时记一行；超时、服务商出错、结构化输出失败、等不到并发槽位时记一行 `failed`（等槽位超时时其实没有调用模型）；
  被取消、或者世界已经建好（重试开场时）就不记。`task` 记的是 `world_builder`，即使实际用的是导演的路由。
- 补选项（`options_repair`）：真的调用了才记，成功是 `ok`，出错是 `failed`，超过时限被打断是 `cancelled`；和导演那一行属于同一个回合。
  用卡片的开场白开场时，开场回合没有导演那一行，只有补选项。
- 世界状态 agent（`state_keeper`，在 worker 进程里）：整理一回合记一行，`turn_id` 是被整理的回合。写入成功是 `ok`；写入时整理进度或时间线编号对不上是 `stale`；
  调模型出错、超时、模型没用 commit 结束、模型不能调用工具、没有可用的模型、写入时和库里已有的行冲突是 `failed`（原因在 `error_class`）。`usage` 是这次运行所有模型调用的合计。
- 章节整理（`chapter_writer`，在 worker 进程里）：写一章记一行，`turn_id` 是这一章的最后一回合。写入成功是 `ok`；写入时覆盖进度或时间线编号对不上是 `stale`；
  调模型出错、超时、结构化输出失败、没有可用的模型是 `failed`。`task` 记 `compactor`。
- 大纲修订（`outline_writer`，在 worker 进程里）：修订一次记一行（改或不改都算），`turn_id` 是这次依据到的那一回合。`ok`、`stale`、`failed` 的含义同章节整理。`task` 记 `outline`。
- 工作台的 agent（`card_maker`，在 worker 进程里）：跑一轮记一行，`draft_id` 是那份草稿，`playthrough_id`、`turn_id` 为空。正常结束是 `ok`；用户点了停止或切到手动接管是 `cancelled`；
  没有可用的模型、模型不能调用工具、服务商出错、超过 15 分钟是 `failed`。`task` 记 `workbench`。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `playthrough_id` | uuid | 是 |  | → `playthroughs.id`，级联删除 |
| `draft_id` | uuid | 是 |  | → `workbench_drafts.id`，级联删除。工作台的 agent 运行记在哪份草稿上；这时 `id` 就是这一轮的编号（对话记录的 `run_id`） |
| `turn_id` | uuid | 是 |  | 无外键，指向 `turns.id` |
| `agent` | text | 否 |  | `director`、`world_builder`、`options_repair`、`state_keeper`、`chapter_writer`、`outline_writer`、`card_maker`、`illustrator` |
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

约束与索引：`status` 的 CHECK；`agent_runs_turn_idx (turn_id, agent)`；`agent_runs_pt_idx (playthrough_id, created_at)`；`agent_runs_draft_idx (draft_id, created_at)`。

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

后台任务队列，worker 进程领取执行。每局两条队列：`state`（世界状态整理）和 `memory`（章节整理、大纲修订）。
同一个 `ordering_key` 的任务严格按 `id` 顺序串行执行，不同键之间并行执行，所以写一章、修订大纲时不挡下一回合的世界状态整理。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 否 | 自增（`BIGSERIAL`） | 主键，也决定同一个键里的执行顺序 |
| `kind` | text | 否 |  | 任务类型，worker 按它找到处理函数 |
| `ordering_key` | text | 否 |  | 串行键，约定为 `{playthrough_id}:{lane}`，lane 是 `state`、`memory` 之一；工作台是 `{draft_id}:workbench` |
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
- 入队时可以要求“这个键上已经有同类、还没开始的任务就不再放”（下面三种都这样用：一个任务会把到那时为止要做的都做完）。

`kind` 和 `payload`：

| `kind` | `payload` | 说明 |
| --- | --- | --- |
| `state.turn` | `{ "playthrough_id" }` | 回合存为 `replied` 时放进来，`max_attempts` 是 1：整理失败不靠队列重试，下一回合的任务会再从那一回合开始 |
| `memory.chapter` | `{ "playthrough_id" }` | 世界状态整理完（或跳过）一回合时在同一个事务里放进来，排序键 `{playthrough_id}:memory`，`max_attempts` 是 1：由章节整理看够不够切一章，够就写，失败了下一回合再试 |
| `memory.outline` | `{ "playthrough_id" }` | 世界状态整理完（或跳过）一回合时，还没有大纲或者有还没处理的“大纲要改”的原因就放进来；回退删了大纲修订时也放。排序键和 `max_attempts` 同上 |
| `memory.lightning` | `{ "playthrough_id" }` | 闪电模式的回合存好（结局除外）时在同一个事务里放进来，排序键和 `max_attempts` 同上：看梗概之后的原文够不够压，够就用导演的模型压成一版新梗概，不够就什么都不做（[agent-runtime.md 的“闪电模式”](../agent-runtime.md#闪电模式)） |
| `workbench.run` | `{ "draft_id", "run_id", "trigger" }` | 工作台开一轮 agent 时和用户的消息、草稿改成 `running` 在同一个事务里放进来，排序键 `{draft_id}:workbench`，`max_attempts` 是 1（跑到一半进程挂了，重跑会重复搜索、重复出图；草稿的心跳过期以后用户可以再开一轮）。`trigger` 是 `text` / `answers` / `plan_reply` / `continue` |
| `story.image` | `{ "image_id" }` | 玩家点“画这一幕”时和插入 `turn_images` 的那一行在同一个事务里放进来，排序键 `{image_id}:image`（几张图可以同时画），`max_attempts` 是 1：重画要再花一次出图的钱，交给玩家点“再试一次”（[illustrations.md](../illustrations.md) 第 2 节） |
| `noop` | 任意 | 冒烟测试用 |

## JSON 列

### `agent_runs.result`

| 调用 | 结构 |
| --- | --- |
| 导演，成功 | `{ "route_id", "finish_reason", "estimated_tokens", "usage_ratio", "dropped_turns", "prompt_versions": { 模板名: 版本 }, "stage", "repairs": [], "notes": [] }`；`stage` 是 `ok` / `salvaged` / `repaired` / `fallback` |
| 导演，`NARRATIVE_MISSING` | 同上，但没有 `stage`、`repairs`、`notes` |
| 导演，服务商出错或碰到上限 | `{ "route_id", "estimated_tokens", "usage_ratio", "dropped_turns", "prompt_versions" }` |

导演的三种都还带 `recall_before`（上下文里的原文从第几回合开始），这一局有世界书快照时还带 `lore`：`{ "constant", "triggered": [序号], "recursion", "dropped", "sticky": [序号], "regex_timeouts" }`，即系统提示里放了几条常驻条目、这一回合挑中的条目在快照（`playthrough_lore.entries`）里的序号、其中几条是递归带出来的、几条因为预算装不下、哪几条是粘滞期里接着生效的（没有就没有这一项）、正则超时几次（没有超时就没有这一项）。不记条目内容。

| 补选项 | `{ "existing", "produced" }`：调用前已有几个合格选项、这次补出了几个 |
| WorldBuilder，成功 | `{ "mode", "attempts", "characters", "locations", "facts" }`；`mode` 是实际用上的结构化输出方式（`json_schema` / `tool_call` / `json_object` / `prompt_json`） |
| WorldBuilder，失败 | `{ "detail" }`：错误说明，最多 300 字 |
| 世界状态 agent，`ok` 或 `stale` | `{ "changes", "rejected": [{ "tool", "code" }], "model_calls", "scene_ended", "outline_change", "refs": { 编号: 名字 } }`：写入了几行改动、被拒绝的修改（工具名和原因代码）、调了几次模型、场景是否结束、有没有说大纲要改、编号对照表 |
| 世界状态 agent，`failed` | `{ "attempt", "refs" }`：这一回合第几次失败；还没调模型就失败（没有模型、模型不能调用工具）时没有 `refs`。写入冲突时同 `ok` |

| 章节整理，`ok` 或 `stale` | `{ "first_seq", "last_seq", "mode", "attempts", "chapter_chars", "profile_chars", "folded_last_seq" }`：这一章的回合范围、结构化输出方式和尝试次数、摘要和画像的字数、并进梗概的那一章的最后一回合（没并时为空） |
| 章节整理，`failed` | `{ "first_seq", "last_seq" }` |
| 大纲修订，`ok` 或 `stale` | `{ "based_on_seq", "first", "changed", "reasons", "active", "mode", "attempts" }`：依据到第几回合、是不是第一版、改没改、处理了几条原因、改完以后进行中的那一拍的编号 |
| 大纲修订，`failed` | `{ "based_on_seq", "first" }` |
| 写画面描述（`illustrator`） | 成功时 `{ "people" }`：画里有几个人在名单上；失败时是空的，原因在 `error_class` |
| 工作台 agent | `{ "mode", "ended", "stopped", "model_calls", "tool_calls", "searches", "pages", "images", "written" }`：这一轮的做法（`planning` / `build` / `revise`）、用哪个工具结束的（`questions` / `plan` / `changes` / null）、是不是被停下、调了几次模型和工具、搜了几次、读了几页、出了几张图、写了几处。不记卡的内容 |

`refs` 是这次运行的工具参数和结果里出现过的编号对应什么：实体 `e3` 对应名字，事实 `f8` 对应开头 40 个字。编号只在一次运行里有效，记下来给日志查看工具在显示故事内容时把编号换成名字；不显示故事内容时接口不返回它。

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
| 章节整理、大纲修订调模型 | 同 WorldBuilder | 同 WorldBuilder |
| 补选项调模型 | `{ "model", "json_object" }` | 成功：`{ "text", "finish_reason" }`；服务商出错：`{ "error", "status" }` |
| 世界状态 agent 调模型 | `{ "provider", "model", "round", "messages", "tools": [] }`：第几次调用、发出的消息条数、提供的工具名 | 成功：`{ "text", "tool_calls": [{ "name", "arguments" }], "finish_reason" }`；服务商出错：`{ "error", "status" }` |
| 工作台 agent 调模型 | 同世界状态 agent（流式调用） | 同世界状态 agent；服务商出错时多一个 `text`（已经写出的部分），等不到并发槽位是 `{ "error": "slot_timeout" }` |
| 用工具 | 解析后的参数；参数解析不了时是 `{ "raw" }` | `{ "text", "error" }`：交回模型的内容；`error` 是 `unknown_tool` / `bad_arguments` / `failed`，成功时为 null |

`text` 最多存 40000 字。
