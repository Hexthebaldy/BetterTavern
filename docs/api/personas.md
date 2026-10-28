# 接口：人设库

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [人设库](personas.md) · [工作台](workbench.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

人设是玩家扮演的“我”：名字、描述、头像（可以没有），存在设置里的人设库，好几个剧本、好几局都能用。每个用户最多一个默认人设。
剧本的设置里可以选一个人设（[`ScenarioSetupModel`](library.md#scenariosetupmodel) 的 `persona_id`），开新故事时先替玩家选好；
开局时把人设的名字和描述存进这一局，之后改人设不影响已经开始的故事。设计见 [personas.md](../personas.md)，表见 [数据模型：人设库](../data-model/personas.md)。

## 接口

### `GET /v1/personas`

我的人设，默认人设排第一，其余按建的先后。不分页（最多 200 个）。

- 鉴权：需要
- 成功：`200`，返回 [`PersonaOut`](#personaout) 的数组。

### `POST /v1/personas`

新建一个人设。

- 鉴权：需要
- 请求体：[`PersonaIn`](#personain)
- 成功：`201`，返回 [`PersonaOut`](#personaout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 409 | `TOO_MANY_PERSONAS` | 人设已经到上限（默认 200 个，`MAX_PERSONAS`），带 `limit` |
| 422 | `VALIDATION_ERROR` | 名字整理后为空或超过 40 个字符（`field: "name"`）；描述超过 2000 个字符（`field: "description"`） |

#### `PersonaIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 名字，1 到 40 个字符（NFKC 规整、连续空白合成一个，和主角名一样） |
| `description` | string | 否 | 描述：外貌、经历、性格，最多 2000 个字符；导演每回合都看（[agent-runtime.md](../agent-runtime.md) 第 6 节“主角设定”） |
| `is_default` | boolean | 否 | 设成默认人设，默认否；原来的默认人设随之取消 |

### `POST /v1/personas/import`

导入 SillyTavern 的人设备份文件（人设管理里“备份”导出的 `personas_日期.json`）。请求体是 `multipart/form-data`，`file` 字段是文件，最大 2 MB。

- 文件里只有名字和描述，没有头像；描述放在哪里、深度、专属世界书这些设置不导入。
- 名字和描述都和已有的人设一样的跳过；没有名字的跳过；描述超过 2000 个字符的截断；到上限以后的跳过。
- 文件里的默认人设，只在人设库里还没有默认人设时才设成默认。
- 和工作台的导入、上传共用每分钟 20 次的限流计数。

- 鉴权：需要
- 成功：`201`，返回 [`PersonaImportOut`](#personaimportout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 413 | `PAYLOAD_TOO_LARGE` | 文件超过 2 MB |
| 422 | `PERSONA_BACKUP_INVALID` | 不是 JSON，或者不是 SillyTavern 的人设备份 |
| 429 | `RATE_LIMITED` | 超过限流 |

### `PATCH /v1/personas/{persona_id}`

改名字、描述，或者设成 / 取消默认人设。不传的项不改。改了名字或描述时，选了这个人设的剧本里 `setup.protagonist` 的副本跟着改；
已经开始的故事不受影响。

- 鉴权：需要
- 请求体：[`PersonaPatchIn`](#personapatchin)
- 成功：`200`，返回 [`PersonaOut`](#personaout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 人设不存在 |
| 422 | `VALIDATION_ERROR` | 同 `POST /v1/personas` |

#### `PersonaPatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string / null | 否 | 新名字 |
| `description` | string / null | 否 | 新描述 |
| `is_default` | boolean / null | 否 | `true` 设成默认（原来的默认人设取消），`false` 取消默认 |

### `DELETE /v1/personas/{persona_id}`

删除人设。选了它的剧本不再选人设（默认主角的副本也清掉）；头像没有别处在用时一起删掉。已经开始的故事不受影响，只是不再显示头像。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 人设不存在 |

### `PUT /v1/personas/{persona_id}/avatar`

换头像。请求体是 `multipart/form-data`，`file` 字段是 PNG、JPEG 或 WebP，最大 16 MB。图片清洗同封面（解码校验、去 EXIF），
再居中裁成正方形、缩到 512×512。原来的头像没有别处在用时删掉。和工作台的导入、上传共用每分钟 20 次的限流计数。

- 鉴权：需要
- 成功：`200`，返回 [`PersonaOut`](#personaout)。图片用 [`GET /v1/blobs/{blob_id}`](library.md#get-v1blobsblob_id) 取。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 人设不存在 |
| 409 | `STORAGE_FULL` | 存的图已经到上限 |
| 413 | `PAYLOAD_TOO_LARGE` | 文件超过 16 MB |
| 422 | `IMAGE_INVALID` | 不是 PNG、JPEG、WebP，或者解码失败 |
| 429 | `RATE_LIMITED` | 超过限流 |

### `DELETE /v1/personas/{persona_id}/avatar`

去掉头像（客户端改画名字的第一个字）。

- 鉴权：需要
- 成功：`200`，返回 [`PersonaOut`](#personaout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 人设不存在 |

## 响应对象

### `PersonaOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 人设 ID |
| `name` | string | 名字 |
| `description` | string | 描述 |
| `avatar_blob_id` | string / null | 头像（正方形）；没有时为 null |
| `is_default` | boolean | 是不是默认人设 |
| `scenario_count` | integer | 几个剧本选了它当默认人设（删除前提醒用） |
| `created_at` | string | 建立时间 |
| `updated_at` | string | 最近修改时间 |

### `PersonaImportOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `personas` | array of [`PersonaOut`](#personaout) | 导入以后人设库里的全部人设（顺序同 `GET /v1/personas`） |
| `created` | integer | 新建了几个 |
| `skipped` | integer | 跳过了几个（和已有的一样、没有名字、超过上限） |
