# BetterTavern 测试技术方案

> 文档索引：[总览](README.md) · [后端](backend.md) · [客户端](client.md) · [测试](testing.md) · [数据模型](data-model/README.md) · [接口](api/README.md)

## 1 可观测性、测试与评估

这类系统的故障多半不是崩溃，而是“悄悄变差”：协议遵守率下降、状态写错、摘要丢信息、延迟上升。所以可观测性和评估与功能同等重要，从 M1 就接入。

### 日志与追踪

日志是服务端边干活边写的流水账：每一行是一条 JSON，写明什么时候、发生了什么、结果怎样。它和数据库里的 `agent_runs`（模型调用账本）分工：
账本只记每次调用模型的最终结果，长期保存，用来统计；日志记过程中的每一步（重试、限流、断线……），只保留最近一段，用来排查单个问题。

**写到哪里**

- 终端：开发时是带颜色的单行，生产环境或者不是终端时是 JSON（`LOG_FORMAT` 可以固定成 `console` 或 `json`）。
- 文件：开发环境默认另写一份 JSON 到 `apps/server/.data/logs/api.log`、`worker.log`（`LOG_TO_FILE` 控制），每个文件 10 MB 轮转、保留 5 份。
  日志不进业务数据库：量大、要能在数据库出问题时照常写、满了自动删。生产环境由部署环境收集标准输出，送进专门的日志存储（如 Loki）。
- 本项目的日志（structlog）和第三方库的日志（uvicorn、asyncpg 等的标准库 logging）走同一条处理链，格式一样。uvicorn 自带的访问日志关掉，由 api 的中间件记。

**每条都有的字段**

| 字段 | 含义 |
| --- | --- |
| `timestamp` | 本地时间，带时区，精确到毫秒 |
| `level` | `debug` / `info` / `warning` / `error` |
| `event` | 固定的英文事件名，例如 `turn.committed` |
| `logger`、`process` | 来源模块；进程（`api` / `worker`） |
| `request_id` | 请求单号（见下） |
| `user_ref` | 用户代号：用户 id 做 SHA-256 取前 12 位，日志里不直接出现用户 id 和邮箱 |
| `playthrough_id`、`turn_id`、`seq`、`turn_attempt` | 回合执行期间才有 |
| `job_id`、`job_kind`、`ordering_key` | 后台任务执行期间才有 |

这些编号用 `structlog.contextvars` 在请求或任务开始时绑定一次，之后打的每一条都自动带上，不用每次手动传。
在请求里启动的后台任务（回合生成）会继承启动时的绑定，所以回合的日志也带着提交它的那次请求的单号。

**请求单号**：一串随机编号，给“某一次请求”当身份证。App 每个请求生成一个，放在请求头 `X-Request-ID` 里；没带或格式不对时服务端生成。
服务端处理这个请求期间写的每一条日志都带着它，响应头原样带回，错误响应体里也有 `request_id`（见 [api/README.md](api/README.md)）。
App 报错时显示这个单号，拿它去日志里一搜：搜不到说明请求没到服务端（网络问题），搜得到就能看到服务端哪一步出了错。

**写法约定**

- `log = structlog.get_logger(__name__)`，`log.info("turn.committed", seq=3, duration_ms=812)`。
- 事件名是固定的英文点分名字，具体数值放字段里，不把变量拼进事件名，这样才能按事件名检索和统计。
- 一个步骤结束时记的事件带 `duration_ms`（这一步花的毫秒数），vis 据此把步骤画成时间条。
- 故事文本只能放在 `narrative`、`text`、`content`、`messages`、`prompt`、`completion` 等约定的字段里（完整列表见 `infra/observability/redact.py`），这些字段默认整个丢掉。

**脱敏**（`infra/observability/redact.py`，思路参考 kimi-code 的 `logging/formatter.ts` 与 hermes-agent 的 `redact.py`）：每条日志写出去之前经过三道关：

1. 看字段名：名字像密钥的（`authorization`、`api_key`、`token`、`password`……）整个值换成 `[REDACTED]`；故事文本字段整个丢掉，只有开发环境打开 `LOG_STORY_TEXT` 才保留。
2. 看内容：任何字符串里像密钥的片段（Bearer 令牌、`sk-…`、`hf_…`、JWT、`api_key=…`）抹掉，邮箱打码。异常信息、第三方库的日志也经过这一关。
3. 看长度：事件名 300 字、字段值 2000 字、异常堆栈 8000 字，超出截断；列表最多 50 项。

**各环节的事件**（带 `duration_ms` 的事件在步骤结束时记，表示这一步花的时间）：

