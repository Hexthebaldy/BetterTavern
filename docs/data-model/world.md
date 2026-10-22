# 数据模型：世界状态

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

开局时把 WorldBuilder 输出的 Seed 展开写入 `entities`、`entity_links`、`facts`（`domain/world/plan.py`）。之后由后台的世界状态 agent 每回合整理：
它的修改先在内存里的副本上逐项检查（`domain/world/draft.py`，线索是 `domain/world/threads.py`），用 commit 结束后在一个事务里按行写入（实体、关系、事实、线索），每改一行都在 `state_patches` 记下改之前和改之后的样子，
再给这一回合写一行 `turn_notes`（[agent-runtime.md](../agent-runtime.md) 第 4、8 节）。实体和事实没有“重要程度”：需要排序时按最近一次出现的回合（`last_seen_seq`）和建立于第几回合（`created_seq`）。
对应的只读接口是 [`GET /v1/playthroughs/{playthrough_id}/world`](../api/play.md)。

## 表

### `entities`

实体，包括人物、物品、地点、组织，以及每局一个 `world` 实体（存放世界设定和当前场景）。每个实体一行，记录它现在的样子。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `kind` | text | 否 |  | `character` / `item` / `location` / `organization` / `world` |
| `name` | text | 否 |  | 显示名，最多 40 字；`world` 实体固定叫“世界” |
| `name_norm` | text | 否 |  | 归一化后的名字，用于唯一约束和别名匹配。归一化步骤是 NFKC、去掉空白和常见标点、casefold（`domain/world/names.py`） |
| `aliases` | text[] | 否 | `'{}'` | 别名，最多 6 个，归一化后与本名相同的会被去掉；`world` 实体的别名是故事标题 |
| `summary` | text | 否 | `''` | 外貌、性格、来历等描述 |
| `data` | jsonb | 否 | `'{}'` | 结构化属性，按 `kind` 不同，结构见下文“JSON 列” |
| `canon` | text | 否 | `'canon'` | `sketch` 表示推测，以后可以改写（铅笔）；`canon` 表示已成定论（钢笔）。开局写入的实体都是 `canon`；世界状态 agent 新建的是 `sketch`，在另一个回合再次出现时改成 `canon`。`sketch` 实体不进状态块的名册，只在名字被提到时出现 |
| `is_protagonist` | boolean | 否 | `false` | 是否是玩家扮演的主角；每局只有一个 |
| `first_seq` | integer | 否 | `0` | 首次出现的回合；开局写入的为 0 |
| `last_seen_seq` | integer | 否 | `0` | 最近一次出现的回合：世界状态 agent 写入时，这一回合点名的、被改过的、关系变了的、新事实涉及的实体都更新成这一回合 |
| `rev` | integer | 否 | `1` | 修订号，每次修改加 1；开局写入场景后，`world` 实体的修订号为 2 |
| `retired` | boolean | 否 | `false` | 是否已退场（死亡、被销毁等）。退场的实体不参与名字唯一约束，也不出现在世界视图里 |

约束与索引：
- `entities_name_uq (playthrough_id, kind, name_norm) WHERE NOT retired`：同一局、同一类实体里名字唯一。
- `entities_protagonist_uq (playthrough_id) WHERE is_protagonist AND NOT retired`：每局只有一个主角。
- `entities_aliases_gin`：`aliases` 上的 GIN 索引，用来按别名查找。
- `kind`、`canon` 的 CHECK。

### `entity_links`

实体之间的关系。关系只记在这张表里，“这个地点有谁”“这个人拿着什么”都查这张表。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `src_id` | uuid | 否 |  | → `entities.id`，级联删除 |
| `rel` | text | 否 |  | 关系名：`located_in`（人物或物品在某个地点）、`held_by`（物品在某人手里）、`member_of`（人物属于某个组织）、`part_of`（地点属于更大的地点）、`knows_of`（人物认识或知道某个实体）。一个人物或物品同一时刻只有一条 `located_in` 或 `held_by` |
| `dst_id` | uuid | 否 |  | → `entities.id`，级联删除 |
| `since_seq` | integer | 否 | `0` | 关系建立时的回合；开局为 0 |

约束与索引：
- 主键 `(src_id, rel, dst_id)`（`entity_links_pkey`），重复插入时忽略。
- `entity_links_dst_idx (dst_id, rel)`：反查时用。
- `entity_links_pt_idx (playthrough_id)`。

