# 接口：服务商与模型路由

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

玩家配好的模型（模型路由）：一个模型包括服务商、API Key、端点、模型名、上下文窗口和写法设置，其中一个是导演。
这里还有服务商列表、模型列表和“测试这个模型”。相关的表见 [数据模型：模型路由](../data-model/models.md)。

添加模型的典型流程：`GET /v1/providers` 选服务商 → `POST /v1/providers/{provider}/models` 用刚填的 Key 拉模型列表 →
`POST /v1/model-routes` 连同 Key、模型名一次保存，可以顺便设为导演。

## 接口

### `GET /v1/providers`

可以选择的服务商：DeepSeek、OpenAI、Grok（xAI）、Gemini、Hugging Face、自定义的 OpenAI 兼容端点（按这个顺序返回）。

- 鉴权：需要
- 成功：`200`，返回 [`ProviderOut`](#providerout) 数组。

### `POST /v1/providers/{provider}/models`

用还没保存的 Key（或者复用自己另一个模型的 Key）调用服务商的模型列表接口，添加模型的表单用。Key 只用于这一次请求，不保存；
列表在服务端缓存 10 分钟，随后用同一个 Key 保存模型时直接用它确定上下文窗口，不再请求一次。

- 鉴权：需要；按用户限流（和测试模型分开计数，上限相同）。
- 请求体：[`ModelListIn`](#modellistin)
- 成功：`200`，返回 [`ModelOut`](#modelout) 数组。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | `copy_key_from` 指向的模型不存在 |
| 409 | `CREDENTIAL_UNREADABLE` | `copy_key_from` 指向的模型的 Key 无法解密 |
| 422 | `VALIDATION_ERROR` | 不支持的服务商（`field: "provider"`）；没填 Key 也没指定复用（`field: "api_key"`）；复用的是别的服务商的 Key（`field: "copy_key_from"`）；需要接口地址却没填（`field: "base_url"`） |
| 422 | `ENDPOINT_NOT_ALLOWED` | 接口地址没有通过 SSRF 校验，带 `reason` |
| 424 | `CREDENTIAL_INVALID` | 服务商拒绝了这个 Key |
| 429 | `RATE_LIMITED` | 每分钟超过 5 次 |
| 502 | `PROVIDER_ERROR` | 服务商的其他错误，带 `error_class`（provider 层的错误类别）；`retryable` 按错误类别给出 |

#### `ModelListIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `api_key` | string / null | 否 | 新填的 Key，最多 4096 个字符，首尾空白会被去掉 |
| `copy_key_from` | string / null | 否 | 不填 `api_key` 时，复用自己哪个模型的 Key（还有它的自定义请求头）。必须是同一个服务商 |
| `base_url` | string / null | 否 | 接口地址，最长 500 个字符。不填就用服务商的默认地址；复用 Key 时不填就沿用那个模型的地址 |

### `GET /v1/model-routes`

我配好的全部模型，按添加时间升序排列。

- 鉴权：需要
- 成功：`200`，返回 [`RouteOut`](#routeout) 数组。

### `POST /v1/model-routes`

添加一个模型：Key、端点、模型名、窗口一次保存。保存时用服务商的模型列表确定上下文窗口：表单刚拉过列表就用缓存，
没有缓存就当场拉一次（最多等 15 秒）；拉不到也照样保存，`status` 为 `unverified`。

- 鉴权：需要
- 请求体：[`RouteIn`](#routein)
- 成功：`201`，返回 [`RouteOut`](#routeout)。拉到了列表时 `status` 为 `ok`，否则为 `unverified`。
- `director` 为真时同时设为导演，原来的导演不再是导演。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | `copy_key_from` 指向的模型不存在 |
| 409 | `CREDENTIAL_UNREADABLE` | `copy_key_from` 指向的模型的 Key 无法解密 |
| 422 | `VALIDATION_ERROR` | 字段为空或超过长度限制（带 `errors`）；不支持的服务商（`field: "provider"`）；模型名只有空白（`field: "model"`）；没填 Key 也没指定复用（`field: "api_key"`）；复用的是别的服务商的 Key（`field: "copy_key_from"`）；需要接口地址却没填（`field: "base_url"`）；手填窗口超出范围（`field: "manual_window"`）；参数超出范围（`field` 形如 `"params.temperature"`）；能力覆盖不合法或写了 `context_window`（`field: "caps_override"`）；自定义请求头或请求体不合法（`field: "extra_headers"` / `"extra_body"`） |
| 422 | `ENDPOINT_NOT_ALLOWED` | 接口地址没有通过 SSRF 校验，带 `reason`。只允许公网的 https 地址；服务端开了 `ALLOW_PRIVATE_ENDPOINTS` 时，也允许 http 和内网地址 |
| 422 | `WINDOW_TOO_SMALL` | 有效窗口小于 16000，带 `model_window`、`cap`、`max_tokens`、`effective_window` |

#### `RouteIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | 是 | 服务商，取 `GET /v1/providers` 返回的 `id` |
| `model` | string | 是 | 模型名，1 到 200 个字符，原样发给服务商 |
| `label` | string | 否 | 显示名，最多 60 个字符；不填时界面显示模型名 |
| `api_key` | string / null | 否 | API Key，最多 4096 个字符，首尾空白会被去掉。加密保存，之后只返回后四位。和 `copy_key_from` 二选一 |
| `copy_key_from` | string / null | 否 | 复用自己哪个模型的 Key（还有它的自定义请求头，除非这次另外给了 `extra_headers`）。必须是同一个服务商 |
| `base_url` | string / null | 否 | 接口地址，最长 500 个字符。不填就用服务商的默认地址（复用 Key 时沿用那个模型的地址）；`requires_base_url` 为真的服务商必须填写 |
| `extra_headers` | object / null | 否 | 自定义请求头 `{名字: 值}`，最多 20 个；不能设置 `Authorization`、`Host`、`Content-Length`、`Transfer-Encoding`、`Connection`、`Cookie`；值最长 2000 个字符，不能含换行。加密保存，之后只返回名字 |
| `extra_body` | object / null | 否 | 合并进每个请求体的字段，序列化后最大 8 KB。合并规则见 [数据模型：`model_routes.extra_body`](../data-model/models.md#model_routesextra_body) |
| `manual_window` | integer / null | 否 | 手填的上下文窗口，4096 到 10000000。只在服务商列表和内置能力表都不知道这个模型的窗口时使用；都不知道又没填时按 32768 估计 |
| `params` | [`RouteParamsIn`](#routeparamsin) | 否 | 写法设置，不传就全部用默认值 |
| `caps_override` | object | 否 | 手动覆盖模型能力，允许的键见 [数据模型：`model_routes.caps_override`](../data-model/models.md#model_routescaps_override)；默认 `{}` |
| `director` | boolean | 否 | 是否同时设为导演，默认 `false` |

#### `RouteParamsIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `temperature` | number / null | 否 | 0 到 2；不设置时按用途取默认值 |
| `top_p` | number / null | 否 | 大于 0，不超过 1 |
| `max_tokens` | integer / null | 否 | 64 到 65536；不设置时按用途取默认值 |
| `thinking` | boolean | 否 | 是否开启深度思考，默认 `false` |
| `working_window` | integer / null | 否 | 工作窗口上限，4096 到 10000000，默认 128000 |

各用途的默认值见 [数据模型：`model_routes.params`](../data-model/models.md#model_routesparams)。

### `GET /v1/model-routes/{route_id}`

单个模型，包括最近一次测试的结果。

- 鉴权：需要
- 成功：`200`，返回 [`RouteOut`](#routeout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 模型不存在 |

### `PATCH /v1/model-routes/{route_id}`

修改一个模型，只改请求里给出的字段。修改了 Key、端点或模型名时，`status` 重置为 `unverified`、清空测试结果；
改了端点或模型名还会丢掉列表给的窗口和运行中学到的窗口，然后像添加时一样重新拉一次列表。

- 鉴权：需要
- 请求体：[`RoutePatchIn`](#routepatchin)
- 成功：`200`，返回 [`RouteOut`](#routeout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 模型不存在；`fallback_route_id` 指向的模型不存在 |
| 409 | `CREDENTIAL_UNREADABLE` | 要重新拉列表或一起换 Key 时，Key 无法解密 |
| 422 | `VALIDATION_ERROR` | 同添加模型；另外，需要接口地址的服务商不能把 `base_url` 清空；备用模型是它自己（`field: "fallback_route_id"`） |
| 422 | `ENDPOINT_NOT_ALLOWED` | 新的接口地址没有通过校验，带 `reason` |
| 422 | `WINDOW_TOO_SMALL` | 改完之后有效窗口小于 16000 |

#### `RoutePatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | string / null | 否 | 新的显示名；空串表示清空（界面显示模型名） |
| `model` | string / null | 否 | 新的模型名 |
| `api_key` | string / null | 否 | 新的 Key；不传或传空串表示不改 |
| `apply_to_same_key` | boolean | 否 | 换 Key 时，把用同一个旧 Key 的其他模型（见 `RouteOut.shares_key_with`）也换成新 Key，默认 `false` |
| `base_url` | string / null | 否 | 新的接口地址；传空串表示恢复为服务商的默认地址 |
| `extra_headers` | object / null | 否 | 整体替换自定义请求头；传 `{}` 表示清空，不传表示不改 |
| `extra_body` | object / null | 否 | 整体替换自定义请求体字段；传 `{}` 表示清空，不传表示不改 |
| `manual_window` | integer / null | 否 | 手填的上下文窗口；传 null 表示清空，不传表示不改 |
| `params` | [`RouteParamsIn`](#routeparamsin) / null | 否 | 整体替换写法设置：没写的键恢复默认值 |
| `caps_override` | object / null | 否 | 整体替换能力覆盖 |
| `director` | boolean / null | 否 | 为真时设为导演（原来的导演不再是导演）；为假时如果它是导演就取消，之后没有导演 |
| `fallback_route_id` | string / null | 否 | 备用模型，必须是自己的另一个模型；传 null 表示去掉，不传表示不改 |

### `DELETE /v1/model-routes/{route_id}`

删除一个模型。把它当作备用模型的其他模型，备用模型变为空。删掉的是导演时就没有导演了，重新设置之前开局和提交行动会返回 409 `ROUTE_MISSING`。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 模型不存在 |

### `POST /v1/model-routes/{route_id}/probe`

测试这个模型实际支持哪些能力。服务端会向服务商发 4 到 5 个很小的请求，检查项见 [`ProbeCheckOut`](#probecheckout)。

- 鉴权：需要；按用户限流。
- 成功：`200`，返回 [`ProbeOut`](#probeout)。即使出现致命错误（Key 无效、模型不存在等）也返回 200，要看 `fatal_error`。
- 结果保存在这个模型上（`last_probe`），之后按测试结果确定能力。
- 状态的变化：没有致命错误时变为 `ok`；致命错误属于 `auth` 类时变为 `invalid`；其他致命错误不改变状态。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 模型不存在 |
| 409 | `CREDENTIAL_UNREADABLE` | Key 无法解密（服务端换了主密钥却没有保留旧的），需要重新填写 Key |
| 429 | `RATE_LIMITED` | 每分钟超过 5 次 |

### `GET /v1/model-routes/{route_id}/models`

用这个模型已存的 Key 重新拉服务商的模型列表（换模型名时用）。列表里有这个模型的窗口时，顺便更新它；获取成功时状态变为 `ok`。

- 鉴权：需要
- 成功：`200`，返回 [`ModelOut`](#modelout) 数组。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 模型不存在 |
| 409 | `CREDENTIAL_UNREADABLE` | Key 无法解密 |
| 424 | `CREDENTIAL_INVALID` | 服务商拒绝了这个 Key，状态同时变为 `invalid` |
| 502 | `PROVIDER_ERROR` | 服务商的其他错误，带 `error_class` |

## 响应对象

### `ProviderOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `deepseek` / `openai` / `xai` / `gemini` / `huggingface` / `custom_openai` |
| `display_name` | string | 显示名，例如 `DeepSeek` |
| `default_base_url` | string / null | 默认的接口地址：DeepSeek 是 `https://api.deepseek.com`，OpenAI 是 `https://api.openai.com/v1`，Grok 是 `https://api.x.ai/v1`，Gemini 是 `https://generativelanguage.googleapis.com/v1beta/openai`，Hugging Face 是 `https://router.huggingface.co/v1`，自定义端点为 null |
| `requires_base_url` | boolean | 为真时必须填 `base_url`（自定义端点） |

### `ModelOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 模型名，填进 `RouteIn.model` |
| `context_window` | integer / null | 上下文长度；Hugging Face 的模型有几家后端时是其中最小的。服务商和内置能力表都不知道时为 null |
| `window_source` | string / null | `context_window` 从哪来：`listed`（服务商的列表）、`table`（列表没给，内置能力表知道）；为 null 时表单要让玩家填窗口 |
| `owned_by` | string / null | 模型的所有者 |

### `RouteOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 模型路由的 ID |
| `label` | string | 显示名；为空时界面显示 `model` |
| `provider` | string | 服务商 |
| `model` | string | 模型名 |
| `base_url` | string / null | 自定义的接口地址；null 表示用服务商的默认地址 |
| `key_last4` | string | Key 的后四位；Key 短于 8 个字符时为空串。完整的 Key 不会返回 |
| `extra_header_names` | array of string | 自定义请求头的名字，按字母排序；值不会返回 |
| `extra_body` | object | 自定义请求体字段 |
| `manual_window` | integer / null | 手填的上下文窗口 |
| `params` | object | 写法设置，只包含设置过的键（`thinking` 总会出现），键同 [`RouteParamsIn`](#routeparamsin) |
| `caps_override` | object | 手动覆盖的能力 |
| `status` | string | `unverified` / `ok` / `invalid`，变化规则见 [数据模型：状态](../data-model/models.md#状态) |
| `last_ok_at` | string（时间）/ null | 最近一次确认 Key 可用的时间 |
| `last_probe` | [`ProbeOut`](#probeout) / null | 最近一次测试的结果；没测过，或者之后改了 Key、端点、模型名时为 null |
| `is_director` | boolean | 是不是导演 |
| `fallback_route_id` | string / null | 备用模型 |
| `shares_key_with` | array of string | 和它用同一个 Key 的其他模型的 ID（换 Key 时可以一起换） |
| `window` | [`WindowOut`](#windowout) | 按当前设置算出的窗口 |
| `created_at` | string（时间） | 添加时间 |
| `updated_at` | string（时间） | 最近修改时间 |

### `WindowOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model_window` | integer | 模型窗口 M，取值顺序见 [数据模型：上下文窗口](../data-model/models.md#上下文窗口) |
| `source` | string | M 从哪来：`listed`（服务商的列表）、`table`（内置能力表）、`manual`（手填）、`learned`（运行中服务商报超长时写明的上限）、`default`（都不知道，按 32768 估计） |
| `working_cap` | integer | 工作窗口上限 C：`params.working_window`，默认 128000 |
| `max_tokens` | integer | 预留给输出的 token 数：`params.max_tokens`，没设置时取导演的默认值 |
| `effective_window` | integer | 有效窗口 W = ⌊min(M, C) − max_tokens − 0.02 × min(M, C)⌋，最小为 0。W 小于 16000 时不能保存 |
| `warnings` | array of string | `WINDOW_CLAMPED`：C 大于 M，实际按 M 计算 |

### `ProbeOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `provider` | string | 服务商 |
| `model` | string | 模型名 |
| `probed_at` | string | 测试时间（ISO 8601） |
| `fatal_error` | string / null | Key、模型或端点不可用时的错误，格式是 `类别: 说明`，例如 `auth: Invalid API key`。出现致命错误后，剩下的检查都不再执行 |
| `checks` | array of [`ProbeCheckOut`](#probecheckout) | 各项检查的结果 |
| `caps_overlay` | object | 根据检查结果得出的能力：`structured`（可用的结构化输出方式）、`stream_usage`（流式输出里有没有用量）。只包含真正测到的项 |

### `ProbeCheckOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 检查项：`stream`（流式输出）、`stream_usage`（流式用量）、`json_object`、`json_schema`、`tool_call`（三种结构化输出），以及模型支持思考开关时的 `reasoning_toggle` |
| `ok` | boolean / null | 是否通过；null 表示没有测（前面已经出现了致命错误） |
| `detail` | string | 说明 |
| `latency_ms` | integer / null | 这项检查的耗时（毫秒） |
