# 数据模型：世界状态

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [剧本库](library.md) · [游玩与回合](story.md) · [世界状态](world.md) · [运行基础设施](infra.md)

M1 只在开局时写入世界状态：把 WorldBuilder 输出的 Seed 展开写入这三张表（`domain/world/plan.py`），之后不再变化。
agent runtime 阶段 2 起，世界状态 agent 每回合更新世界状态，并把撤销日志写进 `state_patches`（[agent-runtime.md](../agent-runtime.md) 第 4、8 节）。实体和事实没有“重要程度”：需要排序时按最近一次出现的回合（`last_seen_seq`）和建立于第几回合（`created_seq`）。
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
| `canon` | text | 否 | `'canon'` | `sketch` 表示推测，以后可以改写（铅笔）；`canon` 表示已成定论（钢笔）。开局写入的实体都是 `canon` |
| `is_protagonist` | boolean | 否 | `false` | 是否是玩家扮演的主角；每局只有一个 |
| `first_seq` | integer | 否 | `0` | 首次出现的回合；开局写入的为 0 |
| `last_seen_seq` | integer | 否 | `0` | 最近一次出现的回合（M2 起维护） |
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
| `rel` | text | 否 |  | 关系名。M1 写入三种：`located_in`（人物或物品在某个地点）、`held_by`（物品在某人手里）、`member_of`（人物属于某个组织） |
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
| `superseded_by` | uuid | 是 |  | 无外键，指向 `facts.id`（M2） |
| `created_seq` | integer | 否 | `0` | 产生这条事实的回合；开局为 0 |
| `source_turn_id` | uuid | 是 |  | 无外键，指向 `turns.id`（M2；开局写入的为空） |

约束与索引：
- `facts_pt_active_idx (playthrough_id) WHERE status = 'active'`。
- `facts_entities_gin`：`entity_ids` 上的 GIN 索引。
- `visibility`、`status` 的 CHECK。

世界视图接口（`GET /v1/playthroughs/{playthrough_id}/world`）默认隐藏主角不知道的秘密，也就是 `visibility = 'secret'` 且主角不在 `known_by` 里的事实；加上 `reveal=true` 才返回。

## JSON 列

### `entities.data`

| `kind` | 结构 |
| --- | --- |
| `world` | `{ "title", "tone", "rules": [], "style", "clock": null, "scene": { "location": 地点实体 ID 或 null, "present": [人物实体 ID], "goal": "主角当前的目标" } }` |
| `character`（主角） | `{ "goal" }` |
| `character`（其他） | `{ "goal", "attitude", "speech_style" }`，只写不为空的键 |
| `organization` | `{ "stance" }`，为空时是 `{}` |
| `location`、`item` | `{}` |