| 环节 | 事件 | 主要字段 |
| --- | --- | --- |
| 请求 | `http.request`、`http.error` | 方法、路径、路由模板、状态码、耗时、客户端版本、`error_code`（业务错误码，由错误处理绑定） |
| 账户 | `auth.registered`、`auth.login`、`auth.login_failed`、`auth.refresh`、`auth.refresh_invalid`、`auth.refresh_reused`（疑似令牌被盗，整族吊销）、`auth.logout`、`account.deleted`、`account.delete_rejected` | 失败原因（`unknown_email` / `wrong_password` / `expired`……）；不记邮箱和密码 |
| 模型 | `route.created` / `updated` / `deleted`、`route.key_unreadable`、`route.probe`、`route.window_learned`、`models.listed`、`models.list_failed`、`models.list_skipped` | 服务商、模型名、端点主机名、改了哪些字段、窗口从哪来、是否复用或一起换了 Key、探测结果、模型数量、错误类别 |
| 导入 | `scenario.imported`、`scenario.import_failed`、`scenario.deleted` | 字节数、卡片规范、世界书条目数、开场白数、被截断的字段名、是否重复导入 |
| 世界书 | `lorebook.imported`、`lorebook.import_failed`、`lorebook.created`、`lorebook.deleted` | 字节数、格式（`st_world` / `lorebook`）、条目数、丢掉几条、不支持的设置几条、失败码、是否重复导入；不记书名和条目内容 |
| 回合 | `turn.submitted`、`turn.replayed`（幂等重放）、`turn.started`、`world.build.started` / `done`、`world.lore_built`、`world.lore_truncated`、`turn.lore`、`turn.barrier_waited`、`context.assembled`、`turn.context_overflow_retry`（服务商写明了上限时带 `learned_window`）、`turn.window_note_failed`、`director.parse`、`options.repair` / `repair_failed`、`turn.committed`、`turn.commit_rejected`、`turn.failed`、`turn.cancel_requested`、`turn.lease_expired`、`turn.crashed` | 行动来源和文字长度、预算与占用比例、提示词指纹、解析走到哪一级、选项来源、失败码与取消原因、总耗时；世界书合了几本几条、这一回合常驻和挑中几条、递归几条、预算装不下几条、正则超时几次 |
| 模型调用 | `provider.request`、`provider.slot_wait` / `slot_timeout`、`provider.first_token`、`provider.response`、`provider.failed`、`provider.limit_hit`（导演这一段碰到总时长或总字数上限） | 服务商、模型、错误类别与 HTTP 状态、首字延迟、各类 token 数、结束原因、碰到哪条上限 |
| 推送 | `sse.subscribe`（实时 / 回合结束后一次给全，续传要补发几条）、`sse.open`、`sse.close` | 从第几条续传、结束原因（`completed` / `client_gone` / `shutdown`）、发出几条、持续多久 |
| 后台任务 | `job.started` / `done` / `failed` / `released` / `lock_lost` / `renew_failed` / `reaped`、`job.claim_failed`、`queue.listen_*`、`worker.*` | 任务类型、第几次尝试、会不会重试、多久后重试 |
| 进程 | `app.started`、`app.stopping`、`scheduler.task_failed`、`secrets.dev_generated` | 版本、环境、实例 |

`tests/e2e/test_observability.py` 在角色卡、玩家行动、模型叙述里埋一个暗号，跑完整个回合后检查日志文件：暗号、API Key、密码、邮箱都不出现；
回合的步骤按顺序出现，并且都带着提交它的那次请求的单号。以后谁不小心把故事写进日志，这个测试会失败。

**访问日志与异常**：最外层的中间件（`api/request_context.py`）在每个请求结束时记一条 `http.request`（方法、路径、路由模板、状态码、耗时、客户端版本）；
事件流这类长连接在连接结束时才记，耗时就是连接时长；健康检查成功时不记。未处理的异常记 `http.error`（带堆栈），返回 500 `INTERNAL_ERROR`。

**手机上的诊断日志**（`apps/mobile/src/observability/`）：只存在手机上，不上传。

- 最多保留最近 500 条，存在 App 文档目录的 `diagnostics.jsonl`，App 重启后接着用；格式和服务端一致（时间、级别、事件名加字段），脱敏规则也一样。
- 记什么：`app.started`、`app.error`（没人处理的异常，崩溃前立刻写盘）、`session.status`（登录状态变化）、`server.changed`、
  `api.request`（失败的和超过 2 秒的请求，带单号、状态码、耗时、错误码；连不上时带底层异常和当时的服务器地址）、
  `sse.state` / `sse.error` / `sse.finished`（推送连接的断开、重连、转轮询，每次连接都有自己的单号）、`turn.phase`（回合状态机的阶段变化）、
  `modal.dismiss_timeout`（iOS 上某个浮层关闭后 1 秒还没收到“已收回”，按已收回处理；正常不会出现，见 [client.md](client.md) 的“浮层的先后”）。
- 正常的请求、连接中这类 `debug` 记录只在开发时打到 Metro 终端，不占小本子的位置。
- 每个请求都带 `X-Request-ID`；意外的错误（连不上、5xx、返回内容看不懂）在界面上附上单号的前 8 位，拿它去服务端日志里查。
- “设置 → 连接测试”页底部可以导出（系统分享面板，开头几行说明，后面每行一条 JSON）和清空。

### 日志查看器 vis

日志文件是一行一条 JSON，人直接读很累。vis 是一个只在本机运行的网页，把日志文件和数据库里的回合记录拼起来，用中文画成看得懂的样子（思路参考 kimi-code 的 vis）。

**怎么用**

第一次先装网页的依赖：

```bash
make vis-install
```

之后每次构建网页并启动，打开 http://127.0.0.1:8100 ：

```bash
make vis
```

