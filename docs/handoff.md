# 交接说明：M0 与 M1

> 写给接手的 Claude Code（以及之后的协作者）。记录到 2026-10-14 为止完成了什么、验证到什么程度、哪些没验证、下一步做什么。
> 设计以 [README.md](README.md)、[backend.md](backend.md)、[client.md](client.md)、[testing.md](testing.md) 为准；
> 已经实现的表结构和接口以 [data-model/](data-model/README.md)、[api/](api/README.md) 为准（按领域分文件，有测试检查它们与代码一致）；
> 写代码前先读仓库根目录的 [AGENTS.md](../AGENTS.md)（分层、提示词、测试、中文的约定）。

## 1 一页概览

BetterTavern 是服务端生成式互动小说：导入 SillyTavern 角色卡，玩家以第一人称推进，每轮服务端的“导演”流式写一段叙述加两个选项，
也可以自由输入。后端 Python + FastAPI + PostgreSQL，客户端 React Native（Expo SDK 57、expo-router）。用户自带模型 Key，
v1 支持 DeepSeek、Hugging Face 和自定义的 OpenAI 兼容端点。

| 里程碑 | 状态 |
| --- | --- |
| M0 探针（RN 上的 SSE、provider 层、导演协议合规率、Postgres 车道队列） | 代码完成。真实模型上的合规率评测**没有跑过**（用户已确认） |
| M1 热路径（账户、凭据与路由、角色卡导入、WorldBuilder、回合流式与选项、幂等与租约、SSE 续传、RN 阅读主屏） | 代码完成，自动化测试在用户 Mac 上全部通过；**还没有在模拟器或真机上运行过，出口标准未验收** |
| M2 起 | 未开始 |

接手后按顺序做：

1. ~~把工作区收拾干净并提交（第 2 节）~~：2026-10-14 已完成。
2. ~~在用户的 Mac 上用真实依赖把测试和检查全跑一遍（第 4 节）~~：2026-10-14 已完成，全部通过。
3. 起服务端和 App，按第 5 节做 M1 真机验收，修发现的问题。
4. 验收通过后把 `m1` 合进 `main` 并推送。

## 2 仓库与 Git 状态

远端 `origin` 是 `https://github.com/Hexthebaldy/BetterTavern.git`，目前是空的，**什么都没有推送**。

| 分支 | 提交 | 内容 |
| --- | --- | --- |
| `main` | `62d01ca` docs: 技术方案与仓库约定 | docs/ 四份方案与 AGENTS.md（M0 开工时的版本） |
|  | `64c371b` feat: M0 探针与项目骨架 | M0 的全部代码、Makefile、deploy、配置 |
| `m1`（当前检出） | `bebb74d` feat(server): M1 热路径 | 服务端全部改动，含独立审查后的修复 |
|  | `91ca439` feat(mobile): M1 客户端 | 客户端全部改动 |
|  | `f40c189` docs: M1 实现状态与偏差 | README、docs 的更新 |

提交作者是 `Hexthebaldy <Asher982649318@outlook.com>`，用户确认不用改。用户本机全局 git 身份是另一个（`yang`），
所以在这个仓库里提交时要显式带上这个作者（`git -c user.name=Hexthebaldy -c user.email=Asher982649318@outlook.com commit ...`）。

写这份说明时工作区里还有下面这些没提交的东西，2026-10-14 已全部处理并提交在 `m1` 上（同时把 `pyproject.toml` 的直接依赖按 uv.lock 改成了精确版本）：

| 文件 | 状态 | 处理 |
| --- | --- | --- |
| `Makefile` | 在提交里，但不在磁盘上（远程工具不允许写这个文件） | `git restore Makefile` |
| `apps/mobile/package-lock.json` | 用户已执行 `npm install`，锁文件已更新 | 提交 |
| `apps/server/uv.lock` | 还是 M0 的版本，缺 M1 新增的 cryptography、pyjwt、python-multipart | 在 `apps/server` 下 `uv sync` 后提交。**更新之前 Docker 镜像会缺依赖**（Dockerfile 用 `uv sync --frozen`） |
| `deploy/docker-compose.yml` | 修复：生产 compose 没有传 `MASTER_KEYS`、`AUTH_SECRET`，`ENV=prod` 下 api 起不来 | 提交（建议 `fix(deploy): ...`） |
| `docs/handoff.md`、`CLAUDE.md` | 新增：本说明，以及让 Claude Code 自动读取 AGENTS.md 的入口 | 提交 |

