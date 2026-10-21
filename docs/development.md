# 开发者指南

> 文档索引：[总览](README.md) · [后端](backend.md) · [客户端](client.md) · [测试](testing.md) · [数据模型](data-model/README.md) · [接口](api/README.md)

这一页写给想在本机跑起来、改代码、跑测试的人：当前实现到哪一步、本地开发、测试、评测、仓库目录。
想先了解这个项目是什么，看仓库根目录的 [README](../README.md)；完整的技术方案见 [总览](README.md)。

## 当前进度

记到 2026-10-21。

**M1 热路径**（已完成）：把“导入一张角色卡、一轮一轮玩下去”这条主线打通了：

- 账户：注册、登录、刷新令牌轮换（检测盗用）、退出、删除账户。
- 模型：添加 DeepSeek、OpenAI、Grok、Gemini、Hugging Face 或任意 OpenAI 兼容端点的模型（Key 在服务端加密保存），添加时自动拉取模型列表，确定上下文窗口；在模型列表里设为导演。
- 剧本：导入 SillyTavern 角色卡（V1、V2、V3，PNG 或 JSON），导入后可以编辑。
- 游玩：开局时 WorldBuilder 根据角色卡生成世界设定，导演写开场；之后每轮流式输出叙述和两个选项，也可以自由输入、写结局。
  提交带幂等键，同一局同一时刻只有一轮在生成（租约），断线后用 `Last-Event-ID` 续传，缓冲过期时一次补全。
- 客户端：手机 App（含平板布局）和网页；中文、英文、日文界面。

**agent runtime 升级**（[agent-runtime.md](agent-runtime.md)，五个阶段都已完成）：

| 阶段 | 做了什么 |
| --- | --- |
| 1 runtime 骨架 | 自己写的执行循环、工具注册表，每次调模型和用工具都记一步（`agent_steps`），日志查看器里能看 |
| 2 世界状态与回退 | 后台的世界状态 agent 每回合整理世界状态；“后台模型”设置；回退到任意一回合（每个存档有次数上限）；剧本试玩脚本 |
| 3 召回 | 导演的三个召回工具、隐藏备注、线索表 |
| 4 分层记忆 | 章节摘要、全书梗概、玩家画像；导演的上下文改成回顾加当前这一章的原文 |
| 5 大纲 | 后台写第一版大纲并按需修订；导演在最后一条消息里看到当前这一拍 |

先看[架构图解](agent-runtime-architecture.md)能最快弄懂整体；每个阶段的试玩结果在 [agent-runtime.md 第 13 节](agent-runtime.md)和 [evals.md](evals.md)，
还没解决的问题在[待优化清单](backlog.md)。

**还没做**：M4 的加固与发布（安全审查、压测、自托管文档、上架）；App 界面的自动化测试；契约工具链（客户端类型现在是手写的）。
和设计文档相比的简化见 [backend.md 第 12 节](backend.md)和 [client.md 第 3 节](client.md)。

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
| `make worker` | 另开一个终端，启动 worker：后台整理世界状态、章节和大纲（[agent-runtime.md](agent-runtime.md) 第 4 节）。不开也能玩，只是世界状态停在开局、没有章节摘要和大纲，回合一直是 `replied` |
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
Key 随便填，模型选 `fake-model`（后端要设 `ALLOW_PRIVATE_ENDPOINTS=true`）。后台整理世界状态时，它每回合直接 `commit`、不改世界状态；大纲修订时写一版三拍的大纲，之后都回“不改”；
自定义端点默认被当成不能调用工具，要让后台整理跑起来，先在模型详情里点“测试这个模型”：

```bash
cd apps/server && uv run python -m tests.fakes.story_llm --port 8020
```

章节整理在 worker 里跑（`make worker`）：这一章的原文超过 `CHAPTER_SOFT_TOKENS`（默认 8000）以后，在下一个场景结束处切一章；
想在开发时很快看到章节摘要，后端和 worker 都设低一点，例如 `CHAPTER_SOFT_TOKENS=400`、`CHAPTER_HARD_TOKENS=800`，日志查看器里打开那局能看到写好的记忆。
有了章节摘要以后，更早的回合不在导演的上下文里，导演可以先查旧回合（底部状态栏的“正在回想前情…”）：假模型服务加上 `--recall`，
它在有召回工具时先查一次再写。导演的模型也要能调用工具（同样先“测试这个模型”）。

排查问题时用日志查看器：`make vis-install` 装一次依赖，之后 `make vis`，打开 http://127.0.0.1:8100 。
它把 `apps/server/.data/logs/` 下的日志和数据库里的回合画成时间线，用法见 [testing.md 第 1 节](testing.md)。

后端的直接依赖在 `apps/server/pyproject.toml` 里精确锁定，与 `uv.lock` 一致；升级依赖时先改 pyproject，再执行 `uv lock` 并提交锁文件。

## 落地页