- 它读 `apps/server/.data/logs/` 下的 `api.log`、`worker.log`（包括轮转出来的 `.1`～`.5`），页面每 3 秒刷新一次，新写的日志很快就能看到；数据库用 `.env` 里的 `DATABASE_URL`。
- `--log-dir` 换日志目录，`--no-db` 只看日志，`--port` 换端口。只监听 `127.0.0.1`：它能看到所有用户的回合，不要对外开放。
- 改网页时 `cd apps/vis && npm run dev`（热更新，`/api` 转发到 8100），同时开着 `make vis`。

**页面**

| 页面 | 内容 |
| --- | --- |
| 概览 | 最近 1 小时 / 24 小时 / 7 天：回合数与失败数、首字等待和模型耗时的中位数、token、调模型重试、推送断线、服务端错误；每小时的回合；最近的警告和错误按事件归类；失败的回合 |
| 故事与回合 | 所有用户的故事；点进一个故事，每个回合一行：行动、状态、首字等待、总耗时、模型、输出 token、重试和断线次数 |
| 回合详情 | 问题提示（重试、限流、首字慢、断线、选项被修补……）→ 时间线瀑布图（请求、搭建世界、等待、模型调用、每条推送连接各占一行）→ 按时间排的步骤，每步一句中文 → 模型调用卡片（token、缓存命中、首字、解析结果；这次运行的每一步：调模型还是用工具、耗时、token、出错原因，模型这一步要调哪些工具；打开“显示故事内容”时还能看模型写的原文、工具的参数和结果，世界状态 agent 用的编号 e1、f3 后面注上名字）→ 故事内容（默认隐藏） |
| 请求 | 每个请求一行，可以只看失败的或慢的；点开看这个请求单号下的全部记录 |
| 原始日志 | 按级别、文件、编号、关键字筛选，实时追加；点一行看全部字段 |

- 顶上的搜索框粘贴任意编号（请求单号、回合编号、故事编号，前 6 位以上就行）直接跳到对应页面。
- 事件名、错误码、字段名都有中文说明（`apps/vis/src/lib/catalog.ts`）；没收录的照原样显示。新增事件时顺手在这里加一行。
- **手机日志**：把手机上导出的诊断日志拖进页面（或点“载入手机诊断日志”），它和服务端的记录按时间合在一起，同一个单号的请求能看到手机和服务端两边各发生了什么；
  只在手机日志里有的单号也能搜到，那通常就是请求根本没到服务端。手机日志只在浏览器内存里，刷新就没了，不上传。

**故事文本**：默认不显示，回合详情只给字数；工具参数只给参数名，模型要调的工具只给工具名，世界状态 agent 的编号对照表不返回（`vis/queries.py` 的 `step_view`、`run_result_view`，`tests/unit/vis/test_queries.py` 检查）。开发环境（`ENV` 不是 `prod`）可以在回合详情底部勾选“显示”，网页这时才带 `?story=1` 去取；生产环境接口直接不返回。

**实现**（`apps/server/src/bettertavern/vis/` 和 `apps/vis/`）

- 接口是一个独立的 FastAPI 应用，由 `bettertavern vis` 启动，同时托管构建好的网页（`apps/vis/dist`）。所有接口只读，不进 `docs/api/`：它不是产品接口，随网页一起改。
- `logstore.py` 增量读日志：记住每个文件读到哪个字节，轮转后按 inode 认出是哪个文件，坏行跳过；按请求单号、回合、故事、任务建索引。
- `timeline.py` 把一个回合的日志变成时间条：带 `duration_ms` 的事件往前推出开始时间，每次请求模型、`sse.open` 到 `sse.close` 各成一段，没有时长的事件画成点。
- `issues.py` 从日志和 `agent_runs` 里找问题；`queries.py` 跨用户查数据库（只读，不带 `user_id` 条件，这是它和业务仓储的区别）。
- 网页是 React + Vite + TanStack Query；纯逻辑（中文目录、格式化、手机日志解析、每一步的显示）用 `node --test` 测（`make vis-test`）。
- 数据库连不上时，只依赖日志的页面（请求、原始日志、时间线）照常工作。

追踪（M4）用 OpenTelemetry。一个回合是一条 trace：根 span `turn`，子 span 有 `assemble_context`、`provider.stream`（属性：model、ttft\_ms、各类 token 数、缓存命中比例）、`commit`。后台任务通过 `jobs.payload.traceparent` 接上同一条 trace，子 span 是 `state_keeper`、`consolidator`、`outline`。span 属性里不放文本。

### 指标

| 指标 | 含义 | 关注点 |
| --- | --- | --- |
| `turn_ttft_seconds{model}` | 提交到首 token | p95 是否超目标 |
| `turn_total_seconds` | 提交到 `turn.completed` |  |
| `turn_failed_total{code}` | 回合失败 | 失败率大于 2% |
| `state_lag_turns` | 导演开始写时，世界状态落后了几回合 | 经常大于 1 说明后台模型太慢或经常失败 |
| `director_parse_total{stage}` | 协议解析走到哪一级：ok、salvaged、repaired、missing | 修复率大于 5% |
| `provider_errors_total{provider,class}` | 厂商错误分类 | 某类突增 |
| `context_usage_ratio` | 每次装配的占用率直方图 | 是否经常接近 95% 紧急线（说明后台整理没跟上） |
| `consolidation_total{kind,result}` | 章节整理的成功、失败、作废 | 失败率 |
| `director_tool_rounds` | 导演每回合用了几轮召回工具 | 用得越多首字越慢 |
| `stale_commits_total{lane}` | 版本围栏拒绝次数 | 突增说明回退或并发异常 |
| `job_lag_seconds{lane}` | 任务从入队到开始的延迟 | p95 大于 10 秒 |
| `tokens_total{agent,type}` | prompt、cached、completion、reasoning | 用量与缓存命中率 |