### `facts`

原子事实：每条一句话，记录涉及的实体和可见性。被推翻的事实标记为 `superseded`，不删除。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `text` | text | 否 |  | 事实内容，最多 200 字 |
| `entity_ids` | uuid[] | 否 | `'{}'` | 涉及的实体 |
| `visibility` | text | 否 | `'public'` | `public` / `secret`；`secret` 表示主角一开始不知道 |
| `known_by` | uuid[] | 否 | `'{}'` | 知道这个秘密的人物实体；主角在其中时，这条事实对玩家可见 |
| `status` | text | 否 | `'active'` | `active` / `superseded` |
| `superseded_by` | uuid | 是 |  | 无外键，指向 `facts.id`：推翻它的新事实；推翻时没有给出新事实就为空 |
| `created_seq` | integer | 否 | `0` | 产生这条事实的回合；开局为 0 |
| `source_turn_id` | uuid | 是 |  | 无外键，指向 `turns.id`：产生这条事实的回合；开局写入的为空 |
| `superseded_seq` | integer | 是 |  | 从第几回合起不再成立；有效的事实为空 |

约束与索引：
- `facts_pt_active_idx (playthrough_id) WHERE status = 'active'`。
- `facts_entities_gin`：`entity_ids` 上的 GIN 索引。
- `visibility`、`status` 的 CHECK。

世界视图接口（`GET /v1/playthroughs/{playthrough_id}/world`）默认隐藏主角不知道的秘密，也就是 `visibility = 'secret'` 且主角不在 `known_by` 里的事实；加上 `reveal=true` 才返回。

### `threads`

线索与伏笔：故事里还没有着落、以后要回应的大事（[agent-runtime.md](../agent-runtime.md) 第 7 节“线索与伏笔”）。世界状态 agent 用 `open_thread` 记下（来源是叙述，以及导演写在 `turns.director_notes` 里的伏笔、真相和承诺），用 `close_thread` 标为解开，用 `merge_threads` 把说同一件事的几条合成一条，用 `update_thread` 改说法或写下导演定下的答案。
和实体、事实一样，每次改动都记进 `state_patches`（`target` 是 `thread`），回退时倒着写回：K 之后记下的删掉，K 之后解开或合并掉的变回没解开，答案也改回原来的。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键（由应用生成后写入，撤销记录里要用） |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `kind` | text | 否 |  | `mystery`（没解开的悬念）/ `promise`（谁答应了什么）/ `foreshadow`（埋下的伏笔） |
| `text` | text | 否 |  | 一句话，最多 160 字 |
| `entity_ids` | uuid[] | 否 | `'{}'` | 涉及的实体 |
| `status` | text | 否 | `'open'` | `open`（没解开）/ `closed`（解开了）/ `merged`（合进了另一条，迁移 `0015`） |
| `opened_seq` | integer | 否 |  | 在第几回合记下；合并出来的那一条是合并的回合 |
| `closed_seq` | integer | 是 |  | 在第几回合解开或被合并；没解开时为空 |
| `source_turn_id` | uuid | 是 |  | 无外键，指向 `turns.id`：记下它的那一回合 |
| `answer` | text | 否 | `''` | 导演定下的答案（来自隐藏备注），最多 200 字，只给导演看；原文移出上下文以后答案还在（迁移 `0015`） |
| `merged_into` | uuid | 是 |  | 无外键，指向 `threads.id`：合进了哪一条；只有 `merged` 的线索有（迁移 `0015`） |

约束与索引：
- `threads_pt_open_idx (playthrough_id, opened_seq) WHERE status = 'open'`：世界状态 agent 读没解开的线索时用。
- `threads_closed_ck`：`status` 是 `open` 当且仅当 `closed_seq` 为空。`threads_merged_ck`：`status` 是 `merged` 当且仅当 `merged_into` 不为空。`kind`、`status` 的 CHECK（`threads_status_check`）；`opened_seq >= 0`。

没解开的最多 15 条，满了要先解开或合并旧的才能记新的；每回合最多新记 2 条（合并出来的那一条也算）；同一句话已经有一条没解开的就不再记。世界状态 agent 的输入里最多列 16 条没解开的线索（也就是全部）：涉及这一回合相关实体的在前，其余按记下的回合从早到晚。

### `state_patches`

