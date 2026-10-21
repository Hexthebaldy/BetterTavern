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
和设计文档相比的简化见 [backend.md 第 12 节](backend.md)和 [client.md 第 3 节](client.md)。

M1 之后在做 agent runtime 的升级（[agent-runtime.md](agent-runtime.md)）：阶段 1（执行循环、工具、每一步的记录）、
阶段 2 的世界状态 agent 和回退已经完成，100 回合剧本试玩的脚本写好了，正在按试玩结果优化；阶段 3 到 5 还没开始。
各阶段的进度和待办见 [agent-runtime.md 第 13 节](agent-runtime.md)。

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
| `make worker` | 另开一个终端，启动 worker：后台整理世界状态（[agent-runtime.md](agent-runtime.md) 第 4 节）。不开也能玩，只是世界状态停在开局，回合一直是 `replied` |
| `make mobile-install` | 装客户端依赖（在根目录 `npm install`，手机端和 `packages/` 是同一个 npm 工作区）；之后在 `apps/mobile` 下 `npm start`，用 Expo Go 打开 |

开发环境不配置密钥也能启动：服务端第一次启动时生成主密钥和令牌签名密钥，存在 `apps/server/.data/dev-secrets.json`
（权限 0600，已在 .gitignore 里）。生产环境必须在环境变量里配置 `MASTER_KEYS` 和 `AUTH_SECRET`，用
`uv run bettertavern keygen` 生成；主密钥丢了，已保存的模型 Key 就解不开了。

然后在 App 里：注册 → 设置 → 模型 → 添加模型（填 Key、选模型、设为导演）→ 剧本里导入角色卡 → 开始故事。
手机连不上服务器时的排查，以及在真机上运行的细节，见 [apps/mobile/README.md](../apps/mobile/README.md)。

网页端（`apps/web`）和手机端是同一个 npm 工作区，`make js-install` 装过依赖后：

```bash
make web
```

打开 http://localhost:5173 。开发服务器把 `/v1`、`/health`、`/ready` 转给 http://localhost:8000 的后端，网页和接口同源，
不用配跨域，Cookie 登录也能用；后端在别的地址时设环境变量 `BT_API_URL`。设计和实现说明见 [client.md 第 4 节](client.md)。
部署时 `make web-build` 生成 `apps/web/dist`，由反向代理和接口放在同一个域名下（见 `deploy/nginx.example.conf`）。

没有模型 Key 也能从导入一路玩下去：起一个假模型服务，在“添加模型”里选“自定义兼容端点”，端点填 `http://127.0.0.1:8020/v1`，
Key 随便填，模型选 `fake-model`（后端要设 `ALLOW_PRIVATE_ENDPOINTS=true`）。后台整理世界状态时，它每回合直接 `commit`、不改世界状态；
自定义端点默认被当成不能调用工具，要让后台整理跑起来，先在模型详情里点“测试这个模型”：

```bash
cd apps/server && uv run python -m tests.fakes.story_llm --port 8020
```

排查问题时用日志查看器：`make vis-install` 装一次依赖，之后 `make vis`，打开 http://127.0.0.1:8100 。
它把 `apps/server/.data/logs/` 下的日志和数据库里的回合画成时间线，用法见 [testing.md 第 1 节](testing.md)。

后端的直接依赖在 `apps/server/pyproject.toml` 里精确锁定，与 `uv.lock` 一致；升级依赖时先改 pyproject，再执行 `uv lock` 并提交锁文件。

## 落地页

项目主页在 `apps/site`（React + Vite，和网页端在同一个 npm 工作区，`make js-install` 一起装依赖）。
设计稿和交互说明见 [design/landing/README.md](design/landing/README.md)。页面只有静态内容，不需要后端：

```bash
make site
```

打开 http://localhost:5174 。`make site-build` 生成 `apps/site/dist`：构建时把整页预渲染成 HTML（`apps/site/scripts/prerender.ts`），
浏览器里再接上交互，所以不开 JS 也能看到全部文字。资源用相对路径，整个目录放在任意路径下都能打开，比如 GitHub Pages 的 `/BetterTavern/`。
看构建出的页面用 `cd apps/site && npm run preview`（http://localhost:4174）。现在还没有部署。

## 测试

| 命令 | 内容 |
| --- | --- |
| `make test` | 后端单测与端到端测试（不需要数据库） |
| `make test-integration` | 需要数据库；会建临时 schema，测完删除（队列、账户、回合的并发与租约） |
| `make lint` | ruff、pyright、import-linter；客户端代码里有没有写死的中文（`scripts/check-i18n.mjs`） |
| `make js-test` | 客户端的纯逻辑（`packages/`、`apps/mobile`、`apps/web` 的 `node --test`）：SSE 解析与重连、回合状态机、会话与令牌刷新、接口客户端、布局、网页的存储和快捷键判断 |
| `make js-typecheck` | 客户端和共用包的 TypeScript 类型检查 |
| `make web-e2e` | 网页端的端到端测试（Playwright，用本机的 Chrome）：自己起后端、假模型服务和 Vite，从注册一路玩到删除账户；测试账号以 `e2e-` 开头，最后会删掉 |
| `make vis-test` | 日志查看器的纯逻辑：中文目录、格式化、手机日志解析、每一步的显示 |

## 合规率评测（M0 的 go / no-go）

在真实模型上跑 200 回合，统计导演输出协议的合规率。出口标准：无需修复不低于 95%，含修复不低于 99.5%。

```bash
cd apps/server
DEEPSEEK_API_KEY=sk-... uv run python -m evals.director_compliance --provider deepseek --model deepseek-flash
HF_TOKEN=hf_... uv run python -m evals.director_compliance --provider huggingface --model <org/model>:fastest
```

报告写在 `apps/server/evals/reports/`（不入库）。至少用 3 个模型各跑一次。

## 剧本试玩（agent runtime 阶段 2）

用真模型把一局玩 100 回合，后台同时整理世界状态，跑完逐回合检查一致性、统计落后和用量。
写进开发数据库（先 `make migrate`），每次新注册一个评测账号，跑完能在日志查看器里逐回合看。说明见 [`apps/server/evals/README.md`](../apps/server/evals/README.md)。

```bash
cd apps/server
DEEPSEEK_API_KEY=sk-... uv run python -m evals.playtest --provider deepseek --model deepseek-flash
```

## 目录

| 路径 | 内容 |
| --- | --- |
| `apps/server` | 后端：FastAPI、agent runtime、provider 层、队列、迁移、测试、评测 |
| `apps/mobile` | 客户端：Expo + TypeScript |
| `apps/site` | 项目主页（落地页）：React + Vite，构建时预渲染成静态 HTML |
| `apps/vis` | 本机日志查看器的网页（接口在 `apps/server` 的 `bettertavern vis`） |
| `deploy` | docker compose 与镜像 |
| `docs` | 设计文档，数据模型和接口的参考文档，界面与标志的设计稿 |