之后补写参考文档（2026-10-14）时新增或修改了下面这些文件，**还没有提交**，建议作为一个提交（`docs: 数据模型与接口参考`）：

| 文件 | 内容 |
| --- | --- |
| `docs/data-model/`、`docs/api/` | 新增：实际的表结构与接口的参考文档，按领域分文件 |
| `apps/server/tests/support/docs.py`、`apps/server/tests/unit/api/test_api_doc.py`、`apps/server/tests/integration/test_data_model_doc.py` | 新增：检查这两个目录与代码是否一致的测试 |
| `AGENTS.md`、`CLAUDE.md`、`README.md`、`docs/README.md`、`docs/backend.md`、`docs/client.md`、`docs/testing.md`、`docs/handoff.md` | 指向两份参考文档；AGENTS.md 加了“改表、改接口时同步更新”的规则 |

## 3 本地运行

需要 Python 3.12+ 和 uv、Docker（Postgres）、Node 22.18+。命令都在仓库根目录执行，见 README 的“本地开发”。

用户的 Mac 上**没有 Docker**，但 Homebrew 的 `postgresql@16` 常驻在 `localhost:5432`，`bettertavern` 角色和同名数据库已经建好，
`.env` 里默认的 `DATABASE_URL` 和 Makefile 的 `TEST_DB` 都能直接用，跳过 `make db-up` 即可。
用户开着 ClashX Meta 的增强模式（fake-ip），所有域名在本机都解析到 `198.18.0.0/15`，SSRF 检查会报“解析到内网或保留地址”
（配了 `OUTBOUND_PROXY` 也一样，代理模式下仍先在本地解析和检查）。所以用户本机的 `apps/server/.env` 打开了 `ALLOW_PRIVATE_ENDPOINTS=true`；
不想放开时，把模型服务的域名加进 Clash 的 `fake-ip-filter`。

```bash
cp apps/server/.env.example apps/server/.env
make db-up
make install
make migrate
make dev
```

- 开发环境（`ENV=dev`）不配置密钥也能启动：第一次启动时生成主密钥和令牌签名密钥，存到 `apps/server/.data/dev-secrets.json`（0600，已忽略）。
  生产环境必须配置 `MASTER_KEYS`、`AUTH_SECRET`，用 `uv run bettertavern keygen` 生成。主密钥丢了，已保存的模型 Key 就解不开了。
- api 默认监听 `0.0.0.0:8000`；`/health`、`/docs`（非生产）。M1 的热路径只需要 api 进程，`make worker` 目前用不到。
- 客户端：`cd apps/mobile && npm install && npx expo start -c`。`EXPO_PUBLIC_API_URL` 写在 `apps/mobile/.env`，也可以在登录页底部临时改（存在手机上）。
  `expo-secure-store` 和 `expo-document-picker` 都在 Expo Go 里，不用重新打包。
- 用户用的是 zsh：交互模式下行尾的 `# 注释` 会被当成参数（`npx expo start -c # ...` 会报 Invalid project root）。给用户的命令不要带行尾注释。

## 4 验证情况

### 已经做过的

- 后端：357 个测试全部通过，包括单元、真实 Postgres 16 的集成测试（`tests/integration`）和端到端流程（`tests/e2e/test_m1_flow.py`：uvicorn 里的真实 api 加假模型服务，
  走完注册 → 添加模型 → 导入 → 开局 → 多回合 → 断开后续传）。ruff、ruff format、pyright 0 错误，分层规则 0 违规。
- 客户端：74 个 `node --test` 全部通过；用用户 Mac 上实际的 `node_modules` 跑了 `tsc`（含 expo-router 生成的 typed routes），0 错误。
- 一个独立的 agent 审查了 M1 的全部代码，找到 10 个问题，已全部修复并加了回归测试（第 8 节）。

### 在用户 Mac 上的复核（2026-10-14）

用户本机、按 uv.lock 安装的依赖（Python 3.12.13、真的 asyncpg 0.32.0、Homebrew Postgres 16.15、Node 22.22.2）：

