# 数据模型：剧本库

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

导入的角色卡和头像文件。对应的接口见 [api/library.md](../api/library.md)。

## 表

### `blobs`

二进制文件。M1 只存角色卡的 PNG 文件，整个文件就是头像。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `sha256` | text | 否 |  | 内容的 SHA-256（十六进制）；头像接口的 ETag 取它的前 32 位 |
| `mime` | text | 否 |  | M1 只有 `image/png` |
| `size` | integer | 否 |  | 字节数，CHECK 不小于 0 |
| `data` | bytea | 否 |  | 文件内容，最大 16 MB |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：`size >= 0` 的 CHECK；`blobs_user_sha_idx (user_id, sha256)`。

以后换成对象存储，只需要改 `infra/db/repositories/library.py`（[backend.md 第 12 节](../backend.md)）。

### `scenarios`

导入的角色卡，也就是剧本。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `name` | text | 否 |  | 显示名。导入时取卡片的角色名，之后可以改（最多 80 字）；和卡片里的角色名（`card.name`）是两回事 |
| `source_kind` | text | 否 |  | `card_v1` / `card_v2` / `card_v3` / `manual`（`manual` 是预留值，M1 不会写入） |
| `source_sha256` | text | 是 |  | 上传文件整体的 SHA-256。同一个用户再次导入同一个文件时，直接返回已有的剧本 |
| `raw` | jsonb | 否 |  | 卡片的原始 JSON，原样保存。扩展字段、资源列表都在这里，生成时不读 |
| `card` | jsonb | 否 |  | 规范化后的卡片，结构见下文“JSON 列”；生成时只读这一列。编辑卡片时整个替换，恢复时用 `raw` 重新整理 |
| `avatar_blob_id` | uuid | 是 |  | → `blobs.id`，被删除时置空。PNG 卡片有头像，JSON 卡片为空 |
| `version` | integer | 否 | `1` | 版本号：改名、编辑卡片、恢复导入时的内容都会加 1。保存编辑时带回读取时的版本号，对不上就拒绝（见下文“编辑”） |
| `edited_at` | timestamptz | 是 |  | 最近一次改动卡片内容的时间（只改显示名不算）；没编辑过，或者恢复成导入时的内容之后，为空 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` | 改名、编辑卡片、恢复时写入 |

约束与索引：`source_kind` 的 CHECK；`version >= 1` 的 CHECK；`scenarios_user_idx (user_id, created_at DESC)`，剧本列表按导入时间倒序排列。

删除剧本时，在同一个事务里删掉它的头像。已经开始的游玩不受影响（`playthroughs.scenario_id` 置空，世界已经建好）；
如果游玩还在搭建世界，就会改用只有主角的最小设定。

## JSON 列

### `scenarios.card`

规范化后的角色卡（`domain/scenario/card.py` 的 `CharacterCard`），V1、V2、V3 统一成这个结构：

```jsonc
{
  "spec": "card_v2",
  "name": "阿苓",
  "description": "…", "personality": "…", "scenario": "…", "first_mes": "…", "mes_example": "…",
  "alternate_greetings": ["…"],
  "system_prompt": "", "post_history_instructions": "", "creator_notes": "",
  "creator": "", "character_version": "", "nickname": "",
  "tags": ["…"],
  "book_name": "",
  "book": [{ "name": "", "keys": ["火漆"], "content": "…", "constant": true, "enabled": true, "order": 0 }],
  "truncated": ["description"]  // 导入时被截断的字段名
}
```

上限（`importers/character_card/parse.py`）：
- 八个顶层文本字段（`description`、`personality`、`scenario`、`first_mes`、`mes_example`、`system_prompt`、`post_history_instructions`、`creator_notes`）各 60000 字，超出的部分截断，并把字段名记进 `truncated`。
- 备选开场白（最多 64 条）和世界书条目的内容也截到 60000 字，但不记进 `truncated`；世界书最多 1000 条，多出的直接丢弃。名字最多 80 字，标签最多 32 个。
- 截断之后文本总量仍然超过 300000 字的卡片，导入时直接拒绝（422 `CARD_INVALID`）。

卡片里的 `{{user}}`、`{{char}}` 宏原样保存，用到时再替换。

### 编辑

导入后可以编辑角色名、描述、性格、情境、开场白、对话示例、标签和卡片自带的世界书（`domain/scenario/edit.py`），其余字段原样保留：

- 上限和导入相同，但超长时拒绝，不截断；世界书条目按列表顺序重新编号 `order`；改过的字段从 `truncated` 里去掉。
- 保存是一条带条件的 UPDATE：`… SET card = :card, version = version + 1, edited_at = … WHERE id = :id AND user_id = :u AND version = :v`，
  影响行数为 0 就说明在别处改过了（或者剧本不存在），接口返回 409 `CARD_CHANGED`（或 404）。卡片内容有改动时 `edited_at` 记为当前时间，
  只改显示名时保持原样（和在剧本库里改名一样）。
- 恢复导入时的内容：用 `raw` 重新跑一遍导入时的整理，覆盖 `card`，`version` 加 1，`edited_at` 置空，显示名不变。
- 卡片只在开局搭建世界时读一次（WorldBuilder 或最小设定），已经开始的游玩不受编辑影响；还在搭建世界的游玩会用到保存后的内容。

### `scenarios.raw`

卡片的原始 JSON，原样保存（V1 是扁平对象，V2、V3 是 `{ "spec", "spec_version", "data" }`）。M1 不读这一列。
