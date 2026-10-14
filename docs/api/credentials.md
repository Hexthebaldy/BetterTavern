# 接口：服务商、凭据与模型路由

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [凭据与模型路由](credentials.md) · [剧本库](library.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

玩家的模型密钥与端点（凭据）、能力探测、模型列表，以及每个 task 用哪个模型（模型路由）。
相关的表见 [数据模型：凭据与模型路由](../data-model/credentials.md)。

## 接口

### `GET /v1/providers`

可以选择的服务商：DeepSeek、Hugging Face、自定义的 OpenAI 兼容端点。

- 鉴权：需要
- 成功：`200`，返回 [`ProviderOut`](#providerout) 数组。

### `GET /v1/credentials`

我的全部凭据，按创建时间升序排列。

- 鉴权：需要
- 成功：`200`，返回 [`CredentialOut`](#credentialout) 数组。

### `POST /v1/credentials`

添加一个凭据（API Key 和接口地址）。这个接口不会请求服务商；Key 能不能用，要靠获取模型列表或探测来确认。

- 鉴权：需要
- 请求体：[`CredentialIn`](#credentialin)
- 成功：`201`，返回 [`CredentialOut`](#credentialout)，`status` 为 `unverified`。

| HTTP | code | 情形 |
| --- | --- | --- |
| 422 | `VALIDATION_ERROR` | 字段为空或超过 `CredentialIn` 的长度限制（带 `errors`）；不支持的服务商（`field: "provider"`）；Key 只有空白（`field: "api_key"`）；需要接口地址却没填（`field: "base_url"`）；自定义请求头或请求体不合法（`field: "extra_headers"` / `"extra_body"`） |
| 422 | `ENDPOINT_NOT_ALLOWED` | 接口地址没有通过 SSRF 校验，带 `reason`。只允许公网的 https 地址；服务端开了 `ALLOW_PRIVATE_ENDPOINTS` 时，也允许 http 和内网地址 |

#### `CredentialIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | 是 | 服务商，取 `GET /v1/providers` 返回的 `id` |
| `label` | string | 否 | 显示名，最多 60 个字符；不填时用服务商的名字 |
| `api_key` | string | 是 | API Key，1 到 4096 个字符，首尾空白会被去掉。加密保存，之后只返回后四位 |
| `base_url` | string / null | 否 | 接口地址，最长 500 个字符。不填就用服务商的默认地址；`requires_base_url` 为真的服务商必须填写 |
| `extra_headers` | object / null | 否 | 自定义请求头 `{名字: 值}`，最多 20 个；不能设置 `Authorization`、`Host`、`Content-Length`、`Transfer-Encoding`、`Connection`、`Cookie`；值最长 2000 个字符，不能含换行。加密保存，之后只返回名字 |
| `extra_body` | object / null | 否 | 合并进每个请求体的字段，序列化后最大 8 KB。合并规则见 [数据模型：`credentials.extra_body`](../data-model/credentials.md#credentialsextra_body) |

### `GET /v1/credentials/{credential_id}`

单个凭据，包括测试过的模型。

- 鉴权：需要
- 成功：`200`，返回 [`CredentialOut`](#credentialout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 凭据不存在 |

### `PATCH /v1/credentials/{credential_id}`

修改凭据，只改请求里给出的字段。以下情况会把 `status` 重置为 `unverified`，并清空探测结果和从模型列表学到的上下文长度：
修改了 `api_key`；`base_url` 改成了不同的地址；`base_url` 传了空串（即使原来就是默认地址）。

- 鉴权：需要
- 请求体：[`CredentialPatchIn`](#credentialpatchin)
- 成功：`200`，返回 [`CredentialOut`](#credentialout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 凭据不存在 |
| 422 | `VALIDATION_ERROR` | 同创建凭据；另外，需要接口地址的服务商不能把 `base_url` 清空 |
| 422 | `ENDPOINT_NOT_ALLOWED` | 新的接口地址没有通过校验，带 `reason` |

#### `CredentialPatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | string / null | 否 | 新的显示名；空串表示不改 |
| `api_key` | string / null | 否 | 新的 Key；不传或传空串表示不改 |
| `base_url` | string / null | 否 | 新的接口地址；传空串表示恢复为服务商的默认地址 |
| `extra_headers` | object / null | 否 | 整体替换自定义请求头；传 `{}` 表示清空，不传表示不改 |
| `extra_body` | object / null | 否 | 整体替换自定义请求体字段；传 `{}` 表示清空，不传表示不改 |

### `DELETE /v1/credentials/{credential_id}`

删除凭据，同时删除用到它的模型路由（包括导演路由）。重新配置路由之前，开局和提交行动会返回 409 `ROUTE_MISSING`。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 凭据不存在 |

### `POST /v1/credentials/{credential_id}/probe`

测试一个模型实际支持哪些能力。服务端会向服务商发 4 到 5 个很小的请求，检查项见 [`ProbeCheckOut`](#probecheckout)。

- 鉴权：需要；按用户限流。
- 请求体：[`ProbeIn`](#probein)
- 成功：`200`，返回 [`ProbeOut`](#probeout)。即使出现致命错误（Key 无效、模型不存在等）也返回 200，要看 `fatal_error`。
- 探测结果保存在凭据上（`probed_models`），之后这个模型的路由按探测结果确定能力。
- 凭据状态的变化：没有致命错误时变为 `ok`；致命错误属于 `auth` 类时变为 `invalid`；其他致命错误不改变状态。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 凭据不存在 |
| 409 | `CREDENTIAL_UNREADABLE` | 凭据无法解密（服务端换了主密钥却没有保留旧的），需要重新填写 Key |
| 422 | `VALIDATION_ERROR` | 模型名为空或太长 |
| 429 | `RATE_LIMITED` | 每分钟超过 5 次 |

#### `ProbeIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 模型名，1 到 200 个字符 |

### `GET /v1/credentials/{credential_id}/models`

调用服务商的模型列表接口。列表里带了上下文长度的模型（Hugging Face 会给），长度会记在凭据上，之后计算窗口时使用。获取成功时凭据状态变为 `ok`。

- 鉴权：需要
- 成功：`200`，返回 [`ModelOut`](#modelout) 数组。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 凭据不存在 |
| 409 | `CREDENTIAL_UNREADABLE` | 凭据无法解密 |
| 424 | `CREDENTIAL_INVALID` | 服务商拒绝了这个 Key，凭据状态同时变为 `invalid` |
| 502 | `PROVIDER_ERROR` | 服务商的其他错误，带 `error_class`（provider 层的错误类别）；`retryable` 按错误类别给出 |

### `GET /v1/model-routes`

我的用户级模型路由，按 task 排序。每条路由都带按当前能力算出的窗口（`window`）。

- 鉴权：需要
- 成功：`200`，返回 [`RouteOut`](#routeout) 数组。

### `PUT /v1/model-routes/{task}`

设置某个 task 用哪个凭据的哪个模型。没有就创建，已有就整体替换：没传的 `params`、`caps_override` 会恢复为默认值。这个接口不会调用服务商。

- 鉴权：需要
- 路径参数 `task`：`director` / `state_keeper` / `outline` / `compactor` / `gate` / `world_builder` / `repair`。
  M1 实际用到三个：`director`（导演）、`world_builder`（开局搭建世界）、`repair`（补选项）。没有单独配置的 task 都用导演的路由。
- 请求体：[`RouteIn`](#routein)
- 成功：`200`，返回 [`RouteOut`](#routeout)。
- 保存前会检查：凭据和备用路由都属于自己；备用路由不是这个 task 自己的用户级路由；参数在范围内；能力覆盖只用了允许的键；有效窗口不小于 16000。窗口的算法见 [`WindowOut`](#windowout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 未知的 task；凭据不存在；备用路由不存在 |
| 422 | `VALIDATION_ERROR` | 模型名为空或太长（带 `errors`），或者只有空白（`field: "model"`）；参数超出范围（`field` 形如 `"params.temperature"`）；能力覆盖不合法（`field: "caps_override"`）；备用路由就是它自己（`field: "fallback_route_id"`） |
| 422 | `WINDOW_TOO_SMALL` | 有效窗口小于 16000，带 `model_window`、`cap`、`max_tokens`、`effective_window` |

#### `RouteIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `credential_id` | string | 是 | 使用哪个凭据 |
| `model` | string | 是 | 模型名，1 到 200 个字符，原样发给服务商 |
| `params` | [`RouteParamsIn`](#routeparamsin) | 否 | 采样参数，不传就全部用默认值 |
| `caps_override` | object | 否 | 手动覆盖模型能力，允许的键见 [数据模型：`model_routes.caps_override`](../data-model/credentials.md#model_routescaps_override)；默认 `{}` |
| `fallback_route_id` | string / null | 否 | 备用路由的 id，必须是自己的路由。只有导演使用：导演在输出第一段文字之前失败，并且错误类别允许切换（限流、繁忙、5xx、超时、连接错误、欠费、无效响应、未知错误）时，改用这条路由 |

#### `RouteParamsIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `temperature` | number / null | 否 | 0 到 2；不设置时按 task 取默认值 |
| `top_p` | number / null | 否 | 大于 0，不超过 1 |
| `max_tokens` | integer / null | 否 | 64 到 65536；不设置时按 task 取默认值 |
| `thinking` | boolean | 否 | 是否开启思考，默认 `false` |
| `working_window` | integer / null | 否 | 工作窗口上限，4096 到 10000000，默认 128000 |

各 task 的默认值见 [数据模型：`model_routes.params`](../data-model/credentials.md#model_routesparams)。

### `DELETE /v1/model-routes/{task}`

删除这个 task 的用户级路由。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 未知的 task，或者这个 task 没有配置路由 |

## 响应对象

### `ProviderOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `deepseek` / `huggingface` / `custom_openai` |
| `display_name` | string | 显示名，例如 `DeepSeek` |
| `default_base_url` | string / null | 默认的接口地址：DeepSeek 是 `https://api.deepseek.com`，Hugging Face 是 `https://router.huggingface.co/v1`，自定义端点为 null |
| `requires_base_url` | boolean | 为真时创建凭据必须填 `base_url`（自定义端点） |

### `CredentialOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 凭据 ID |
| `provider` | string | 服务商 |
| `label` | string | 显示名 |
| `base_url` | string / null | 自定义的接口地址；null 表示用服务商的默认地址 |
| `key_last4` | string | Key 的后四位；Key 短于 8 个字符时为空串。完整的 Key 不会返回 |
| `extra_header_names` | array of string | 自定义请求头的名字，按字母排序；值不会返回 |
| `extra_body` | object | 自定义请求体字段 |
| `status` | string | `unverified` / `ok` / `invalid`，变化规则见 [数据模型：凭据的状态](../data-model/credentials.md#状态) |
| `last_ok_at` | string（时间）/ null | 最近一次探测或获取模型列表成功的时间 |
| `probed_models` | array of [`ProbedModelOut`](#probedmodelout) | 测试过的模型，按模型名排序 |
| `created_at` | string（时间） | 创建时间 |
| `updated_at` | string（时间） | 最近修改时间 |

### `ProbedModelOut`

凭据上保存的单个模型的探测结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 模型名 |
| `probed_at` | string | 探测时间（ISO 8601） |
| `ok` | boolean | 有没有致命错误；没有就为真 |
| `fatal_error` | string / null | 致命错误，格式是 `类别: 说明`，例如 `auth: Invalid API key` |
| `checks` | array of object | 各项检查的结果，结构同 [`ProbeCheckOut`](#probecheckout) |

### `ProbeOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `provider` | string | 服务商 |
| `model` | string | 模型名 |
| `probed_at` | string | 探测时间（ISO 8601） |
| `fatal_error` | string / null | 凭据、模型或端点不可用时的错误，格式是 `类别: 说明`。出现致命错误后，剩下的检查都不再执行 |
| `checks` | array of [`ProbeCheckOut`](#probecheckout) | 各项检查的结果 |
| `caps_overlay` | object | 根据检查结果得出的能力：`structured`（可用的结构化输出方式）、`stream_usage`（流式输出里有没有用量）。只包含真正测到的项 |

### `ProbeCheckOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 检查项：`stream`（流式输出）、`stream_usage`（流式用量）、`json_object`、`json_schema`、`tool_call`（三种结构化输出），以及模型支持思考开关时的 `reasoning_toggle` |
| `ok` | boolean / null | 是否通过；null 表示没有测（前面已经出现了致命错误） |
| `detail` | string | 说明 |
| `latency_ms` | integer / null | 这项检查的耗时（毫秒） |

### `ModelOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 模型名，填进路由的 `model` |
| `context_window` | integer / null | 上下文长度；服务商没给时为 null |
| `owned_by` | string / null | 模型的所有者 |

### `RouteOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 路由 ID，可以作为别的路由的 `fallback_route_id` |
| `task` | string | 用途 |
| `credential_id` | string | 使用的凭据 |
| `provider` | string | 凭据的服务商 |
| `credential_label` | string | 凭据的显示名 |
| `model` | string | 模型名 |
| `params` | object | 保存的参数，只包含设置过的键（`thinking` 总会出现），键同 [`RouteParamsIn`](#routeparamsin) |
| `caps_override` | object | 手动覆盖的能力 |
| `fallback_route_id` | string / null | 备用路由 |
| `window` | [`WindowOut`](#windowout) | 按当前能力算出的窗口 |
| `updated_at` | string（时间） | 最近修改时间 |

### `WindowOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model_window` | integer | 模型窗口 M：能力里的 `context_window`（能力表、模型列表、探测结果和手动覆盖综合得出），未知时按 32768 计算 |
| `working_cap` | integer | 工作窗口上限 C：`params.working_window`，默认 128000 |
| `max_tokens` | integer | 预留给输出的 token 数：`params.max_tokens`，没设置时取 task 的默认值 |
| `effective_window` | integer | 有效窗口 W = ⌊min(M, C) − max_tokens − 0.02 × min(M, C)⌋，最小为 0。W 小于 16000 的路由不能保存 |
| `warnings` | array of string | `WINDOW_CLAMPED`：C 大于 M，实际按 M 计算 |