初始 SLO：首 token p50 小于 3 秒；回合失败率小于 2%；九成五的回合开始时世界状态落后不超过 1 回合；协议修复率小于 5%；后台任务延迟 p95 小于 10 秒。这些是目标值，M0 实测后修订。

### 测试

| 层 | 内容 | 要点 |
| --- | --- | --- |
| 单元 | `domain/` 的纯逻辑（不变量、补丁应用与撤销、别名索引、状态块渲染、预算降级、阈值）；`providers` 的 `build_body`；`DirectorStreamParser`；`SseClient` 的帧解析 | 不连网络、不连数据库 |
| 随机测试 | 解析器对任意 chunk 切分结果相同（固定种子的随机切分，服务端与客户端各一套）；回退的随机走：随机地往前玩几回合、回退到更早的一回合，每次回退后世界状态、回合标签、摘要、大纲和整理进度都和当初刚整理完那一回合时逐行相同（`tests/integration/test_rollback.py`，固定种子，没用 Hypothesis） | 回退和流式解析最容易出隐蔽 bug |
| 集成 | 真实 Postgres（`BT_TEST_DATABASE_URL` 指定，每个测试建临时 schema；本地 `make db-up`，CI 用 Postgres 服务容器）：队列内串行、队列之间并行、`SKIP LOCKED`、版本围栏（并发提交只有一个成功）、回退事务、租约过期清理、幂等键 | 数据库不 mock；异步测试用 anyio 的 pytest 插件 |
| 契约 | 各厂商的录制夹具（v1 是 DeepSeek 与 Hugging Face，自定义端点由假 LLM 服务覆盖；请求体、流式响应、错误体）；OpenAPI 与 TS 类型比对 | 夹具来自真实调用，靠夜间 live smoke 更新 |
| 假 LLM 服务 | `tests/fakes/llm_server.py`：模拟 OpenAI 兼容的 SSE，按脚本回复，可注入 429、中途断流、标签损坏、慢首 token、`content_filter` | 集成与端到端共用 |
| 端到端 | uvicorn 里的真实 api 加假 LLM：注册、添加模型、导入、开场、多回合、SSE 断线续传（`e2e/test_m1_flow.py`）；剧本试玩脚本整条跑几回合（`e2e/test_playtest_offline.py`，后台整理、章节、大纲都跑到）；网页端用 Playwright 从注册玩到删除账户 | 续传用例：中途断开再带 `Last-Event-ID`，拼接结果等于最终叙述 |
| 客户端 | `node --test`：`SseClient` 的帧解析、UTF-8 切分、重连与续传、回合状态机（纯 TypeScript，不依赖 RN）。计划中、还没接：Jest + RNTL 测界面组件，Maestro 从登录走完一个回合 |  |
| 夜间 live smoke | 可选，用维护者的密钥对两家厂商各跑一个回合 | 发现厂商 API 漂移，不进 PR 门禁 |
| 性能 | k6 或 locust：100 个并发 playthrough 对假 LLM，观察队列延迟与数据库竞争 | M4 |

测试原则借鉴 hermes-agent 的 `AGENTS.md`（其中有 “Don’t write change-detector tests”“Never read source code in tests” 两条）：测行为，不测实现文本；测试不读取源码文件内容。
文档同步测试读的是 `docs/` 下的文档，对照的是运行时的 OpenAPI 和真实数据库里的表结构，不读源码。

CI（`.github/workflows/ci.yml`，GitHub Actions）：每次推送和每个 PR 跑服务端的 ruff、pyright、import-linter 和全部 pytest（带一个 Postgres 服务容器，
所以集成和端到端测试都会跑），以及前端的类型检查、`node --test`、`check-i18n` 和网页构建；还会照 README 用 `deploy/docker-compose.yml` 起一整套，
确认网页、接口和网页登录都能从 `web` 容器（8080）访问。推送到 `m1` 并且都通过时构建服务端镜像，
线上部署用的就是它（[ops.md](ops.md)）。网页端到端（Playwright）要本机的 Chrome 和开发数据库，不在 CI 里跑，发布前在本机跑 `make web-e2e`。

### 评估（`evals/`）

质量不能只靠单测，要用剧本试玩评估量化：

