# 数据模型：外部服务

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [点数](credits.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [人设库](personas.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

工作台的 agent 联网和出图用的外部服务（搜索、读网页、文生图）的配置，以及读过的网页。接口见 [api/tools.md](../api/tools.md)。

## 表

### `tool_routes`

外部服务的配置。和 `model_routes` 分开建表：模型那张表的上下文窗口、能力表、导演这些列都和外部服务无关。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 |  | 主键，由应用生成：加密时要把行 ID 绑进附加数据（`tool:{id}:api_key`），和 `model_routes` 一样 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `kind` | text | 否 |  | `search`（网页搜索，含搜图）/ `fetch`（读网页的服务商，可选）/ `image`（文生图） |
| `provider` | text | 否 |  | 搜索和读网页填服务商名，文生图填接口协议；合法值由 `providers/web`、`providers/image` 的注册表决定 |
| `label` | text | 否 | `''` | 显示名，最多 60 字 |
| `base_url` | text | 是 |  | 接口地址；SearXNG 和 `openai_chat` 必填，其他为空时用服务商的默认地址。写入前做防内网访问检查 |
| `api_key_enc` | text | 是 |  | 加密后的 Key，格式同 `model_routes.api_key_enc`；SearXNG、Jina 可以没有 Key |
| `key_id` | text | 是 |  | 加密用的主密钥编号 |
| `key_last4` | text | 否 | `''` | Key 的后四位，显示用 |
| `model` | text | 是 |  | 文生图的模型名 |
| `params` | jsonb | 否 | `'{}'` | 搜索：`country`、`language`、`search_lang`、`safesearch`；文生图：`sizes`（画幅对应的尺寸）、`extra_body`（并进请求体的自定义字段）。整体最大 8 KB |
| `status` | text | 否 | `'unverified'` | `unverified` / `ok` / `invalid`：添加和改 Key、地址、模型名以后是 `unverified`，测试以后按结果变 |
| `probe` | jsonb | 否 | `'{}'` | 最近一次测试：`{"ok", "detail", "latency_ms", "tested_at"}` |
| `is_default` | boolean | 否 | `false` | 同一种 `kind` 里默认用哪一个：agent 和封面面板用它 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` |  |

约束与索引：
- `kind`、`status` 的 CHECK；
- `tool_routes_user_idx (user_id, kind, created_at)`；
- `tool_routes_default_uq (user_id, kind) WHERE is_default`：同一种最多一个默认。换默认时先把旧的置为假，再把新的置为真。

每种第一次添加的自动设为默认；删掉默认的那个时，同一种里最早添加的顶上。worker 跑工作台 agent 时读每一种的默认、解密 Key；
解密不了的当作没配（agent 就没有那些工具）。

### `web_pages`

读过的网页全文：既是缓存，也给 agent 的 `read_page`（按行读长网页中间省略的部分）用。agent 在 worker 进程里跑、接口在 api 进程里，
磁盘不共享，所以存数据库。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键，也是 `read_page` 用的页面编号 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除。按用户分开存，不在用户之间共享 |
| `url` | text | 否 |  | 请求的地址 |
| `url_hash` | text | 否 |  | 地址的 SHA-256，查缓存用 |
| `final_url` | text | 是 |  | 跳转后的地址 |
| `title` | text | 否 | `''` | 网页标题 |
| `content` | text | 否 |  | 正文（Markdown，内嵌的 base64 图片换成了占位），最多 200 万字 |
| `fetcher` | text | 否 |  | `local`（服务器自己读的）或服务商名 |
| `fetched_at` | timestamptz | 否 | `now()` |  |

约束与索引：`web_pages_lookup_idx (user_id, url_hash, fetched_at DESC)`；`web_pages_fetched_idx (fetched_at)`，清理时用。

- 同一个地址 24 小时内再读，直接用这里的结果。只存读成功的。
- 维护任务每 10 分钟左右删掉 7 天以前的。
- 搜索结果不进数据库，在 worker 进程的内存里缓存 20 分钟。
