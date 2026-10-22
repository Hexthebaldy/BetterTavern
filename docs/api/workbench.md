# 接口：工作台

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

创建、导入和修改角色卡都在工作台。设计见 [workbench.md](../workbench.md)，表见 [数据模型：工作台](../data-model/workbench.md)。

- 一份**草稿**就是“正在做的一张卡”。手动模式的表单和 agent 改的是同一份草稿，随时可以切换。
- 草稿**不在角色卡仓库里**：点“保存”（[`POST /v1/workbench/drafts/{draft_id}/save`](#post-v1workbenchdraftsdraft_idsave)）才正式进库。改仓库里已有的卡也是先开一份草稿。
- 草稿带版本号 `version`：手动自动保存、agent 每写一处、换封面都加 1。自动保存要带上读到的版本号，对不上返回 409 `DRAFT_CHANGED`，重新读取再改。
  这样手动和 agent 同时改时不会互相覆盖。
- 每个用户有用量上限（服务端的配置，见 [README.md 的“限流”](README.md#限流)）：同时在写的 agent 最多 2 个（`TOO_MANY_RUNS`），
  没保存的草稿最多 50 份（`TOO_MANY_DRAFTS`），存的图（封面、导入的卡图、草稿里的图）一共最多 200 MB（`STORAGE_FULL`）。

## 接口

### `POST /v1/workbench/drafts`

新建草稿，按开始方式分：

- `manual`：空白的手动表单；
- `edit_card`：从仓库打开一张卡。这张卡已经有草稿就返回那一份（保存过、之后卡又在别处改过时，先换成卡现在的内容），没有就复制卡的内容新建一份，封面也带过来；
- `agent`：从聊天框开始，记下用户的第一句话，同时开 agent 的第一轮（见 `POST /v1/workbench/drafts/{draft_id}/messages`）。

- 鉴权：需要
- 请求体：[`DraftCreateIn`](#draftcreatein)
- 成功：`201`，返回 [`DraftOut`](#draftout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | `edit_card` 时卡不存在 |
| 409 | `TOO_MANY_DRAFTS` | `manual`、`agent` 时没保存的草稿已经到上限，带 `limit` |
| 409 | `TOO_MANY_RUNS` | `agent` 时同时在写的 agent 已经到上限，带 `limit` |
| 422 | `VALIDATION_ERROR` | `edit_card` 没带 `card_id`（`field: "card_id"`）；`agent` 没带 `text`（`field: "text"`） |
| 429 | `RATE_LIMITED` | 工作台的操作每分钟超过 20 次（同一个用户，和导入、上传、出图、发消息、接着写共用一个计数） |

#### `DraftCreateIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `origin` | string | 是 | `manual` / `edit_card` / `agent` |
| `card_id` | string / null | 否 | `edit_card` 时必填 |
| `text` | string / null | 否 | `agent` 时必填：用户在聊天框里说的第一句话，最多 8000 个字符 |
| `language` | string | 否 | 草稿的语言（agent 说话和提示词用）：`zh`（默认）/ `en` / `ja`，客户端传当前的界面语言 |

### `POST /v1/workbench/drafts/import`

导入一张角色卡，解析成草稿（进手动表单）。请求体是 `multipart/form-data`：

| 字段 | 说明 |
| --- | --- |
| `file` | 角色卡文件，必填。支持 V1、V2、V3：嵌了卡片数据的 PNG（`chara` 或 `ccv3` 文本块）或 JSON。按内容识别格式，不看扩展名。最大 16 MB |
| `language` | 草稿的语言，同上，默认 `zh` |
| `allow_duplicate` | 这个文件已经导入过时，是否仍然另起一份草稿。默认 `false` |

PNG 卡的图片会重新编码一遍（去掉卡片数据和 EXIF），当作草稿的封面；图片坏了也照样导入，只是没有封面。

- 鉴权：需要
- 成功：`201`，返回 [`DraftImportOut`](#draftimportout)，`draft` 是新草稿。
  同一个用户导入过同一个文件（SHA-256 相同）、而且 `allow_duplicate` 为假时，返回 `200`，`draft` 为 null，`existing_card` 是那张卡：
  客户端问用户是打开它（`POST /v1/workbench/drafts` 的 `edit_card`）还是另起一份（带 `allow_duplicate=true` 再传一次）。
  另起的那份保存成新卡时不再记文件指纹。

| HTTP | code | 情形 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | multipart 格式损坏，无法解析 |
| 409 | `TOO_MANY_DRAFTS` | 没保存的草稿已经到上限，带 `limit` |
| 409 | `STORAGE_FULL` | PNG 卡的图片存不下了，带 `limit_mb` |
| 413 | `PAYLOAD_TOO_LARGE` | 文件超过 16 MB |
| 422 | `CARD_INVALID` | 不是角色卡、JSON 损坏、嵌套太深等，原因写在 `title` 里 |
| 422 | `VALIDATION_ERROR` | 请求里没有 `file` 字段 |
| 429 | `RATE_LIMITED` | 工作台的操作每分钟超过 20 次（同一个用户，和导入、上传、出图、发消息、接着写共用一个计数） |

### `GET /v1/workbench/drafts`

草稿列表：只列有没保存修改的草稿（从没保存过，或者保存以后又改过），按最近改动倒序。

- 鉴权：需要
- 成功：`200`，返回 [`DraftSummaryOut`](#draftsummaryout) 数组。

### `GET /v1/workbench/drafts/{draft_id}`

草稿的全部内容：卡片、封面、图片、进度清单、检查结果。

- 鉴权：需要
- 成功：`200`，返回 [`DraftOut`](#draftout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |

### `PUT /v1/workbench/drafts/{draft_id}/card`

手动模式的自动保存：整张卡（不是只传改了的字段）和显示名。版本号加 1。请求体最大 4 MB（一般接口是 1 MB）。

草稿是**宽松模式**（`domain/scenario/edit.py`）：
- 名字、世界书条目的内容可以暂时是空的，备选开场白可以有空的一条（正在写）；
- 长度照样检查：文本字段和每条开场白最多 60000 字，角色名最多 80 字，备选开场白最多 32 条，标签最多 32 个、每个最多 40 字，
  世界书最多 1000 条（名称最多 120 字，关键词最多 64 个、每个最多 100 字），文字总量最多 300000 字。超长拒绝，不截断；
- 文本去掉首尾空白，换行统一成 `\n`，去掉 `\u0000`；标签和关键词去掉空的和重复的；世界书按列表顺序重新编号；
- 改过的字段不再列在 `truncated` 里。作者、版本号、后置指令这些不开放编辑的字段原样保留。

- 鉴权：需要
- 请求体：[`DraftCardIn`](#draftcardin)
- 成功：`200`，返回 [`DraftOut`](#draftout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |
| 409 | `DRAFT_CHANGED` | `version` 不是当前的版本号（agent 或别的设备改过），带当前的 `version`。重新读取后再改 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 4 MB |
| 422 | `VALIDATION_ERROR` | 超长，`field` 指出是哪个字段：`name`、`description` 等文本字段、`alternate_greetings` / `alternate_greetings.{序号}`、`tags`、`book`、`book.{序号}.name` / `.keys` / `.content`，总量超限是 `card` |

#### `DraftCardIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | integer | 是 | 读到的草稿版本号 |
| `name` | string | 否 | 显示名（保存进仓库时用；为空时用角色名），最多 200 个字符，存的时候截到 80 |
| `card` | [`CharacterCardIn`](#charactercardin) | 是 | 卡片内容 |

#### `CharacterCardIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 角色名，替换卡片里的 `{{char}}` |
| `description` | string | 否 | 角色描述 |
| `personality` | string | 否 | 性格 |
| `scenario` | string | 否 | 情境 |
| `first_mes` | string | 否 | 开场白 |
| `mes_example` | string | 否 | 对话示例 |
| `system_prompt` | string | 否 | 系统提示 |
| `creator_notes` | string | 否 | 作者备注 |
| `alternate_greetings` | array of string | 否 | 备选开场白，按顺序 |
| `tags` | array of string | 否 | 标签 |
| `book` | array of [`LoreEntryIn`](#loreentryin) | 否 | 世界书条目，按列表顺序 |

#### `LoreEntryIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 条目名称，可以为空 |
| `keys` | array of string | 否 | 关键词 |
| `content` | string | 否 | 内容，草稿里可以为空，保存进仓库时不能为空 |
| `enabled` | boolean | 否 | 是否启用，默认是；不启用的条目开局时不用 |
| `constant` | boolean | 否 | 是否常驻，默认否；常驻条目开局时优先使用 |

### `PATCH /v1/workbench/drafts/{draft_id}`

切换模式（下次打开默认用哪种）。切到 `manual` 时，如果 agent 正在跑，就让它做完手上这一步停下（手动接管）。版本号不变。

- 鉴权：需要
- 请求体：[`DraftPatchIn`](#draftpatchin)
- 成功：`200`，返回 [`DraftOut`](#draftout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |

#### `DraftPatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | string | 是 | `agent` / `manual` |

### `POST /v1/workbench/drafts/{draft_id}/assets`

往草稿里上传一张图（封面候选）。请求体是 `multipart/form-data`，文件放在 `file` 字段里。

只收 PNG、JPEG、WebP，最大 16 MB、最多 4000 万像素。存之前完整解码一遍，按 EXIF 方向转正，长边缩到 4096 以内，
重新编码（格式不变），去掉 EXIF 和文本块。上传的图版权记为 `own`。

- 鉴权：需要
- 成功：`201`，返回 [`AssetOut`](#assetout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |
| 409 | `STORAGE_FULL` | 存的图已经到上限，带 `limit_mb` |
| 413 | `PAYLOAD_TOO_LARGE` | 文件超过 16 MB |
| 422 | `IMAGE_INVALID` | 不是 PNG、JPEG、WebP，解码失败或像素太多（`field: "file"`） |
| 422 | `VALIDATION_ERROR` | 请求里没有 `file` 字段 |
| 429 | `RATE_LIMITED` | 工作台的操作每分钟超过 20 次（同一个用户，和导入、上传、出图、发消息、接着写共用一个计数） |

### `POST /v1/workbench/drafts/{draft_id}/covers`

封面面板里直接生成封面候选，不经过 agent：用默认的文生图服务（[外部服务](tools.md)）出几张，存进草稿的图片（版权记为 `own`），由用户挑一张当封面。
生图要花钱，一次最多 4 张；最多等 120 秒左右（按服务的速度）。

- 鉴权：需要
- 请求体：[`CoverGenerateIn`](#covergeneratein)
- 成功：`201`，返回新生成的 [`AssetOut`](#assetout) 数组。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |
| 409 | `TOOL_ROUTE_MISSING` | 还没配文生图 |
| 409 | `CREDENTIAL_UNREADABLE` | 文生图的 Key 无法解密 |
| 409 | `STORAGE_FULL` | 存的图已经到上限（出图之前就检查，不花钱），带 `limit_mb`。出到一半存满时返回已经存下的几张 |
| 429 | `RATE_LIMITED` | 工作台的操作每分钟超过 20 次（同一个用户，和导入、上传、出图、发消息、接着写共用一个计数） |
| 502 | `TOOL_ROUTE_INVALID` | 文生图服务出错，带 `reason` |

#### `CoverGenerateIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | 画面描述，1 到 4000 个字符 |
| `style` | string | 否 | 风格：`ink`（水墨）、`oil`（油画）、`film`（胶片）、`flat`（平涂）之一（换成英文说法拼进提示词），或者自己写一个；默认不加 |
| `count` | integer | 否 | 几张，1 到 4，默认 4 |
| `aspect` | string | 否 | 画幅：`portrait`（竖版，默认）/ `square` / `landscape` |

### `PUT /v1/workbench/drafts/{draft_id}/cover`

选一张草稿里的图当封面，或者去掉封面。版本号加 1。

版权是 `copyrighted`（有版权）或 `unknown`（拿不准）的图只作参考，默认不能当封面；用户坚持要用时，带 `personal_use: true` 确认“仅限个人使用”，确认记在这张图上，之后不用再确认。

- 鉴权：需要
- 请求体：[`DraftCoverIn`](#draftcoverin)
- 成功：`200`，返回 [`DraftOut`](#draftout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在，或者图不在这份草稿里 |
| 409 | `IMAGE_LICENSE` | 图的版权不明，没有确认仅限个人使用，带 `license` |

#### `DraftCoverIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `asset_id` | string / null | 是 | 哪张图；null 表示去掉封面 |
| `personal_use` | boolean | 否 | 确认版权不明的图仅限个人使用，默认否 |

### `POST /v1/workbench/drafts/{draft_id}/save`

保存到角色卡仓库：

- 新卡（草稿还没对应的卡，或者对应的卡已经删了）就建一张。来源（`source`）按草稿怎么开始的定：导入的是卡片格式，其他是 `manual` 或 `agent`；
- 改已有的卡，就带着开草稿时卡的版本号写回去。对不上（在别处改过）返回 409 `CARD_CHANGED`，让用户选覆盖（`on_conflict: "overwrite"`）还是另存成新卡（`"copy"`）；
- 保存前用**正式模式**整理一遍（去掉空的备选开场白），再用和客户端同一套规则检查（`domain/scenario/check.py`）：有 `error` 就返回 422 `CARD_CHECK_FAILED` 和问题清单，`warning` 不挡保存；
- 存成功以后版本号加 1、记一份版本历史；草稿留着（不再出现在草稿列表里），下次从仓库打开同一张卡时接着用它；
- 带 `new_scenario: true` 时，顺便用这张卡建一个剧本（“保存并开始新故事”）。

- 鉴权：需要
- 请求体：[`DraftSaveIn`](#draftsavein)
- 成功：`200`，返回 [`DraftSaveOut`](#draftsaveout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |
| 409 | `CARD_CHANGED` | 卡在别处改过，带卡当前的 `version` |
| 422 | `CARD_CHECK_FAILED` | 卡片没通过检查，带 `issues`（[`IssueOut`](#issueout) 的数组，只有 `error`）和第一个问题的 `field` |

#### `DraftSaveIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `new_scenario` | boolean | 否 | 顺便用这张卡建一个剧本，默认否 |
| `on_conflict` | string / null | 否 | 卡在别处改过时怎么办：`overwrite`（覆盖）/ `copy`（另存成新卡）；不传时返回 409 |

### `DELETE /v1/workbench/drafts/{draft_id}`

删除草稿和它的图片记录（agent 正在跑时先让它停下）。图片本身没有别处在用（不是哪张卡的封面）时一起删掉。仓库里的卡不受影响。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |

### `GET /v1/workbench/drafts/{draft_id}/messages`

agent 模式的对话记录，按序号排；以及此刻最新的推送事件编号 `last_event_id`：订阅事件流时从它之后开始，就不会漏也不会重复。

- 鉴权：需要
- 成功：`200`，返回 [`TranscriptOut`](#transcriptout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |

### `POST /v1/workbench/drafts/{draft_id}/messages`

用户在对话里说一句话（`text`）、交问卷（`answers`）、回复方案（`plan_reply`），然后开新一轮 agent：
一个事务里写这条消息、把草稿从 `idle` / `awaiting_user` 改成 `running`、放一个后台任务。agent 在 worker 进程里跑，进展用 [事件流](#get-v1workbenchdraftsdraft_idevents) 推送。

- `answers` 只能在草稿等着回答问卷时交，`plan_reply` 只能在等着确认方案时交（看 `awaiting`）；
- 交问卷时没答的题按推荐项补上；`delegated` 为真表示“都交给你”；
- 确认方案以后草稿进入 `build`：agent 才能往卡里写。退回时要写明想改哪里；
- 草稿在等用户决定改动时也可以直接说话，那些改动还可以接着决定。

- 鉴权：需要
- 请求体：[`MessageIn`](#messagein)
- 成功：`201`，返回 [`MessageOut`](#messageout)（刚写的这条）。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |
| 409 | `DRAFT_BUSY` | agent 还在跑（先停止，或者等它做完） |
| 409 | `NOT_AWAITING` | 草稿不在等问卷的回答（`answers`）或方案的回复（`plan_reply`） |
| 409 | `TOO_MANY_RUNS` | 同时在写的 agent 已经到上限（别的草稿还在写），带 `limit` |
| 422 | `VALIDATION_ERROR` | 说的话为空或超过 8000 字（`field: "text"`）；回答里有不认识的题或类型不对（`field: "answers"`）；退回方案没写原因（`field: "text"`） |
| 429 | `RATE_LIMITED` | 工作台的操作每分钟超过 20 次（同一个用户，和导入、上传、出图、发消息、接着写共用一个计数） |

#### `MessageIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | string | 是 | `text` / `answers` / `plan_reply` |
| `text` | string / null | 否 | `text` 时是说的话；`plan_reply` 退回时是想改的地方。最多 8000 个字符 |
| `answers` | object / null | 否 | `answers` 时：键是问卷里的 `qid`；单选题是一个字符串（选项，或者“其他”里自己写的话），多选题是字符串数组 |
| `delegated` | boolean | 否 | `answers` 时：“都交给你” |
| `approved` | boolean / null | 否 | `plan_reply` 时：确认（真）或退回（假） |
| `name` | string / null | 否 | `plan_reply` 确认时选中的名字（可以是自己写的），最多 80 个字符；不传用方案里的第一个 |

### `POST /v1/workbench/drafts/{draft_id}/changes/{seq}`

对一条改动对比（`kind` 为 `changes` 的消息，`seq` 是它的序号）做决定，不开新一轮：

- 采用的几处一起写进草稿，版本号加 1。写之前先检查草稿里那一处现在还是不是改前的样子：不是（比如用户手动改过）就标成 `stale`，不写；
- `all: "accept"` 全部采用，`all: "reject"` 都不要；逐条看时 `accept`、`reject` 列出这次决定的几处，没提到的还是 `pending`；
- 一条改动里没有 `pending` 的了，草稿就不再等用户决定（回到 `idle`）。

- 鉴权：需要
- 请求体：[`ChangesDecisionIn`](#changesdecisionin)
- 成功：`200`，返回 [`ChangesDecisionOut`](#changesdecisionout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在，或者这个序号不是改动对比 |
| 409 | `CHANGE_DECIDED` | 这条改动的每一处都已经决定过了 |
| 422 | `VALIDATION_ERROR` | `accept` 或 `reject` 里有不认识的编号（`field: "accept"`） |

#### `ChangesDecisionIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `accept` | array of string | 否 | 采用的几处（`h1`、`h2`……），最多 50 个 |
| `reject` | array of string | 否 | 不要的几处 |
| `all` | string / null | 否 | `accept`（全部采用）或 `reject`（都不要）；给了就不看 `accept`、`reject` |

### `POST /v1/workbench/drafts/{draft_id}/stop`

停止 agent：它做完手上这一步就收尾，进度清单保留。切到手动接管时客户端用 `PATCH /v1/workbench/drafts/{draft_id}` 切模式，效果一样。没有请求体。

- 鉴权：需要
- 成功：`200`，返回 [`StopOut`](#stopout)。agent 没在跑时 `stopped` 为假。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |

### `POST /v1/workbench/drafts/{draft_id}/continue`

让 agent 接着做（“接着写完”）：从手动切回来、上一轮被停下或出错以后用。手动开始或导入的草稿还没写完时，agent 直接动手写，不再问卷、出方案；
写完的卡接着改时只能给改动对比。没有请求体。

- 鉴权：需要
- 成功：`200`，返回 [`DraftOut`](#draftout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |
| 409 | `DRAFT_BUSY` | agent 还在跑 |
| 409 | `TOO_MANY_RUNS` | 同时在写的 agent 已经到上限，带 `limit` |
| 429 | `RATE_LIMITED` | 工作台的操作每分钟超过 20 次（同一个用户，和导入、上传、出图、发消息、接着写共用一个计数） |

### `GET /v1/workbench/drafts/{draft_id}/events`

推送事件（SSE），格式见下文“推送事件”。连接一直开着，没有事件时每 15 秒发一次 `: keepalive`；客户端断开或服务端优雅退出时结束，客户端重连即可。

- 鉴权：需要
- 请求头 `Last-Event-ID`：从哪一条之后接着推。可以是上次收到的事件 `id`（`{draft_id}:{编号}`），也可以只写编号（例如对话记录接口返回的 `last_event_id`）；不带时从这份草稿现存最早的事件推起。
- 成功：`200`，`Content-Type: text/event-stream`。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 草稿不存在 |

## 推送事件

每条事件：

```
id: {draft_id}:{编号}
event: {类型}
data: {JSON}
```

| 类型 | `data` | 说明 |
| --- | --- | --- |
| `status` | `{"agent_status", "stage", "awaiting", "trigger", "mode", "done"}`（只带变了的） | agent 开始跑、阶段变了、一轮结束（`done` 为真）、用户的决定让草稿不再等待 |
| `delta` | `{"text"}` | agent 说的话，一小段（约 150 毫秒攒一批）。这一段说完以后会有一条 `message`（`kind` 为 `text`），以它为准 |
| `field_delta` | `{"target": {"field": "first_mes"} 或 {"lore": "条目名"}, "text"}` | 正在写的字段一小段：卡片预览上“正在写”的那一项实时出字。写完、校验通过才真正写进草稿，那时会有一条 `draft` |
| `tool` | `{"name", "state": "start"}` | 开始用一个工具（写字段、写世界书、搜索……） |
| `message` | [`MessageOut`](#messageout) 的样子 | 新的一条对话记录，或者一条改动对比的决定变了（序号相同，整条替换） |
| `todos` | `{"todos": [...]}` | 进度清单变了 |
| `draft` | `{"version", "fields": [...]}` | 草稿内容变了：客户端重新读草稿（`GET /v1/workbench/drafts/{draft_id}`）刷新这几项 |

## 响应对象

### `DraftSummaryOut`

草稿列表项。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 草稿 ID，也是工作台地址里的编号 |
| `name` | string | 显示名，可能是空串（界面写“新角色”） |
| `character_name` | string | 角色名，可能是空串 |
| `origin` | string | 怎么开始的：`agent` / `manual` / `import_file` / `edit_card` |
| `card_id` | string / null | 对应仓库里的哪张卡；全新的卡第一次保存前为 null |
| `cover_blob_id` | string / null | 封面 |
| `mode` | string | 上次停在哪种模式：`agent` / `manual` |
| `stage` | string | agent 走到哪一步：`start` / `research` / `questions` / `plan` / `build` / `check` / `done` / `revise` |
| `agent_status` | string | `idle` / `running` / `awaiting_user` |
| `awaiting` | object / null | 在等用户做什么：`{"kind": "questions" | "plan" | "changes", "seq": 12}` |
| `version` | integer | 草稿的版本号 |
| `saved_version` | integer / null | 上次保存到仓库时草稿的版本号；从没保存过是 null |
| `unsaved` | boolean | 有没保存的修改（`saved_version` 不等于 `version`） |
| `created_at` | string（时间） | 创建时间 |
| `updated_at` | string（时间） | 最近改动时间 |

### `DraftOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `draft` | [`DraftSummaryOut`](#draftsummaryout) | 概况 |
| `card` | [`CharacterCardOut`](library.md#charactercardout) | 卡片内容，世界书按顺序排好 |
| `cover_asset_id` | string / null | 选中的封面是哪张图 |
| `base_version` | integer / null | 打开草稿（或上次保存）时对应那张卡的版本号 |
| `todos` | array of object | agent 的进度清单：`[{"key", "text", "state": "done" | "doing" | "todo", "detail"}]` |
| `language` | string | 草稿的语言 |
| `issues` | array of [`IssueOut`](#issueout) | 按保存的规则检查的结果（宽松模式下允许的空名字、空条目在这里是 `error`） |
| `assets` | array of [`AssetOut`](#assetout) | 草稿里的图片，按加进来的时间排 |
| `notes` | array of [`NoteOut`](#noteout) | agent 查资料记下的笔记，按记下的时间排；资料页用 |

### `IssueOut`

检查出的一个问题。`code` 和客户端 `packages/core/src/scenario/cardEdit.ts` 一致，客户端按它显示界面语言的文字。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `field` | string | 哪个字段：`display_name`、`name`、文本字段名、`alternate_greetings.{序号}`、`tags`、`book`、`book.{序号}.name` / `.keys` / `.content`，总量是 `card` |
| `code` | string | 见下表 |
| `level` | string | `error`（不能保存）/ `warning`（能保存，多半是写漏了） |
| `params` | object | 填进提示文字的参数，例如 `max`、`n`、`macro`、`key`、`other` |

| `code` | 级别 | 含义 |
| --- | --- | --- |
| `display_name_empty`、`name_empty` | error | 显示名、角色名为空 |
| `display_name_too_long`、`name_too_long` | error | 超过 80 字（`max`） |
| `field_too_long` | error | 文本字段、开场白或条目内容超过 60000 字（`max`、`n`） |
| `total_too_long` | error | 文字总量超过 300000 字（`max`、`n`） |
| `too_many_greetings` | error | 备选开场白超过 32 条 |
| `greeting_empty` | error | 有一条备选开场白是空的 |
| `too_many_tags`、`tag_too_long` | error | 标签超过 32 个，或者有一个超过 40 字 |
| `too_many_entries` | error | 世界书超过 1000 条 |
| `entry_empty` | error | 世界书条目的内容为空 |
| `entry_name_too_long`、`too_many_keys`、`key_too_long` | error | 条目名称超过 120 字；关键词超过 64 个或有一个超过 100 字 |
| `description_empty` | warning | 没写角色描述 |
| `opening_empty` | warning | 没写开场白 |
| `entry_unreachable` | warning | 条目启用了，但既没有关键词也不常驻，永远用不到 |
| `key_duplicate` | warning | 关键词和前面某一条重复（`key`、`other` 是那一条的序号，从 1 开始） |
| `macro_unknown` | warning | `{{user}}`、`{{char}}` 以外的宏，开局时会被丢掉（`macro`） |
| `macro_broken` | warning | 花括号不成对，像是 `{{user}}`、`{{char}}` 写错了（`macro`） |

### `AssetOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 图片记录的 ID（选封面时用） |
| `blob_id` | string | 图片文件，用 `GET /v1/blobs/{blob_id}` 读取 |
| `source` | string | `search`（网上找到的）/ `generated`（文生图）/ `upload`（用户上传）/ `card`（卡自带的） |
| `license` | string | `public_domain` / `copyrighted` / `unknown` / `own` |
| `source_url` | string / null | 找到的图原来的地址 |
| `prompt` | string / null | 生成图用的提示词 |
| `mime` | string | 图片类型 |
| `width` | integer / null | 宽 |
| `height` | integer / null | 高 |
| `personal_use` | boolean | 用户确认过“仅限个人使用” |
| `created_at` | string（时间） | 加进草稿的时间 |

### `MessageOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `seq` | integer | 序号，从 1 开始 |
| `role` | string | `user` / `assistant` |
| `kind` | string | `text` / `research` / `questions` / `answers` / `plan` / `plan_reply` / `changes` / `images` / `progress` / `error` |
| `content` | object | 结构随 `kind` 变，见 [数据模型：`workbench_messages.content`](../data-model/workbench.md#workbench_messagescontent) |
| `created_at` | string（时间） | 时间 |

### `TranscriptOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `messages` | array of [`MessageOut`](#messageout) | 全部对话记录，按序号排 |
| `last_event_id` | integer | 此刻最新的推送事件编号；订阅事件流时带上它（`Last-Event-ID`） |

### `ChangesDecisionOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `message` | [`MessageOut`](#messageout) | 决定以后的那条改动对比（每一处的 `state` 已经更新） |
| `draft` | [`DraftOut`](#draftout) | 决定以后的草稿 |

### `StopOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `stopped` | boolean | agent 原来在跑、已经让它停下 |

### `NoteOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | ID |
| `text` | string | 笔记，最多 2000 字 |
| `url` | string | 出处的地址，可能是空串 |
| `title` | string | 出处的标题 |
| `site` | string | 出处的网站（域名） |
| `used_in` | array of string | 打算用在卡片哪里（字段名） |

### `DraftImportOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `draft` | [`DraftOut`](#draftout) / null | 新草稿；文件已经导入过时为 null |
| `existing_card` | [`CardOut`](library.md#cardout) / null | 文件已经导入过时，是那张卡 |

### `DraftSaveOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `card` | [`CardOut`](library.md#cardout) | 保存后的卡 |
| `draft` | [`DraftOut`](#draftout) | 保存后的草稿（`unsaved` 为假） |
| `scenario` | [`ScenarioOut`](library.md#scenarioout) / null | `new_scenario` 时新建的剧本 |
