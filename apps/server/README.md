# BetterTavern 服务端

Python 3.12+，FastAPI + LangGraph（M1 起接入）+ PostgreSQL。设计见 [docs/backend.md](../../docs/backend.md)。

## 常用命令（在 apps/server 下）

```bash
uv sync                                   # 安装依赖（含开发依赖）
uv run bettertavern migrate               # 数据库迁移
uv run bettertavern serve --reload        # api 进程
uv run bettertavern worker                # worker 进程
uv run pytest                             # 测试；设置 BT_TEST_DATABASE_URL 后会跑 Postgres 集成测试
uv run ruff check . && uv run pyright && uv run lint-imports --config importlinter.ini
```

## 目录（M0 已有的部分）

```
src/bettertavern/
├── providers/          模型服务适配：统一接口、OpenAI 兼容适配器、DeepSeek / HF / 自定义端点 profile、
│                       能力表与探测、SSE 解析、错误分类与重试、SSRF 防护、并发限流
├── runtime/
│   ├── protocol/       导演输出协议的增量解析器与修复阶梯
│   ├── agents/         options_repair（选项不足时补齐）
│   ├── context/        围栏（sanitize_for_fence）
│   ├── events/         事件缓冲：生成与连接解耦、Last-Event-ID 续传
│   └── prompts/zh/     提示词模板
├── domain/             选项规范、有效窗口与阈值线
├── services/           M0 SSE 探针
├── api/                SSE 响应、problem+json、探针接口、健康检查
├── infra/              数据库引擎、Postgres 车道任务队列、LISTEN/NOTIFY、worker 主循环
└── entrypoints/        create_app()、worker、命令行
evals/                  M0 导演协议合规率评测
tests/                  单元、端到端（假 LLM 服务）、集成（真实 Postgres）
migrations/             Alembic 迁移（手写 SQL）
```
