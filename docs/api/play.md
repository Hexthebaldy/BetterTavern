# 接口：游玩与回合

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](../data-model/README.md) · [接口](README.md)
>
> 接口：[说明与约定](README.md) · [认证与账户](auth.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](play.md) · [回合事件流](events.md) · [运维与开发](ops.md)

开局、游玩列表与详情、世界状态的只读视图、历史回合、提交行动（包括写结局）、停止生成，以及订阅回合的事件流。
事件流的格式见 [events.md](events.md)；相关的表见 [数据模型：游玩与回合](../data-model/story.md)、[世界状态](../data-model/world.md)。

## 接口

### `POST /v1/playthroughs`

开局。服务端在一个事务里创建游玩（`building` 状态）和开场回合（`seq` 0，`generating` 状态），领取租约，然后在后台搭建世界并生成开场。
客户端用返回的 `events_url` 订阅开场回合的事件流，会先收到 `world.building` 和 `world.ready`。

这个接口不是幂等的：重发请求会再创建一局。

- 鉴权：需要；按用户限流，和提交行动共用一个计数。
- 请求体：[`PlaythroughIn`](#playthroughin)
- 成功：`202`，返回 [`PlaythroughCreatedOut`](#playthroughcreatedout)。
- 搭建世界：如果有可用的路由（`world_builder`，没有就用导演的）和角色卡，就调用模型生成开局设定，超时 30 秒。
  模型失败或超时时，改用卡片原文生成最小设定（`world.ready` 的 `source` 为 `minimal`），开场不会因此失败。

| HTTP | code | 情形 |
| --- | --- | --- |
| 422 | `VALIDATION_ERROR` | 主角名整理后为空（`field: "protagonist_name"`） |
| 404 | `NOT_FOUND` | 剧本不存在 |
| 409 | `ROUTE_MISSING` | 还没有设置导演模型 |
| 409 | `CREDENTIAL_UNREADABLE` | 导演模型的 Key 无法解密 |
| 429 | `RATE_LIMITED` | 每分钟超过 30 次（和提交行动合计） |
| 503 | `UNAVAILABLE` | 服务正在重启，带 `Retry-After: 5` |

#### `PlaythroughIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `scenario_id` | string | 是 | 用哪个剧本开局 |
| `protagonist` | [`ProtagonistIn`](#protagonistin) | 是 | 玩家扮演的主角 |
| `title` | string / null | 否 | 标题，最多 80 个字符；不填时用剧本名 |
| `preferences` | [`PreferencesIn`](#preferencesin) | 否 | 叙述偏好，不传就全部用默认值 |
| `language` | string | 否 | 这一局给 agent 的提示词用哪种语言：`zh`（默认）/ `en` / `ja`。客户端传当前的界面语言；之后不能改，也不影响故事正文用什么语言（见 [i18n.md](../i18n.md) 第 4 节） |

#### `ProtagonistIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 主角的名字，1 到 40 个字符。服务端会做 NFKC 规范化、合并连续空白 |
| `summary` | string | 否 | 主角的外貌、身份等，最多 400 个字符 |

#### `PreferencesIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `length` | string | 否 | 每轮叙述的篇幅：`short` / `medium` / `long`，默认 `medium` |
| `style` | string | 否 | 文风要求，最多 200 个字符 |
| `boundaries` | string | 否 | 内容边界，例如不想看到的内容，最多 300 个字符 |

### `GET /v1/playthroughs`

我的游玩，按最近更新倒序排列，最多 100 条，不分页。每条都带头部回合的 `head_seq` 和 `head_excerpt`。

- 鉴权：需要
- 成功：`200`，返回 [`PlaythroughOut`](#playthroughout) 数组。

### `GET /v1/playthroughs/{playthrough_id}`

游玩详情，加上头部回合、正在生成的回合和最近一次失败的尝试。客户端打开阅读页时先调用这个接口（见 [README.md 的“一次完整的流程”](README.md#一次完整的流程)第 9 步）。

- 鉴权：需要
- 成功：`200`，返回 [`PlaythroughDetailOut`](#playthroughdetailout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 游玩不存在 |

### `PATCH /v1/playthroughs/{playthrough_id}`

修改标题。

- 鉴权：需要
- 请求体：[`PlaythroughPatchIn`](#playthroughpatchin)
- 成功：`200`，返回 [`PlaythroughOut`](#playthroughout)。这个响应里 `head_seq` 是 null，`head_excerpt` 是空串。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 游玩不存在 |
| 422 | `VALIDATION_ERROR` | 标题去掉首尾空白后为空（`field: "title"`） |

#### `PlaythroughPatchIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 新标题，1 到 80 个字符 |

### `DELETE /v1/playthroughs/{playthrough_id}`

删除游玩，包括全部回合、世界状态、单局的路由覆盖和调用记录。如果有正在生成的回合，并且在当前实例上，先取消它。

- 鉴权：需要
- 成功：`204`，没有响应体。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 游玩不存在 |

### `GET /v1/playthroughs/{playthrough_id}/world`

世界状态的只读视图：实体、关系和事实。M1 的世界状态只在开局时写入，之后不再变化。

- 鉴权：需要
- 查询参数 `reveal`（布尔，默认 `false`）：为真时，主角不知道的秘密事实也一起返回（会剧透）。
- 成功：`200`，返回 [`WorldOut`](#worldout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 游玩不存在 |

### `GET /v1/playthroughs/{playthrough_id}/turns`

历史回合：活跃链上的回合（`replied`、`committed` 状态），按 `seq` 升序排列。失败的尝试、被回退的回合和正在生成的回合都不包括在内。

- 鉴权：需要
- 查询参数 `after_seq`（整数，不小于 −1，默认 −1）：只返回 `seq` 大于它的回合。翻页时，用上一页最后一个回合的 `seq` 作为下一页的 `after_seq`。
- 查询参数 `limit`（整数，1 到 200，默认 50）：最多返回多少个回合。
- 成功：`200`，返回 [`TurnListOut`](#turnlistout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 游玩不存在 |
| 422 | `VALIDATION_ERROR` | 查询参数超出范围 |

### `POST /v1/playthroughs/{playthrough_id}/turns`

提交玩家的行动。回合创建后在后台生成，和客户端的连接无关；客户端订阅返回的 `events_url`。

- 鉴权：需要；按用户限流，和开局共用一个计数。
- 请求头 `Idempotency-Key`（可选，强烈建议带上）：每次新的提交生成一个新的值（例如 UUID）。网络出错、不知道请求有没有送达时，用同一个值重发。
  同一个值、同样的请求内容，返回 `200` 和当初创建的那个回合，不论它现在是什么状态；同一个值、不同的请求内容，返回 422 `IDEMPOTENCY_KEY_REUSED`。幂等键保留 24 小时。
  重放之前仍然会先检查服务是否在重启和限流，所以重放也可能得到 503 或 429，并且也计入限流次数。
- 请求体：[`TurnIn`](#turnin)
- 成功：`201`，返回 [`TurnCreatedOut`](#turncreatedout)，回合状态是 `generating`；同一个幂等键的重放返回 `200`。

行动的规则：
- `parent_turn_id` 必须等于当前的头部回合（开场还没完成时为 null）。
- `source` 为 `option` 时，`option_id` 必须是父回合的选项（`o1` 或 `o2`）。客户端只发 `option_id`，选项文字由服务端从父回合里取，客户端不能伪造。
- `source` 为 `text` 时，`text` 去掉首尾空白后为 1 到 2000 个字符。
- `source` 为 `opening` 时，重新生成开场。只有开场还没有完成（没有头部回合、`parent_turn_id` 为 null）时可以使用，用于开场失败后的重试。
- `source` 为 `ending` 时，让导演写整个故事的最后一段。`text` 是玩家希望的结局方向，可以不填；填了的话去掉首尾空白后最多 2000 个字符。
  - 开场完成后才能写结局。
  - 结局这一轮写完时，叙述照常保存，选项是空的（模型写了选项也会丢掉，也不另调模型补），游玩的 `status` 在同一个事务里变成 `ended`。
  - 之后这局不能再提交任何行动，包括再写一次结局；改名、看世界状态、删除照常可以。没有撤销。
  - 结局这一轮失败或被停止时，和普通的回合一样可以重试，游玩仍是 `active`，也可以不重试、继续正常提交行动。
- 重试一个失败的回合：用同样的 `parent_turn_id` 和同样的行动再提交一次，但要换一个新的 `Idempotency-Key`（用原来的值会原样返回那个失败的回合）。
  新回合的 `seq` 相同，`attempt` 加 1。

检查的顺序：服务是否在重启 → 限流 → 路径和参数的格式 → 幂等键重放 → 游玩的归属 → 故事是否已完结 → 导演模型 → 锁住游玩
→ 故事是否已完结（再看一次，防止另一台设备刚好写完结局）→ 是否有正在生成的回合（租约已过期的，先把它标为失败）
→ `parent_turn_id` 是不是当前头部 → 行动本身。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 游玩不存在 |
| 409 | `ROUTE_MISSING` | 还没有设置导演模型 |
| 409 | `CREDENTIAL_UNREADABLE` | 导演模型的 Key 无法解密 |
| 409 | `TURN_IN_PROGRESS` | 上一轮还在生成，带 `active_turn_id`；客户端可以直接订阅它的事件流 |
| 409 | `STALE_PARENT` | `parent_turn_id` 不是当前头部（故事在别处更新过），带最新的 `head_turn_id`。已经有开场时提交 `opening` 并且 `parent_turn_id` 为 null，得到的也是这个码 |
| 409 | `OPENING_PENDING` | 开场还没完成，就提交了 `option`、`text` 或 `ending` 行动 |
| 409 | `STORY_ENDED` | 这局已经写完结局（`status` 是 `ended`），不能再提交行动 |
| 422 | `OPENING_EXISTS` | `parent_turn_id` 是当前头部（已经有开场）时提交了 `opening` |
| 422 | `OPTION_NOT_FOUND` | `option_id` 不在父回合的选项里 |
| 422 | `IDEMPOTENCY_KEY_REUSED` | 同一个 `Idempotency-Key` 对应了不同的请求内容 |
| 422 | `VALIDATION_ERROR` | `parent_turn_id` 不是 UUID（`field: "parent_turn_id"`）；`Idempotency-Key` 长度不对（`field: "Idempotency-Key"`）；字段超过 `TurnIn` 的限制（带 `errors`）；`option` 行动缺 `option_id`、自由输入为空或超过 2000 字、结局方向超过 2000 字（不带 `field`，原因在 `title` 里） |
| 429 | `RATE_LIMITED` | 每分钟超过 30 次（和开局合计） |
| 503 | `UNAVAILABLE` | 服务正在重启，带 `Retry-After: 5` |

#### `TurnIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `parent_turn_id` | string / null | 否 | 当前头部回合的 id；开场时为 null |
| `action` | [`ActionIn`](#actionin) | 是 | 玩家的行动 |

#### `ActionIn`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | string | 是 | `option`（点选项）/ `text`（自由输入）/ `opening`（重新生成开场）/ `ending`（写结局） |
| `text` | string / null | 否 | `source` 为 `text` 时必填；为 `ending` 时是结局方向，可以不填。请求里最长 4000 个字符，去掉首尾空白后不能超过 2000 个字符 |
| `option_id` | string / null | 否 | `source` 为 `option` 时必填：`o1` 或 `o2` |

### `GET /v1/turns/{turn_id}`

单个回合，任何状态的回合都能查到，包括失败的尝试。

- 鉴权：需要
- 成功：`200`，返回 [`TurnOut`](#turnout)。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 回合不存在 |

### `POST /v1/turns/{turn_id}/cancel`

停止生成。没有请求体。

- 鉴权：需要
- 成功：`200`，返回 [`TurnOut`](#turnout)。
  - 回合不在生成中时，什么都不做，原样返回。
  - 回合在生成中时，通知生成任务停止，返回的回合仍然是 `generating`。随后事件流会收到 `turn.failed`（`CANCELLED`，可以重试），已经生成的叙述保存为草稿。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 回合不存在 |
| 409 | `TURN_NOT_LOCAL` | 这一轮不在当前的服务实例上，这个接口停不了它。如果它在另一个还在运行的实例上，会照常生成完；如果那个实例已经不在了（例如服务重启过），租约到期后（最长约 2 分钟）以 `RUNNER_LOST` 结束 |

### `GET /v1/turns/{turn_id}/events`

回合的事件流（SSE），格式和续传规则见 [events.md](events.md)。回合不存在时，在开始推送之前返回 404 的 problem+json。

- 鉴权：需要
- 请求头 `Last-Event-ID`（可选）：最后收到的事件 id，断线重连时带上。
- 成功：`200`，`Content-Type: text/event-stream`。

| HTTP | code | 情形 |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 回合不存在 |

## 响应对象

### `PlaythroughOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 游玩 ID |
| `title` | string | 标题 |
| `status` | string | `building`（世界还没建好）/ `active` / `ended`（已经写完结局，不能再提交行动） |
| `scenario_id` | string / null | 剧本；剧本被删除后为 null |
| `language` | string | 提示词的语言：`zh` / `en` / `ja`，开局时定下 |
| `protagonist_name` | string | 主角的名字 |
| `preferences` | object | 叙述偏好 `{"length", "style", "boundaries"}`，含义同 [`PreferencesIn`](#preferencesin) |
| `head_turn_id` | string / null | 头部回合，也就是最新一个完成的回合；开场完成前为 null |
| `head_seq` | integer / null | 头部回合的 `seq`。只有游玩列表和游玩详情会填，其他接口的响应里是 null |
| `head_excerpt` | string | 头部回合叙述的前 120 个字符，供列表显示。只有游玩列表和游玩详情会填，其他接口的响应里是空串 |
| `active_turn_id` | string / null | 正在生成的回合 |
| `rollback_floor_seq` | integer | 回退的下限，一直是 0；agent runtime 阶段 4 删掉（[agent-runtime.md](../agent-runtime.md) 第 8 节） |
| `state_seq` | integer | 世界状态已整理到第几回合；-1 表示还没整理过任何回合（还是开局时的样子）。世界状态由后台整理，可能比头部回合落后几回合 |
| `seed_source` | string / null | 开局设定的来源：`world_builder` / `minimal`；世界建好之前为 null |
| `created_at` | string（时间） | 创建时间 |
| `updated_at` | string（时间） | 最近更新时间（改名、开始生成、生成结束时更新） |

### `PlaythroughDetailOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `playthrough` | [`PlaythroughOut`](#playthroughout) | 游玩本身 |
| `head` | [`TurnOut`](#turnout) / null | 头部回合 |
| `active_turn` | [`TurnOut`](#turnout) / null | 正在生成的回合；客户端用它的 id 订阅事件流 |
| `last_failed` | [`TurnOut`](#turnout) / null | 头部之后最近一次失败的尝试（`seq` 等于头部的 `seq` 加 1；没有头部时是开场）。只在没有正在生成的回合时返回，客户端据此显示“重试” |

### `PlaythroughCreatedOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `playthrough` | [`PlaythroughOut`](#playthroughout) | 新建的游玩，`status` 是 `building` |
| `turn` | [`TurnOut`](#turnout) | 开场回合：`seq` 是 0，`status` 是 `generating` |
| `events_url` | string | 开场回合的事件流路径 `/v1/turns/{turn_id}/events` |

### `TurnOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 回合 ID |
| `playthrough_id` | string | 所属的游玩 |
| `seq` | integer | 回合序号，0 是开场 |
| `attempt` | integer | 同一个 `seq` 的第几次尝试，从 0 开始 |
| `status` | string | `generating` / `replied`（叙述和选项已保存，世界状态还没整理）/ `committed`（世界状态已整理，或者整理失败两次后跳过了；结局那一轮保存时直接是它）/ `failed` / `archived`。客户端把 `replied` 和 `committed` 都当成已完成 |
| `action` | object | 服务端解析后的玩家行动 `{"source", "text", "option_id"}`：`text` 由服务端确定（点选项时是选项的文字），`option_id` 只在点选项时有；开场是 `{"source": "opening", "text": ""}`；写结局是 `{"source": "ending", "text": "结局方向，没填时是空串"}` |
| `narrative` | string | 叙述。生成中是空串，增量要从事件流里拿；失败时可能是半截草稿（此时 `error.partial` 为真） |
| `options` | array of [`OptionOut`](#optionout) | 两个选项；生成中、失败时和结局那一轮为空数组 |
| `options_source` | string / null | 选项的来源：`model`（模型给的）/ `repaired`（另调小模型补的）/ `fallback`（固定的兜底选项）；完成前和结局那一轮为 null |
| `state_seq` | integer | 写这一回合时，状态块截至第几回合（-1 表示开局时的样子）。下一回合不等世界状态整理完，所以它可能比 `seq - 1` 小 |
| `error` | object / null | 失败原因 `{"code", "message", "retryable", "partial"}`，`code` 见 [README.md 的“回合失败码”](README.md#回合失败码) |
| `created_at` | string（时间） | 提交时间 |
| `replied_at` | string（时间）/ null | 叙述和选项保存的时间 |

### `OptionOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `o1` 或 `o2`，提交行动时作为 `option_id` |
| `text` | string | 选项的文字 |

### `TurnCreatedOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `turn` | [`TurnOut`](#turnout) | 新回合（幂等重放时是当初创建的回合） |
| `events_url` | string | 这个回合的事件流路径 `/v1/turns/{turn_id}/events` |

### `TurnListOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `turns` | array of [`TurnOut`](#turnout) | 按 `seq` 升序排列 |

### `WorldOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `entities` | array of [`WorldEntityOut`](#worldentityout) | 没有退场的实体，按类型、最近一次出现的回合（从近到远）、首次出现的回合、名字排序 |
| `links` | array of object | 实体之间的关系 `{"src_id", "rel", "dst_id"}`。`rel` 是 `located_in`（在某个地点）/ `held_by`（在某人手里）/ `member_of`（属于某个组织）/ `part_of`（地点属于更大的地点）/ `knows_of`（人物认识或知道某个实体） |
| `facts` | array of [`WorldFactOut`](#worldfactout) | 有效的事实，按建立于第几回合从近到远排序 |
| `hidden_facts` | integer | 被隐藏的秘密事实的数量；`reveal=true` 时为 0 |
| `state_seq` | integer | 世界状态已整理到第几回合，同 [`PlaythroughOut`](#playthroughout) 的 `state_seq`。客户端显示“截至第几回合” |
| `state_issue` | [`WorldStateIssueOut`](#worldstateissueout) / null | 整理世界状态时遇到的问题；没有问题时为 null |

### `WorldStateIssueOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `seq` | integer | 出问题的回合 |
| `kind` | string | `failed`：这一回合整理失败了，下一回合的整理会再试一次；`skipped`：失败两次，这一回合跳过了，里面的变化可能没记下来。有正在失败的回合时给 `failed`，否则给最近一次被跳过的回合 |
| `reason` | string / null | 最近一次失败的原因（英文代码，例如 `timeout`、`rate_limit`、`tools_unsupported`、`no_commit`），客户端按它翻译 |

### `WorldEntityOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 实体 ID |
| `kind` | string | `character` / `item` / `location` / `organization` / `world` |
| `name` | string | 名字；`world` 实体固定叫“世界” |
| `aliases` | array of string | 别名 |
| `summary` | string | 描述 |
| `data` | object | 按类型不同的属性，结构见 [数据模型：`entities.data`](../data-model/world.md#entitiesdata) |
| `is_protagonist` | boolean | 是否是主角 |

### `WorldFactOut`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 事实 ID |
| `text` | string | 事实内容 |
| `entity_ids` | array of string | 涉及的实体 |
| `secret` | boolean | 是否是秘密（主角一开始不知道的）。秘密只在 `reveal=true`，或者主角已经知道时才会返回 |
