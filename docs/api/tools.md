# 接口：外部服务

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

工作台的 agent 联网和出图用的外部服务：网页搜索（含搜图）、读网页的服务商（可选）、文生图（生成封面）。和模型路由分开配：
模型那边的上下文窗口、能力表、导演这些和外部服务无关。设计见 [workbench.md 第 5、6 节](../workbench.md)，表见 [数据模型：外部服务](../data-model/tools.md)。

- **搜索**（`search`）：Tavily、Brave、SearXNG（自己架，不用 Key，要填地址）、博查。没配时 agent 没有搜索工具，只能按模型自己知道的写；
- **读网页**（`fetch`）：默认由服务器自己读，不用配；配了 Tavily 或 Jina Reader 时，自己读不出来（页面靠 JS 渲染、被网站拒绝）就换它再读；
- **文生图**（`image`）：按接口协议接，不按厂家接：`openai_images`（OpenAI 的 gpt-image、硅基流动、豆包 Seedream 和各种中转）、
  `openai_chat`（用对话接口出图，例如 OpenRouter 上的图像模型）、`gemini`（Gemini 原生接口）。没配时封面用搜到的公有领域的图、用户上传的图，或者客户端画的几何封面。

每一种（`kind`）可以配几个，其中一个是默认（第一次添加的自动是默认），agent 和封面面板用默认的那个。

## 接口

### `GET /v1/tool-providers`

能选哪些服务商和协议、各自要填什么。设置页用。

- 鉴权：需要
- 成功：`200`，返回 [`ToolProviderOut`](#toolproviderout) 数组。

### `GET /v1/tool-routes`

我配好的外部服务，按种类、添加时间排列。Key 只返回后四位。

- 鉴权：需要
- 成功：`200`，返回 [`ToolRouteOut`](#toolrouteout) 数组。

### `POST /v1/tool-routes`

添加一个外部服务。Key 用和模型 Key 一样的信封加密存；地址写入前做防内网访问检查（和模型端点的规则一样）。

- 鉴权：需要
- 请求体：[`ToolRouteIn`](#toolroutein)
- 成功：`201`，返回 [`ToolRouteOut`](#toolrouteout)，`status` 为 `unverified`。

| HTTP | code | 情形 |
| --- | --- | --- |
| 422 | `VALIDATION_ERROR` | 不认识的服务商或协议、这个服务商不支持这一种（`field: "provider"`）；要 Key 没填（`field: "api_key"`）；要地址没填（`field: "base_url"`）；文生图没填模型名（`field: "model"`）；参数或 `extra_body` 超过 8 KB（`field: "params"`） |
| 422 | `ENDPOINT_NOT_ALLOWED` | 地址没有通过防内网访问检查，带 `reason` |

#### `ToolRouteIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | string | 是 | `search` / `fetch` / `image` |
| `provider` | string | 是 | 搜索、读网页填服务商（`tavily` / `brave` / `searxng` / `bocha` / `jina`），文生图填协议（`openai_images` / `openai_chat` / `gemini`），见 `GET /v1/tool-providers` |
| `label` | string | 否 | 显示名，最多 60 个字符 |
| `api_key` | string / null | 否 | Key；`needs_key` 的服务必填 |
| `base_url` | string / null | 否 | 接口地址；SearXNG 和 `openai_chat` 必填，其他不填用服务商的默认地址 |
| `model` | string / null | 否 | 文生图的模型名，文生图必填 |
| `params` | object | 否 | 搜索：`country`、`language`、`search_lang`、`safesearch`；文生图：`sizes`（画幅对应的尺寸，例如 `{"portrait": "1024x1536"}`）、`extra_body`（并进请求体的自定义字段）。整体最大 8 KB |
| `default` | boolean | 否 | 设为这一种的默认，默认否（这一种还没有默认时自动是） |

### `PATCH /v1/tool-routes/{route_id}`

只改传了的字段。改了 Key、地址或模型名以后 `status` 回到 `unverified`。

- 鉴权：需要
- 请求体：[`ToolRoutePatchIn`](#toolroutepatchin)
- 成功：`200`，返回 [`ToolRouteOut`](#toolrouteout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 不存在 |
| 422 | `VALIDATION_ERROR` | 同 `POST /v1/tool-routes` |
| 422 | `ENDPOINT_NOT_ALLOWED` | 地址没有通过防内网访问检查 |

#### `ToolRoutePatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | string / null | 否 | 显示名 |
| `api_key` | string / null | 否 | 新的 Key；不传或空串表示不改 |
| `base_url` | string / null | 否 | 新的地址；空串表示清空（用服务商的默认地址） |
| `model` | string / null | 否 | 新的模型名 |
| `params` | object / null | 否 | 新的参数（整个替换） |
| `default` | boolean / null | 否 | 为真时设为这一种的默认；为假时如果它是默认就取消 |

### `DELETE /v1/tool-routes/{route_id}`

删掉一个外部服务。删的是默认的，同一种里最早添加的那个自动成为默认。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 不存在 |

### `POST /v1/tool-routes/{route_id}/test`

测试一下：搜索搜一个词，读网页读一个页面，文生图出一张小图（要花一点钱）。最多 60 秒。结果记进 `probe`，`status` 变成 `ok` 或 `invalid`。没有请求体。

- 鉴权：需要
- 成功：`200`，返回 [`ToolRouteOut`](#toolrouteout)。服务商出错不算接口出错：看 `status` 和 `probe`。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 不存在 |
| 409 | `CREDENTIAL_UNREADABLE` | Key 无法解密（服务器的主密钥换过），要重新填 Key |

## 响应对象

### `ToolProviderOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 服务商或协议的名字，填进 `provider` |
| `kinds` | array of string | 能用作哪几种：`search`、`fetch`、`image` |
| `can_search` | boolean | 能不能搜索 |
| `can_images` | boolean | 能不能搜图 |
| `can_fetch` | boolean | 能不能读网页 |
| `needs_key` | boolean | 要不要 Key |
| `needs_base_url` | boolean | 要不要填地址 |
| `needs_model` | boolean | 要不要填模型名（文生图） |
| `max_references` | integer | 文生图最多能带几张参考图；0 表示不支持 |

### `ToolRouteOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | ID |
| `kind` | string | `search` / `fetch` / `image` |
| `provider` | string | 服务商或协议 |
| `label` | string | 显示名 |
| `base_url` | string / null | 地址；为 null 时用服务商的默认地址 |
| `key_last4` | string | Key 的后四位（Key 太短时是空串） |
| `has_key` | boolean | 填了 Key 没有 |
| `model` | string / null | 文生图的模型名 |
| `params` | object | 参数 |
| `status` | string | `unverified` / `ok` / `invalid` |
| `probe` | object | 最近一次测试的结果：`{"ok", "detail", "latency_ms", "tested_at"}`；没测过是空对象 |
| `is_default` | boolean | 是不是这一种的默认 |
| `created_at` | string（时间） | 添加时间 |
| `updated_at` | string（时间） | 最近修改时间 |