- `make test` 340 个通过（4 个需要数据库的跳过）；`make test-integration` 17 个通过。合计 357 个，与下面的记录一致。
- `make lint` 一开始有两处不过，已修复：迁移里一行 SQL 超过 100 字符（ruff E501）；import-linter 的“api 不用 providers”把经 services 的间接导入也算进去了，
  改成 `allow_indirect_imports = true`，只禁止 api 直接 import providers。修复后 ruff、format、pyright、6 条分层规则全部通过。
- `make mobile-test` 74 个通过，`npm run typecheck` 0 错误。

之后补参考文档时新加了 4 个测试（`tests/unit/api/test_api_doc.py` 3 个，`tests/integration/test_data_model_doc.py` 1 个）。
它们在我的环境里和其他测试一起通过（合计 361 个），还没有在用户的 Mac 上跑过；下次 `make test`、`make test-integration`、`make lint` 会覆盖到。

下面一节是上一个环境的局限，以上复核已经覆盖。

### 验证环境的局限（已由上面的复核覆盖）

- 我的环境访问不到 PyPI 和 npm，装不了编译型的 asyncpg，所以后端测试是通过一个**只存在于我环境里的 asyncpg 兼容层**连真实 Postgres 跑的（没有放进仓库）。
  兼容层按 asyncpg 的严格类型规则写，但请在用户的 Mac 上用真的 asyncpg 跑一遍 `make test-integration`，结果以那次为准。
- 我用的是 Python 3.13，仓库固定 3.12（`.python-version`）；依赖版本也不是按 uv.lock 装的。
- 客户端的类型检查用了临时的 tsconfig（只为在我的环境里找到 `node_modules/@types`）；用户本机直接 `npm run typecheck` 即可。

### 完全没做的

- App 没有在模拟器或真机上跑过：界面、键盘、滚动、深色模式、导入文件、Keychain 都没有实际看过。
- 没有用真实的 DeepSeek 或 Hugging Face Key 跑过 M1 流程（端到端测试用的是假模型服务）。导演提示词、WorldBuilder 的结构化输出在真实模型上的表现未知。
- `deploy/docker-compose.yml` 的完整部署没跑过。
- 没有性能和长局测试（30 回合以上、上千回合的故事流渲染）。

## 5 M1 验收

出口标准（docs/README.md 第 3 节）：DeepSeek 与 Hugging Face 各完整玩 30 回合；断网续传用例通过。建议按下面的清单在 iOS 和 Android 真机上各走一遍。

1. 注册 → 设置 → 模型 → 添加模型：选 DeepSeek、填 Key（模型列表自动出来）→ 选模型、勾“设为导演” → 保存；进入模型详情“测试这个模型”（会真的调用几次），能看到窗口和它的来源。
   用户指定的测试模型是 DeepSeek V4.1 Flash，API 里的模型 ID 是 `deepseek-flash`（官方文档 2026-09-10 起）；`deepseek-v4-flash` 暂时也路由到它，
   `deepseek-chat`、`deepseek-reasoner` 已在 2026-07-24 停用。`capabilities.yaml` 里 `deepseek-*` 的规则（1M 窗口、384K 输出、thinking 开关）覆盖它。
2. 剧本 → 导入一张 V2 的 PNG 卡和一张 V3 卡 → 剧本详情填主角名 → 开始故事：应先看到“正在根据角色卡搭建世界…”，再流式出开场。
3. 连续玩 30 回合，选项和自由输入都用；中途在“生成中”点一次“停止”，再“重试”。
4. 生成中切飞行模式几秒再切回：叙述接着出，不重复、不缺字（客户端带 `Last-Event-ID` 续传）。
5. 生成中把 App 切到后台再回来、或者杀掉再打开：能接上这一轮，或者看到可以重试的失败。
6. 放置 15 分钟以上再操作：访问令牌过期后自动刷新，不会被踢回登录页。
7. 换成 Hugging Face 的 Key 和模型重复 1 到 5。
8. 服务器换成蜂窝网络可达的 https 地址，跑一次“设置 → 连接测试”；结果是“轮询降级”说明代理在缓冲 SSE（Nginx 要 `proxy_buffering off`）。

