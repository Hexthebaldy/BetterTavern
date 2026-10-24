# 数据模型：角色卡与剧本

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [点数](credits.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

角色卡仓库（`cards`、`card_revisions`）、剧本仓库（`scenarios`、`scenario_cards`）和图片文件（`blobs`）。
对应的接口见 [api/library.md](../api/library.md)；卡从工作台的草稿保存进来，草稿的表见 [workbench.md](workbench.md)。

迁移 0018 把原来“一个剧本就是一张卡”拆开：每个现有剧本复制出一张卡（卡的 `id` 沿用剧本的 `id`），各记一份版本，
剧本通过 `scenario_cards` 引用它；同一个用户导入过两份相同文件的，只有最早那张卡保留 `source_sha256`。

## 表

### `blobs`

图片文件：角色卡和草稿的封面、草稿里的图片。存之前用 Pillow 完整解码一遍，按 EXIF 方向转正，长边缩到 4096 以内，
重新编码（格式不变），去掉 EXIF 和 PNG 文本块（`importers/images.py`）。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `sha256` | text | 否 |  | 内容的 SHA-256（十六进制）；图片接口的 ETag 取它的前 32 位 |
| `mime` | text | 否 |  | `image/png` / `image/jpeg` / `image/webp`。0018 之前存的是导入的 PNG 卡片原文件（带卡片数据） |
| `size` | integer | 否 |  | 字节数，CHECK 不小于 0 |
| `data` | bytea | 否 |  | 文件内容，最大 16 MB |
| `width` | integer | 是 |  | 宽，CHECK 大于 0；0018 之前存的为空 |
| `height` | integer | 是 |  | 高，CHECK 大于 0 |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：`size >= 0`、`width > 0`、`height > 0` 的 CHECK；`blobs_user_sha_idx (user_id, sha256)`。

一张图可能同时被卡的封面、旧版本的封面和草稿里的图片记录引用。删卡、删草稿、版本被淘汰时，调用方把涉及的图交给
`delete_orphan_blobs`，它只删三处都没人用的。以后换成对象存储，只需要改 `infra/db/repositories/library.py`（[backend.md 第 12 节](../backend.md)）。

### `cards`

角色卡仓库：正式保存的卡。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `name` | text | 否 |  | 显示名，最多 80 字；和卡片里的角色名（`card.name`）是两回事 |
| `source` | text | 否 |  | 最初怎么来的：`card_v1` / `card_v2` / `card_v3`（导入）、`manual`（手动新建）、`agent`（agent 做的） |
| `source_sha256` | text | 是 |  | 导入文件整体的 SHA-256。同一个用户再导入同一个文件时，工作台先问是打开这张卡还是另起一份；另起的那份保存时这一列为空 |
| `raw` | jsonb | 是 |  | 导入时卡片的原始 JSON，原样保存；导出时保留里面 `extensions` 的内容。手动新建和 agent 做的为空 |
| `card` | jsonb | 否 |  | 规范化后的卡片，结构见下文“JSON 列”；开局搭建世界时读它 |
| `cover_blob_id` | uuid | 是 |  | → `blobs.id`，被删除时置空。封面；为空时客户端画几何封面 |
| `meta` | jsonb | 否 | `'{}'` | 附加信息，结构见下文 |
| `version` | integer | 否 | `1` | 每正式保存一次加 1；草稿保存回来时带着开草稿时的版本号，对不上返回 409 `CARD_CHANGED` |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` | 角色卡仓库按它倒序 |

约束与索引：
- `source` 的 CHECK；`version >= 1`；
- `cards_user_idx (user_id, updated_at DESC)`；
- `cards_user_sha_uq (user_id, source_sha256) WHERE source_sha256 IS NOT NULL`：同一个文件只记一张卡。

写回已有的卡是一条带条件的 UPDATE（`… WHERE id = :id AND user_id = :u AND version = :v`），影响行数为 0 就是在别处改过；
用户选“覆盖”时不带版本条件。每次写入（新建、写回、恢复旧版）都在同一个事务里记一份 `card_revisions`。

删卡前查 `scenario_cards`：有剧本在用就拒绝（409 `CARD_IN_USE`），数据库层面也有 `ON DELETE RESTRICT` 兜底。

### `card_revisions`

角色卡每次正式保存的版本，看历史、恢复旧版用。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `card_id` | uuid | 否 |  | → `cards.id`，级联删除 |
| `version` | integer | 否 |  | 等于这次保存以后的 `cards.version`，CHECK 不小于 1 |
| `name` | text | 否 |  | 当时的显示名 |
| `card` | jsonb | 否 |  | 当时的整张卡 |
| `cover_blob_id` | uuid | 是 |  | 当时的封面；→ `blobs.id`，被删除时置空 |
| `draft_id` | uuid | 是 |  | 从哪份草稿保存的；→ `workbench_drafts.id`，被删除时置空 |
| `note` | text | 否 | `''` | 一句话说明；恢复旧版时是 `restore:{原来的版本号}` |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：主键 `(card_id, version)`；`version >= 1`。每张卡最多留 30 份：记新版本的同一个事务里删掉 `version <= 新版本号 - 30` 的，
它们用过的封面交给 `delete_orphan_blobs`。

### `scenarios`

剧本：用了哪几张卡（在 `scenario_cards` 里）加上剧本自己的设置。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `name` | text | 否 |  | 剧本名，最多 80 字；新建时不填就用主角色卡的显示名 |
| `version` | integer | 否 | `1` | 改名字、设置、换卡时加 1；`PATCH` 带了版本号时对不上返回 409 `SCENARIO_CHANGED` |
| `setup` | jsonb | 否 | `'{}'` | 剧本的设置，结构见下文 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` | 剧本仓库按它倒序 |

约束与索引：`version >= 1` 的 CHECK；`scenarios_user_idx (user_id, created_at DESC)`。

删除剧本时一起删掉 `scenario_cards` 的行，卡不动。已经开始的游玩不受影响（`playthroughs.scenario_id` 置空，世界已经建好）；
如果游玩还在搭建世界，就会改用只有主角的最小设定。

### `scenario_cards`

剧本用了哪几张卡（群像剧本）。剧本**实时引用**角色卡：只记卡的 id，开新故事时读这几张卡当时最新的正式版本。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `scenario_id` | uuid | 否 |  | → `scenarios.id`，级联删除 |
| `card_id` | uuid | 否 |  | → `cards.id`，**ON DELETE RESTRICT**：有剧本在用的卡不能删 |
| `position` | smallint | 否 |  | 排第几，从 0 开始，CHECK 在 0 到 7 之间（一个剧本最多 8 张卡）；第 0 张是主角色卡（剧本封面、默认名字取它） |

约束与索引：主键 `(scenario_id, card_id)`；`scenario_cards_position_uq (scenario_id, position)` 唯一；
`scenario_cards_card_idx (card_id)`，删卡和列出“在用的剧本”时查。换卡时先删掉这个剧本的全部行再按新顺序插入。

## JSON 列

### `cards.card`

规范化后的角色卡（`domain/scenario/card.py` 的 `CharacterCard`），V1、V2、V3 统一成这个结构；`card_revisions.card`、`workbench_drafts.card` 也是它：

```jsonc
{
  "spec": "card_v2",       // 导入时的格式；手动新建和 agent 做的写 card_v3
  "name": "阿苓",
  "description": "…", "personality": "…", "scenario": "…", "first_mes": "…", "mes_example": "…",
  "alternate_greetings": ["…"],
  "system_prompt": "", "post_history_instructions": "", "creator_notes": "",
  "creator": "", "character_version": "", "nickname": "",
  "tags": ["…"],
  "book_name": "",
  "book": [{ "name": "", "keys": ["火漆"], "content": "…", "constant": true, "enabled": true, "order": 0 }],
  "truncated": ["description"]  // 导入时被截断、之后没改过的字段名
}
```

导入时的上限（`importers/character_card/parse.py`）：
- 八个顶层文本字段（`description`、`personality`、`scenario`、`first_mes`、`mes_example`、`system_prompt`、`post_history_instructions`、`creator_notes`）各 60000 字，超出的部分截断，并把字段名记进 `truncated`。
- 备选开场白（最多 64 条）和世界书条目的内容也截到 60000 字，但不记进 `truncated`；世界书最多 1000 条，多出的直接丢弃。名字最多 80 字，标签最多 32 个。
- 截断之后文本总量仍然超过 300000 字的卡片，导入时直接拒绝（422 `CARD_INVALID`）。

编辑（工作台的草稿，`domain/scenario/edit.py`）能改角色名、七个文本字段（不含后置指令）、备选开场白（最多 32 条）、标签和世界书；
上限和导入相同，但超长时拒绝，不截断；世界书条目按列表顺序重新编号 `order`；改过的字段从 `truncated` 里去掉。
卡片里的 `{{user}}`、`{{char}}` 宏原样保存，用到时再替换。

### `cards.meta`

```jsonc
{
  "made_by": "manual",                                  // 最近一版主要是谁写的：agent / manual / mixed（两种都写过）
  "ip": { "work": "红楼梦", "character": "林黛玉" },     // 作品里的角色才有（agent 写入）
  "sources": [{ "url": "https://…", "title": "…", "used_in": ["personality"] }]  // agent 查过的资料
}
```

### `cards.raw`

导入时卡片的原始 JSON，原样保存（V1 是扁平对象，V2、V3 是 `{ "spec", "spec_version", "data" }`）。只在导出时读（保留 `extensions`）。

### `scenarios.setup`

剧本的设置（`domain/scenario/setup.py`），写入前规整形状和长度。开新故事时预填没填的字段：

```jsonc
{
  "protagonist": { "name": "宝玉", "summary": "荣国府的二公子" },          // 默认主角；name 最多 40 字，summary 最多 400 字
  "preferences": { "length": "medium", "style": "", "boundaries": "" },  // 默认偏好，含义同开局时的偏好
  "opening": { "card_id": "…", "greeting": 0 },                          // 用哪张卡的哪条开场白：0 是 first_mes，1 起是备选开场白；为 null 时由导演写开场
  "lightning": false                                                      // 闪电模式：这个剧本开的新故事不在后台整理世界状态（playthroughs.mode）；只影响之后开始的故事
}
```

写入时检查 `opening.card_id` 在这个剧本的卡里、那条开场白存在且不为空。迁移 0018 之前的剧本是 `{}`，读出时按默认值补齐。