- `evals/director_compliance.py`（M0）：在真实模型上连续跑 200 回合，统计导演协议无需修复与含修复的合规率、首 token 延迟和缓存命中，给出 go / no-go。剧本里的 `language` 决定用哪种语言的提示词：`datasets/m0/tavern.yaml` 是中文，`datasets/m0/ryokan_ja.yaml` 是日文。
- 用真模型做剧本试玩的完整步骤、历次结果和花费见 [evals.md](evals.md)。
- `evals/playtest.py`（agent runtime 阶段 2 起）：用真模型把一局玩 100～300 回合（`datasets/m2/tavern_100.yaml`、`tavern_300.yaml`，大部分点选项，穿插专门考世界状态整理的行动；`detour_60.yaml` 中途改道，考大纲），后台同时整理世界状态、章节和大纲；跑完用撤销记录倒推出每一回合的世界，逐回合检查一致性规则，列出退场后又被写进叙述的人和物，统计世界状态落后几回合、失败和跳过的回合、被拒绝的修改、两个 agent 的用量和延迟；剧本里写了检查点（第几回合后谁该退场、谁该在哪、谁手里该有什么）、召回题（很早以前的细节后面再问）和大纲检查，逐条判断。导演自己给出选项不到 95%、检查点没全过、出现一致性问题，都判为不合格；召回题、章节整理和大纲只列结果。用法见 `apps/server/evals/README.md`。
- 剧本试玩以后要扩展的（计划中）：用一批剧本自动试玩（合成数据，或用户明确授权的匿名数据，放在 `datasets/`），在指定的模型组合下跑完整管线，输出：协议合规率与各级修复比例；两个选项之间的词面重叠率（衡量区分度）；世界状态 agent 的修改对照人工标注的精确率与召回率；一致性探针（从状态表出若干事实问题，检查后续叙述是否与之矛盾，可选用 LLM 评审）；摘要保真度（对已整理成摘要的回合出若干问答，只用“摘要加状态表”回答，统计正确率）；用量与延迟。
- 长剧本试玩、回退一致性测试和每回合的记录项见 [agent-runtime.md](agent-runtime.md) 第 9 节。
- 提示词变更的门禁：模板头部有 `version`；改了模板，单元测试检查三种语言一致、能渲染（CI 里会跑，见 `.github/workflows/ci.yml`），维护者在本地用真模型跑剧本试玩（`evals/playtest.py`），把结果记进 [evals.md](evals.md) 第 5 节。
- 数据来源：不提交真实用户的故事；数据集只用合成数据或明确授权的数据。

预算比例、阈值、采样参数这些初始值，都以剧本试玩的结果为准调整，不凭感觉改。

## 2 各里程碑的测试出口

状态记到 2026-10-21，详见 [README.md 第 3 节](README.md)。

- M0（完成）：RN 真机 SSE 验收（见 [client.md 第 1 节](client.md)的“M0 探针的验收标准”）；导演协议在 200 回合里无需修复的合规率不低于 95%，含修复不低于 99.5%。
- M1（代码完成，按清单的真机验收没有单独记录）：DeepSeek 与 Hugging Face 各完整玩 30 回合；断网续传用例通过。
- M2（[agent-runtime.md](agent-runtime.md) 阶段 1、2，完成）：现有测试全部通过；100 回合剧本试玩的一致性检查通过；回退一致性测试通过。“重放结果和改造前一致”要靠确定性重放，还没做（[backlog.md](backlog.md) R1）。
- M3（[agent-runtime.md](agent-runtime.md) 阶段 3 到 5，完成）：300 回合剧本试玩上下文长度稳定（1.6～1.7 万 token）、长程问题 6 / 8 答对；召回评测和偏离剧本的评测出了结果（[evals.md](evals.md)）。
- M4（没开始）：外部安全审查无高危；100 并发压测达标；自托管文档按步骤能跑通。

完整里程碑见 [README.md 第 3 节](README.md)。

## 3 已有的测试

后端（`apps/server/tests`）：

