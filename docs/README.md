# BetterTavern 技术方案

> 文档索引：[总览](README.md) · [后端](backend.md) · [客户端](client.md) · [测试](testing.md) · [数据模型](data-model/README.md) · [接口](api/README.md)

BetterTavern 是一个服务端生成式互动小说应用：Python 后端运行 agent runtime，React Native 客户端负责阅读和操作。
本目录有四份按读者拆分的设计文档，以及数据模型、接口两个参考文档目录。设计文档写的是完整的方案，参考文档写的是代码里已经实现的样子。本页是总览、仓库结构和里程碑。

| 文档 | 内容 |
| --- | --- |
| [backend.md](backend.md) | 架构与选型、数据模型、世界状态、上下文与压缩、每轮管线、agent、回退、provider 层、API、后端目录、安全 |
| [client.md](client.md) | React Native 技术栈、SSE 客户端、回合状态机、页面、客户端目录 |
| [testing.md](testing.md) | 可观测性、测试分层、回放评估 |
| [agent-runtime.md](agent-runtime.md) | agent runtime：几个 agent 的分工与工具、一回合怎么走、上下文怎么拼、长期记忆分层、写入与回退、分阶段计划；取代 backend.md 里后台管线、屏障、压缩、门控和回退的旧设计 |
| [i18n.md](i18n.md) | 多语言：界面文字的资源与写法、语言设置、错误按错误码翻译、按这一局的语言选提示词 |
| [development.md](development.md) | 开发者指南：当前进度、本地开发、测试、评测、仓库目录 |
| [bugs/](bugs/README.md) | 问题记录：修过的重要 bug，每份写清现象、原因、影响范围、修复、验证和遗留 |
| [data-model/](data-model/README.md) | 参考：数据库里实际存在的每张表（列、类型、约束、索引）、JSON 列的结构、状态机、并发控制、删除与清理。按领域分文件：账户、模型路由、剧本库、游玩与回合、世界状态、运行基础设施 |
| [api/](api/README.md) | 参考：已实现的每个接口（请求、响应、状态码、错误码）、SSE 事件与续传、限流与请求体大小。按领域分文件：认证与账户、模型路由、剧本库、游玩与回合、事件流、运维 |

改表结构或接口时，在同一个改动里更新这两个目录里对应领域的文件；有测试检查它们和代码是否一致（[testing.md 第 3 节](testing.md)）。

## 1 概述

v1 交付一个服务端 agent runtime 加一个 React Native 客户端：玩家以第一人称推进剧情，每轮点选两个选项之一（或自由输入），世界状态由后台 agent 自动维护。

### 目标

- 第一人称互动小说：导演每轮回复后立即给出 2 个选项，同时保留自由输入框，尽量减少打字。
- 长篇一致性：结构化世界状态、渐进式披露、分层摘要、长程大纲配合，而不是把所有设定拼成一个大 prompt（[agent-runtime.md](agent-runtime.md)）。
- 用户自带 API Key 并自选端点；适配 DeepSeek、OpenAI、Grok（xAI）、Gemini、Hugging Face 和玩家自定义的 OpenAI 兼容端点（都走 OpenAI 兼容接口），厂商适配按“配置加通用适配器”设计，以后可以接入大量厂商。
- 支持回退与重新生成。
- 代码开源，服务端可自托管，一条 `docker compose up` 起全套。

### 非目标（v1 不做）

- 世界书模块：关键词触发、递归激活、ST 世界书的导入转换均延后。
- 向量检索、知识图谱数据库、分支树界面。
- 多人、RPG 规则引擎、云同步、内容社区。
- 更多厂商的专门适配（如 Anthropic）、Jev 等专门的判断模型、费用估算与用量上限。

### 已确认的设计决策

1. 服务端 runtime，Python + FastAPI，agent 的执行循环自己写，不用 LangGraph（LangChain 仅按需）；客户端 React Native。
2. 玩家消息到达后，同步工作的只有导演 agent；它的回复立即返回客户端，其余 agent 随后整理状态。
3. 每局的回合串行；下一回合不等上一回合的世界状态整理，状态块标明截至第几回合，之后回合的原文在上下文里（[agent-runtime.md](agent-runtime.md) 第 3 节）。
4. 导演上下文 = 摘要 + 不在导演上下文中的实体状态（物品、人物、地点、机构、世界）+ 本轮玩家行为与导演回复。
5. 长程大纲：世界状态 agent 每回合回答“大纲要不要改”，要改时由导演的模型修订（[agent-runtime.md](agent-runtime.md) 第 4 节）。
6. 记忆在场景、章节的分界处整理成场景摘要、章节摘要和全书梗概；场景和章节是否结束由模型判断，不按回合数。原来“占到 80% 才压缩”的做法去掉，95% 紧急截断保留。不接入 Jev（[agent-runtime.md](agent-runtime.md) 第 6、7 节）。
7. 摘要放回上下文时必须带说明：这是回顾，不是当前任务，只回应玩家最新一次行动。
8. 允许回退到当前故事线上任意一回合和重新生成，没有回退下限：整理出来的记忆都记下来源回合，回退时作废来源在目标回合之后的部分，玩家画像不回退（[agent-runtime.md](agent-runtime.md) 第 8 节）。
9. ST 世界书导入后全部转成世界状态的一部分；v1 不做世界书模块。
10. Provider 层只参考 SillyTavern 适配各家模型接口的思路，代码自行编写，不移植；v1 适配 DeepSeek、Hugging Face 和自定义 OpenAI 兼容端点，并按“厂商配置加通用适配器”设计，以后可以适配大量厂商。
11. 每轮回复后给 2 个选项，同时保留自由输入。
12. 工作窗口上限默认 128K，玩家可以自己调；runtime 检查玩家设置的窗口当前模型能否满足（[backend.md 第 4 节](backend.md)）。
13. 提示词按语言分目录，现在有中文、英文、日文三套，一局用哪套由开局时的界面语言决定（[i18n.md](i18n.md) 第 4 节）。
14. v1 不考虑成本控制：不做价格表、费用估算和用量上限；token 用量仍然记录，用于排错和校准估算。

