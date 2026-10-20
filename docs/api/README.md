# 接口

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

这个目录说明服务端**已经实现**的全部接口（M1），内容以代码为准。完整的接口设计（包括还没做的回退、重新生成、会话通道）见 [backend.md 第 9 节](../backend.md)，
实现与设计的差异见 [backend.md 第 12 节](../backend.md)。非生产环境下，服务端在 `/docs` 提供交互式文档，OpenAPI 在 `/openapi.json`。

接口按领域分文件。每个领域文件写这个领域的接口，以及这些接口用到的请求模型和响应模型；本页写各领域共用的约定、一次完整的流程和全部错误码。

| 文件 | 领域 | 路径 |
| --- | --- | --- |
| [auth.md](auth.md) | 认证与账户 | `/v1/auth/*`、`/v1/me` |
| [models.md](models.md) | 服务商与模型路由（玩家配好的模型，含 Key 和端点） | `/v1/providers*`、`/v1/model-routes*` |
| [library.md](library.md) | 剧本库 | `/v1/scenarios*`、`/v1/blobs/*` |
| [play.md](play.md) | 游玩与回合 | `/v1/playthroughs*`、`/v1/turns/*` |
| [events.md](events.md) | 回合事件流（SSE）的格式 | `/v1/turns/{turn_id}/events` 推送的内容（接口本身在 play.md） |
| [ops.md](ops.md) | 运维与开发 | `/health`、`/ready`、`/v1/probe/*` |

`tests/unit/api/test_api_doc.py` 会把这个目录里的所有文件合在一起，对照 OpenAPI 检查：接口是否齐全、鉴权和成功状态码、查询参数和请求头、
每个请求和响应模型的字段（规则见本页最后的“维护”）。客户端手写的类型在 `packages/core/src/api/types.ts`，字段和各文件里的响应对象一一对应，要一起改。

## 约定

### 地址与格式

- 业务接口都在 `/v1` 下，运维接口 `/health`、`/ready` 在根路径。`/v1` 里只做向后兼容的增加，破坏性的变更放到 `/v2`。
- 请求和响应都是 JSON（UTF-8）。请求里多出的未知字段会被忽略。响应里的字段总会出现，可以为空的字段在类型里写成 `… / null`。
- ID 都是 UUID 字符串。路径里的 ID 不是合法的 UUID 时，直接返回 404。
- 时间是带时区的 ISO 8601 字符串（UTC），例如 `2026-10-14T08:00:00.123456Z`。

### 鉴权

