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
| 密钥 | `credential.created` / `updated` / `deleted`、`credential.unreadable`、`credential.probe`、`models.listed`、`models.list_failed` | 服务商、端点主机名、改了哪些字段、探测结果、模型数量、错误类别 |
| 导入 | `scenario.imported`、`scenario.import_failed`、`scenario.deleted` | 字节数、卡片规范、世界书条目数、开场白数、被截断的字段名、是否重复导入 |
| 回合 | `turn.submitted`、`turn.replayed`（幂等重放）、`turn.started`、`world.build.started` / `done`、`turn.barrier_waited`、`context.assembled`、`turn.context_overflow_retry`、`turn.fallback`、`director.parse`、`options.repair` / `repair_failed`、`turn.committed`、`turn.commit_rejected`、`turn.failed`、`turn.cancel_requested`、`turn.lease_expired`、`turn.crashed` | 行动来源和文字长度、预算与占用比例、提示词指纹、解析走到哪一级、选项来源、失败码与取消原因、总耗时 |
| 模型调用 | `provider.request`、`provider.slot_wait` / `slot_timeout`、`provider.retry`、`provider.first_token`、`provider.response`、`provider.failed` | 服务商、模型、第几次尝试、错误类别与 HTTP 状态、重试等待、首字延迟、各类 token 数、结束原因 |
| 推送 | `sse.subscribe`（实时 / 回合结束后一次给全，续传要补发几条）、`sse.open`、`sse.close` | 从第几条续传、结束原因（`completed` / `client_gone` / `shutdown`）、发出几条、持续多久 |
| 后台任务 | `job.started` / `done` / `failed` / `released` / `lock_lost` / `renew_failed` / `reaped`、`job.claim_failed`、`queue.listen_*`、`worker.*` | 任务类型、第几次尝试、会不会重试、多久后重试 |
| 进程 | `app.started`、`app.stopping`、`scheduler.task_failed`、`secrets.dev_generated` | 版本、环境、实例 |

`tests/e2e/test_observability.py` 在角色卡、玩家行动、模型叙述里埋一个暗号，跑完整个回合后检查日志文件：暗号、API Key、密码、邮箱都不出现；
回合的步骤按顺序出现，并且都带着提交它的那次请求的单号。以后谁不小心把故事写进日志，这个测试会失败。

**访问日志与异常**：最外层的中间件（`api/request_context.py`）在每个请求结束时记一条 `http.request`（方法、路径、路由模板、状态码、耗时、客户端版本）；
事件流这类长连接在连接结束时才记，耗时就是连接时长；健康检查成功时不记。未处理的异常记 `http.error`（带堆栈），返回 500 `INTERNAL_ERROR`。

追踪（M4）用 OpenTelemetry。一个回合是一条 trace：根 span `turn`，子 span 有 `barrier_wait`、`assemble_context`、`provider.stream`（属性：model、ttft\_ms、各类 token 数、缓存命中比例）、`commit`。后台任务通过 `jobs.payload.traceparent` 接上同一条 trace，子 span 是 `state_keeper`、`gate.*`、`compactor`、`outline_reviser`。span 属性里不放文本。

### 指标

| 指标 | 含义 | 关注点 |
| --- | --- | --- |
| `turn_ttft_seconds{model}` | 提交到首 token | p95 是否超目标 |
| `turn_total_seconds` | 提交到 `turn.completed` |  |
| `turn_failed_total{code}` | 回合失败 | 失败率大于 2% |
| `barrier_wait_seconds`、`barrier_timeout_total` | 屏障等待与超时 | 超时率大于 3% |
| `director_parse_total{stage}` | 协议解析走到哪一级：ok、salvaged、repaired、fallback | 修复率大于 5% |
| `provider_errors_total{provider,class}` | 厂商错误分类 | 某类突增 |
| `context_usage_ratio` | 每次装配的占用率直方图 | 分布是否偏向阈值线 |
| `compaction_total{result}`、`compaction_saved_ratio` | 压缩的成功、失败、过期，以及节省比例 | anti-thrash 是否触发 |
| `gate_decisions_total{gate,question,decision}` | 门控判定分布 | 小 LLM 超时、降级到规则的比例 |
| `stale_commits_total{lane}` | 版本围栏拒绝次数 | 突增说明回退或并发异常 |
| `job_lag_seconds{lane}` | 任务从入队到开始的延迟 | p95 大于 10 秒 |
| `tokens_total{agent,type}` | prompt、cached、completion、reasoning | 用量与缓存命中率 |

