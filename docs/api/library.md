# 接口：角色卡仓库与剧本仓库

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

“剧本”页分成两个仓库：

- **角色卡仓库**：正式保存的角色卡。卡只从[工作台](workbench.md)保存进来（新建、导入、修改都先是草稿）；这里能看、删、看版本历史、恢复旧版、导出。
- **剧本仓库**：从角色卡仓库里选一张或几张卡（群像剧本）建剧本，再加上剧本的设置（默认主角、偏好、用哪条开场白）。

剧本**实时引用**角色卡：只记卡的 id，开新故事时读这几张卡当时最新的正式版本；已经开始的故事不受影响。有剧本在用的卡不能删。
相关的表见 [数据模型：角色卡与剧本](../data-model/library.md)。

## 接口

### `GET /v1/cards`

我的角色卡，按最近保存时间倒序，不分页。

- 鉴权：需要
- 成功：`200`，返回 [`CardOut`](#cardout) 数组。

### `GET /v1/cards/{card_id}`

一张卡的全部内容（文本是卡片原文，宏原样返回；世界书按顺序排好）、参考过的资料，以及哪些剧本在用它。

- 鉴权：需要
- 成功：`200`，返回 [`CardDetailOut`](#carddetailout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 卡不存在 |

### `DELETE /v1/cards/{card_id}`

删除角色卡和它的版本历史。打开过这张卡的草稿还在（`card_id` 变成 null），可以另存成新卡。封面图没有别处在用时一起删掉。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 卡不存在 |
| 409 | `CARD_IN_USE` | 有剧本在用这张卡，带 `scenarios`（`[{id, name}]`）。先删掉这些剧本或者给它们换卡 |

### `GET /v1/cards/{card_id}/revisions`

版本历史，新的在前。每次正式保存（新建、从草稿保存回来、恢复旧版）记一份，每张卡最多留 30 份。

- 鉴权：需要
- 成功：`200`，返回 [`CardRevisionOut`](#cardrevisionout) 数组。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 卡不存在 |

### `POST /v1/cards/{card_id}/revisions/{version}/restore`

把某个旧版本恢复成最新版：内容、显示名、封面都换成那一版的，算一次新的保存（版本号加 1，记一份新的版本，`note` 是 `restore:{version}`）。没有请求体。

- 鉴权：需要
- 成功：`200`，返回 [`CardDetailOut`](#carddetailout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 卡不存在，或者那个版本已经不在了 |

### `GET /v1/cards/{card_id}/export`

导出角色卡，别的软件（SillyTavern 等）也能导入。查询参数 `format`：

- `png`（默认）：封面按 2:3 居中裁成 512×768 的 PNG，卡片数据写进 `ccv3`（V3）和 `chara`（V2）两个文本块；没有封面时是一张纯色图；
- `json`：V3 格式的 JSON。

导入时原始 JSON 里 `extensions` 的内容原样保留，BetterTavern 自己的信息（卡的 id、版本号、`meta`）放进 `extensions.bettertavern`。

- 鉴权：需要
- 成功：`200`，响应体是文件，`Content-Type` 是 `image/png` 或 `application/json`，带 `Content-Disposition: attachment`（文件名是卡的显示名）。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 卡不存在 |
| 422 | `VALIDATION_ERROR` | `format` 不是 `png` 或 `json` |

### `GET /v1/blobs/{blob_id}`

读取图片：角色卡和草稿的封面、草稿里的图片。客户端显示图片时，要在图片请求里带上 `Authorization` 头。

- 鉴权：需要
- 成功：`200`，响应体就是文件内容，`Content-Type` 是保存时的类型（`image/png`、`image/jpeg` 或 `image/webp`）。
  响应带 `ETag`（文件 SHA-256 的前 32 位，加引号）和 `Cache-Control: private, max-age=86400`。
  请求的 `If-None-Match` 和 `ETag` 相同时，返回 `304`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 文件不存在 |

### `GET /v1/scenarios`

我的剧本，按最近修改时间倒序，不分页。

- 鉴权：需要
- 成功：`200`，返回 [`ScenarioOut`](#scenarioout) 数组。

### `POST /v1/scenarios`

从角色卡仓库选卡新建剧本。

- 鉴权：需要
- 请求体：[`ScenarioIn`](#scenarioin)
- 成功：`201`，返回 [`ScenarioOut`](#scenarioout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 有一张卡不存在 |
| 422 | `VALIDATION_ERROR` | 没选卡或超过 8 张（`field: "card_ids"`）；名字为空（`field: "name"`）；`setup.opening` 指向的卡不在 `card_ids` 里、开场白编号不存在或那一条是空的（`field: "setup.opening"`） |

#### `ScenarioIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string / null | 否 | 剧本名，最多 80 个字符；不传时用第一张卡的显示名 |
| `card_ids` | array of string | 是 | 用哪几张卡，1 到 8 张，按顺序；第一张是主角色卡（剧本封面、默认名字取它）。重复的只算一次 |
| `setup` | [`ScenarioSetupModel`](#scenariosetupmodel) | 否 | 剧本的设置，默认全空 |

#### `ScenarioSetupModel`

请求和响应共用。开新故事时用它预填没填的字段（见 [`POST /v1/playthroughs`](play.md#post-v1playthroughs)）。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `protagonist` | [`SetupProtagonist`](#setupprotagonist) | 否 | 默认主角 |
| `preferences` | [`SetupPreferences`](#setuppreferences) | 否 | 默认偏好 |
| `opening` | [`SetupOpening`](#setupopening) / null | 否 | 用哪张卡的哪条开场白开场；为 null 时由导演写开场 |

#### `SetupProtagonist`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 主角名，最多 40 个字符，可以为空 |
| `summary` | string | 否 | 主角的一句话介绍，最多 400 个字符 |

#### `SetupPreferences`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `length` | string | 否 | 每段的篇幅：`short` / `medium`（默认）/ `long` |
| `style` | string | 否 | 文风，最多 200 个字符 |
| `boundaries` | string | 否 | 不想看到的内容，最多 300 个字符 |

#### `SetupOpening`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `card_id` | string | 是 | 剧本里的哪张卡 |
| `greeting` | integer | 否 | 第几条开场白：0 是 `first_mes`（默认），1 起是备选开场白 |

### `GET /v1/scenarios/{scenario_id}`

- 鉴权：需要
- 成功：`200`，返回 [`ScenarioOut`](#scenarioout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |

### `PATCH /v1/scenarios/{scenario_id}`

改名字、设置，或者换卡。只改传了的字段；版本号加 1。

- 鉴权：需要
- 请求体：[`ScenarioPatchIn`](#scenariopatchin)
- 成功：`200`，返回 [`ScenarioOut`](#scenarioout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在，或者有一张卡不存在 |
| 409 | `SCENARIO_CHANGED` | 带了 `version`，但不是当前的版本号（在别处改过了），带当前的 `version` |
| 422 | `VALIDATION_ERROR` | 同 `POST /v1/scenarios`；换了卡以后 `setup.opening` 指向的卡不在剧本里也是这个错误，要一起改 |

#### `ScenarioPatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string / null | 否 | 新名字，1 到 80 个字符 |
| `card_ids` | array of string / null | 否 | 换成这几张卡（整个替换），1 到 8 张 |
| `setup` | [`ScenarioSetupModel`](#scenariosetupmodel) / null | 否 | 新的设置（整个替换） |
| `version` | integer / null | 否 | 读到的版本号；带上时检查有没有在别处改过 |

### `DELETE /v1/scenarios/{scenario_id}`

删除剧本，卡不动。已经开始的游玩不受影响，它们的 `scenario_id` 变成 null。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |

## 响应对象

### `CardOut`

角色卡仓库的列表项。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 卡的 ID |
| `name` | string | 显示名 |
| `character_name` | string | 角色名（卡片里的 `name`，替换 `{{char}}`） |
| `source` | string | 最初怎么来的：`card_v1` / `card_v2` / `card_v3`（导入）、`manual`（手动新建）、`agent`（agent 做的） |
| `cover_blob_id` | string / null | 封面，用 `GET /v1/blobs/{blob_id}` 读取；为 null 时客户端画几何封面 |
| `description_preview` | string | 角色描述的预览，直接给人看：合并空白，`{{char}}` 换成角色名、`{{user}}` 换成“你”（英文卡换成 you），`*动作*` 换成括号（中文卡用全角括号），`**加粗**` 只留文字，落单的星号去掉；然后取前 280 个字符，超出时末尾加“…”。存的卡片原文和发给模型的文本不受影响 |
| `creator` | string | 卡片作者 |
| `tags` | array of string | 标签 |
| `book_entries` | integer | 世界书条目数 |
| `greetings` | integer | 开场白的条数（`first_mes` 不为空算 1 条，加上备选开场白） |
| `made_by` | string | 最近一版主要是谁写的：`agent` / `manual` / `mixed` |
| `ip` | [`CardIpOut`](#cardipout) / null | 作品里的角色才有：出自哪部作品、是谁 |
| `scenario_count` | integer | 几个剧本在用它（大于 0 时不能删） |
| `draft_id` | string / null | 这张卡有没保存修改的草稿时，是那份草稿的 ID |
| `version` | integer | 版本号，从 1 开始，每正式保存一次加 1 |
| `created_at` | string（时间） | 第一次保存的时间 |
| `updated_at` | string（时间） | 最近一次保存的时间 |

### `CardIpOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `work` | string | 作品名 |
| `character` | string | 作品里的角色名 |

### `CardDetailOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `card` | [`CardOut`](#cardout) | 概况 |
| `content` | [`CharacterCardOut`](#charactercardout) | 卡片的全部内容 |
| `sources` | array of [`CardSourceOut`](#cardsourceout) | agent 查资料时参考过的网页 |
| `scenarios` | array of [`ScenarioRefOut`](#scenariorefout) | 在用这张卡的剧本，按名字排 |

### `CardSourceOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `url` | string | 网页地址 |
| `title` | string | 网页标题 |
| `used_in` | array of string | 用在卡片哪里（字段名，例如 `personality`） |

### `ScenarioRefOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 剧本 ID |
| `name` | string | 剧本名 |

### `CharacterCardOut`

卡片内容，角色卡详情和工作台草稿共用。文本是卡片原文，宏不替换。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 角色名，替换卡片里的 `{{char}}`；草稿里可能是空串 |
| `description` | string | 角色描述 |
| `personality` | string | 性格 |
| `scenario` | string | 情境 |
| `first_mes` | string | 开场白 |
| `mes_example` | string | 对话示例 |
| `system_prompt` | string | 系统提示 |
| `creator_notes` | string | 作者备注（agent 查过的资料来源也写在这里） |
| `alternate_greetings` | array of string | 备选开场白 |
| `tags` | array of string | 标签 |
| `book` | array of [`LoreEntryOut`](#loreentryout) | 卡片自带的世界书条目，按顺序排好 |
| `creator` | string | 卡片作者（不能在 BetterTavern 里改，导出时原样写回） |
| `character_version` | string | 卡片的版本号（同上） |
| `post_history_instructions` | string | 后置指令（同上） |
| `truncated` | array of string | 导入时因为太长被截断、之后也没改过的字段 |

### `LoreEntryOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 条目名称 |
| `keys` | array of string | 关键词 |
| `content` | string | 内容 |
| `enabled` | boolean | 是否启用 |
| `constant` | boolean | 是否常驻 |

### `CardRevisionOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | integer | 这一版的版本号 |
| `name` | string | 当时的显示名 |
| `note` | string | 一句话说明；恢复旧版时是 `restore:{原来的版本号}`，其他时候可能是空串 |
| `cover_blob_id` | string / null | 当时的封面 |
| `from_draft` | boolean | 是不是从工作台的草稿保存的 |
| `created_at` | string（时间） | 保存时间 |

### `ScenarioOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 剧本 ID |
| `name` | string | 剧本名 |
| `cards` | array of [`ScenarioCardOut`](#scenariocardout) | 用了哪几张卡，按顺序；第一张是主角色卡 |
| `cover_blob_id` | string / null | 主角色卡的封面 |
| `setup` | [`ScenarioSetupModel`](#scenariosetupmodel) | 剧本的设置，没设置的项是默认值 |
| `description_preview` | string | 主角色卡描述的预览，规则同 [`CardOut`](#cardout) |
| `version` | integer | 版本号，从 1 开始；改名字、设置、换卡都会加 1 |
| `created_at` | string（时间） | 创建时间 |
| `updated_at` | string（时间） | 最近修改时间 |

### `ScenarioCardOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `card_id` | string | 卡的 ID |
| `name` | string | 卡的显示名 |
| `cover_blob_id` | string / null | 卡的封面 |
