# 数据模型：工作台

> 文档索引：[总览](../README.md) · [后端](../backend.md) · [客户端](../client.md) · [测试](../testing.md) · [数据模型](README.md) · [接口](../api/README.md)
>
> 数据模型：[说明与约定](README.md) · [账户与令牌](accounts.md) · [模型路由](models.md) · [外部服务](tools.md) · [角色卡与剧本](library.md) · [工作台](workbench.md) · [游玩与回合](story.md) · [世界状态](world.md) · [记忆](memory.md) · [运行基础设施](infra.md)

工作台的草稿、草稿里的图片、agent 模式的对话记录和推送事件、查资料的笔记。设计见 [workbench.md](../workbench.md)，接口见 [api/workbench.md](../api/workbench.md)。

## 表

### `workbench_drafts`

一份草稿就是“正在做的一张卡”：卡的内容、agent 做到哪了，都在这一行。手动模式的表单和 agent 读写的都是它。
草稿不在角色卡仓库里，保存时才写进 `cards`。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键，也是工作台地址里的编号 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `card_id` | uuid | 是 |  | → `cards.id`，被删除时置空。改仓库里已有的卡、或者这份草稿已经保存过一次时，指向那张卡；全新的卡在第一次保存前为空 |
| `base_version` | integer | 是 |  | 打开这份草稿（或者上次保存）时那张卡的 `version`；保存时对不上，说明在别处改过 |
| `origin` | text | 否 |  | 怎么开始的：`agent`（从聊天框）/ `manual`（手动新建）/ `import_file`（导入文件）/ `edit_card`（从仓库打开已有的卡） |
| `name` | text | 否 | `''` | 显示名，保存时写进 `cards.name`；为空时用角色名 |
| `card` | jsonb | 否 |  | 卡片内容，结构同 [`cards.card`](library.md#cardscard)；刚开始时是空卡（`name` 为空串）。草稿是宽松模式：名字、条目内容可以暂时为空 |
| `raw` | jsonb | 是 |  | 导入文件时卡片的原始 JSON，保存成新卡时写进 `cards.raw` |
| `source_sha256` | text | 是 |  | 导入文件的 SHA-256，保存成新卡时写进 `cards.source_sha256`（已经有一张卡记着它时不写） |
| `cover_asset_id` | uuid | 是 |  | → `workbench_assets.id`，被删除时置空。选中的封面；保存时把它的 `blob_id` 写进 `cards.cover_blob_id` |
| `version` | integer | 否 | `1` | 草稿自己的版本号：手动自动保存、agent 每写一处、换封面都加 1；写入时带回读到的版本号，对不上返回 409 `DRAFT_CHANGED` |
| `saved_version` | integer | 是 |  | 上次保存到仓库时草稿的 `version`；和 `version` 不相等就是“有没保存的修改” |
| `mode` | text | 否 | `'agent'` | 上次停在哪种模式：`agent` / `manual`，下次打开默认用它 |
| `stage` | text | 否 | `'start'` | agent 走到哪一步：`start` / `research` / `questions` / `plan` / `build` / `check` / `done` / `revise`。导入的和从仓库打开的直接是 `revise` |
| `agent_status` | text | 否 | `'idle'` | `idle`（等用户说话）/ `running`（agent 在干活）/ `awaiting_user`（发了问卷、方案或改动，等用户回答或决定） |
| `awaiting` | jsonb | 是 |  | 在等什么：`{"kind": "questions" | "plan" | "changes", "seq": 12}` |
| `plan_approved_seq` | integer | 是 |  | 用户确认的那份方案在对话里的序号；有了它 agent 才能往卡里写 |
| `todos` | jsonb | 否 | `'[]'` | 进度清单：`[{"key": "personality", "text": "描述和性格", "state": "done" | "doing" | "todo", "detail": "描述 412 字"}]` |
| `agent_baseline` | jsonb | 是 |  | agent 上一轮结束时卡片的样子；下一轮开始前和当前内容比一下，知道用户手动改了哪些地方 |
| `language` | text | 否 | `'zh'` | agent 说话和提示词用哪种语言：`zh` / `en` / `ja`，建草稿时按界面语言定 |
| `stop_requested` | boolean | 否 | `false` | 用户点了停止或切到手动接管；agent 做完手上这一步就收尾 |
| `last_seq` | integer | 否 | `0` | 对话记录的序号计数 |
| `run_id` | uuid | 是 |  | 正在跑的那一轮 agent 的编号（等于这一轮 `agent_runs.id`）；agent 的每次写入都带着它，不是这一轮就不写。一轮结束时清空 |
| `run_heartbeat_at` | timestamptz | 是 |  | 正在跑的那一轮最近一次报平安的时间（每次调模型之前、每次写入时更新）。超过 5 分钟没更新就当这一轮已经死了（worker 意外退出）：读出的 `agent_status` 当作 `idle`，可以重新开一轮 |
| `created_at` | timestamptz | 否 | `now()` |  |
| `updated_at` | timestamptz | 否 | `now()` | 草稿列表按它倒序 |

约束与索引：
- `origin`、`mode`、`stage`、`agent_status`、`language` 的 CHECK；`version >= 1`；
- `workbench_drafts_user_idx (user_id, updated_at DESC)`；
- `workbench_drafts_card_idx (card_id)`：从仓库打开一张卡时找它的草稿，列卡时标出“有没保存的草稿”。

几条规则：
- 开一轮 agent 是一条带条件的 UPDATE：`… SET agent_status = 'running', run_id = :新的 … WHERE … AND (agent_status <> 'running' OR run_heartbeat_at < now() - 5 分钟)`，
  改不动就是已经有一轮在跑（409 `DRAFT_BUSY`）。和用户的消息、`workbench.run` 任务在同一个事务里写。
- agent 写卡：`… WHERE id = :id AND run_id = :run AND agent_status = 'running' AND version = :v`。版本号对不上（用户同时在表单里改了）就重读，
  用户改的正是这一处时不覆盖。一轮结束时清空 `run_id`，记下 `agent_baseline`。
- 停止（点停止或切到手动接管）只置 `stop_requested`，agent 做完手上这一步就收尾。
- 改内容是一条带条件的 UPDATE：`… SET card = :card, version = version + 1 WHERE id = :id AND user_id = :u AND version = :v`，影响行数为 0 就是被别人改过。
- 切模式只改 `mode`，不算内容的修改，版本号不变。
- 草稿列表只列 `saved_version` 为空或不等于 `version` 的。保存以后草稿留着，下次从仓库打开同一张卡时接着用它。
- 从仓库打开一张卡：这张卡已经有草稿就打开最近的那份；那份保存过、之后卡又在别处改过（例如恢复了旧版）时，先换成卡现在的内容。
  没有草稿就新建一份，复制卡的内容和封面，记下 `card_id`、`base_version`，`saved_version` 等于 `version`（没有修改）。

### `workbench_messages`

agent 模式的对话记录：界面上显示的就是这张表，下一轮拼上下文也从这张表来。工具调用的参数和结果很长，不放这里，放 `agent_steps`。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `draft_id` | uuid | 否 |  | → `workbench_drafts.id`，级联删除 |
| `seq` | integer | 否 |  | 第几条，从 1 开始，取自草稿的 `last_seq`；CHECK 不小于 1 |
| `role` | text | 否 |  | `user` / `assistant` |
| `kind` | text | 否 |  | `text` / `research` / `questions` / `answers` / `plan` / `plan_reply` / `changes` / `images` / `progress` / `error`，`content` 的结构见下文“JSON 列” |
| `content` | jsonb | 否 |  | 内容 |
| `run_id` | uuid | 是 |  | 无外键，agent 发的消息是哪一轮（`agent_runs.id`）；用户的消息为空 |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：主键 `(draft_id, seq)`；`seq`、`role`、`kind` 的 CHECK。

对改动的决定直接改那一条 `changes` 消息里每一处的 `state`，不另记一条。

### `workbench_events`

一边生成一边推送的事件。agent 在 worker 进程里跑，用户连的是 api 进程，两边靠这张表传话：worker 写一批事件就 `NOTIFY bt_workbench`（内容是草稿 id），
api 收到后读出新事件，用 SSE 推给客户端；断线后客户端带上最后收到的编号，从下一条接着推。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 否 | 自增（`BIGSERIAL`） | 主键，也是 SSE 的事件编号 |
| `draft_id` | uuid | 否 |  | → `workbench_drafts.id`，级联删除 |
| `run_id` | uuid | 否 |  | 哪一轮；api 自己发的事件（采用改动、用户的消息）是全零 |
| `type` | text | 否 |  | `delta` / `field_delta` / `tool` / `message` / `todos` / `draft` / `status`，`data` 的结构见 [api/workbench.md 的“推送事件”](../api/workbench.md#推送事件) |
| `data` | jsonb | 否 | `'{}'` | 事件内容 |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：`type` 的 CHECK；`workbench_events_draft_idx (draft_id, id)`；`workbench_events_created_idx (created_at)`，清理时用。

- agent 说的话和正在写的字段按 150 毫秒左右攒一批写一行。
- 维护任务每 10 分钟左右删掉一天以前的事件：内容早已存进对话记录和草稿，事件只是路上用的。

### `workbench_assets`

草稿里的图片：上传的、导入的卡自带的、从仓库打开时带过来的封面，以后还有搜到的和生成的。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `user_id` | uuid | 否 |  | → `users.id`，级联删除 |
| `draft_id` | uuid | 否 |  | → `workbench_drafts.id`，级联删除 |
| `blob_id` | uuid | 否 |  | → `blobs.id`，级联删除 |
| `source` | text | 否 |  | `search`（网上找到的）/ `generated`（文生图）/ `upload`（用户上传）/ `card`（卡自带的） |
| `license` | text | 否 |  | `public_domain`（公有领域）/ `copyrighted`（有版权）/ `unknown`（拿不准）/ `own`（生成的、上传的、卡自带的） |
| `source_url` | text | 是 |  | 找到的图原来的地址 |
| `prompt` | text | 是 |  | 生成图用的提示词 |
| `meta` | jsonb | 否 | `'{}'` | 附加信息，结构见下文 |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：`source`、`license` 的 CHECK；`workbench_assets_draft_idx (draft_id, created_at)`；`workbench_assets_blob_idx (blob_id)`，清理没人用的图时查。

`copyrighted` 和 `unknown` 的图只作参考，默认不能设为封面；用户确认“仅限个人使用”后记进 `meta.personal_use`，之后可以用。

### `workbench_notes`

agent 查资料记下的笔记：读完网页只把要点记成笔记，后面写卡时读笔记，不再把整页网页塞进上下文。资料页把它们列出来，写明每条用在卡片哪里。

| 列 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `draft_id` | uuid | 否 |  | → `workbench_drafts.id`，级联删除 |
| `text` | text | 否 |  | 笔记，CHECK 最多 2000 字 |
| `source` | jsonb | 否 | `'{}'` | 出处：`{"url": "…", "title": "…", "site": "zh.wikipedia.org"}` |
| `used_in` | jsonb | 否 | `'[]'` | 打算用在卡片哪里（字段名）：`["description", "first_mes"]` |
| `created_at` | timestamptz | 否 | `now()` |  |

约束与索引：`text` 长度的 CHECK；`workbench_notes_draft_idx (draft_id, created_at)`。

保存到仓库时，笔记的出处（按地址去重，合并 `used_in`）写进 `cards.meta.sources`，作者备注里还没写到的出处补在最后（“资料来源：”一段）。

## JSON 列

### `workbench_messages.content`

| `kind` | 谁发 | `content` |
| --- | --- | --- |
| `text` | 双方 | `{"text": "…"}` |
| `questions` | agent | `{"intro": "…", "questions": [{"qid": "q0", "question": "…", "choices": ["…"], "recommended": 0, "multi": false}], "skippable": true}`：最多 6 题，每题 2 到 5 个选项；`qid` 由代码按顺序编号；`recommended` 是预先选好的那个（多选题可以为 null） |
| `answers` | 用户 | `{"answers": {"q0": "悬疑", "q1": ["…"]}, "delegated": false, "questions_seq": 3}`：没答的题按推荐项补上；“都交给你”时 `delegated` 为真、`answers` 为空 |
| `plan` | agent | `{"names": ["…"], "pitch": "…", "sections": [{"key", "heading", "body"}], "lore": ["…"], "opening": "…", "cover": {"mode": "generate" / "search" / "upload" / "none", "count": 4, "style": "…", "note": "…"}, "sources": [{"url", "title"}], "estimate": {"searches", "pages", "images"}, "language": "…"}` |
| `plan_reply` | 用户 | `{"approved": true, "name": "温九", "plan_seq": 5}` 或 `{"approved": false, "text": "想改的地方", "plan_seq": 5}` |
| `changes` | agent | `{"intro": "…", "hunks": [{"id": "h1", "target": {…}, "before": "…", "after": "…" / null, "summary": "…", "state": "pending" / "accepted" / "rejected" / "stale"}]}`：`target` 是 `{"field": "personality"}`、`{"greeting": 2}`、`{"lore": 3}` 或 `{"lore_new": {"name", "keys", "constant"}}`；`before` 由代码从草稿里取 |
| `images` | agent | `{"asset_ids": ["…"], "purpose": "cover_candidates" / "references", "note": "…"}` |
| `progress` | agent | `{"fields": ["description", "first_mes"], "lore": {"added": 2}, "cover": false, "complete": true, "stopped": false}`：一轮写完的摘要 |
| `research` | agent | `{"searches": ["林黛玉 性格"], "pages": ["page_id"], "images": 1}`：这一轮查资料的过程（搜了什么、读了哪几页、存了几张网上的图），一轮结束时记一条 |
| `error` | agent | `{"code": "TOOLS_UNSUPPORTED", "message": "…", "reason": null}`：这一轮没做完，`code` 见 [api/README.md 的“工作台一轮失败的原因”](../api/README.md#工作台一轮失败的原因) |

### `workbench_assets.meta`

```jsonc
{
  "personal_use": true,          // 用户确认过“仅限个人使用”（版权不明的图要先确认才能当封面）
  "page_url": "https://…", "title": "…",          // 搜到的图所在的网页
  "tool_route_id": "…", "protocol": "openai_images", "model": "…", "aspect": "portrait", "style": "水墨"   // 生成的图
}
```
