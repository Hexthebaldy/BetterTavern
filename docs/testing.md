# BetterTavern 测试技术方案

> 文档索引：[总览](README.md) · [后端](backend.md) · [客户端](client.md) · [测试](testing.md)

## 1 可观测性、测试与评估

这类系统的故障多半不是崩溃，而是“悄悄变差”：协议遵守率下降、状态写错、摘要丢信息、延迟上升。所以可观测性和评估与功能同等重要，从 M1 就接入。

### 日志与追踪

- 日志用 structlog 输出 JSON，每条带 `request_id`、`user_id`（哈希）、`playthrough_id`、`turn_id`、`agent`、`route`、`error_class`；不含故事文本和密钥（[backend.md 第 11 节](backend.md)）。
- 追踪用 OpenTelemetry。一个回合是一条 trace：根 span `turn`，子 span 有 `barrier_wait`、`assemble_context`、`provider.stream`（属性：model、ttft\_ms、各类 token 数、缓存命中比例）、`commit`。后台任务通过 `jobs.payload.traceparent` 接上同一条 trace，子 span 是 `state_keeper`、`gate.*`、`compactor`、`outline_reviser`。span 属性里不放文本。

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
| `integration/test_accounts.py` | 注册登录、刷新令牌轮换、宽限期与盗用检测、退出吊销整族、删除账户 |
| `integration/test_turns.py` | 同一个幂等键并发提交只建一个回合、生成中再提交得到 `TURN_IN_PROGRESS`、租约过期清理后迟到的结果作废、跨用户 404、过期父回合与选项校验 |
| `e2e/test_m1_flow.py` | uvicorn 里的真实 api 加假模型服务：注册 → 凭据 → 路由 → 导入 → 开局 → 多回合（幂等重放、并发提交、过期父回合）→ 中途断开再续传，拼接结果等于最终叙述；鉴权与隔离；窗口校验 |

`integration` 与 `e2e/test_m1_flow.py` 需要 `BT_TEST_DATABASE_URL`（`make test-integration`），没有设置时跳过。

客户端（`apps/mobile`，`npm test`）：`sseParser`、`sseClient`（重连、退避、续传、转轮询、401）、`turnMachine`、`playSession`（加载、幂等重试、
`TURN_IN_PROGRESS` / `STALE_PARENT`、续传、轮询、失效登录）、`turnStream`（半截终止事件后的恢复）、`session`（单飞刷新）、`client`（401 重试、problem+json）。
界面还没有自动化测试。

**M1 的出口验收**（需要真机和真实的 Key，自动化测试覆盖不了）：DeepSeek 与 Hugging Face 各完整玩 30 回合；
游玩中途切到飞行模式再切回来，叙述接着出、不重复不缺字；生成中杀掉 App 再打开，能接上或看到可重试的失败。
