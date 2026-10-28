# 数据模型：人设库

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [点数](credits.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [人设库](personas.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

人设是玩家扮演的“我”（F3，设计见 [personas.md](../personas.md)），对应的接口见 [api/personas.md](../api/personas.md)。
剧本选了哪个人设记在 [`scenarios.setup`](library.md#scenariossetup) 的 `persona_id` 里（没有外键）；
开局时人设的名字和描述存进 [`playthroughs.settings`](story.md#playthroughssettings)，之后改人设不影响已经开始的故事。

迁移 0029 建表时，把已有剧本设置里写了默认主角（`setup.protagonist.name` 不为空）的，按（用户、名字、描述）去重变成人设，
剧本的 `setup.persona_id` 指向它。

## 表

### `personas`

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `name` | text | 否 |  | 名字，1 到 40 字（NFKC 规整、连续空白合成一个，和主角名一样） |
| `description` | text | 否 | `''` | 描述，最多 2000 字 |
| `avatar_blob_id` | uuid | 是 |  | → `blobs.id`，被删除时置空。头像，存之前居中裁成 512×512 的正方形 |
| `is_default` | boolean | 否 | `false` | 是不是默认人设：开新故事时剧本没选人设，就先选它 |
| `created_at` | timestamptz | 否 | `now()` | 列表按它排（默认人设排第一） |
| `updated_at` | timestamptz | 否 | `now()` |  |

约束与索引：`personas_user_idx (user_id, created_at)`；`personas_default_uq (user_id) WHERE is_default` 唯一：每个用户最多一个默认人设，
设新的默认人设时在同一个事务里先取消原来的。

每个用户最多 200 个（服务端设置 `MAX_PERSONAS`），超过时 409 `TOO_MANY_PERSONAS`。

改名字或描述时，在同一个事务里把选了它的剧本的 `setup.protagonist` 改成新的副本（描述截到 400 字）；删除时把这些剧本的
`setup.persona_id` 去掉、`setup.protagonist` 清空。这两种改动不让剧本的版本号加 1。换头像、删人设时，原来的头像交给
`delete_orphan_blobs`（[library.md 的 `blobs`](library.md#blobs)）。
