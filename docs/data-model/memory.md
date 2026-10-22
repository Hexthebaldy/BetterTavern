# 数据模型：记忆

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

整理出来的记忆（[agent-runtime.md](../agent-runtime.md) 第 4、7 节）：章节整理在后台每切一章写一条章节摘要、改写一版玩家画像，
还没并进全书梗概的章节摘要已经有 3 章时，把最早一章并进全书梗概（新增一版）。
导演的上下文里放最新一版全书梗概、还没并进梗概的章节摘要和最新一版玩家画像（`<recap>`），再加当前这一章的原文。
存档上的 `playthroughs.summarized_seq` 记章节摘要已经覆盖到第几回合（[story.md](story.md)）。

大纲也在这里：大纲修订在后台写第一版大纲，之后按世界状态 agent 留下的“大纲要改”的原因（`turn_notes.outline_reason`，[world.md](world.md)）决定改不改，
每次决定记一行 `outline_revisions`；导演每回合在最后一条消息里看到最新一版的前提、当前这一拍、下一拍和约束（`<outline>`）。
存档上的 `playthroughs.outline_seq` 记修订已经看过第几回合的原因。

玩家看不到这些记忆和大纲，接口不返回。

## 表

### `story_summaries`

章节摘要和全书梗概。只新增，不就地覆盖；全书梗概每并进一章新增一版，用 `last_seq` 最大的一版。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `kind` | text | 否 |  | `chapter`（章节摘要）/ `synopsis`（全书梗概的一个版本） |
| `first_seq` | integer | 否 |  | 覆盖的第一回合；全书梗概是 0 |
| `last_seq` | integer | 否 |  | 覆盖的最后一回合；全书梗概是并进去的最后一章的最后一回合 |
| `written_seq` | integer | 否 |  | 写它时章节摘要覆盖到第几回合，也就是这次写的那一章的最后一回合；章节摘要和 `last_seq` 相同，全书梗概可能更大（覆盖的是更早的章，但它是写后面某一章时并出来的） |
| `text` | text | 否 |  | 摘要的内容：章节摘要最多约 600 字，全书梗概最多约 1800 字（提示词要求 500、1500 字，超出的截掉） |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：
- `story_summaries_pt_kind_last_uq (playthrough_id, kind, last_seq)`：同一种摘要在一局里覆盖到同一回合的只有一条。
- `story_summaries_range_ck`：`last_seq >= first_seq` 且 `written_seq >= last_seq`。`kind` 的 CHECK；`first_seq >= 0`。

还没并进梗概的章节摘要：`kind = 'chapter'` 且 `last_seq` 大于最新一版梗概的 `last_seq`（还没有梗概时是全部章节摘要）。

回退到第 K 回合：`written_seq > K` 的删掉（[story.md 的“回退”](story.md#回退)）。只按覆盖范围删不够：一版梗概覆盖的虽然是更早的回合，但只玩到 K 时还没有它，回退后要和那时一样。

### `player_profiles`

玩家画像：玩家喜欢什么、不喜欢什么、怎么玩。章节整理每写一章改写一版（在上一版基础上合并），用最新的一版。按一局记，不跨故事。回退时不动。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `text` | text | 否 |  | 画像的内容，最多约 900 字（提示词要求 800 字，超出的截掉） |
| `based_on_seq` | integer | 否 |  | 改写时依据到第几回合（那一章的最后一回合） |
| `created_at` | timestamptz | 否 | `now()` | 最新一版按它（再按 `id`）取 |

约束与索引：
- `player_profiles_pt_idx (playthrough_id, created_at)`：取最新一版时用。
- `based_on_seq >= 0`。

### `outline_revisions`

大纲修订的每一次决定，只新增，不就地覆盖。`changed` 为真的行是一版新大纲，当前大纲是 `changed` 为真、`based_on_seq` 最大的一行；
为假的行是“看过这些原因，不改”，只留下原因，导演看到的还是上一版。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `based_on_seq` | integer | 否 |  | 这次依据到第几回合：修订开始时世界状态已经整理到的回合（`playthroughs.state_seq`）。写入时 `outline_seq` 前进到它 |
| `changed` | boolean | 否 |  | 改了（有新一版大纲）还是没改 |
| `content` | jsonb | 是 |  | 新一版大纲，结构见下文“JSON 列”；没改时为空 |
| `reason` | text | 否 | `''` | 模型说的为什么改或不改，最多 200 字；第一版为空串 |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：
- `outline_revisions_pt_seq_uq (playthrough_id, based_on_seq)`：一局里依据到同一回合的决定只有一次。
- `outline_revisions_content_ck`：`changed` 为真时 `content` 不为空，为假时为空。`based_on_seq >= 0`。

回退到第 K 回合：`based_on_seq > K` 的删掉，`outline_seq` 改回剩下的最后一次决定的 `based_on_seq`（一行都不剩时是 -1）。
删了修订时放一个大纲修订任务：K 之前可能还有没处理的原因，或者连第一版都删掉了。

## JSON 列

### `outline_revisions.content`

```json
{
  "premise": "故事的前提，一两句话",
  "beats": [
    { "id": "b1", "status": "done", "intent": "这一拍要达成什么", "done_when": "怎样算完成" },
    { "id": "b2", "status": "active", "intent": "…", "done_when": "…" },
    { "id": "b3", "status": "pending", "intent": "…", "done_when": "" }
  ],
  "constraints": ["必须守住的约束"]
}
```

写入前由代码修正（`domain/memory/outline.py` 的 `settle()`），模型写的不直接入库：

- 前提最多 200 字，每拍的 `intent`、`done_when` 最多 200 字（提示词要求 60 字），至多 10 拍；约束每条最多 160 字，至多 6 条；
- `id` 重复的改成 `b` 加序号；`status` 只有 `pending`（待写）、`active`（进行中）、`done`（完成）、`skipped`（玩家绕过了，不会再发生，留着记录）四种，认不得的当 `pending`；
- 上一版里完成了的拍，新一版不能改回没完成；
- 完成和跳过的拍只留最近两拍，更早的去掉（以前的修订里都有），免得越积越多、把待写的拍挤掉；
- 只有一拍是 `active`：一拍都没有时，第一拍 `pending` 的变成 `active`；多于一拍时只留最前面的一拍。

## 状态

大纲的一拍：`pending` → `active` → `done`，或者任何时候 → `skipped`；`done` 不能回到别的状态（回退删掉整行修订时除外）。