初始 SLO：首 token p50 小于 3 秒；回合失败率小于 2%；屏障超时率小于 3%；协议修复率小于 5%；后台任务延迟 p95 小于 10 秒。这些是目标值，M0 实测后修订。

### 测试

| 层 | 内容 | 要点 |
| --- | --- | --- |
| 单元 | `domain/` 的纯逻辑（不变量、补丁应用与撤销、别名索引、状态块渲染、预算降级、阈值）；`providers` 的 `build_body`；`DirectorStreamParser`；`SseClient` 的帧解析 | 不连网络、不连数据库 |
| 属性测试 | 解析器对任意 chunk 切分结果相同（M0 用固定种子的随机切分，服务端与客户端各一套）；M2 起用 Hypothesis：随机合法补丁序列之后回退到任意 k，世界状态逐字段等于第 k 回合时的快照；合法补丁永不违反不变量 | 回退和流式解析最容易出隐蔽 bug |
| 集成 | 真实 Postgres（`BT_TEST_DATABASE_URL` 指定，每个测试建临时 schema；本地 `make db-up`，CI 用 Postgres 服务容器）：车道串行与并行、`SKIP LOCKED`、版本围栏（并发提交只有一个成功）、回退事务、租约过期清理、幂等键 | 数据库不 mock；异步测试用 anyio 的 pytest 插件 |
| 契约 | 各厂商的录制夹具（v1 是 DeepSeek 与 Hugging Face，自定义端点由假 LLM 服务覆盖；请求体、流式响应、错误体）；OpenAPI 与 TS 类型比对 | 夹具来自真实调用，靠夜间 live smoke 更新 |
| 假 LLM 服务 | `tests/fakes/llm_server.py`：模拟 OpenAI 兼容的 SSE，按脚本回复，可注入 429、中途断流、标签损坏、慢首 token、`content_filter` | 集成与端到端共用 |
| 端到端 | docker compose 加假 LLM：创建剧本、开场、多回合、压缩、回退、重新生成、SSE 断线续传 | 续传用例：中途断开再带 `Last-Event-ID`，拼接结果等于最终叙述 |
| 客户端 | `node --test`：`SseClient` 的帧解析、UTF-8 切分、重连与续传（纯 TypeScript，不依赖 RN）；M1 起加 Jest + RNTL：状态机 reducer、选项条与流式段落；Maestro：从登录走完一个回合 |  |
| 夜间 live smoke | 可选，用维护者的密钥对两家厂商各跑一个回合 | 发现厂商 API 漂移，不进 PR 门禁 |
| 性能 | k6 或 locust：100 个并发 playthrough 对假 LLM，观察队列延迟与数据库竞争 | M4 |

测试原则借鉴 hermes-agent 的 `AGENTS.md`（其中有 “Don’t write change-detector tests”“Never read source code in tests” 两条）：测行为，不测实现文本；测试不读取源码文件内容。
文档同步测试读的是 `docs/` 下的文档，对照的是运行时的 OpenAPI 和真实数据库里的表结构，不读源码。

### 评估（`evals/`）

质量不能只靠单测，要用回放评估量化：

- `evals/director_compliance.py`（M0）：在真实模型上连续跑 200 回合，统计导演协议无需修复与含修复的合规率、首 token 延迟和缓存命中，给出 go / no-go。
- `evals/replay.py`：回放一批剧情脚本（合成数据，或用户明确授权的匿名数据，放在 `datasets/`），在指定的模型组合下跑完整管线，输出：协议合规率与各级修复比例；两个选项之间的词面重叠率（衡量区分度）；StateKeeper 对照人工标注补丁的精确率与召回率；一致性探针（从状态表出若干事实问题，检查后续叙述是否与之矛盾，可选用 LLM 评审）；压缩保真度（对被折叠的回合出若干问答，只用“摘要加状态表”回答，统计正确率）；用量与延迟。
- `evals/gate_eval.py`：对比 RuleGate 与 SmallLlmGate 的判定与人工标注，给出 `beat_done`、`deviation` 两个问题的精确率与召回率，用来定默认的置信度阈值；以后接入 Jev 时用同一套数据评估。
- 提示词变更的门禁：模板头部有 `version`；PR 改了模板，CI 用假模型跑格式冒烟，维护者在本地用真模型跑 `replay`，把结果贴进 `docs/prompts/`。
- 数据来源：不提交真实用户的故事；数据集只用合成数据或明确授权的数据。

