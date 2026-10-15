# 开发者指南

> 文档索引：[总览](README.md) · [后端](backend.md) · [客户端](client.md) · [测试](testing.md) · [数据模型](data-model/README.md) · [接口](api/README.md)

这一页写给想在本机跑起来、改代码、跑测试的人：当前实现到哪一步、本地开发、测试、评测、仓库目录。
想先了解这个项目是什么，看仓库根目录的 [README](../README.md)；完整的技术方案见 [总览](README.md)。

## 当前进度：M1 热路径

M1 把“导入一张角色卡、一轮一轮玩下去”这条主线打通了：

- 账户：注册、登录、刷新令牌轮换（检测盗用）、退出、删除账户。
- 模型：添加 DeepSeek、Hugging Face 或任意 OpenAI 兼容端点的模型（Key 在服务端加密保存），添加时自动拉取模型列表，确定上下文窗口；在模型列表里设为导演。
- 剧本：导入 SillyTavern 角色卡（V1、V2、V3，PNG 或 JSON）。
- 游玩：开局时 WorldBuilder 根据角色卡生成最小的世界设定，导演写开场；之后每轮流式输出叙述和两个选项，也可以自由输入。
  提交带幂等键，同一局同一时刻只有一轮在生成（租约），断线后用 `Last-Event-ID` 续传，缓冲过期时一次补全。
- 客户端：登录注册、剧本库与导入、故事列表、阅读主屏（流式文字、两个选项、自由输入、停止、重试）、世界状态面板、阅读设置、
  模型设置、外观（跟随系统 / 浅色 / 夜间）、平板布局、诊断日志。

M1 的出口标准是 DeepSeek 与 Hugging Face 各完整玩 30 回合、断网续传用例通过，需要在真机上用真实的 Key 验收。
和设计文档相比的简化（热路径暂不用 LangGraph、回合直接提交、还没有 StateKeeper 等）见
[backend.md 第 12 节](backend.md)和 [client.md 第 3 节](client.md)。

M0 的探针仍然保留：SSE 探针在 App 的“设置 → 连接测试”里，导演协议合规率评测见下文。

## 本地开发

需要：Python 3.12+ 和 [uv](https://docs.astral.sh/uv/)、Docker（跑 Postgres）、Node 22.18+。
没有 Docker 时，用本机的 PostgreSQL 16 也行：建好 `bettertavern` 角色和同名数据库，`apps/server/.env` 里的 `DATABASE_URL` 指过去，跳过 `make db-up`。

先复制两份配置，把 `apps/mobile/.env` 里的地址改成电脑的局域网 IP：

```bash
cp apps/server/.env.example apps/server/.env
cp apps/mobile/.env.example apps/mobile/.env
```

然后在仓库根目录依次执行：

| 命令 | 作用 |
| --- | --- |
| `make db-up` | 用 docker compose 起一个 Postgres |
| `make install` | `uv sync`，装后端依赖 |
| `make migrate` | 建表；拉了新代码以后也要跑一次 |
| `make dev` | 启动 api，接口文档在 http://localhost:8000/docs |
| `make worker` | 另开一个终端，启动 worker（M1 的热路径不需要它） |
| `make mobile-install` | 装客户端依赖；之后在 `apps/mobile` 下 `npm start`，用 Expo Go 打开 |

开发环境不配置密钥也能启动：服务端第一次启动时生成主密钥和令牌签名密钥，存在 `apps/server/.data/dev-secrets.json`
（权限 0600，已在 .gitignore 里）。生产环境必须在环境变量里配置 `MASTER_KEYS` 和 `AUTH_SECRET`，用
`uv run bettertavern keygen` 生成；主密钥丢了，已保存的模型 Key 就解不开了。

然后在 App 里：注册 → 设置 → 模型 → 添加模型（填 Key、选模型、设为导演）→ 剧本里导入角色卡 → 开始故事。
手机连不上服务器时的排查，以及在真机上运行的细节，见 [apps/mobile/README.md](../apps/mobile/README.md)。

排查问题时用日志查看器：`make vis-install` 装一次依赖，之后 `make vis`，打开 http://127.0.0.1:8100 。
它把 `apps/server/.data/logs/` 下的日志和数据库里的回合画成时间线，用法见 [testing.md 第 1 节](testing.md)。

后端的直接依赖在 `apps/server/pyproject.toml` 里精确锁定，与 `uv.lock` 一致；升级依赖时先改 pyproject，再执行 `uv lock` 并提交锁文件。

## 测试

| 命令 | 内容 |
| --- | --- |
| `make test` | 后端单测与端到端测试（不需要数据库） |
| `make test-integration` | 需要数据库；会建临时 schema，测完删除（队列、账户、回合的并发与租约） |
| `make lint` | ruff、pyright、import-linter |
| `make mobile-test` | 客户端的纯逻辑：SSE 解析与重连、回合状态机、会话与令牌刷新、接口客户端 |
| `make vis-test` | 日志查看器的纯逻辑：中文目录、格式化、手机日志解析 |

## 合规率评测（M0 的 go / no-go）

在真实模型上跑 200 回合，统计导演输出协议的合规率。出口标准：无需修复不低于 95%，含修复不低于 99.5%。

```bash
cd apps/server
DEEPSEEK_API_KEY=sk-... uv run python -m evals.director_compliance --provider deepseek --model deepseek-flash
HF_TOKEN=hf_... uv run python -m evals.director_compliance --provider huggingface --model <org/model>:fastest
```

报告写在 `apps/server/evals/reports/`（不入库）。至少用 3 个模型各跑一次。

## 目录

| 路径 | 内容 |
| --- | --- |
| `apps/server` | 后端：FastAPI、agent runtime、provider 层、队列、迁移、测试、评测 |
| `apps/mobile` | 客户端：Expo + TypeScript |
| `apps/vis` | 本机日志查看器的网页（接口在 `apps/server` 的 `bettertavern vis`） |
| `deploy` | docker compose 与镜像 |
| `docs` | 设计文档，数据模型和接口的参考文档，界面与标志的设计稿 |