排查入口：服务端日志（不含故事文本）；`GET /v1/playthroughs/{id}` 看 `active_turn`、`last_failed`；`GET /v1/turns/{id}` 看回合状态与 `error.code`
（各个错误码的含义见 [api/README.md 的“错误码”](api/README.md#错误码)）；`agent_runs` 表记录每次模型调用的结果与用量（字段见 [data-model/infra.md](data-model/infra.md)）。

真机上最可能出问题的地方（都没验证过）：

- **键盘**：登录页、注册页、剧本详情用 `KeyboardAvoidingView`（iOS 上 `padding`）。阅读页不用它：行动面板是浮层，
  iOS 上自己监听键盘事件浮到键盘上方（`ActionBar` 的 `useKeyboardLift`），故事流的底部留白跟着加上键盘高度；Android 靠窗口随键盘缩小，
  没有额外处理。如果 Android 上面板被键盘挡住，在 `useKeyboardLift` 里给 Android 也加上抬升。
- **自动滚动**：`StoryFeed` 停在底部时 `onContentSizeChange` 里 `scrollToEnd`，上翻超过 80px 暂停并显示“回到最新”。长故事的首次定位依赖多次 `scrollToEnd` 收敛。
  面板下面的留白必须放在列表尾部组件里：`FlatList.scrollToEnd` 只算到尾部组件，不算 `contentContainerStyle` 的内边距（放在内边距里时打开故事会停在最后两段被面板盖住的位置）。
- **导入**：`DocumentPicker.getDocumentAsync({ type: "*/*" })` 之后按扩展名过滤，把 `new File(uri)`（expo-file-system）放进 `FormData` 上传。
  不能用 RN 的 `{ uri, name, type }`：SDK 57 的全局 `fetch` 是 `expo/fetch`，遇到这种对象直接抛 `Unsupported FormDataPart implementation`，
  请求根本发不出去，界面上显示成“连不上服务器”（2026-10-14 真机上遇到并修复）。iOS 上的上传可能没有 Content-Length，
  服务端的大小限制中间件（`api/body_limit.py`）对此是边收边数的。
- **标签栏**：自己画的浮动胶囊（`bars.tsx` 的 `TabBar`），绝对定位在内容上面；有 Home 指示条的机型离底 `安全区 − 6`，没有的离底 16。
  标签页的列表底部要用 `useTabBarSpace()` 留白，新加标签页时别忘了。
- **SecureStore**：会话以一个 JSON 存在 `bt.session`，远小于 2 KB。
- **WorldBuilder**：结构化输出阶梯在真实模型上可能降级到 `prompt_json`；失败时退回只用卡片文字的最小 Seed（`world.ready` 的 `source` 会标出来）。

## 6 架构速览

### 后端（`apps/server/src/bettertavern/`）

分层：`api` → `services` → `runtime` → `domain`；`providers` 不依赖本项目其他包；`infra` 是叶子；`runtime` 只通过 `runtime/ports.py` 读写数据。`importlinter.ini` 强制。

| 目录 | M1 的内容 |
| --- | --- |
| `api/` | `v1/{auth,routes,scenarios,playthroughs,health}.py` 路由；`schemas/` 请求与响应模型；`errors.py`（problem+json）；`deps.py`（当前用户、限流）；`ratelimit.py`（进程内）；`body_limit.py`（请求体 1 MB，角色卡 16 MB）；`sse.py`；`probe_app.py`（M0 探针，只能读自己建的流） |
| `services/` | `auth_service`、`route_service`（玩家配好的模型：SSRF 校验、探测、模型列表、窗口校验；门面加 `route_inputs`、`route_codec`、`route_models`、`route_views`）、`scenario_service`、`playthrough_service`（创建时插入开场回合并领租约）、`turn_service`（提交、幂等、租约、历史、取消、事件流）、`turn_store`（实现 runtime 的 `TurnStore` 端口）、`maintenance`（每 15 秒清过期租约，定期清幂等键和刷新令牌）、`container.py`（组装） |
| `runtime/` | `runner.py`（`TurnRunner`、`TurnRunnerPool`）；`agents/{director,world_builder,options_repair}.py`；`context/{assembler,state_block,tokens,fences}.py`；`protocol/{director_parser,repair,structured,json_extract}.py`；`events/buffer.py`；`prompts/zh/*.j2`；`routing.py` |
| `domain/` | `story/turn.py`（行动解析、选项）、`scenario/card.py`、`world/{seed,plan,views,names}.py`、`routing.py`（`RouteTask`、`RouteParams`）、`memory/thresholds.py` |
| `importers/character_card/` | `png.py`（只读 chara / ccv3 文本块，限制块数、单块与总解压量）、`parse.py`（V1/V2/V3 规范化） |
| `infra/` | `crypto/{envelope,keyring,passwords,tokens}.py`；`db/repositories/{accounts,routes,library,story,world,runs}.py`（SQLAlchemy Core 写 SQL）；`db/engine.py`（`hide_parameters=True`） |
| `migrations/versions/` | `0002_core`：M1 的全部表（users、refresh_tokens、credentials、blobs、scenarios、playthroughs、turns、model_routes、entities、entity_links、facts、agent_runs、idempotency_keys）；`0003_model_routes`：credentials 并进 model_routes，一行一个配好的模型 |

一轮的生命周期：

1. `POST /v1/playthroughs/{id}/turns`（带 `Idempotency-Key`）。先查幂等键（重放直接返回 200 和已有回合），再确认归属，再查导演路由，
   然后在一个事务里：锁 playthroughs 行 → 再查一次幂等键 → 租约（未过期返回 409 `TURN_IN_PROGRESS` 带 `active_turn_id`；已过期就把那一轮标为 `RUNNER_LOST`）
   → 父回合必须等于 head（否则 409 `STALE_PARENT`）→ 解析行动（选项只发 `option_id`，文字由服务端从父回合的选项里取）→ 插入回合（`generating`）并领租约 → 写幂等键。返回 201。
2. `TurnRunnerPool.start` 在 api 进程里起后台任务，和客户端连接无关。`TurnRunner`：需要时先跑 WorldBuilder（`world.building` / `world.ready`）→ 屏障（M1 里不会等待）
   → 装配上下文 → 导演流式生成（`narrative.delta`，首 token 前出错可重试或切 fallback 路由，超窗时紧急截断后重试一次）→ 选项修复阶梯 → 带围栏提交 → `options.ready`、`turn.completed`。
   失败发 `turn.failed`（半截叙述存库，`partial`）。生成期间每 30 秒续租，发现租约丢了就取消生成。
3. 提交：先 `UPDATE playthroughs ... WHERE active_turn_id = 本轮 AND timeline_epoch = epoch`（释放租约、推进 head），成功后才写 turns 和 agent_runs；
   不成功说明租约已被清理任务收走，结果作废，推给客户端的错误与库里一致（`RUNNER_LOST`，可重试）。
4. 事件流 `GET /v1/turns/{id}/events`：事件 id 为 `{turn_id}:{n}`，带 `Last-Event-ID` 从进程内缓冲补发；缓冲不在了就等回合结束后发一个 `snapshot` 加终止事件。每 15 秒 keepalive。

### 客户端（`apps/mobile/`）

| 位置 | 作用 |
| --- | --- |
| `src/state/AppProvider.tsx` | 组装 `ApiClient`、`SessionManager`、事件流连接；`useApp()` 提供 `api`、登录状态、服务器地址 |
| `src/api/client.ts` | `ApiClient`：带令牌，401 时刷新一次再重试；problem+json 转 `ApiError`（`code`、`field()`）；超时与网络错误统一成 status 0 |
| `src/api/endpoints.ts`、`types.ts`、`events.ts` | 各接口的封装、手写的类型（与 `api/schemas/` 对应）、事件解析（不认识的事件忽略） |
| `src/api/sse/` | `SseParser`（流结束时丢弃半截事件）、`SseClient`（退避、续传、卡住 3 次或 404 转轮询、401 刷新后重连） |
| `src/api/turnStream.ts` | 用 `SseClient` 打开回合事件流；终止事件必须能解析才算结束 |
| `src/auth/session.ts` | `SessionManager`：令牌存取、提前一分钟单飞刷新、刷新被拒即退出 |
| `src/features/play/turnMachine.ts` | 纯 reducer：`loading / load_failed / idle / submitting / streaming / reconnecting / polling / syncing / failed` |
| `src/features/play/playSession.ts` | `PlaySession`：加载、提交（网络错误用同一个幂等键退避重试）、409 处理、接事件流、轮询降级、回到前台立即重连 |
| `src/features/play/usePlaySession.ts`、`StoryFeed.tsx`、`TurnActions.tsx`、`BottomBar.tsx` | hook（每帧最多渲染一次）、故事流（选项接在最新一段后面）、底部贴边的操作栏（左边世界状态、右边“更多”，中间是“自己写…”或生成状态和“停止”） |
| `app/` | 路由：`(auth)/login`、`(auth)/register`、`(tabs)/playthroughs`、`(tabs)/library`、`(tabs)/settings`、`scenario/[id]`、`play/[id]`、`settings/models`、`settings/model/[id]`、`settings/account`、`dev/probe`；`_layout.tsx` 用 `Stack.Protected` 按登录状态切换 |
| `src/theme/index.ts`、`src/components/ui.tsx` | 界面「白 / 柔线 / 大圆角」的设计 token 与部件（设计稿和交互规则都在 `docs/design/ui/`）。`ui.tsx` 是门面，部件分在同目录的 primitives、feedback、controls、bars、overlay、dialog、icons 里；页头、标签栏、对话框、底部面板都是自己画的，原生导航栏不显示 |

## 7 不能破坏的约束

- 所有提交先做带条件的 UPDATE（`playthroughs` 行），再写其他表；**加锁顺序一律先 playthroughs 后 turns**（提交、失败、清理、创建、删除都是如此，审查里出过一次死锁）。
- turns 上的部分唯一索引 `(playthrough_id, seq) WHERE status NOT IN ('failed','archived')`：失败的尝试不占位，重试是同一个 seq、`attempt + 1`。
- 幂等键按 `(user_id, key)` 存请求哈希；同一个键不同内容返回 422 `IDEMPOTENCY_KEY_REUSED`。客户端：请求没送达就用原来的键重发，生成失败的重试用新键。
- 访问别人的资源一律 404，而且归属检查要在其他检查（比如路由是否配置）之前。
- 注入上下文的用户文本（玩家输入、角色卡、实体文字）先过 `sanitize_for_fence()`；处理不可信文本的正则必须是线性的（用占有量词，`tests/unit/runtime/test_prompts_and_fences.py` 有耗时测试）。
- 日志不写故事文本和密钥。
- 提示词是 `runtime/prompts/zh/*.j2` 数据文件，渲染必须确定性。
- 客户端只在事件真正派发时推进 `Last-Event-ID`；叙述靠增量拼接，所以续传绝不能从头重放到已有文字上（正在生成的回合加载时叙述从空开始）。
- 改表结构或接口时，在同一个改动里更新 [data-model/](data-model/README.md) 或 [api/](api/README.md) 里对应领域的文件；`test_data_model_doc.py`、`test_api_doc.py` 不通过就说明文档落后了。

## 8 审查发现并已修复的问题

| 严重度 | 问题 | 修复 |
| --- | --- | --- |
| 高 | PNG 里大量压缩文本块逐个解压，一个 16 MB 的文件能吃掉十几 GB 内存，且在事件循环上执行 | 只解压 chara / ccv3，限制解压总量，导入放进线程 |
| 高 | 围栏正则在“<”加长串空白上平方级回溯；JSON 提取在一长串“{”上平方级；选项行正则同样 | 正则改为占有量词；JSON 提取改为在每个“{”处用 `raw_decode` 并限制长度和次数 |
| 中 | 不需要登录的探针接口能按 id 读到真实回合的事件流 | 只交出探针自己建的流（`probe_` 前缀且有记录） |
| 中 | 数据库出错时异常里带 SQL 参数（故事文本）进日志 | 引擎 `hide_parameters=True` |
| 中 | 客户端：流在终止事件中途干净结束时，半截事件被派发、`Last-Event-ID` 前移，界面卡在“生成中” | 解析器丢弃半截事件；终止事件要能解析；流结束但还在等就转轮询 |
| 低 | `fail_turn` 先锁 turns 后锁 playthroughs，与删除并发会死锁 | 改为先 playthroughs |
| 低 | 提交被围栏拒绝时推 `TURN_SUPERSEDED`（不可重试），库里却是 `RUNNER_LOST`（可重试） | 两边一致为 `RUNNER_LOST` |
| 低 | multipart 先整个落盘才检查大小；示例 Nginx 默认只放行 1 MB | 加请求体大小中间件；Nginx `client_max_body_size 17m` |
| 低 | 嵌套极深的 JSON 角色卡导致 500 | 捕获 `RecursionError`，返回 `CARD_INVALID` |
| 低 | 刷新令牌宽限期用应用时钟和数据库时钟比较 | `used_at` 改用应用传入的时间 |

## 9 已知限制与后续工作

先处理（M1 收尾）：

- ~~锁文件与 compose 的提交（第 2 节）；`pyproject.toml` 的直接依赖按 uv.lock 改成精确版本~~：2026-10-14 已完成。
- 真机验收与修复（第 5 节）；用真 asyncpg 跑集成测试。
- 客户端没有界面测试（RNTL、Maestro 都还没接）。

写参考文档时对照代码发现的小问题（都还没修，严重度低；[data-model/](data-model/README.md)、[api/](api/README.md) 按现状描述）：

- `\u0000`：只有导入角色卡和给剧本改名时会去掉。玩家的自由输入、主角设定、标题、模型路由的字段、模型输出里含 `\u0000` 时，Postgres 拒绝写入，接口返回 500，或者回合以 `INTERNAL_ERROR` 失败。
- 生成中途续租失败（租约已被清理任务收走）时，runner 通过取消令牌停止，推给客户端的 `turn.failed` 是 `CANCELLED`，库里是 `RUNNER_LOST`。
  提交被围栏拒绝的情况已经统一成 `RUNNER_LOST`（第 8 节），这里也应该一样。
- 同一个 `Idempotency-Key` 同时用在两局上：后插入的违反主键，返回 500，应该是 422 `IDEMPOTENCY_KEY_REUSED`。
- 提交行动时把过期回合标为失败的那条路径没有发 `bt_turns` 通知（M1 没有订阅方，暂时没有影响）。
- 还没有轮换主密钥后重新加密的工具；只改 Key 时 `extra_headers_enc` 不会用新的主密钥重新加密。

与设计文档的偏差（详见 [backend.md 第 12 节](backend.md)、[client.md 第 3 节](client.md)），M2 起按设计补齐：

- 热路径是线性的 `TurnRunner`，没有 LangGraph；回合直接提交为 `committed`，没有 StateKeeper 和 `post_turn` 车道，屏障不会真的等待。
- 没有会话通道 `/playthroughs/{id}/events`；开局进度在开场回合的事件流里（`world.building`、`world.ready`）。
- 头像存在 Postgres 的 `blobs` 表；仓储是手写 SQL，没有 ORM 模型。
- 客户端类型手写（没有 OpenAPI 生成）；没有 TanStack Query、Zustand、FlashList、expo-sqlite 缓存、i18n、触觉反馈。
- 限流在进程内；租约清理在 api 进程里。
- 还没有的接口：导出数据、单局路由覆盖、只重做选项、重新生成、回退、摘要和大纲视图、`/metrics`。

M2 的主要工作（docs/README.md 第 3 节）：StateKeeper、不变量、状态块与披露分层、屏障、回退与重新生成、世界浏览与时间线界面。

## 10 已确认的产品决策（摘要）

完整列表见 [README.md 第 1 节](README.md)。

- v1 的模型：DeepSeek、Hugging Face，加用户自定义的 OpenAI 兼容端点；provider 层只做最后的 HTTP 请求，要能扩展到更多厂商。不移植 SillyTavern 的代码。
- 每轮只有导演在关键路径上，回复立即返回；其他 agent 在后台更新状态。同一局的回合串行，下一轮等上一轮的状态提交（屏障最多 8 秒）。
- 每轮固定两个选项，加自由输入。
- 上下文超过窗口的 80% 时压缩；v1 不接 Jev。摘要放回上下文时必须带“回顾”包装。回退的下限是最近一次摘要折叠的边界。
- 工作窗口默认 128K，用户可调，运行时要校验当前模型能否满足。
- 世界书转成世界状态，v1 没有世界书模块。中文优先；不做成本控制；隐私不作为重点。