- 除了注册、登录、刷新、退出和开发用的探针接口，其他 `/v1` 接口都要带 `Authorization: Bearer <access_token>`。
- 访问令牌是 JWT（HS256），默认 15 分钟过期（`ACCESS_TOKEN_TTL_S`）。客户端把它当作不透明的字符串使用，不要解析里面的内容。
- 令牌缺失、格式不对或已过期时返回 401 `UNAUTHENTICATED`。客户端的处理方式：用刷新令牌刷新一次，再重试原请求；刷新也返回 401 时，回到登录页。
- 刷新令牌（`rt_…`）默认 30 天过期，每次刷新都会换新的，规则见 [`POST /v1/auth/refresh`](auth.md#post-v1authrefresh)。
  App 把它放在响应体和请求体里；网页用 Cookie 模式（`X-Auth-Mode: cookie`），刷新令牌只在 HttpOnly Cookie 里，见 [auth.md 的“两种登录方式”](auth.md#两种登录方式)。
- 服务端校验访问令牌时不查数据库。账户删除后，已经签发的访问令牌在过期前仍能通过鉴权，但读到的列表都是空的、单个资源都是 404，写入会失败。

### 请求头

| 请求头 | 用在哪里 | 说明 |
| --- | --- | --- |
| `Authorization` | 需要鉴权的接口 | `Bearer <access_token>` |
| `Idempotency-Key` | `POST /v1/playthroughs/{playthrough_id}/turns` | 1 到 128 个字符，见 [play.md](play.md) 里这个接口的说明 |
| `Last-Event-ID` | 回合事件流、探针事件流 | 断线续传，见 [events.md](events.md) |
| `If-None-Match` | `GET /v1/blobs/{blob_id}` | 带上次拿到的 `ETag`，没有变化时返回 304 |
| `User-Agent` | 注册、登录、刷新 | 记在刷新令牌上，排错用 |
| `X-Auth-Mode` | 注册、登录、刷新、退出 | 只能是 `cookie`：网页用，刷新令牌放在 Cookie 里，见 [auth.md](auth.md#两种登录方式) |
| `X-Client-Version` | 客户端的每个请求 | 客户端版本号。M1 的服务端不检查它（设计里的 `CLIENT_TOO_OLD` 还没做），只记在访问日志里 |
| `X-Request-ID` | 任何请求（可选） | 请求单号，8 到 64 个字符，只能是字母、数字和 `. _ : -`。App 每个请求生成一个；没带或格式不对时服务端生成。服务端这次请求的所有日志都带着它，响应头 `X-Request-ID` 原样带回 |

### 错误

所有错误都按 RFC 9457 返回 `application/problem+json`（`/ready` 的 503 除外）：

```json
{
  "type": "/errors/turn-in-progress",
  "title": "The previous turn is still being written",
  "status": 409,
  "code": "TURN_IN_PROGRESS",
  "retryable": false,
  "active_turn_id": "6b1d…",
  "request_id": "9f2c4e1a7b3d4e5f…"
}
```

- `code` 是稳定的错误码，客户端按它判断，全部取值见下文“错误码”；`retryable` 表示原样重试有没有可能成功。
- `title` 是英文说明，不做多语言。客户端按 `code`（业务校验再看 `field`）显示界面语言的文字，没有对应翻译时英文界面才直接用 `title`（[i18n.md](../i18n.md) 第 3 节）。
- 有些错误带附加字段，例如上面的 `active_turn_id`。附加字段也列在“错误码”里。
- 请求体或参数不符合模型定义（缺字段、类型不对、超过长度限制、JSON 格式错误）时，返回 422 `VALIDATION_ERROR`，带 `errors` 字段：
  `[{ "loc": ["body", "email"], "msg": "…" }]`，最多 20 条。各模型的限制写在领域文件的字段表里。
- 服务端的业务校验没通过时也返回 422 `VALIDATION_ERROR`，但不带 `errors`。多数情况用 `field` 字段指出哪个字段有问题，例如 `"field": "password"`；
  行动本身的校验错误（见提交行动的接口）两个字段都不带，原因在 `title` 里。
- 访问别人的资源和资源不存在一样，都返回 404 `NOT_FOUND`，不暴露资源是否存在。注意参数格式之类的校验可能先于归属检查执行。
- 服务端未处理的异常返回 500 `INTERNAL_ERROR`，`retryable` 为真。
- 每个错误响应都带 `request_id`（请求单号，和响应头 `X-Request-ID` 相同），排错时拿它去服务端日志里查这次请求。

### 限流

按 60 秒的滑动窗口计数，计数在每个 api 进程里各自进行。超过上限返回 429 `RATE_LIMITED`，带 `Retry-After` 响应头和 `retry_after` 字段（秒）。

| 计数对象 | 默认上限（每分钟） | 适用的接口 |
| --- | --- | --- |
| 客户端 IP | 5（`RATE_LIMIT_AUTH_PER_MIN`），注册和登录分开计数 | `POST /v1/auth/register`、`POST /v1/auth/login` |
| 用户 | 30（`RATE_LIMIT_TURNS_PER_MIN`），两个接口共用一个计数 | `POST /v1/playthroughs`、`POST /v1/playthroughs/{playthrough_id}/turns` |
| 用户 | 5（`RATE_LIMIT_PROBE_PER_MIN`），两个接口各自计数 | `POST /v1/model-routes/{route_id}/probe`、`POST /v1/providers/{provider}/models` |

客户端 IP 取的是连接的对端地址；对端在 `FORWARDED_ALLOW_IPS`（默认 `127.0.0.1,::1`，可以写网段）里时，改用它带来的 `X-Forwarded-For`
里最后一个不受信任的地址，也就是代理看到的真实 IP。服务部署在反向代理后面时，要把代理的地址加进这个变量，否则所有玩家会共用代理的 IP 计数。
`deploy/docker-compose.yml` 已经加上了 Docker 的内网段（宿主机上的代理经 Docker 网关连进容器），见 [bugs/2026-10-16-login-rate-limit-behind-proxy.md](../bugs/2026-10-16-login-rate-limit-behind-proxy.md)。

### 请求体大小

请求体默认最大 1 MB，导入角色卡的接口最大 16 MB 加 256 KB（multipart 的边界和头部）。超过限制返回 413 `PAYLOAD_TOO_LARGE`。
检查在最外层的中间件里进行：有 `Content-Length` 的请求直接拒绝，分块上传边收边计数。

### 优雅退出

服务端收到退出信号后，`/ready` 返回 503；创建游玩和提交行动返回 503 `UNAVAILABLE`（`Retry-After: 5`）；正在推送的事件流会被主动断开，客户端重连到其他实例即可。
还没生成完的回合最多再等 `SHUTDOWN_GRACE_S`（默认 60 秒），到时没完成的回合以 `CANCELLED` 结束，可以重试。

## 一次完整的流程

1. `POST /v1/auth/register` 注册，拿到访问令牌和刷新令牌。（[auth.md](auth.md)）
2. `GET /v1/providers` 列出服务商，`POST /v1/providers/{provider}/models` 用刚填的 API Key 获取模型列表。（[models.md](models.md)）
3. `POST /v1/model-routes` 把 Key、端点、模型名一次保存，带 `"director": true` 设为导演。没有导演就不能开局。
4. 可以用 `POST /v1/model-routes/{route_id}/probe` 测一下这个模型；以后换导演用 `PATCH /v1/model-routes/{route_id}` 传 `"director": true`。
5. `POST /v1/scenarios/import` 上传角色卡（PNG 或 JSON）。（[library.md](library.md)）
6. `POST /v1/playthroughs` 开局，返回 202、游玩和开场回合。（[play.md](play.md)）
7. `GET /v1/turns/{turn_id}/events` 订阅开场回合的事件流：先是搭建世界的事件，然后是叙述增量、选项，最后是 `turn.completed`。（[events.md](events.md)）
8. 玩家选了一个选项（或自由输入）后，`POST /v1/playthroughs/{playthrough_id}/turns` 提交行动，带 `Idempotency-Key`，`parent_turn_id` 填当前的头部回合，返回 201；然后像第 7 步一样订阅事件流。
9. 重新打开 App 时，先调 `GET /v1/playthroughs/{playthrough_id}`：`active_turn` 不为空就订阅它的事件流，`last_failed` 不为空就显示“重试”，否则显示 `head` 的选项。历史回合用 `GET /v1/playthroughs/{playthrough_id}/turns` 分页读取。
10. 玩家想结束故事时，提交 `{"source": "ending", "text": "结局方向（可以不填）"}`。结局写完后游玩的 `status` 变成 `ended`，之后再提交行动返回 409 `STORY_ENDED`。

## 错误码

### 接口错误码

| code | HTTP | 含义 | 附加字段 |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | 请求体无法解析，例如损坏的 multipart（JSON 格式错误返回的是 422 `VALIDATION_ERROR`） |  |
| `UNAUTHENTICATED` | 401 | 缺少访问令牌、格式不对或已过期 |  |
| `INVALID_CREDENTIALS` | 401 / 403 | 登录时邮箱或密码不对（401）；删除账户时密码不对（403） |  |
| `REFRESH_INVALID` | 401 | 刷新令牌无效、已吊销或已过期 |  |
| `REFRESH_REUSED` | 401 | 用过的刷新令牌超过 30 秒后又出现，整个家族已被吊销 |  |
| `CROSS_SITE` | 403 | 网页的 Cookie 登录请求来自别的网站（`Sec-Fetch-Site` 不是同源，`Origin` 也不在 `CORS_ORIGINS` 里） |  |
| `NOT_FOUND` | 404 | 资源不存在，或者不属于你；路径不存在也是这个码 |  |
| `METHOD_NOT_ALLOWED` | 405 | 路径存在，但不支持这个方法 |  |
| `EMAIL_TAKEN` | 409 | 邮箱已经注册过 |  |
| `CREDENTIAL_UNREADABLE` | 409 | 模型的 Key 无法解密，需要重新填写 Key（测试、获取模型列表、复用 Key，以及开局、提交行动时解析导演都可能遇到） |  |
| `ROUTE_MISSING` | 409 | 还没有设置导演模型 |  |
| `TURN_IN_PROGRESS` | 409 | 上一轮还在生成 | `active_turn_id` |
| `STALE_PARENT` | 409 | `parent_turn_id` 不是当前头部 | `head_turn_id` |
| `OPENING_PENDING` | 409 | 开场还没完成就提交了行动 |  |
| `STORY_ENDED` | 409 | 这局已经写完结局，不能再提交行动 |  |
| `NOT_ON_TIMELINE` | 409 | 回退的目标回合不在当前故事线上 |  |
| `ALREADY_AT_TURN` | 409 | 回退的目标回合就是最新一回合 |  |
| `ROLLBACK_LIMIT_REACHED` | 409 | 这个存档的回退次数用完了 | `limit` |
| `CARD_CHANGED` | 409 | 保存角色卡时版本号对不上：在别处改过了 | `version`（当前的版本号） |
| `TURN_NOT_LOCAL` | 409 | 要停止的回合不在当前实例上 |  |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体或文件超过限制 |  |
| `VALIDATION_ERROR` | 422 | 参数不符合要求 | `errors`（模型校验）或 `field`（业务校验）；行动本身的校验错误两个都不带；探针接口用 `detail` |
| `ENDPOINT_NOT_ALLOWED` | 422 | 接口地址没有通过 SSRF 校验 | `reason` |
| `WINDOW_TOO_SMALL` | 422 | 模型的有效窗口小于 16000 | `model_window`、`cap`、`max_tokens`、`effective_window` |
| `CARD_INVALID` | 422 | 角色卡无法解析 |  |
| `IDEMPOTENCY_KEY_REUSED` | 422 | 同一个 `Idempotency-Key` 对应了不同的请求内容 |  |
| `OPENING_EXISTS` | 422 | `parent_turn_id` 是当前头部（已经有开场）时又请求生成开场 |  |
| `OPTION_NOT_FOUND` | 422 | `option_id` 不在父回合的选项里 |  |
| `CREDENTIAL_INVALID` | 424 | 获取模型列表时，服务商拒绝了这个 Key |  |
| `RATE_LIMITED` | 429 | 超过限流，`retryable` 为真 | `retry_after`（另有 `Retry-After` 响应头） |
| `INTERNAL_ERROR` | 500 | 服务端出错，`retryable` 为真 |  |
| `PROVIDER_ERROR` | 502 | 获取模型列表时服务商出错 | `error_class` |
| `UNAVAILABLE` | 503 | 服务正在重启，`retryable` 为真 | 响应头 `Retry-After` |

### 回合失败码

用在事件 `turn.failed` 的 `code` 和 [`TurnOut`](play.md#turnout) 的 `error.code` 里。`retryable` 为真时，客户端可以显示“重试”
（重试的方法见 [play.md](play.md) 里 `POST /v1/playthroughs/{playthrough_id}/turns` 的说明）。

| code | retryable | 含义 |
| --- | --- | --- |
| `PROVIDER_ERROR` | 多数为真 | 服务商出错：限流、繁忙、5xx、超时、连接断开、生成中途断流等可以重试；欠费、请求格式不被接受、不支持的功能不能重试 |
| `CREDENTIAL_INVALID` | 否 | 服务商拒绝了 Key，要去设置里检查 |
| `MODEL_NOT_FOUND` | 否 | 模型名不对 |
| `CONTENT_BLOCKED` | 否 | 被服务商的内容策略拦截 |
| `ENDPOINT_NOT_ALLOWED` | 否 | 接口地址在请求时没有通过 SSRF 校验 |
| `CONTEXT_TOO_LARGE` | 否 | 上下文装不进有效窗口（截断后重试也不行），建议换更大窗口的模型 |
| `ROUTE_MISSING` | 否 | 生成时发现导演模型已经被删除或取消 |
| `NARRATIVE_MISSING` | 是 | 模型这次没有写出叙述 |
| `GENERATION_TIMEOUT` | 是 | 导演这一段写的总时长超过上限（`DIRECTOR_TIMEOUT_S`，默认 600 秒），主动停下；已写出的部分存成草稿（`partial`） |
| `OUTPUT_TOO_LONG` | 是 | 导演写的正文超过字数上限（`max_tokens` × 8 个字符），说明模型没有按 `max_tokens` 停下，主动停下；已写出的部分存成草稿 |
| `CANCELLED` | 是 | 玩家停止了生成，或者服务在重启。生成中途租约丢失时，事件流里也是这个码，但库里记的是 `RUNNER_LOST`（已知问题） |
| `RUNNER_LOST` | 是 | 生成进程意外中止（租约过期后被清理），或者提交时发现租约已经被收回 |
| `INTERNAL_ERROR` | 是 | 服务端出错 |
| `TURN_ARCHIVED` | 否 | 这一轮已经被回退（M2 起，只出现在快照模式里） |

## 维护

- 改了接口的路径或方法、请求或响应模型、状态码、查询参数、请求头、SSE 事件、错误码时，在同一个改动里更新这个目录。
  如果客户端也要跟着变，同时改 `packages/core/src/api/types.ts`、`events.ts`。
- 新接口写进它所属领域的文件（按本页开头表格里的路径），放在“接口”下面；它用到的请求模型紧跟在接口后面，响应模型放在同一个文件的“响应对象”下面。
  几个领域共用的模型，放在主要使用它的那个文件里。
- 新领域（新的路由文件或新的路径前缀）：新建一个文件，格式照着现有的领域文件写，并在本页开头的表格和每个文件的导航行里加上它。
- 格式有测试依赖，要遵守：
  - 每个接口一节，标题里只写 `` `METHOD /path` ``，路径和代码里完全一致（包括 `/v1` 和 `{参数名}`）。节里要有“- 鉴权：需要”或“- 鉴权：不需要”一行，以及“- 成功：`状态码`”一行。
  - 每个请求模型和响应模型一节，标题里只写 `` `类名` ``，与 `apps/server/src/bettertavern/api/schemas/` 里的类同名。节里第一张以“字段”开头的表格，第一列是用反引号包起来的字段名；请求模型的表格多一列“必填”，填“是”或“否”。
  - 每个接口、每个模型在整个目录里只能写一次。
  - 其他标题不要写成只有一段行内代码的形式。
- `tests/unit/api/test_api_doc.py` 会从 OpenAPI 读出实际的接口和模型，然后检查：
  - 每个接口都有一节，也没有多出来的接口；
  - 鉴权行和成功状态码与代码一致；
  - 每个查询参数和接口专用的请求头都在该接口的那一节里出现；
  - 每个模型的字段不多不少；请求模型的必填项与代码一致。
- 测试检查不到的内容要靠评审：SSE 事件（[events.md](events.md)）、错误码（本页）、探针接口（不在 OpenAPI 里），以及各处的文字说明。
