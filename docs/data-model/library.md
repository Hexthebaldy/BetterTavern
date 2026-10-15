# 数据模型：剧本库

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](story.md) · [世界状态](world.md) · [运行基础设施](infra.md)

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
| `name` | text | 否 |  | 显示名。导入时取卡片的角色名，之后可以改（最多 80 字） |
| `source_kind` | text | 否 |  | `card_v1` / `card_v2` / `card_v3` / `manual`（`manual` 是预留值，M1 不会写入） |
| `source_sha256` | text | 是 |  | 上传文件整体的 SHA-256。同一个用户再次导入同一个文件时，直接返回已有的剧本 |
| `raw` | jsonb | 否 |  | 卡片的原始 JSON，原样保存。扩展字段、资源列表都在这里，生成时不读 |
| `card` | jsonb | 否 |  | 规范化后的卡片，结构见下文“JSON 列”；生成时只读这一列 |
| `avatar_blob_id` | uuid | 是 |  | → `blobs.id`，被删除时置空。PNG 卡片有头像，JSON 卡片为空 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` | 改名时写入 |

约束与索引：`source_kind` 的 CHECK；`scenarios_user_idx (user_id, created_at DESC)`，剧本列表按导入时间倒序排列。

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

### `scenarios.raw`

卡片的原始 JSON，原样保存（V1 是扁平对象，V2、V3 是 `{ "spec", "spec_version", "data" }`）。M1 不读这一列。