### 其余假设（没有异议就按此实现）

| # | 假设 | 影响 |
| --- | --- | --- |
| A2 | 在场或被本轮提及的实体，一律以状态表为准注入，即使近期原文写过；只有休眠实体按“不在上下文中”处理。 | [backend.md 第 3 节](backend.md)、[backend.md 第 4 节](backend.md)；原文里的状态描述可能已过期 |
| A3 | 发给模型之前的装配结果超过有效窗口的 95% 时，只截断发给模型的视图，不删数据；正常情况下各块由后台整理控制在预算以内。 | [backend.md 第 4 节](backend.md)；防止后台整理跟不上时请求超窗 |
| A4 | 导演输出用带分隔标签的纯文本，分析类 agent 用结构化输出。 | [backend.md 第 6 节](backend.md)、[backend.md 第 8 节](backend.md) |
| A5 | 屏障已取消：下一回合不等世界状态整理，状态块标明截至第几回合；晚到的写入靠时间线编号和 `state_seq` 校验。 | [agent-runtime.md](agent-runtime.md) 第 3、8 节 |
| A6 | PostgreSQL 为唯一事实来源；v1 任务队列用 Postgres 表，Redis 可选。 | [backend.md 第 1 节](backend.md)、[backend.md 第 2 节](backend.md) |

## 2 仓库结构

仓库是一个 monorepo：后端、客户端、接口契约、部署和文档放在一起，契约变更在同一个 PR 里同时改两端。Python 包名为 `bettertavern`。

```
BetterTavern/                           # Python 包名 bettertavern
├── README.md
├── LICENSE                             # 开源协议待定（不受 ST 的 AGPL 约束）
├── CONTRIBUTING.md
├── AGENTS.md                           # 给编码 agent 与贡献者的仓库约定（参考 hermes-agent）
├── Makefile                            # make dev / test / lint / gen-api / eval
├── .env.example
├── .github/
│   └── workflows/
│       ├── server.yml                  # ruff、pyright、import-linter、pytest（带 Postgres 服务）
│       ├── mobile.yml                  # tsc、eslint、jest
│       ├── contract.yml                # 重新生成 OpenAPI 与 TS 类型并比对
│       └── release.yml                 # 镜像构建与 EAS 发布
├── package.json                        # npm 工作区：apps/mobile、apps/web、packages/*
├── apps/
│   ├── server/                         # Python 后端，见下
│   ├── mobile/                         # React Native 客户端，见下
│   ├── web/                            # 电脑浏览器里的网页端（Vite + React，DOM 和 CSS），见 client.md 第 4 节
│   └── vis/                            # 开发用的日志查看器
├── packages/
│   ├── core/                           # 手机端和网页端共用的纯逻辑：接口客户端、SSE、会话、回合状态机
│   ├── design/                         # 共用的设计数据：色板、主题、尺寸、布局函数、图标、封面、标志
│   └── api-contract/                   # （计划中）
│       ├── openapi.json                # 由 FastAPI 导出并提交
│       ├── events.schema.json          # SSE 事件的 JSON Schema
│       └── scripts/generate.sh         # 生成 TS 类型与请求函数
├── deploy/
│   ├── docker-compose.yml              # api、worker、postgres、一次性的 migrate；redis 为可选 profile
│   ├── docker-compose.dev.yml
│   ├── Dockerfile.server
│   ├── nginx.example.conf              # 反向代理示例（网页和接口同源，SSE 关闭缓冲）
│   └── k8s/                            # 可选
├── docs/
│   ├── architecture/                   # 本文档的版本化副本与图
│   ├── adr/                            # 架构决策记录，每个重大取舍一篇
│   ├── prompts/                        # 提示词设计说明与评测记录
│   └── self-hosting.md
└── scripts/
    ├── dev_seed.py                     # 本地开发用的示例剧本
    └── export_openapi.py
```

## 3 里程碑、风险与待确认问题

先用 M0 的几个探针把最不确定的三件事验掉：RN 上的 SSE、两家厂商的协议差异、导演输出协议的遵守率；再按“热路径 → 世界状态与回退 → 压缩与大纲 → 加固”的顺序推进。每个里程碑都有可检查的出口标准。人力按 1 到 2 名工程师估算，数字是粗估，M0 之后修订。