| 文件 | 内容 |
| --- | --- |
| `unit/infra/test_crypto.py` | 主密钥（第一个加密、其余只解密）、信封加密绑定所在的行与字段、开发环境密钥只生成一次、生产环境必须显式配置、Argon2id 与重新哈希、访问令牌、刷新令牌只存哈希 |
| `unit/importers/test_character_card.py` | PNG 的 tEXt 与压缩文本块、V3 优先于 V2、压缩炸弹、无效输入、V1 / V3 的 JSON、宏替换 |
| `unit/domain/test_seed_and_plan.py` | Seed 规范化（名字与引用）、世界规划、最小 Seed、名字规范化、行动解析 |
| `unit/domain/test_world_draft.py` | 世界状态 agent 的修改清单：编号和名字都能指代实体、新建的是铅笔实体且每回合有上限、已确定的实体不能改长期描述、一个人或物同一时刻只在一处、换场景时主角跟着走、在场名单为准、关系的类型规则、事实推翻而不删、秘密告诉主角；收尾时更新出现的回合、铅笔改钢笔、改动按实体 → 关系 → 事实排；只有新出现的问题才挡住提交 |
| `unit/runtime/test_context.py` | 状态块排版与秘密分区、名册和事实的顺序、提到的和相关的两层、挂在在场的人和物身上的线索（越老越靠前、写明挂了多少回合和答案、不算主角）、回顾接在规则后面（梗概、最近几章、画像，摘要文字过围栏）、开头的“截至第几回合”、预算降级、消息摆放、确定性、玩家文字跳不出围栏、紧急截断；历史回合带当时的选项和隐藏备注；原文整块移出（块内前缀不变、没整理的回合不移出、提供工具时才提示可以查）；大纲切片只在最后一条消息里、排在状态块后面（system 和原文不变），文字过围栏，结局那一轮也有，开场没有 |
| `unit/runtime/test_director_recall.py` | 导演的召回：先查再写的事件顺序（`director.recalling` 在叙述之前，查东西那一轮的字不推给玩家）、工具结果用 `<recall>` 接回去、最多两轮第三次不给工具、全部原文都在上下文里或模型不能调用工具时不提供、叙述开始后工具调用被忽略、多轮用量相加；隐藏备注存下来但不推给玩家 |
| `unit/runtime/test_director_tools.py` | 三个召回工具：按名字（含别名）和关键词找回合、关键词按命中数排、名字不在世界状态里时当关键词找、只读不在上下文里的回合、查实体的完整资料（秘密标出、退场的也能查）、一回合的返回总量上限、命中处前后的摘录 |
| `unit/runtime/test_director_parser.py` | 导演输出的增量解析：任意切分结果相同、各种标签缺损的抢救；隐藏备注不混进叙述（叙述没闭合就写备注时到此为止）、没闭合的备注照样留下并截到 600 字 |
| `unit/domain/test_chapters.py` | 在哪里切章：过了软线以后的下一个场景结束处、越线那一回合正好场景结束、到硬线时硬切、还不到时不切；原文从上一章最后两回合开始 |
| `unit/runtime/test_memory_runner.py` | 章节整理（假模型）：不够一章时不写；在场景结束处切，发给模型的只有这一章的原文；已经有 3 章时把最早一章并进梗概（提示词里有要并的那章、留着的前几章和上一版画像）；积压时一章一章写完；失败和写入作废时停下 |
| `unit/domain/test_outline.py` | 大纲的修正：截长、去掉多余的拍、重复的编号、认不得的状态、只留一拍进行中、完成过的拍不能改回去；导演看到的切片（当前这一拍、下一拍） |
| `unit/runtime/test_outline_runner.py` | 大纲修订（假模型）：没有要做的不调模型；第一版照开局设定写并按规则修正；有大纲时可以不改（交给模型的有现在的大纲和原因）、改了的完成过的拍不能改回去；说要改却没给大纲、调模型出错时记失败不写入；写入作废返回 False |
| `unit/domain/test_world_threads.py` | 线索的修改清单：只有没解开的有编号、记下和解开算出的改动、种类、空文字、重复和每回合上限的检查、没解开的总数上限、合并（标为 `merged`、指向新的一条、沿用答案、回退时的顺序）、后写答案、同一回合记下又解开算一次新建 |
| `unit/runtime/test_agent_loop.py` | 执行循环和工具注册表：参数检查、不在清单里的工具不执行、工具出错交回模型、读工具的结果过围栏并截断、轮数上限和最后一轮不给工具；有收尾工具时调用成功就结束、没调用就提醒一次、最后一轮只给收尾工具 |
| `unit/runtime/test_state_runner.py` | 后台整理世界状态（假模型按剧本调工具）：工具调用变成一次提交、记下、解开和合并线索并写下答案（输入里有没解开的线索和导演的隐藏备注，线索的改动排在最后）、用过的编号记下对应的名字（失败的运行也记）、被拒绝的修改交回模型并记下、没有变化也提交、多个回合按顺序整理、第一次失败就停下、第二次失败跳过、一直不 commit 算失败、不能调用工具的模型不调用、写入作废就停下、输入过围栏；有大纲时输入里有当前这一拍和前几回合还没处理的“要改”的原因，“大纲要改”的原因随提交一起写下 |
| `unit/runtime/test_prompt_languages.py` | 中文、英文、日文三套提示词（[i18n.md](i18n.md) 第 4 节）：文件一一对应、模板用到的变量相同、数据文件的键相同、字段说明指向真实字段、每种语言都能渲染；英文、日文的状态块和上下文是各自的语言 |
| `unit/domain/test_language.py` | 提示词语言的解析（认识的原样保留，不认识的按中文）、没有名字的主角按语言的兜底称呼 |
| `unit/runtime/test_structured.py` | 结构化输出阶梯：校验失败带错误重试一次、不支持的级别跳过并缓存、降两级后放弃、传输错误上抛 |
| `unit/runtime/test_runner.py` | 事件顺序与提交、选项修复（补两次都失败时这一回合没有选项）、首 token 前出错直接失败、不重发也不换模型，超窗时重新装配再请求一次，半截失败保留叙述、鉴权错误不重试（失败事件带 `reason`）、没有叙述、没有路由、提交被围栏拒绝、不等世界状态整理（状态块写明截至第几回合）、租约丢失时取消生成、开局构建、关闭时取消、英文和日文的一局用各自语言的提示词 |
| `unit/api/test_body_limit.py`、`unit/api/test_probe_api.py` | 请求体大小限制；探针接口读不到真实回合的事件流 |
| `unit/api/test_api_doc.py` | [docs/api/](api/README.md) 与 OpenAPI 一致（目录里的文件合在一起检查，每个接口和模型只能写一次）：接口齐全、鉴权与成功状态码、查询参数与请求头、每个请求和响应模型的字段与必填项 |
| `integration/test_data_model_doc.py` | [docs/data-model/](data-model/README.md) 与迁移建出的表一致（同上）：表、列名、类型、可空、索引名 |
| `integration/test_accounts.py` | 注册登录、刷新令牌轮换、宽限期与盗用检测、退出吊销整族、删除账户 |
| `integration/test_routes.py` | 模型路由：窗口的来源顺序（服务商列表 > 能力表 > 手填 > 32K）、保存时复用表单拉过的列表、复用 Key 与一起换 Key、只有一个导演且所有用途都用它、学到的窗口只往小调、跨用户 404 |
| `integration/test_turns.py` | 同一个幂等键并发提交只建一个回合、生成中再提交得到 `TURN_IN_PROGRESS`、租约过期清理后迟到的结果作废、跨用户 404、过期父回合与选项校验 |
| `unit/evals/test_playtest_report.py` | 剧本试玩的分析：用撤销记录倒推每回合的世界（包括线索）、新出现的问题、退场后又被写到的人、落后几回合、导演自己给出选项的比例、流水账和一次性实体、召回工具的使用和召回题、结论和总结页 |
| `unit/evals/test_playtest_checks.py` | 剧本试玩的检查点：每一种检查的判断、按名字和别名找、没过时写明实际记成了什么、读剧本里的检查点 |
| `unit/evals/test_playtest_outline.py` | 剧本试玩里的大纲：修订列表、按回合段的大纲检查（改了几次、改出来的大纲有没有跟上玩家）、总结页的一节 |
| `e2e/test_playtest_offline.py` | 用假模型服务把剧本试玩脚本完整跑一遍（几回合）：开局、玩、后台整理、等追上、分析；切章的线很低时章节整理也跑起来，后台写了第一版大纲，之后假导演按真实的流式格式先调一次 `recall` 再写；需要数据库 |
| `integration/test_memory.py` | 章节整理：世界状态整理完一回合就放一个任务；在场景结束处切、到硬线时切，第 4、5 章时把最早一章并进梗概，每章改写一版画像，运行记在这一章最后一回合上；导演的上下文换成回顾加当前这一章的原文、提供召回工具；回退删掉在目标回合之后写的摘要（包括之后才并出来的梗概），画像不动 |
| `integration/test_outline.py` | 大纲修订：世界状态整理完开场就放任务写第一版；下一回合导演在最后一条消息里看到大纲、世界状态 agent 看到当前这一拍；没说要改时不放任务；修订还没做时，下一回合的世界状态 agent 看得到上一回合说过的原因；攒下的原因一次处理，“不改”也记一次、进度前进；回退删掉依据超过目标回合的修订，删了才放任务；回退前开始的修订写入时作废；失败时原因留着，下一回合再试 |
| `integration/test_recall.py` | 隐藏备注存进回合、接口不返回、交给世界状态 agent、回到之后导演的上下文，据此记下的线索出现在状态块里；召回查询只看当前故事线上、上下文之前的回合（关键词也找一句话摘要，`%` 不是通配符，回退后归档的回合查不到） |
| `integration/test_rollback.py` | 回退：随机走很多步“往前玩几回合 / 回退到更早的一回合”，每次回退后世界状态（实体、关系、事实、线索，包括合并和答案）、章节摘要和全书梗概（每回合切一章，并梗概也走得到）、大纲的修订（改和不改都走得到）、回合标签（包括“大纲要改”的原因）和三个整理进度都和当初刚整理完那一回合时逐行相同；世界状态落后时回退，接着整理到目标回合；回退前开始的整理写入时作废；已经在最新一回合、正在生成、目标不在故事线上、次数用完时拒绝；写完结局的故事回退后回到进行中 |
| `integration/test_state.py` | 世界状态 agent 的写入：回合存为 `replied` 并只放一个整理任务；整理结果写进世界状态表、`state_patches`、`turn_notes` 和 `agent_steps`；时间线变了时什么都不写、运行记为 `stale`；世界状态接口带上整理进度、失败和跳过 |
| `e2e/test_m1_flow.py` | uvicorn 里的真实 api 加假模型服务：注册 → 拉模型列表并添加模型 → 导入 → 开局 → 多回合（幂等重放、并发提交、过期父回合）→ 中途断开再续传，拼接结果等于最终叙述；鉴权与隔离；窗口校验；开局的 `language`（不传按中文、只认 zh / en、英文的一局给导演的是英文提示词） |
| `e2e/test_web_auth.py` | 网页的 Cookie 登录：注册、刷新、登录只在 HttpOnly Cookie 里给刷新令牌，刷新和退出凭 Cookie、被拒时删掉 Cookie；跨站请求返回 403；不带 `X-Auth-Mode` 时和 App 一样 |

