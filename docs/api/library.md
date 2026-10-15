# 接口：剧本库

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

导入角色卡、管理剧本，以及读取头像文件。相关的表见 [数据模型：剧本库](../data-model/library.md)。

## 接口

### `POST /v1/scenarios/import`

导入角色卡。请求体是 `multipart/form-data`，文件放在 `file` 字段里。支持 V1、V2、V3 格式：可以是嵌了卡片数据的 PNG（`chara` 或 `ccv3` 文本块），
也可以是 JSON 文件。格式按文件内容识别，不看扩展名。文件最大 16 MB。PNG 文件本身会保存为头像。

- 鉴权：需要
- 成功：`201`，返回 [`ScenarioOut`](#scenarioout)。同一个用户导入过同一个文件（SHA-256 相同）时，返回 `200` 和已有的剧本，`duplicate` 为真。

| HTTP | code | 情形 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | multipart 格式损坏，无法解析 |
| 413 | `PAYLOAD_TOO_LARGE` | 文件超过 16 MB |
| 422 | `CARD_INVALID` | 不是角色卡、JSON 损坏、嵌套太深等，原因写在 `title` 里 |
| 422 | `VALIDATION_ERROR` | 请求里没有 `file` 字段 |

### `GET /v1/scenarios`

我的剧本，按导入时间倒序排列，不分页。

- 鉴权：需要
- 成功：`200`，返回 [`ScenarioOut`](#scenarioout) 数组。

### `GET /v1/scenarios/{scenario_id}`

- 鉴权：需要
- 成功：`200`，返回 [`ScenarioOut`](#scenarioout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |

### `PATCH /v1/scenarios/{scenario_id}`

给剧本改名。

- 鉴权：需要
- 请求体：[`ScenarioPatchIn`](#scenariopatchin)
- 成功：`200`，返回 [`ScenarioOut`](#scenarioout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |
| 422 | `VALIDATION_ERROR` | 名字去掉首尾空白后为空（`field: "name"`） |

#### `ScenarioPatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 新名字，1 到 80 个字符 |

### `DELETE /v1/scenarios/{scenario_id}`

删除剧本和它的头像。已经开始的游玩不受影响，它们的 `scenario_id` 变成 null。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |

### `GET /v1/blobs/{blob_id}`

读取文件，M1 里只有角色卡的头像。客户端显示头像时，要在图片请求里带上 `Authorization` 头。

- 鉴权：需要
- 成功：`200`，响应体就是文件内容，`Content-Type` 是保存时的类型（M1 只有 `image/png`）。
  响应带 `ETag`（文件 SHA-256 的前 32 位，加引号）和 `Cache-Control: private, max-age=86400`。
  请求的 `If-None-Match` 和 `ETag` 相同时，返回 `304`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 文件不存在 |

## 响应对象

### `ScenarioOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 剧本 ID |
| `name` | string | 显示名 |
| `source_kind` | string | 卡片格式：`card_v1` / `card_v2` / `card_v3` |
| `avatar_blob_id` | string / null | 头像，用 `GET /v1/blobs/{blob_id}` 读取；JSON 卡片为 null |
| `description_preview` | string | 角色描述的预览，直接给人看：合并空白，`{{char}}` 换成角色名、`{{user}}` 换成“你”（英文卡换成 you），`*动作*` 换成括号（中文卡用全角括号），`**加粗**` 只留文字，落单的星号去掉；然后取前 280 个字符，超出时末尾加“…”。存的卡片原文和发给模型的文本不受影响 |
| `first_mes_preview` | string | 开场白的预览，规则同上 |
| `creator` | string | 卡片作者 |
| `tags` | array of string | 卡片的标签 |
| `book_entries` | integer | 卡片自带的世界书条目数 |
| `alternate_greetings` | integer | 备选开场白的数量 |
| `truncated_fields` | array of string | 导入时因为太长被截断的字段 |
| `created_at` | string（时间） | 导入时间 |
| `updated_at` | string（时间） | 最近修改时间 |
| `duplicate` | boolean | 只在导入接口里有意义：这个文件以前导入过，返回的是已有的剧本（此时状态码是 200） |
