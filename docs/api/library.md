# 接口：剧本库

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

导入角色卡、管理剧本、编辑导入后的角色卡，以及读取头像文件。相关的表见 [数据模型：剧本库](../data-model/library.md)。

剧本带一个版本号 `version`：改名、编辑卡片、恢复导入时的内容都会让它加 1。保存编辑时要带上读取时的版本号，
对不上（在别的设备上改过）就拒绝，免得互相覆盖。卡片只在开局搭建世界时读一次，所以改卡只影响之后开始的故事。

## 接口

### `POST /v1/scenarios/import`

导入角色卡。请求体是 `multipart/form-data`，文件放在 `file` 字段里。支持 V1、V2、V3 格式：可以是嵌了卡片数据的 PNG（`chara` 或 `ccv3` 文本块），
也可以是 JSON 文件。格式按文件内容识别，不看扩展名。文件最大 16 MB。PNG 文件本身会保存为头像。

- 鉴权：需要
- 成功：`201`，返回 [`ScenarioOut`](#scenarioout)。同一个用户导入过同一个文件（SHA-256 相同）时，返回 `200` 和已有的剧本，`duplicate` 为真。
  已有的剧本如果编辑过，返回的就是编辑后的样子。

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

给剧本改名，版本号加 1。

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

### `GET /v1/scenarios/{scenario_id}/card`

读取能编辑的那部分卡片，编辑页用。文本是卡片原文，`{{char}}`、`{{user}}` 这类宏原样返回。世界书按顺序排好。

- 鉴权：需要
- 成功：`200`，返回 [`ScenarioCardOut`](#scenariocardout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |

### `PUT /v1/scenarios/{scenario_id}/card`

保存编辑后的卡片和剧本的显示名，版本号加 1，记下编辑时间。请求体里是完整的可编辑内容（不是只传改了的字段）。
请求体最大 4 MB（一般接口是 1 MB）。

- 鉴权：需要
- 请求体：[`ScenarioCardIn`](#scenariocardin)
- 成功：`200`，返回 [`ScenarioCardOut`](#scenariocardout)。

保存时的整理和检查（`domain/scenario/edit.py`）：
- 文本去掉首尾空白，换行统一成 `\n`，去掉 `\u0000`。和导入时不同，超长不截断，而是拒绝。
- 角色名不能为空，最多 80 字；五个文本字段各最多 60000 字；标签最多 32 个、每个最多 40 字，去掉空的和重复的。
- 世界书最多 1000 条；每条的内容不能为空、最多 60000 字，名称最多 120 字，关键词最多 64 个、每个最多 100 字（去掉空的和重复的）。
  条目按列表顺序重新编号，开局搭建世界时常驻条目优先，其次按这个顺序取。
- 文字总量（文本字段、世界书内容，加上没开放编辑的系统提示、作者备注、备选开场白）最多 300000 字。
- 改过的字段不再列在 `truncated_fields` 里。没开放编辑的字段（系统提示、作者备注、备选开场白、作者等）原样保留。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |
| 409 | `CARD_CHANGED` | `version` 不是当前的版本号（在别处改过了），带当前的 `version`。重新读取后再改 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 4 MB |
| 422 | `VALIDATION_ERROR` | 内容不合格，`field` 指出是哪个字段：`display_name`、`name`、`description` 等文本字段、`tags`、`book`、`book.{序号}.content` / `.name` / `.keys`，总量超限是 `card`；请求体格式不对时带 `errors` |

#### `ScenarioCardIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | integer | 是 | 读取时拿到的版本号 |
| `display_name` | string | 是 | 剧本的显示名，1 到 80 个字符 |
| `card` | [`CharacterCardIn`](#charactercardin) | 是 | 编辑后的卡片 |

#### `CharacterCardIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 角色名，替换卡片里的 `{{char}}` |
| `description` | string | 否 | 角色描述，默认空串 |
| `personality` | string | 否 | 性格 |
| `scenario` | string | 否 | 情境 |
| `first_mes` | string | 否 | 开场白 |
| `mes_example` | string | 否 | 对话示例 |
| `tags` | array of string | 否 | 标签 |
| `book` | array of [`LoreEntryIn`](#loreentryin) | 否 | 卡片自带的世界书条目，按列表顺序 |

#### `LoreEntryIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 条目名称，可以为空 |
| `keys` | array of string | 否 | 关键词 |
| `content` | string | 否 | 内容，保存时不能为空 |
| `enabled` | boolean | 否 | 是否启用，默认是；不启用的条目开局时不用 |
| `constant` | boolean | 否 | 是否常驻，默认否；常驻条目开局时优先使用 |

### `POST /v1/scenarios/{scenario_id}/card/reset`

把卡片恢复成导入时的内容（用保存的原始 JSON 重新整理一遍），版本号加 1，清掉编辑时间。剧本的显示名不变。没有请求体。

- 鉴权：需要
- 成功：`200`，返回 [`ScenarioCardOut`](#scenariocardout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |

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
| `truncated_fields` | array of string | 导入时因为太长被截断、之后也没改过的字段 |
| `version` | integer | 版本号，从 1 开始；改名、编辑卡片、恢复都会加 1 |
| `edited_at` | string（时间）/ null | 最近一次改动卡片内容的时间（只改显示名不算）；没编辑过，或者恢复成导入时的内容之后，是 null |
| `created_at` | string（时间） | 导入时间 |
| `updated_at` | string（时间） | 最近修改时间 |
| `duplicate` | boolean | 只在导入接口里有意义：这个文件以前导入过，返回的是已有的剧本（此时状态码是 200） |

### `ScenarioCardOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scenario_id` | string | 剧本 ID |
| `version` | integer | 版本号，保存时带回来 |
| `edited_at` | string（时间）/ null | 最近一次改动卡片内容的时间（只改显示名不算） |
| `display_name` | string | 剧本的显示名 |
| `card` | [`CharacterCardOut`](#charactercardout) | 能编辑的那部分卡片 |
| `truncated_fields` | array of string | 导入时因为太长被截断、之后也没改过的字段 |

### `CharacterCardOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 角色名 |
| `description` | string | 角色描述（原文，宏不替换） |
| `personality` | string | 性格 |
| `scenario` | string | 情境 |
| `first_mes` | string | 开场白 |
| `mes_example` | string | 对话示例 |
| `tags` | array of string | 标签 |
| `book` | array of [`LoreEntryOut`](#loreentryout) | 卡片自带的世界书条目，按顺序排好 |

### `LoreEntryOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 条目名称 |
| `keys` | array of string | 关键词 |
| `content` | string | 内容 |
| `enabled` | boolean | 是否启用 |
| `constant` | boolean | 是否常驻 |
