# 接口：角色卡、剧本与世界书仓库

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

这里有三个仓库：

- **角色卡仓库**：正式保存的角色卡。卡只从[工作台](workbench.md)保存进来（新建、导入、修改都先是草稿）；这里能看、删、看版本历史、恢复旧版、导出。
- **剧本仓库**：从角色卡仓库里选一张或几张卡（群像剧本）建剧本，再加上剧本的设置（默认主角、偏好、用哪条开场白），可以挂几本世界书。
- **世界书仓库**：导入 SillyTavern 的世界书文件，或者新建空白的；能改名、改条目、删除。设计见 [lorebook.md](../lorebook.md)。

剧本**实时引用**角色卡和世界书：只记 id，开新故事时读它们当时最新的内容；已经开始的故事不受影响。有剧本在用的卡不能删；世界书删掉时自动从剧本上摘掉。
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
世界书条目照 SillyTavern 导出卡时的写法：`insertion_order` 是优先级数字（`priority`，没有时是列表位置），次要关键词、逻辑和其余触发设置写进每条的 `extensions`（键名同 SillyTavern，粘滞、冷却、延迟换回消息条数）。

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
| 404 | `NOT_FOUND` | 有一张卡或一本世界书不存在 |
| 422 | `VALIDATION_ERROR` | 没选卡或超过 8 张（`field: "card_ids"`）；世界书超过 4 本（`field: "lorebook_ids"`）；名字为空（`field: "name"`）；`setup.opening` 指向的卡不在 `card_ids` 里、开场白编号不存在或那一条是空的（`field: "setup.opening"`） |