`integration` 与 `e2e/test_m1_flow.py`、`e2e/test_web_auth.py` 需要 `BT_TEST_DATABASE_URL`（`make test-integration`），没有设置时跳过。

客户端（仓库根目录 `npm test`，主要在 `packages/core`）：`i18n`（英文、日文资源的 key 都和中文一一对应、插值变量和组件标签一致、英文复数齐全、语言的解析和切换）、错误按错误码翻译（中、英、日）、`sseParser`、`sseClient`（重连、退避、续传、转轮询、401）、`turnMachine`（包括“正在回想”的提示）、`playSession`（加载、幂等重试、
`TURN_IN_PROGRESS` / `STALE_PARENT`、续传、轮询、失效登录、回到更早的一段（成功后重新加载、次数用完不发请求、被拒绝时返回原因并重新加载））、`turnStream`（半截终止事件后的恢复）、`session`（单飞刷新、网页的 Cookie 模式）、`client`（401 重试、problem+json、
Cookie 模式的请求头和请求体）。网页端（`apps/web`）自己的纯逻辑也在 `npm test` 里：桌面布局（`theme/layout.ts`：断点、世界面板的形态、右键菜单和提示的位置、
快捷键判断、标签页标题）、导航轮盘（`theme/wheel.ts`：角度换算成第几块、靠边时圆心往里挪、松手贴边、按住多久算拖动、位置的存和取、键盘转圈）、
漫画格子（`theme/grid.ts`：每一页放哪几项、每一项占哪几格、第一页不满时不留空洞、翻页）、人物位取哪个字和哪种底、剧本的题材和搜索、登录页桌面的伪随机形状（同一个种子一样、点都在画布里）、
阅读页的回想列表和右栏（人物、刚记下的）、浏览器存储、界面偏好、导入规则、跟随新文字、Enter 发送与输入法组字。App 的界面还没有自动化测试。

