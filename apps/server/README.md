# BetterTavern 服务端

Python 3.12+，FastAPI + PostgreSQL 16。agent 的执行循环自己写，不用 LangGraph。

- 设计：[docs/backend.md](../../docs/backend.md)（总体），[docs/agent-runtime.md](../../docs/agent-runtime.md)（几个 agent、上下文、记忆、回退），先看[架构图解](../../docs/agent-runtime-architecture.md)最快；
- 实际的表结构和接口：[docs/data-model/](../../docs/data-model/README.md)、[docs/api/](../../docs/api/README.md)；
- 本地开发、测试、评测：[docs/development.md](../../docs/development.md)；写代码前先读仓库根目录的 [AGENTS.md](../../AGENTS.md)。

## 常用命令（在 apps/server 下）

```bash
uv sync                                   # 安装依赖（含开发依赖）
uv run bettertavern migrate               # 数据库迁移
uv run bettertavern serve --reload        # api 进程
uv run bettertavern worker                # worker 进程：后台整理世界状态、章节、大纲
uv run bettertavern keygen                # 生成生产环境的 MASTER_KEYS 和 AUTH_SECRET
uv run bettertavern vis                   # 本机日志查看器的接口（网页先在仓库根目录 make vis-install）
uv run pytest                             # 测试；设置 BT_TEST_DATABASE_URL 后会跑 Postgres 集成测试
uv run ruff check . && uv run pyright && uv run lint-imports --config importlinter.ini
```

仓库根目录的 `make dev`、`make worker`、`make test`、`make test-integration`、`make lint` 是同样的命令。

## 两个进程

- **api**：HTTP 接口和热路径。玩家提交行动后，回合执行器（`runtime/runner.py`）在进程里让导演流式生成，叙述经 SSE 推给客户端；回合存好后放一个世界状态整理任务。
- **worker**：从 Postgres 任务表领任务。每局两条队列：`state`（世界状态 agent 整理一回合）和 `memory`（章节整理、大纲修订）。队列内按顺序，队列之间并行。

## 目录

```
src/bettertavern/
├── entrypoints/   组装根：create_app()、worker、命令行
├── api/           HTTP 层：/v1 路由、请求与响应模型、problem+json、限流、请求体大小限制、SSE、网页的 Cookie 登录
├── services/      用例层：账户、模型路由、剧本、游玩与回退、回合（幂等与租约）；*_store 实现 runtime 的接口，*_jobs 放后台任务
├── runtime/       agent runtime：执行循环、六个 agent、上下文装配、导演协议解析、结构化输出、提示词（zh / en / ja）、
│                  热路径的回合执行器，后台的世界状态、章节、大纲三个 runner
├── domain/        纯逻辑：回合与行动、角色卡、开局设定、世界状态的修改清单与一致性规则、线索、切章、大纲修正
├── providers/     模型服务适配：统一接口、OpenAI 兼容适配器、各家 profile、能力表与探测、错误分类、SSRF 防护、并发限流
├── importers/     角色卡导入（PNG 文本块、V1 / V2 / V3）；世界书导入是占位
├── infra/         数据库（手写 SQL 的仓储）、任务队列、加密（信封加密、Argon2id、令牌）、日志
└── vis/           本机日志查看器的接口（只读）
evals/             导演协议合规率评测、剧本试玩
tests/             单元、端到端（假模型服务）、集成（真实 Postgres）
migrations/        Alembic 迁移（手写 SQL）
```

每个文件的位置见 [docs/backend.md 第 10 节](../../docs/backend.md)；依赖方向由 `importlinter.ini` 检查（`api` → `services` → `runtime` → `domain`）。
和设计文档相比的简化见 [docs/backend.md 第 12 节](../../docs/backend.md)。