#### `ScenarioIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string / null | 否 | 剧本名，最多 80 个字符；不传时用第一张卡的显示名 |
| `card_ids` | array of string | 是 | 用哪几张卡，1 到 8 张，按顺序；第一张是主角色卡（剧本封面、默认名字取它）。重复的只算一次 |
| `setup` | [`ScenarioSetupModel`](#scenariosetupmodel) | 否 | 剧本的设置，默认全空 |
| `lorebook_ids` | array of string | 否 | 挂哪几本世界书，0 到 4 本，按顺序（顺序只影响开局合并时的先后，见 [lorebook.md](../lorebook.md) 第 3.2 节）。重复的只算一次。卡里自带的世界书不用在这里加 |

#### `ScenarioSetupModel`

请求和响应共用。开新故事时用它预填没填的字段（见 [`POST /v1/playthroughs`](play.md#post-v1playthroughs)）。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `protagonist` | [`SetupProtagonist`](#setupprotagonist) | 否 | 默认主角 |
| `preferences` | [`SetupPreferences`](#setuppreferences) | 否 | 默认偏好 |
| `opening` | [`SetupOpening`](#setupopening) / null | 否 | 用哪张卡的哪条开场白开场；为 null 时由导演写开场 |
| `lightning` | boolean | 否 | 闪电模式，默认 `false`。开着时这个剧本开的新故事花费更少、没有世界状态（存档的 `mode` 是 `lightning`）；已经开始的故事不受影响 |

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

改名字、设置，或者换卡、换世界书。只改传了的字段；版本号加 1。

- 鉴权：需要
- 请求体：[`ScenarioPatchIn`](#scenariopatchin)
- 成功：`200`，返回 [`ScenarioOut`](#scenarioout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在，或者有一张卡、一本世界书不存在 |
| 409 | `SCENARIO_CHANGED` | 带了 `version`，但不是当前的版本号（在别处改过了），带当前的 `version` |
| 422 | `VALIDATION_ERROR` | 同 `POST /v1/scenarios`；换了卡以后 `setup.opening` 指向的卡不在剧本里也是这个错误，要一起改 |

#### `ScenarioPatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string / null | 否 | 新名字，1 到 80 个字符 |
| `card_ids` | array of string / null | 否 | 换成这几张卡（整个替换），1 到 8 张 |
| `setup` | [`ScenarioSetupModel`](#scenariosetupmodel) / null | 否 | 新的设置（整个替换） |
| `lorebook_ids` | array of string / null | 否 | 换成这几本世界书（整个替换），0 到 4 本；传空数组是全部摘掉 |
| `version` | integer / null | 否 | 读到的版本号；带上时检查有没有在别处改过 |

### `DELETE /v1/scenarios/{scenario_id}`

删除剧本，卡不动。已经开始的游玩不受影响，它们的 `scenario_id` 变成 null。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 剧本不存在 |

### `GET /v1/lorebooks`

我的世界书，按最近修改时间倒序，不分页。不带条目全文。

- 鉴权：需要
- 成功：`200`，返回 [`LorebookOut`](#lorebookout) 数组。

### `POST /v1/lorebooks`

新建一本空白的世界书（`source` 是 `manual`），之后用 `PUT /v1/lorebooks/{lorebook_id}/book` 写条目。和工作台的导入、上传共用每分钟 20 次的限流计数。

- 鉴权：需要
- 请求体：[`LorebookCreateIn`](#lorebookcreatein)
- 成功：`201`，返回 [`LorebookDetailOut`](#lorebookdetailout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 409 | `TOO_MANY_LOREBOOKS` | 世界书已经到上限（默认 100 本），带 `limit` |
| 422 | `VALIDATION_ERROR` | 名字为空或超过 80 个字符（`field: "name"`）；简介超过 2000 个字符（`field: "description"`） |
| 429 | `RATE_LIMITED` | 超过限流 |

#### `LorebookCreateIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 书名，1 到 80 个字符（连续空白合成一个） |
| `description` | string | 否 | 简介，最多 2000 个字符 |

### `POST /v1/lorebooks/import`

导入一本世界书。请求体是 `multipart/form-data`：

| 字段 | 说明 |
| --- | --- |
| `file` | 世界书文件，必填，JSON，最大 8 MB。按内容识别格式，不看扩展名：SillyTavern 的世界书文件（`worlds/*.json`）、角色卡规范里单独导出的世界书（`lorebook_v3`，或者只有一个 `character_book`）。书名取文件里的名字，没有就用文件名 |
| `allow_duplicate` | 这个文件已经导入过时，是否仍然另起一本。默认 `false` |

字段怎么对应、丢掉哪些条目见 [lorebook.md](../lorebook.md) 第 6 节：没有正文的、没有关键词又不是常驻的条目丢掉，最多留 2000 条；结果里的导入报告写明各丢了几条、哪些设置不支持。

- 鉴权：需要
- 成功：`201`，返回 [`LorebookImportOut`](#lorebookimportout)，`lorebook` 是新的那本。
  同一个用户导入过同一个文件（SHA-256 相同）、而且 `allow_duplicate` 为假时，返回 `200`，`lorebook` 为 null，`existing` 是已有的那本：
  客户端问用户是打开它还是另外导入一份（带 `allow_duplicate=true` 再传一次）。另外导入的那本不记文件指纹。

| HTTP | code | 情形 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | multipart 格式损坏，无法解析 |
| 409 | `TOO_MANY_LOREBOOKS` | 世界书已经到上限，带 `limit` |
| 413 | `PAYLOAD_TOO_LARGE` | 文件超过 8 MB |
| 422 | `LOREBOOK_INVALID` | 不是世界书、JSON 损坏、嵌套太深、一条能用的条目都没有、正文加起来超过 50 万字，原因写在 `title` 里 |
| 422 | `LOREBOOK_IS_CARD` | 传的是角色卡（客户端提示去工作台导入） |
| 422 | `VALIDATION_ERROR` | 请求里没有 `file` 字段 |
| 429 | `RATE_LIMITED` | 超过限流（和工作台的导入、上传共用计数） |

### `GET /v1/lorebooks/{lorebook_id}`

一本世界书的全部内容：概况、全部条目（按列表顺序，文本是原文，宏原样返回）、挂着它的剧本。

- 鉴权：需要
- 成功：`200`，返回 [`LorebookDetailOut`](#lorebookdetailout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 世界书不存在 |

### `PATCH /v1/lorebooks/{lorebook_id}`

改书名、简介。只改传了的字段；版本号加 1。

- 鉴权：需要
- 请求体：[`LorebookPatchIn`](#lorebookpatchin)
- 成功：`200`，返回 [`LorebookDetailOut`](#lorebookdetailout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 世界书不存在 |
| 409 | `LOREBOOK_CHANGED` | 带了 `version`，但不是当前的版本号（在别处改过了），带当前的 `version` |
| 422 | `VALIDATION_ERROR` | 同 `POST /v1/lorebooks` |

#### `LorebookPatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string / null | 否 | 新书名，1 到 80 个字符 |
| `description` | string / null | 否 | 新简介，最多 2000 个字符 |
| `version` | integer / null | 否 | 读到的版本号；带上时检查有没有在别处改过 |

### `PUT /v1/lorebooks/{lorebook_id}/book`

编辑条目的自动保存：整本的条目（不是只传改了的）和读到的版本号。版本号加 1。请求体最大 8 MB。

和工作台草稿的自动保存一样**宽松**（`domain/scenario/lorebook.py`）：
- 标题、正文、关键词可以暂时空着（这样的条目不会被带上，编辑页标出来）；
- 长度照样检查：最多 2000 条，正文加起来最多 500000 字，每条的上限同卡里的世界书（见 [workbench.md](workbench.md#put-v1workbenchdraftsdraft_idcard)）。超长拒绝，不截断；
- 文本去掉首尾空白，换行统一成 `\n`，去掉 `\u0000`；关键词去掉空的和重复的；按列表顺序重新编号（`order`），优先级和其余触发设置不跟着变。

- 鉴权：需要
- 请求体：[`LorebookBookIn`](#lorebookbookin)
- 成功：`200`，返回 [`LorebookDetailOut`](#lorebookdetailout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 世界书不存在 |
| 409 | `LOREBOOK_CHANGED` | 版本号对不上：在别的设备上改过了，重新读取再改。带当前的 `version` |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 8 MB |
| 422 | `VALIDATION_ERROR` | 超过上限，`field` 指出是哪里，例如 `book`、`book.3.content`、`book.3.keys` |

#### `LorebookBookIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | integer | 是 | 读到的版本号 |
| `book` | array of [`LoreEntryIn`](workbench.md#loreentryin) | 否 | 全部条目，按列表顺序 |

### `DELETE /v1/lorebooks/{lorebook_id}`

删除世界书，并从挂着它的剧本上摘掉（剧本少一本书照样能玩）。已经开始的故事不受影响。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 世界书不存在 |

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

世界书的一条，角色卡自带的世界书和独立世界书共用。触发规则照 SillyTavern（[lorebook.md](../lorebook.md) 第 6、7 节）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 条目名称（只给人看，不发给模型） |
| `keys` | array of string | 关键词；写成 `/……/flags` 的是正则 |
| `content` | string | 内容 |
| `enabled` | boolean | 是否启用 |
| `constant` | boolean | 是否常驻 |
| `secondary_keys` | array of string | 次要关键词 |
| `logic` | string | 次要关键词的逻辑：`any` / `all` / `not_any` / `not_all`，含义见 [`LoreEntryIn`](workbench.md#loreentryin) |
| `priority` | integer / null | 优先级数字（SillyTavern 的 `order`）；为 null 时按列表位置算 |
| `rules` | [`LoreRulesModel`](#lorerulesmodel) / null | 不常用的触发设置；为 null 时全按默认 |

### `LoreRulesModel`

世界书条目不常用的触发设置，请求和响应共用。为 null 的项表示按 SillyTavern 新装时的默认值。粘滞、冷却、延迟按回合算（SillyTavern 按消息条数，导入时除以 2 向上取整）。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `whole_words` | boolean / null | 否 | 整词匹配：关键词前后不能紧挨英文字母、数字、下划线；默认（null）开 |
| `case_sensitive` | boolean / null | 否 | 区分大小写；默认（null）关 |
| `scan_depth` | integer / null | 否 | 往回扫几条消息（一回合两条），0 到 1000；默认（null）2 |
| `match` | array of string | 否 | 顺带扫描的文字：`persona`（主角介绍）、`description`、`personality`、`depth_prompt`、`scenario`、`creator_notes`（卡的这几段） |
| `exclude_recursion` | boolean | 否 | 不被别的条目的内容触发，默认否 |
| `prevent_recursion` | boolean | 否 | 被触发以后，内容不去触发别的条目，默认否 |
| `delay_until_recursion` | integer | 否 | 只在第几层递归以后才能触发，0 到 100；0（默认）是不限 |
| `probability` | integer | 否 | 触发概率，0 到 100，默认 100 |
| `groups` | array of string | 否 | 所在的组，最多 16 个；同一组同时命中时只留一条 |
| `group_override` | boolean | 否 | 组内优先：同组里优先留它（几条都开了就取优先级大的），默认否 |
| `group_weight` | integer | 否 | 同组里按权重抽时的权重，0 到 1000000，默认 100 |
| `group_scoring` | boolean / null | 否 | 组打分：同组先留命中关键词最多的；默认（null）关 |
| `sticky` | integer | 否 | 触发后连着生效几回合，0 到 1000，默认 0 |
| `cooldown` | integer | 否 | 生效结束后几回合内不能再触发，0 到 1000，默认 0 |
| `delay` | integer | 否 | 第几回合以后才能触发，0 到 1000，默认 0 |
| `triggers` | array of string | 否 | 只在哪几种生成方式下触发（SillyTavern 的 `normal`、`continue`、`impersonate`、`swipe`、`regenerate`、`quiet`）；空的（默认）不限。我们的回合都算 `normal` |
| `ignore_budget` | boolean | 否 | 不占预算：预算满了也带上，默认否 |

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
| `version` | integer | 版本号，从 1 开始；改名字、设置、换卡、换世界书都会加 1 |
| `created_at` | string（时间） | 创建时间 |
| `updated_at` | string（时间） | 最近修改时间 |
| `lorebooks` | array of [`ScenarioLorebookOut`](#scenariolorebookout) | 挂的世界书，按顺序 |

### `ScenarioLorebookOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `lorebook_id` | string | 世界书的 ID |
| `name` | string | 书名 |
| `entries` | integer | 条目数 |

### `ScenarioCardOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `card_id` | string | 卡的 ID |
| `name` | string | 卡的显示名 |
| `cover_blob_id` | string / null | 卡的封面 |

### `LorebookOut`

世界书仓库的一本（不带条目全文）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 世界书的 ID |
| `name` | string | 书名 |
| `description` | string | 简介，可能是空串 |
| `source` | string | 怎么来的：`st_world`（SillyTavern 的世界书文件）/ `lorebook`（角色卡格式的世界书）/ `manual`（新建的） |
| `entries` | integer | 条目数 |
| `constant` | integer | 常驻条目数 |
| `scenario_count` | integer | 几个剧本挂着它 |
| `report` | [`LorebookReportOut`](#lorebookreportout) / null | 导入报告；新建的是 null |
| `version` | integer | 版本号，从 1 开始；改名、改简介、改条目都会加 1 |
| `created_at` | string（时间） | 导入或新建的时间 |
| `updated_at` | string（时间） | 最近修改时间 |

### `LorebookReportOut`

导入报告：导入时数的几样，之后改条目不变。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `entries` | integer | 导进来几条 |
| `constant` | integer | 其中常驻的 |
| `disabled` | integer | 其中停用的 |
| `dropped_empty` | integer | 没有正文、丢掉的 |
| `dropped_unreachable` | integer | 没有关键词又不是常驻（永远不会被带上）、丢掉的 |
| `dropped_over_limit` | integer | 超过 2000 条、丢掉的 |
| `vectorized` | integer | 按意思匹配的（要 SillyTavern 的向量扩展）：我们只看关键词 |
| `character_filter` | integer | 只对某些角色生效的：这个限制不生效 |
| `bad_regex` | integer | 有正则关键词写错、或者用了不认的写法的：那个关键词不会命中 |
| `other_macros` | integer | 用了 `{{user}}`、`{{char}}` 以外的宏的：开局时那些宏被删掉 |

### `LorebookDetailOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `lorebook` | [`LorebookOut`](#lorebookout) | 概况 |
| `book` | array of [`LoreEntryOut`](#loreentryout) | 全部条目，按列表顺序 |
| `scenarios` | array of [`ScenarioRefOut`](#scenariorefout) | 挂着它的剧本，按名字排 |

### `LorebookImportOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `lorebook` | [`LorebookDetailOut`](#lorebookdetailout) / null | 新导入的那本；文件导入过、又没让另起一本时为 null |
| `existing` | [`LorebookOut`](#lorebookout) / null | 已经导入过的那本 |
