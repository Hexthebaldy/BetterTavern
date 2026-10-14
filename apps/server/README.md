# BetterTavern 服务端

Python 3.12+，FastAPI + PostgreSQL；LangGraph 在 M2 随后台管线接入。设计见 [docs/backend.md](../../docs/backend.md)。

## 常用命令（在 apps/server 下）

```bash
uv sync                                   # 安装依赖（含开发依赖）
uv run bettertavern migrate               # 数据库迁移
uv run bettertavern serve --reload        # api 进程
uv run bettertavern worker                # worker 进程
uv run pytest                             # 测试；设置 BT_TEST_DATABASE_URL 后会跑 Postgres 集成测试
uv run ruff check . && uv run pyright && uv run lint-imports --config importlinter.ini
```

## 目录（M1 已有的部分）

```
src/bettertavern/
├── providers/          模型服务适配：统一接口、OpenAI 兼容适配器、DeepSeek / HF / 自定义端点 profile、
│                       能力表与探测、SSE 解析、错误分类与重试、SSRF 防护、并发限流
├── runtime/
│   ├── runner.py       TurnRunner：热路径（开局构建 → 装配上下文 → 导演流式生成 → 修复 → 提交）
│   ├── agents/         director、world_builder、options_repair
│   ├── context/        上下文装配、状态块、token 估算、围栏
│   ├── protocol/       导演输出协议的增量解析与修复阶梯、结构化输出阶梯、JSON 提取
│   ├── events/         事件缓冲：生成与连接解耦、Last-Event-ID 续传
│   ├── ports.py        runtime 读写数据的接口（由 services 实现）
│   └── prompts/zh/     提示词模板
├── domain/             纯逻辑：回合与行动、角色卡模型、世界 Seed 与规划、名字规范化、路由参数、阈值线
├── importers/          角色卡导入（PNG 文本块、V1/V2/V3 规范化）；世界书导入是占位
├── services/           用例层：账户、凭据、模型路由、剧本、游玩、回合（幂等与租约）、租约清理、SSE 探针
├── api/                HTTP 层：/v1 路由、请求与响应模型、problem+json、限流、请求体大小限制、SSE
├── infra/              数据库（SQL 仓储）、加密（信封加密、Argon2id、令牌）、队列、worker 主循环
└── entrypoints/        create_app()、worker、命令行（serve / worker / migrate / keygen）
evals/                  导演协议合规率评测
tests/                  单元、端到端（假模型）、集成（真实 Postgres）
migrations/             Alembic 迁移（手写 SQL）
```

M1 相对设计文档的简化见 [docs/backend.md 第 12 节](../../docs/backend.md)。