预算比例、阈值、采样参数这些初始值，都以 `replay` 的结果为准调整，不凭感觉改。

## 2 各里程碑的测试出口

- M0：RN 真机 SSE 验收（见 [client.md 第 1 节](client.md)的“M0 探针的验收标准”）；导演协议在 200 回合里无需修复的合规率不低于 95%，含修复不低于 99.5%。
- M1：DeepSeek 与 Hugging Face 各完整玩 30 回合；断网续传用例通过。
- M2：属性测试通过；100 回合回放的一致性探针达标；回退后状态与快照一致。
- M3：300 回合回放的压缩保真度达标，anti-thrash 不触发，没有触发过 95% 紧急截断；`gate_eval` 出结果。
- M4：外部安全审查无高危；100 并发压测达标；自托管文档按步骤能跑通。

完整里程碑见 [README.md 第 3 节](README.md)。

## 3 M1 已有的测试

后端（`apps/server/tests`）：

| 文件 | 内容 |
| --- | --- |
| `unit/infra/test_crypto.py` | 主密钥（第一个加密、其余只解密）、信封加密绑定所在的行与字段、开发环境密钥只生成一次、生产环境必须显式配置、Argon2id 与重新哈希、访问令牌、刷新令牌只存哈希 |
| `unit/importers/test_character_card.py` | PNG 的 tEXt 与压缩文本块、V3 优先于 V2、压缩炸弹、无效输入、V1 / V3 的 JSON、宏替换 |
| `unit/domain/test_seed_and_plan.py` | Seed 规范化（名字与引用）、世界规划、最小 Seed、名字规范化、行动解析 |
| `unit/runtime/test_context.py` | 状态块排版与秘密分区、预算降级、消息摆放、确定性、玩家文字跳不出围栏、紧急截断 |
| `unit/runtime/test_structured.py` | 结构化输出阶梯：校验失败带错误重试一次、不支持的级别跳过并缓存、降两级后放弃、传输错误上抛 |
| `unit/runtime/test_runner.py` | 事件顺序与提交、选项修复与默认选项、首 token 前出错切 fallback、半截失败保留叙述、鉴权错误不重试、没有叙述、没有路由、提交被围栏拒绝、屏障超时、租约丢失时取消生成、开局构建、关闭时取消 |
| `unit/api/test_body_limit.py`、`unit/api/test_probe_api.py` | 请求体大小限制；探针接口读不到真实回合的事件流 |
| `unit/api/test_api_doc.py` | [docs/api/](api/README.md) 与 OpenAPI 一致（目录里的文件合在一起检查，每个接口和模型只能写一次）：接口齐全、鉴权与成功状态码、查询参数与请求头、每个请求和响应模型的字段与必填项 |
| `integration/test_data_model_doc.py` | [docs/data-model/](data-model/README.md) 与迁移建出的表一致（同上）：表、列名、类型、可空、索引名 |
| `integration/test_accounts.py` | 注册登录、刷新令牌轮换、宽限期与盗用检测、退出吊销整族、删除账户 |
| `integration/test_turns.py` | 同一个幂等键并发提交只建一个回合、生成中再提交得到 `TURN_IN_PROGRESS`、租约过期清理后迟到的结果作废、跨用户 404、过期父回合与选项校验 |
| `e2e/test_m1_flow.py` | uvicorn 里的真实 api 加假模型服务：注册 → 凭据 → 路由 → 导入 → 开局 → 多回合（幂等重放、并发提交、过期父回合）→ 中途断开再续传，拼接结果等于最终叙述；鉴权与隔离；窗口校验 |

`integration` 与 `e2e/test_m1_flow.py` 需要 `BT_TEST_DATABASE_URL`（`make test-integration`），没有设置时跳过。

客户端（`apps/mobile`，`npm test`）：`sseParser`、`sseClient`（重连、退避、续传、转轮询、401）、`turnMachine`、`playSession`（加载、幂等重试、
`TURN_IN_PROGRESS` / `STALE_PARENT`、续传、轮询、失效登录）、`turnStream`（半截终止事件后的恢复）、`session`（单飞刷新）、`client`（401 重试、problem+json）。
界面还没有自动化测试。

**M1 的出口验收**（需要真机和真实的 Key，自动化测试覆盖不了）：DeepSeek 与 Hugging Face 各完整玩 30 回合；
游玩中途切到飞行模式再切回来，叙述接着出、不重复不缺字；生成中杀掉 App 再打开，能接上或看到可重试的失败。