网页端的端到端测试（`apps/web/e2e`，`make web-e2e`）：Playwright 自己起后端（开发数据库）、假模型服务（`tests/fakes/story_llm.py`）和 Vite，
用本机的 Chrome 走一遍注册 → 刷新后仍登录（Cookie）→ 按 Q 展开轮盘、点“模型”进模型页、添加模型 → 在工作台导入角色卡、手动改（自动保存，空的世界书条目保存时标红、改好就恢复）→ 保存并开始新故事（建剧本）→ 开局 → 按 A 选选项 → 按 / 自己写、Enter 发送 → 按 W 打开世界状态 →
把窗口拖到 1920、1280、900、390 看轮盘和 Tab 栏、没有横向滚动 → 按 ? → 写结局 → 在设置页删除账户。设 `E2E_ALL_BROWSERS=1` 时加跑 WebKit 和 Firefox
（先 `npx playwright install webkit firefox`）。上面这条按中文跑；`e2e/english.spec.ts` 用英文浏览器跑一条冒烟：
界面是英文（轮盘上的名字也是）、登录失败的说明按错误码翻译、设置里切到中文再切回来立刻生效、开局请求带 `language: "en"`；
`e2e/japanese.spec.ts` 用日文浏览器跑同样的一条，再看正文用的是日文的宋体。
`e2e/auth.spec.ts` 看登录这几页：左格的桌面没有字、读屏看不到；找回密码走到填验证码那一步（6 格只留数字）；验证页的邮箱和“换一个邮箱”；服务器切换对话框；窄屏只剩表单。

落地页（`apps/site`）的纯逻辑也在 `npm test` 里：演示的故事推进（逐字写完、选项、两轮结束、四条路、全部显示、减少动态效果、从头再读）、
主角改名（前文和当前一段一起换、空白和字数）、世界面板的新条目和更新；关系图的邻接、悬停时亮哪些、选中节点的关系（含揭开的秘密）；
导航高亮当前所在的节；复制命令的退路（剪贴板被拒、没有剪贴板接口、旧的复制命令也失败）；构建时去掉用不上的字体片；
架构图每一步点亮哪些部件、按钮的循环；三份文案的结构、占位和行内代码一一对应，三种语言的演示都能走到结尾；
从地址认语言、按浏览器语言选、页面之间的相对链接；预渲染时改 `<head>`（含分享配图和结构化数据），以及中文首页的跳转脚本（第一次按浏览器语言跳、记住手动选的、爬虫不跳）；
给搜索引擎的文件：robots.txt、站点地图（每种语言列出全部语言版本）、404 页。
冒烟测试（`apps/site/e2e`，`make site-e2e`）：先构建，再把 `dist` 放在 `/BetterTavern/` 子路径下，用本机的 Chrome 打开：
中文、英文、日文三页的预渲染内容、`lang`、页面信息和托管字体（日文页是 Noto Serif JP），hydrate 没有报错；点演示的选项读到结尾；
架构图点步骤、点框、按“下一步”；常见问题一次展开一条；切部署标签、复制；换语言带上锚点、记住选择；英文浏览器第一次打开首页跳到英文页；
三种语言在 320 到 1440 的宽度下都没有横向滚动，也没有内容伸出窗口被裁掉；不开 JS 时看得到三种语言的全部文字。

`make lint` 最后跑 `scripts/check-i18n.mjs`：手机端、网页端、落地页和 `packages` 的代码里不能有写死的中文字符串（资源目录、测试文件除外），界面文字都要走 i18n。

**M1 的出口验收**（需要真机和真实的 Key，自动化测试覆盖不了）：DeepSeek 与 Hugging Face 各完整玩 30 回合；
游玩中途切到飞行模式再切回来，叙述接着出、不重复不缺字；生成中杀掉 App 再打开，能接上或看到可重试的失败。