M0 的出口标准决定是否进入 M1；可观测性与测试不等到最后，从 M1 起就和功能一起推进。

### 里程碑

| 里程碑 | 范围 | 出口标准（提议） | 粗估 |
| --- | --- | --- | --- |
| M0 探针 | RN 真机 SSE；provider 层对 DeepSeek 与 Hugging Face 跑通（流式、usage、错误分类）；导演协议在至少 3 个模型上的合规率；Postgres 车道队列原型 | RN 验收标准见[client.md 第 1 节](client.md)；200 回合里无需修复的合规率不低于 95%，含修复不低于 99.5%；给出 go / no-go | 1 到 2 周 |
| M1 热路径 | 注册登录、凭据与探测、角色卡导入、WorldBuilder（最小 Seed）、回合流式与选项、幂等与租约、SSE 续传、RN 阅读主屏 | 两家厂商各完整玩 30 回合；断网续传用例通过 | 3 到 4 周（代码已完成，待真机验收；实现与设计的差异见 [backend.md 第 12 节](backend.md)、[client.md 第 3 节](client.md)） |
| M2 runtime、世界状态与回退 | [agent-runtime.md](agent-runtime.md) 阶段 1、2：执行循环与工具、删除“重要程度”、世界状态 agent、后台模型设置、回退到任意回合、世界浏览与时间线界面 | 见 [agent-runtime.md](agent-runtime.md) 第 10 节；100 回合回放的一致性检查和回退一致性测试通过 | 3 到 4 周 |
| M3 召回、记忆、大纲 | [agent-runtime.md](agent-runtime.md) 阶段 3 到 5：召回工具与导演隐藏备注、线索与伏笔、分层摘要与玩家画像、大纲修订、长剧本评测 | 300 回合回放：上下文长度稳定、长程问题的正确率达标；偏离剧本的评测出结果 | 3 到 4 周 |
| M4 加固与发布 | 安全审查、SSRF 测试、限流、可观测性、部署文档、性能测试、商店合规清单、内测 | 外部安全审查无高危；100 并发压测达标；自托管文档按步骤能跑通 | 2 到 3 周 |
| 之后 | 更多厂商的专门适配（例如 Anthropic）、按意思检索（pgvector）、世界书导入器、RPG 模式、分支树界面、“纠正世界状态”界面 |  |  |

合计约 12 到 17 周。

### 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 导演协议合规率低，尤其是 Hugging Face 上的小众后端 | 选项缺失、叙述被截断 | 修复阶梯；探测加能力降级；M0 用合规率做 go / no-go；评测按模型出报告 |
| 世界状态 agent 写错，错误会被后续回合当成事实 | 剧情自相矛盾 | 写入前一次性检查一致性；铅笔与钢笔；修改记录可回退；后续提供“纠正世界状态”界面，让玩家直接改实体 |
| 摘要漂移或丢信息 | 长篇后期矛盾 | 固定模板与迭代更新；状态表兜底；保真度评测；原文永久保留，可以重新折叠 |
| Hugging Face 路由后端差异大 | 同一个模型名的行为随时间变化 | 建议固定 provider 后缀；探测加运行时降级；文档提示 |
| 窗口设置与模型不匹配 | 压缩过早或过晚，或请求超出模型窗口 | 保存路由和每次调用前都校验（[backend.md 第 4 节](backend.md)）；95% 紧急线兜底 |
| 许可证 | 误把 ST 的代码照搬进仓库，就必须按 AGPL 发布 | 只参考思路、自行实现，评审时检查；复用 hermes-agent（MIT）的代码要保留版权声明 |
| 应用商店合规 | 上架被拒 | 举报入口、年龄分级、内容过滤钩子；上架前逐条核对商店规则 |
| 下一回合不等后台整理 | 状态块过时 | 状态块标明截至第几回合；没整理的回合一定以原文出现在上下文里；推 `pipeline.degraded` 提示 |
| Postgres 队列在高并发下的锁竞争 | 任务延迟 | `JobQueue` 接口可换 Taskiq 或 Redis；M4 压测 |

### 待确认的问题

其余问题的结论已写进第 1 节的“已确认的设计决策”，下面两项还没定。

1. **谁来运行服务器？** 两种做法：一是“公开服务”，由我们（或你）部署一份，所有玩家都连这一份，玩家只需要装 App、填自己的 API Key；二是“各自部署”，每个玩家（或一个小圈子）用 `docker compose up` 自己跑一份，故事数据都在自己手里。本文默认两种都支持。区别只影响两件事：自定义的模型地址能不能指向内网（公开服务必须禁止；各自部署的人可以自己打开，比如接本机的 Ollama），以及上架应用商店时要不要做内容过滤和举报入口。你想先做哪一种？
2. **开源协议选哪个？** 既然只参考 ST 的思路、不移植它的代码，就不受 AGPL 约束。常见选择是 MIT（最宽松）或 Apache-2.0（多一条专利授权）。不急，发布前定即可。
