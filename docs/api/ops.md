# 接口：运维与开发

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [人设库](personas.md) · [工作台](workbench.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

健康检查、就绪检查，以及开发环境的 SSE 探针。

## 健康检查

### `GET /health`

进程是否活着，不检查数据库。顺带报正在运行的版本，部署脚本（`scripts/deploy.sh`）据此确认新版本已经起来。

- 鉴权：不需要
- 成功：`200`，返回 `{"status": "ok", "version": "0.1.0", "build": "3f2c1ab"}`。`version` 是程序的版本号；
  `build` 是构建镜像时的提交号（环境变量 `BUILD_ID`），本机开发时是 `dev`。

### `GET /ready`

能否接收新请求。

- 鉴权：不需要
- 成功：`200`，返回 `{"status": "ready"}`。开始优雅退出后返回 `503` 和 `{"status": "shutting_down"}`（这个 503 不是 problem+json），负载均衡据此把实例摘掉。

## 探针

M0 的 SSE 探针，用来在真机上验证长连接、续传和代理缓冲。客户端的“设置 → 连接测试”和 `npm run probe` 用的就是它们。

- 由 `ENABLE_PROBE_ENDPOINTS` 控制：不设置时，开发环境打开，生产环境关闭。
- **不需要登录**，所以只能读取探针自己创建的流（id 以 `probe_` 开头），读不到真实回合的事件。
- 这几个接口挂在一个单独的子应用上，不在 OpenAPI 里。

### `POST /v1/probe/streams`

创建一条模拟的长流：服务端按设定的速率持续发送确定性的中文文本（含多字节字符和 emoji）。

- 鉴权：不需要
- 请求体（可以为空）：`{"duration_s": 180, "events_per_second": 20, "chars_per_event": 8}`。
  `duration_s` 取 1 到 1800，`events_per_second` 取 0.5 到 200，`chars_per_event` 取 1 到 200；三者的乘积（总字数）不能超过 200000；不能有其他字段。最多同时运行 20 条。
- 成功：`201`，返回 `{"stream_id", "status": "running", "chars_total", "chars_sent", "events", "sha256", "events_url", "status_url"}`。
- 参数不对时返回 422 `VALIDATION_ERROR`，原因在 `detail` 字段里。

### `GET /v1/probe/streams/{stream_id}/events`

订阅探针的事件流。续传可以用 `Last-Event-ID` 请求头，也可以用查询参数 `last_event_id`（给设置不了请求头的客户端用）。

- 鉴权：不需要
- 成功：`200`，SSE。事件依次是：
  - `turn.created`：`{"stream_id", "chars", "seq": 0}`
  - `narrative.delta`（若干个）：`{"text", "sent_at", "n"}`，`sent_at` 是服务端发送时的毫秒时间戳，`n` 是序号
  - `narrative.done`：`{"chars"}`
  - `turn.completed`：`{"chars", "sha256", "events"}`
  - 服务关闭时改发 `turn.failed`：`{"code": "SHUTTING_DOWN", "retryable": true, "partial": true}`
- 流不存在或者缓冲已过期时返回 404 `NOT_FOUND`，客户端改用轮询。

### `GET /v1/probe/streams/{stream_id}`

查询探针的状态，也是 SSE 不可用时的轮询入口。

- 鉴权：不需要
- 成功：`200`，返回 `{"stream_id", "status", "chars_total", "chars_sent", "events", "sha256"}`。`status` 是 `running` / `completed` / `failed`；
  完成后多一个 `text` 字段（全文），用来核对拼接结果。
- 探针不存在时返回 404 `NOT_FOUND`。

### `GET /v1/probe/time`

服务端的当前时间，客户端用它估算时钟偏差、计算延迟。

- 鉴权：不需要
- 成功：`200`，返回 `{"server_time_ms": 1792000000000}`。
