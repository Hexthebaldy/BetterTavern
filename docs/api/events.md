# 接口：回合事件流（SSE）

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [人设库](personas.md) · [工作台](workbench.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

`GET /v1/turns/{turn_id}/events` 推送的事件：连接的格式、每个事件的 data、正常顺序，以及断线续传和快照模式。
接口本身（鉴权、请求头、错误）见 [play.md](play.md)。

## 连接

- 响应头：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`（让 Nginx 不缓冲）。这个接口不压缩。反向代理要关闭缓冲（Nginx 用 `proxy_buffering off`）。
- 流的第一行是 `retry: 1000`，即建议的重连间隔（毫秒）。
- 每个事件的格式是 `id: {turn_id}:{n}`、`event: {事件名}`、`data: {一行 JSON}`，最后是一个空行。`n` 从 1 开始，在一个回合里递增。
- 超过 15 秒没有事件时，服务端发一行注释 `: keepalive`。
- 终止事件（`turn.completed` 或 `turn.failed`）发出后，服务端关闭连接。服务端开始优雅退出时，也会主动断开连接。
- 客户端断开连接不影响生成。

```text
retry: 1000

id: 6b1d…:1
event: turn.created
data: {"turn_id": "6b1d…", "seq": 3, "attempt": 0}

id: 6b1d…:2
event: narrative.delta
data: {"text": "雨还在下。"}

: keepalive

```

## 事件

| 事件 | data | 说明 |
| --- | --- | --- |
| `turn.created` | `{"turn_id", "seq", "attempt"}` | 第一个事件 |
| `world.building` | `{}` | 只在开场回合、世界还没建好时出现：开始搭建世界 |
| `world.ready` | `{"source", "entities"}` | 世界建好了。`source` 是 `world_builder`（模型生成）或 `minimal`（模型失败，只用了卡片原文）；`entities` 是实体数量 |
| `director.recalling` | `{"round"}` | 导演在写之前先用召回工具查更早的回合（[agent-runtime.md](../agent-runtime.md) 第 7 节“召回”）。`round` 是第几轮，最多 2。只在有不在上下文里的旧回合、模型能调用工具时出现；客户端显示“正在回想……”，第一个 `narrative.delta` 到了就不再显示 |
| `narrative.delta` | `{"text"}` | 叙述的增量，按顺序拼接。服务端大约每 40 毫秒合并发送一批 |
| `narrative.done` | `{"chars"}`，有时还有 `"rewritten"` | 叙述结束。`rewritten` 为真表示服务端在收尾时改写了叙述（例如模型把选项写进了叙述里），这时要以 `turn.completed` 里的 `narrative` 为准 |
| `options.ready` | `{"options": [{"id", "text"}], "source"}` | 选项已经保存。`source` 是 `model` / `repaired` / `missing`（补了两次也没补齐，`options` 不足两个，可能是空数组）；结局那一轮 `options` 是空数组、`source` 是 null |
| `turn.completed` | `{"turn", "usage"}` | 终止事件。`turn` 含 `id`、`seq`、`attempt`、`status`、`narrative`、`options`、`options_source`、`state_seq`，含义同 [`TurnOut`](play.md#turnout)（`status` 是 `replied`，结局那一轮是 `committed`）；`usage` 是 `{"prompt", "completion", "cached", "reasoning"}`，服务商没给用量时为 null，快照模式下总是 null |
| `turn.failed` | `{"code", "message", "retryable", "partial", "reason"}` | 终止事件。`code` 见 [README.md 的“回合失败码”](README.md#回合失败码)；`message` 是英文说明；`reason` 是服务商错误的类别（`auth`、`billing`、`rate_limit`、`overloaded` 等），不是服务商错误时为 null。客户端按 `code` 和 `reason` 显示界面语言的文字（[i18n.md](../i18n.md) 第 3 节）；`partial` 为真表示已生成的部分叙述保存成了草稿 |
| `snapshot` | `{"narrative", "options", "source"}` | 只在快照模式下出现（见下文）：用它**替换**已经拼出来的叙述，不要追加。失败回合和结局那一轮的 `options` 为空数组、`source` 为 null |

正常情况下的顺序：

- 开场、世界还没建好：`turn.created` → `world.building` → `world.ready` → `narrative.delta`（若干个）→ `narrative.done` → `options.ready` → `turn.completed`
- 普通回合：`turn.created` →（导演先查旧回合时：`director.recalling`，最多两个）→ `narrative.delta`（若干个）→ `narrative.done` → `options.ready` → `turn.completed`
- 结局（行动来源 `ending`）：顺序和普通回合一样，只是 `options.ready` 和 `turn.completed` 里的选项是空的
- 失败：在上面任意一步之后收到 `turn.failed`，前面可能已经有若干个 `narrative.delta`

不认识的事件要忽略，以后的版本会增加新事件。

## 断线续传

- 重连时带 `Last-Event-ID: {turn_id}:{n}`，服务端从第 n+1 个事件开始补发，不重不漏。值不属于这个回合或者格式不对时，从第一个事件开始发。
- 事件保存在 api 进程的内存缓冲里，回合结束后保留 10 分钟（`EVENT_BUFFER_RETENTION_S`）。
- 缓冲不在了（已经过期、服务重启过，或者回合在另一个实例上）时，改用快照模式：
  - 如果回合还在生成，服务端每秒查一次数据库，等它结束，最多等租约时长加 15 秒（默认 135 秒）。
  - 回合成功：发 `snapshot`（完整的叙述和选项），然后发 `turn.completed`。
  - 回合失败：有草稿时先发 `snapshot`，然后发 `turn.failed`。
  - 等到上限时回合仍未结束，就按 `RUNNER_LOST` 发 `turn.failed`。
  - 快照模式下的事件 id 从 1 重新编号，`Last-Event-ID` 不起作用。