世界状态 agent 的撤销记录：一回合写入时每改一行就记一行，回退时按回合倒序、按 `idx` 倒序写回 `before`（agent runtime 阶段 2 的回退部分）。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `turn_id` | uuid | 否 |  | → `turns.id`，级联删除：哪一回合的整理改的 |
| `idx` | smallint | 否 |  | 这一回合里的第几项，从 0 开始；写入时先实体、再关系、再事实、最后线索 |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `seq` | integer | 否 |  | 那一回合的 `seq` |
| `target` | text | 否 |  | 改的是哪张表的行：`entity` / `link` / `fact` / `thread`（迁移 `0014` 加的） |
| `before` | jsonb | 是 |  | 改之前这一行的全部列（结构见下文“JSON 列”）；为空表示这一行是新建的 |
| `after` | jsonb | 是 |  | 改之后这一行的全部列；为空表示这一行被删了（关系被去掉） |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：
- 主键 `(turn_id, idx)`（`state_patches_pkey`）。
- `state_patches_change_ck`：`before` 和 `after` 不能都为空。`seq >= 0`、`idx >= 0`、`target` 的 CHECK（`state_patches_target_check`）。
- `state_patches_pt_seq_idx (playthrough_id, seq)`：回退时按回合找。

### `turn_notes`

世界状态 agent 给每回合写的标签，整理完（或跳过）一回合写一行。导演的召回工具 `recall` 按名字查旧回合时，找的是 `entity_ids` 里有这个实体的回合；按关键词查时也在 `digest` 里找。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `turn_id` | uuid | 否 |  | 主键，→ `turns.id`，级联删除 |
| `playthrough_id` | uuid | 否 |  | → `playthroughs.id`，级联删除 |
| `seq` | integer | 否 |  | 回合的 `seq` |
| `digest` | text | 否 | `''` | 这一回合发生了什么，一句话，最多 120 字；跳过的回合为空串 |
| `entity_ids` | uuid[] | 否 | `'{}'` | 这一回合涉及的实体 |
| `scene_ended` | boolean | 否 | `false` | 这一回合之后当前场景是否结束；当前场景从上一个结束的场景之后开始算 |
| `skipped` | boolean | 否 | `false` | 整理失败两次后跳过了这一回合：世界状态没改，摘要为空 |
| `outline_reason` | text | 否 | `''` | 世界状态 agent 整理这一回合时说“大纲要改”的原因（这一拍完成了、玩家走向了别处、出现了大纲里没有的大事），一句话，最多 120 字；不用改、还没有大纲、跳过的回合为空串。大纲修订按它决定改不改（[memory.md](memory.md)） |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：
- `turn_notes_pkey (turn_id)`。
- `turn_notes_pt_seq_uq (playthrough_id, seq)`：一局里每个回合只有一行。
- `turn_notes_entities_gin`：`entity_ids` 上的 GIN 索引，按人物找回合时用。
- `seq >= 0`。

## JSON 列

### `entities.data`

| `kind` | 结构 |
| --- | --- |
| `world` | `{ "title", "tone", "rules": [], "style", "clock": null 或 "故事里的时间", "scene": { "location": 地点实体 ID 或 null, "present": [人物实体 ID], "goal": "主角当前的目标" } }`。`clock` 和 `scene` 由世界状态 agent 的 `set_clock`、`set_scene` 改 |
| `character` | `{ "goal", "attitude", "speech_style", "condition" }`，只写不为空的键；开局时主角只有 `goal`。`condition` 是身体和情绪状况，由世界状态 agent 写 |
| `organization` | `{ "stance", "condition" }`，只写不为空的键 |
| `location`、`item` | `{ "condition" }`（看得见的变化，例如门锁着、坏了），没有时是 `{}` |

### `state_patches.before`、`state_patches.after`

一行的全部列，键是列名（`domain/world/records.py`）：

| `target` | 结构 |
| --- | --- |
| `entity` | `{ "id", "kind", "name", "name_norm", "aliases": [], "summary", "data": {}, "canon", "is_protagonist", "first_seq", "last_seen_seq", "rev", "retired" }` |
| `link` | `{ "src_id", "rel", "dst_id", "since_seq" }` |
| `fact` | `{ "id", "text", "entity_ids": [], "visibility", "known_by": [], "status", "superseded_by", "superseded_seq", "created_seq", "source_turn_id" }` |
| `thread` | `{ "id", "kind", "text", "entity_ids": [], "status", "opened_seq", "closed_seq", "source_turn_id", "answer", "merged_into" }` |