项目主页在 `apps/site`（React + Vite，和网页端在同一个 npm 工作区，`make js-install` 一起装依赖）。
设计稿和交互说明见 [design/landing/README.md](design/landing/README.md)。页面只有静态内容，不需要后端：

```bash
make site
```

打开 http://localhost:5174 （英文 /en/，日文 /ja/）。`make site-build` 生成 `apps/site/dist`：构建时把三种语言的整页各预渲染成 HTML
（`apps/site/scripts/prerender.ts`）——中文 `index.html`、英文 `en/index.html`、日文 `ja/index.html`，浏览器里再接上交互，所以不开 JS 也能看到全部文字。
资源用相对路径，整个目录放在任意路径下都能打开，比如 GitHub Pages 的 `/BetterTavern/`。构建时设置环境变量 `SITE_URL`（站点的绝对地址，
比如 `https://example.github.io/BetterTavern/`）时，页面里会写上 canonical 和各语言版本的 hreflang；不设就不写。
看构建出的页面用 `cd apps/site && npm run preview`（http://localhost:4174）。仓库里不放落地页的部署配置。

Android 安装包不在仓库里：部署时放到站点目录的 `downloads/BetterTavern.apk`，页面上的“下载 Android 版”指向它（相对地址），
发新版覆盖这个文件就行（`apps/mobile/README.md` 的“打包 Android 安装包”）。

文案在 `apps/site/src/i18n/`：`zh`、`en`、`ja` 各一份，结构由 `types.ts` 定，改一份就改另外两份（单元测试会对照三份的结构和占位）。
中文首页第一次打开时按浏览器语言跳一次（英文去 en/，日文去 ja/）；页面上换过语言以后按换的跳。文档只有中文，英文、日文页上指向文档的链接后面注明。

标题的思源宋体（600 / 700 / 900，日文页换成 Noto Serif JP 的同样三档）和等宽的 IBM Plex Mono 用 `@fontsource` 的包自己托管，不走 Google Fonts；
样式表按 unicode-range 切片，浏览器只下载页面上用到的片，构建时再去掉一个字都用不上的片（`apps/site/scripts/fontFaces.ts`，日文字体只看日文文案）。
正文黑体用系统字体。

## 测试

| 命令 | 内容 |
| --- | --- |
| `make test` | 后端单测与端到端测试（不需要数据库） |
| `make test-integration` | 需要数据库；会建临时 schema，测完删除：队列、账户、回合的并发与租约，世界状态的写入，章节整理，大纲修订，回退（随机走的一致性测试），以及文档里的表结构和真实的表是否一致 |
| `make lint` | ruff、pyright、import-linter；客户端代码里有没有写死的中文（`scripts/check-i18n.mjs`） |
| `make js-test` | 客户端的纯逻辑（`packages/`、`apps/mobile`、`apps/web`、`apps/site` 的 `node --test`）：SSE 解析与重连、回合状态机、会话与令牌刷新、接口客户端、布局、网页的存储和快捷键判断、落地页的演示和关系图 |
| `make js-typecheck` | 客户端和共用包的 TypeScript 类型检查 |
| `make site-e2e` | 落地页的冒烟测试（Playwright，用本机的 Chrome）：先构建，再打开放在 `/BetterTavern/` 子路径下的页面点一遍，量 320 到 1440 的宽度，也看不开 JS 的样子 |
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

## 剧本试玩（agent runtime 阶段 2 起）

用真模型把一局玩 100～300 回合，后台同时整理世界状态、章节和大纲，跑完逐回合检查一致性、检查点、召回题和大纲，统计落后和用量。
写进开发数据库（先 `make migrate`），每次新注册一个评测账号，跑完能在日志查看器里逐回合看。
剧本有 `tavern_100`、`tavern_300`（长篇记忆）、`detour_60`（中途改道，考大纲）。怎么跑、怎么读报告、历次结果和花费见 [evals.md](evals.md)，
脚本的参数见 [`apps/server/evals/README.md`](../apps/server/evals/README.md)。

```bash
cd apps/server
DEEPSEEK_API_KEY=sk-... uv run python -m evals.playtest --provider deepseek --model deepseek-flash
```

## 目录

| 路径 | 内容 |
| --- | --- |
| `apps/server` | 后端：FastAPI、agent runtime、provider 层、队列、迁移、测试、评测 |
| `apps/mobile` | 手机端：Expo + TypeScript |
| `apps/web` | 网页端：React + Vite |
| `apps/site` | 项目主页（落地页）：React + Vite，构建时预渲染成静态 HTML |
| `apps/vis` | 本机日志查看器的网页（接口在 `apps/server` 的 `bettertavern vis`） |
| `packages` | 手机端和网页端共用的包：`core`（接口客户端、SSE、会话、回合状态机、i18n 资源）、`design`（色板、主题、尺寸、图标、封面） |
| `deploy` | docker compose、镜像、反向代理示例 |
| `scripts` | 仓库级的检查脚本（界面代码里有没有写死的中文） |
| `docs` | 设计文档，数据模型和接口的参考文档，界面与标志的设计稿 |
