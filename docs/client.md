# BetterTavern 客户端技术方案

> 文档索引：[总览](README.md) · [后端](backend.md) · [客户端](client.md) · [测试](testing.md) · [数据模型](data-model/README.md) · [接口](api/README.md)

## 1 React Native 客户端

客户端是一个薄客户端：它不跑任何 agent，也不保存模型密钥，只负责三件事——把故事流畅地读出来、把玩家的选择安全地发出去、把服务端推来的状态变化展示出来。

### 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Expo（Dev Client）+ TypeScript strict | 需要原生模块时用 prebuild，不用 eject |
| 路由 | Expo Router | 文件即路由，目录见第 2 节 |
| 服务端数据 | TanStack Query | 缓存、失效、重试；回合列表用无限查询 |
| 本地状态 | Zustand | 登录态、界面偏好、当前回合状态机 |
| 列表 | FlashList | 故事流可能上千段 |
| 本地存储 | expo-sqlite（历史缓存）、expo-secure-store（令牌） | 缓存随时可丢，服务端才是权威 |
| API 客户端 | `openapi-fetch` + 生成的类型 | 来自 `packages/api-contract`（[backend.md 第 9 节](backend.md)） |
| 流式 | `expo/fetch` 加自写 `SseClient` | 见下 |
| 国际化 | i18next + react-i18next + expo-localization | 中文、英文、日文三种界面语言，资源和网页端共用（`packages/core/src/i18n/`），见 [i18n.md](i18n.md) |
| 文件导入 | expo-document-picker | 角色卡原样上传，服务端解析 PNG 里的 `chara` 文本块，客户端不带 PNG 解析器 |
| 测试 | `node --test`（纯逻辑）、Jest、React Native Testing Library、MSW、Maestro | [testing.md 第 1 节](testing.md) |

**密钥处理**：玩家在设置页输入 API Key，经 TLS 一次性发给服务端；输入框是只写的，之后界面只显示后四位。客户端不在设备上保存模型密钥，丢设备不会泄露它们。

### 流式：`SseClient`（`packages/core/src/api/sse/`）

Expo 文档称 `expo/fetch` 符合 WinterCG 规范，可以通过 `response.body.getReader()` 读取流，并给出了带 `Accept: text/event-stream` 的示例（文档对应 SDK 57）。文档没有明确承诺真机上长连接 SSE 的表现，所以这条放进 M0 探针，通过之前不动工后面的界面。

- 用 `TextDecoder('utf-8')` 解码，且必须带 `{ stream: true }`：中文是多字节字符，一个字可能被拆在两个 chunk 里。Expo 文档说明原生 `TextDecoder` 只支持 UTF-8，正好够用。
- 按空行切帧，处理 `id:`、`event:`、多行 `data:` 和以冒号开头的注释行。
- 断线重连：网络不通时按 0.5、1、2、4 秒退避，之后每 10 秒重试一次，一直带 `Last-Event-ID` 续传，断网不会让客户端放弃 SSE。连上却拿不到数据（HTTP 错误、45 秒内一个字节都没有、连上后一个事件都没有就结束）连续 3 次，说明这一跳可能在缓冲 SSE，转为轮询 `GET /turns/{id}`（每 1.5 秒，直到终态）。收到任何事件都会把计数清零；服务端返回 404（缓冲已过期）时直接转轮询。
- App 切到后台时连接可能被系统挂起，回到前台就重连续传；服务端的生成不受影响。
- 取消用 `AbortController`；退出页面时关闭连接，但不取消服务端的生成。

**M0 探针的验收标准**：iOS 与 Android 真机，Wi-Fi 与蜂窝网络，各跑一次 3 分钟以上的长流；中文无乱码；中途断网再恢复后用 `Last-Event-ID` 续传，拼出的文本与最终叙述一致；服务端发出到屏幕上出现的延迟 p95 小于 300 毫秒。

### 回合状态机（`packages/core/src/play/turnMachine.ts`，纯 reducer，可单测）

| 状态 | 事件 | 下一状态 | 界面表现 |
| --- | --- | --- | --- |
| idle | 点选项或发送自由输入 | submitting | 选项区禁用，显示玩家行动 |
| submitting | 201 | streaming | 出现空的叙述气泡 |
| submitting | 409 `TURN_IN_PROGRESS` | streaming | 直接订阅已有的回合 |
| submitting | 409 `STALE_PARENT` | syncing | 拉最新 head 后回到 idle |
| submitting | 网络错误 | submitting | 用同一个 `Idempotency-Key` 重试 |
| streaming | `director.recalling` | streaming | 提示“正在回想……”（agent runtime 阶段 3；屏障取消后不再有 `turn.waiting_state`） |
| streaming | `narrative.delta` | streaming | 追加文字 |
| streaming | `options.ready` 加 `turn.completed` | idle | 展示两个选项 |
| streaming | 连接断开 | reconnecting | 小提示，自动重连 |
| reconnecting | 重连成功 | streaming |  |
| reconnecting | 连续 3 次连上却拿不到数据，或 404 | polling | 轮询直到终态 |
| 任意 | `turn.failed` 且可重试 | failed | “重试”按钮（等于重新生成） |
| idle 或 failed | 回退成功（接口返回新的存档详情） | syncing | 重新拉取历史与世界状态 |

最新一段是结局（行动来源 `ending`）时故事已经结束：状态仍是 idle，但 `isEnded()` 为真，`canAct()`、`canSubmit()` 都是假，不能再提交任何行动。
结局写失败和普通回合一样进入 failed，“重试”重发同一个结局（带同样的方向）。

### 渲染与性能

- 流式文字存放在 ref 里，用 `requestAnimationFrame` 合并到最多每帧一次更新；只有正在生成的那一段重渲染，已完成的回合用 `memo` 固定。
- 故事流自动滚动到底，但玩家向上翻阅时暂停自动滚动，出现“回到最新”按钮。
- 无障碍：叙述用 `accessibilityLiveRegion=polite` 并批量朗读，不逐字；支持系统字号缩放、深色模式、减少动态效果（流式光标停止闪烁）。
- 选项条：两个大点击区，点按有触觉反馈；自由输入收起在一个展开按钮后面，减少打字是产品目标，所以默认不弹键盘。

### 本地缓存

`expo-sqlite` 按 playthrough 缓存回合（id、seq、叙述、选项、状态），打开故事时先显示缓存，再用 `GET /turns?after_seq=` 增量同步。收到 `timeline.rolled_back` 或 `summary.updated` 就让相关缓存失效。缓存可以随时清空，不影响数据。故事需要服务端才能继续，所以不支持离线游玩，但支持离线阅读已缓存的内容。

### 页面

| 路由 | 页面 | 要点 |
| --- | --- | --- |
| `(auth)/login`、`register`、`verify`、`forgot` | 登录与注册、验证邮箱、找回密码 |  |
| `(tabs)/library` | 剧本 | 剧本仓库和角色卡仓库两个标签，进入详情；加号从角色卡新建剧本 |
| `(tabs)/workbench` | 工作台 | 一句话让 agent 写、导入角色卡、手动新建；没保存的草稿 |
| `workbench/[id]` | 草稿 | Agent / 手动随时切换；对话（问卷、方案、改动对比）或表单；预览、封面、保存进角色卡仓库（见 [workbench.md](workbench.md)） |
| `card/[id]` | 角色卡 | 在工作台里改、新建剧本、在用的剧本、版本历史、删除 |
| `scenario/[id]` | 剧本详情 | 剧本里的卡、剧本设置、按设置预填的开始表单 |
| `scenario/form` | 新建、编辑剧本 | 选一张或几张卡、剧本名、默认主角和偏好、用哪条开场白 |
| `(tabs)/playthroughs` | 继续游玩 | 最近的故事 |
| `play/[id]` | 阅读主屏 | 故事流、两个选项、自由输入、菜单（重新生成、回退、世界、时间线） |
| `play/[id]/world` | 世界 | 按类型分页浏览实体；角色私有的秘密默认隐藏 |
| `play/[id]/timeline` | 时间线 | 回合列表带一句话摘要，每一回合都可以作为回退的目标 |
| `play/[id]/outline` | 大纲 | 打开剧透开关才显示 |
| `settings/models` | 模型 | 配好的模型列表；添加模型时 Key、端点、模型名、窗口一次填完 |
| `settings/model/[id]` | 模型详情 | 测试、设为导演、用于后台整理、用于工作台、窗口上限（显示当前模型能否满足）与思考开关、更换 Key |
| `settings/tools` | 外部服务 | 网页搜索、读网页、生成封面的服务（工作台用） |
| `settings/personas` | 人设 | 人设库：玩家扮演的“我”，名字、描述、头像（[personas.md](personas.md)） |
| `settings/account` | 账户 | 导出数据、删除账户 |

**发布**：EAS Build 出包，EAS Update 推 JS 补丁；补丁与服务端的兼容性靠 `X-Client-Version` 加服务端的最低版本检查兜住（[backend.md 第 9 节](backend.md)）。
现在只配了出 Android APK 的 `preview`（`apps/mobile/eas.json`，步骤见 [apps/mobile/README.md](../apps/mobile/README.md)）：安装包不带默认服务器地址，
允许连 `http://` 的局域网服务器。EAS Update 和服务端的最低版本检查还没做。

## 2 客户端目录结构

```
apps/mobile/
├── app.config.ts  eas.json  package.json  tsconfig.json  babel.config.js  metro.config.js
├── app/                                # Expo Router：文件即路由
│   ├── _layout.tsx  index.tsx
│   ├── (auth)/  login.tsx  register.tsx  verify.tsx  forgot.tsx
│   ├── (tabs)/  _layout.tsx  library.tsx  workbench.tsx  playthroughs.tsx  settings.tsx
│   ├── workbench/[id].tsx  card/[id].tsx
│   ├── scenario/  [id]/index.tsx  form.tsx
│   ├── play/[id]/  index.tsx  world.tsx  timeline.tsx  outline.tsx
│   └── settings/  models.tsx  model/[id].tsx  tools.tsx  account.tsx
├── src/
│   ├── api/
│   │   ├── client.ts  sse.ts           # openapi-fetch 客户端；SseClient
│   │   ├── generated/                  # 来自 packages/api-contract，不手改
│   │   └── hooks/                      # TanStack Query 的 hooks
│   ├── features/
│   │   ├── play/  StoryFeed.tsx  StreamingParagraph.tsx  OptionsBar.tsx  ActionInput.tsx
│   │   │          turnMachine.ts  usePlaySession.ts
│   │   ├── library/  world/  timeline/  settings/
│   ├── state/  authStore.ts  uiStore.ts
│   ├── storage/  db.ts  secure.ts      # expo-sqlite 缓存；expo-secure-store
│   ├── components/  theme/  utils/
│   └── i18n/                       # 实际放在 packages/core/src/i18n/，两端共用（见 i18n.md）
├── e2e/                                # Maestro 流程
└── __tests__/
```

接口类型由后端导出的 OpenAPI 和 SSE 事件 schema 生成，生成流程见 [backend.md 第 9 节](backend.md)的“契约工具链”。

## 3 实现状态与偏差

已经实现：登录注册、工作台（agent 写卡、导入、手动编辑、草稿、封面）、剧本仓库和角色卡仓库、群像剧本、故事列表、阅读主屏（流式叙述、选项、自由输入、停止、重试、写结局、回到更早的一段、世界状态面板）、模型设置（导演模型、后台整理模型）、外观和语言、平板布局。
为了先把主线跑通，技术栈做了简化，页面和数据流按第 1 节设计，下面这些还没补齐：

| 设计 | 现在的做法 | 什么时候补 |
| --- | --- | --- |
| TanStack Query 管服务端数据 | `src/hooks/useAsync.ts`：进入或回到页面时取一次，可下拉刷新 | 页面变多、需要缓存与失效时 |
| Zustand 管登录态与回合状态 | 登录态在 `packages/core/src/auth/session.ts`（`SessionManager`，经 `useSyncExternalStore` 接入 React）；回合状态由 `PlaySession` 持有，`usePlaySession` 订阅 | 需要跨页面共享的界面状态时 |
| `openapi-fetch` 加生成的类型 | `packages/core/src/api/client.ts` 的 `ApiClient`（带令牌、401 时刷新一次再重试、problem+json 转 `ApiError`、超时）加手写的 `types.ts` 与 `endpoints.ts`。字段与 [api/](api/README.md) 里各领域的请求和响应模型一一对应，改接口时一起改 | 契约工具链接入时 |
| FlashList | `FlatList`：已完成的回合用 `memo` 固定，只有生成中的那一段重渲染 | 故事很长、出现卡顿时 |
| expo-sqlite 本地缓存 | 不缓存，打开故事时整条拉取（分页，每页 200 回合） | 故事长到打开变慢时 |
| Jest、RNTL、Maestro | 纯逻辑用 `node --test`（见下）；界面还没有自动化测试，靠真机验收 | M4 之前 |
| 触觉反馈 | 没有（需要 expo-haptics） | 之后 |

**回合状态机**在第 1 节的表格之外多了两点：加载失败是单独的 `load_failed` 状态（只能“重新加载”）；
提交没送达（网络错误重试用完）时保留行动和幂等键，“重试”用同一个键重发，服务端最多建一个回合；生成失败后的“重试”则用新键重新生成。
开局时的世界构建通过 `world.building` / `world.ready` 事件提示。导演在写之前先查更早的回合时收到 `director.recalling`，底部状态栏把“正在构思…”换成“正在回想前情…”，第一段叙述到了就恢复。事件流说结束了却没有可用的终止事件时，转轮询对齐结果，不会卡在“生成中”。

**SseClient** 在第 1 节之外：请求头可以是函数，每次连接前取最新的访问令牌；收到 401 先刷新令牌再立即重连，刷新失败就结束（`unauthorized`）。
流在事件中途结束时，按规范丢弃没写完的事件，`Last-Event-ID` 停在上一个完整事件。

**令牌**：访问令牌 15 分钟，提前一分钟刷新，多个请求同时需要刷新时只发一次；刷新被服务端拒绝就退出登录（路由守卫 `Stack.Protected` 随即切回登录页）。
令牌和自定义的服务器地址存在 expo-secure-store；模型的 API Key 不在设备上保存。

### 页面（实际的路由）

| 路由 | 页面 |
| --- | --- |
| `(auth)/login`、`(auth)/register` | 登录、注册；底部的服务器行打开服务器面板（最近用过的地址单选、输入新地址、测试连接），连不上时自动打开。注册要勾选“已满 18 岁并同意协议”（协议在网页端，用当前服务器的地址打开） |
| `(auth)/verify`、`(auth)/forgot` | 验证邮箱（服务器要求验证时，注册后、没验证就登录时来这里）、找回密码（先发验证码，再填验证码和新密码）；“重新发送”有 60 秒倒计时。规则见 [api/auth.md 的“邮箱验证”](api/auth.md#邮箱验证) |
| `(tabs)/playthroughs`、`(tabs)/library`、`(tabs)/settings` | 存档列表（界面上叫“存档”；每行方形封面 72，标题后面跟状态胶囊，右上角是更新时间，下面两行摘要；左滑或长按：重命名、删除）、剧本（剧本、角色卡、世界书三个标签，网格 / 列表；剧本长按或左滑：重命名、删除；角色卡长按：在工作台里改、新建剧本、删除；顶上提示一次“新建和导入挪到了工作台”；世界书每本一格，书名的第一个字压在网点底上，写着来源、条目数、常驻数、几个剧本在用，有不支持的设置时琥珀色小标，长按或左滑改名、删除，右上角是导入（系统的文件选择，只收 .json，导入过的问打开已有的还是另外导入一份）和新建（输入书名），见 [lorebook.md](lorebook.md) 第 9.2 节）、设置首页（导演模型卡片） |
| `(tabs)/workbench` | 工作台首页：一句话开始（示例）、导入角色卡（一次一张，导入过的问打开已有的还是另外导入）、手动新建；没保存的草稿（写明在等什么，长按删除）、最近保存的角色卡 |
| `workbench/[id]` | 草稿：顶上名字和保存状态、预览、更多（保存并开始新故事、删除草稿）；“Agent / 手动”切换和保存。Agent 模式是对话：问卷、方案、改动对比（全部采用 / 逐条看 / 都不要）、图片、进度清单和停止、接着写完；手动模式是表单（分节标签、自动保存、备选开场白、世界书）。预览是整屏面板：卡片（正在写的字段实时出字）、资料、图片；手动模式里是检查和开场的样子。封面面板：上传、生成、选图 |
| `lorebook/[id]` | 世界书详情：导航栏的“更多”是改名、删除；来源和时间、条目 / 常驻 / 停用三个数字格、简介（失焦保存）、导入报告（琥珀色提示）、挂着它的剧本（点了去剧本）；条目编辑和工作台里卡自带的世界书同一个 `BookEditor`（`features/workbench/BookEditor.tsx`：次要关键词和它怎么算，“更多设置”里优先级、概率、分组和权重、连着带几回合、冷却、从第几回合起、两个递归开关、整词匹配，其余从 SillyTavern 带来的设置原样保留），顶上是保存状态和按标题或关键词的搜索；改了 800 毫秒后自动保存整本，别处改过时换成最新的并提示（`features/lorebook/useLorebookForm.ts`）；最后是删除（挂着它的剧本会把它摘掉） |
| `card/[id]` | 角色卡：封面、来源、标签；在工作台里改、用这张卡新建剧本；描述、在用的剧本、参考资料、版本历史（恢复）、删除（有剧本在用时说明是哪几个）。导出只在网页端 |
| `scenario/form` | 新建（`?card=` 预选一张）和编辑（`?id=`）剧本：选卡（最多 8 张，可以调先后）、剧本名、默认主角和偏好（同开始表单）、开场（导演写或某张卡的某条开场白）、世界书（从仓库挂最多 4 本，可以调先后；也能当场导入一本并挂上，导入过的文件问“挂上已有的”还是另外导入一份）、闪电模式开关（说明只讲花费和效果，见 [agent-runtime.md 的“闪电模式”](agent-runtime.md#闪电模式)） |
| `scenario/[id]`（`scenario/[id]/index.tsx`） | 剧本详情：封面、剧本名（右边是“编辑设置”）、剧本里的卡（第一张是主角色，点一下看卡）、剧本设置（默认主角、偏好、开场、世界书）、简介；“开始新的故事”五步表单（名字建议、“这个角色是谁”输入框、篇幅、文风标签、不想看到的勾选清单），按剧本设置预填，拼回原来的字段；页面最底下是删除剧本 |
| `play/[id]` | 阅读主屏；选项接在最新一段后面，跟着正文滚动（这一段的选项补了两次也没补齐时，那里写一行“这一段没有给出选项，在下面写下你接下来要做的事”）；底部固定的操作栏左边是世界状态面板（标题下写截至第几回合，整理失败或跳过时有一条提示；人物与地点、关系图、事实，揭示秘密前确认。面板开着时，最新一段变了（写完新的一段、回退）就重新取；后台还没整理到最新一段时每 4 秒再取一次，整理到了就停，最新一段整理失败、要等下一回合再试时也停，`worldRefreshDelay()`；网页同样），右边是“更多”（阅读设置：宋体 / 黑体、字号；重命名、回到更早的一段、写结局、删除故事。“回到更早的一段”列出之前的每一段，点一段、确认后回退，之后的段落和世界状态的变化都撤销；生成中不能点，这个存档的回退次数用完时写明已用完。正文长按是选中复制，所以回退不用长按），中间是“自己写…”或生成中的状态和“停止”，往上翻时右端多出一个回到最新的下箭头按钮；导航栏只有返回和标题。闪电模式的存档（`PlayState.mode`）没有世界状态：操作栏左边空出同样大小的位置，“更多”里没有“世界”，平板上也不停靠 |
| `settings/models` | 模型列表（导演和后台模型那一行带标记）和添加模型：服务商图块（DeepSeek、OpenAI、Grok、Gemini、Hugging Face、自定义兼容端点，一行三块；圆标里是各家的标志，取自 Lobe Icons，形状数据在 `@bettertavern/design/providerLogos`，可以带线性渐变（Gemini 的彩色四角星），自定义端点写 { }）→ Key（每次都新填，可粘贴；不列出已配置过的 Key）→ 端点（使用官方地址）→ 模型列表（Key 和端点填好后自动获取，也可以手动重新获取）、搜索兼手动输入 → 上下文窗口（只有服务商列表和内置资料都不知道时才让填，不知道就按 32K 估计）→ 备注名、是否设为导演 → 保存。一个 Key 配几个模型时每个模型一行 |
| `settings/model/[id]` | 模型详情：服务商、Key、模型名、端点；测试这个模型（结果存在模型上）、设为导演；“能记住多少”格子图，标出窗口的来源（服务商提供、内置资料、你填的、按服务商报错纠正、估计值），估计值和手填的可以改；工作窗口上限、深度思考；“用于后台整理”“用于工作台”开关（点了立刻保存；模型不能调用工具时打不开，并说明原因）；编辑备注名、模型名和端点；更换 Key（别的模型也用这个 Key 时可以一起换）；取消导演；删除 |
| `settings/tools` | 外部服务：网页搜索、读网页、生成封面三种，每种可以配几个、一个默认；测试、设为默认、换 Key、删除；添加用底部面板，加好就测一次 |
| `settings/personas`、`settings/persona/[id]` | 人设库（设置首页“配置”里第二行进来）：一行一个人设（头像、名字、默认、描述的开头），顶上是新建、导入 SillyTavern 的人设备份；编辑页是头像（选图后服务端裁成正方形）、名字、描述、设为默认、保存、删除（`id` 为 `new` 是新建）。宽屏设置两栏时嵌在右栏里。开新故事和剧本设置的第 1 步“你扮演谁”从这里选（[personas.md](personas.md) 第 3 节）；阅读页书名页“我是 林川”前面放开局时那个人设的头像 |
| `settings/account` | 退出登录；删除账户（展开后列出会删掉的故事、剧本、模型数，输入密码确认） |
| 设置首页的“语言” | 选择面板（手机是底部面板，平板是对话框）：跟随系统（下面注明系统语言）、中文、English、日本語；每种语言用它自己的文字写 |
| `dev/probe` | 连接测试（M0 的 SSE 探针），登录前后都能打开；时长分段、延迟走势、报告 |

界面按漫画风的设计稿实现（[design/comic/mobile/](design/comic/mobile/README.md)、平板横屏 [design/comic/tablet/](design/comic/tablet/README.md)，和网页端同一套：墨黑粗描边、硬投影、网点）。
页面结构、交互仍按第一版（[design/ui/](design/ui/README.md) 的“白 / 柔线 / 大圆角”，2026-10-25 换成漫画风时只换了风格）。
颜色在 `packages/design/src/comic.ts`（`useComic()` 取当前主题那一套），描边、圆角、硬投影的层数也在那里；字号在 `src/theme/comicType.ts`；
按下时往投影的方向挪、投影缩短（`components/press.ts`），不缩放。
界面文字有中文、英文和日文，在“设置 → 语言”里选：跟随系统（系统语言是中文时用中文，是日文时用日文，其他用英文）、中文、English、日本語，存在设备上，选了立刻生效；
开局时把当前的界面语言传给服务端，决定这一局的提示词用哪种语言（[i18n.md](i18n.md)）。外观在“设置 → 外观”里选：跟随系统、浅色、夜间（夜间就是深色色板），存在设备上，选了立刻生效；固定主题时用 `Appearance.setColorScheme` 覆盖系统深浅，键盘和状态栏跟着 App 走。加主题要在 `packages/design/src/themes.ts` 的主题表里加一项，并在 `comic.ts` 里配一套漫画颜色；主题只换颜色，描边、圆角、字号、间距是固定的。
标签栏（`components/tabBar.tsx`）是浮在内容上的胶囊：白底、2.5 墨线、圆角 32、墨色硬投影 4，按安全区摆放，列表底部按它的高度留白（`useTabBarSpace()`）；
四块是存档、库、工作台、设置，选中的一块图标主体填蓝（`FilledIcon`）、字变墨色加粗，没有选中框，不用液态玻璃。
宽屏左侧是 6 块的侧栏（存档、剧本、角色、工作台、模型、设置，上下居中，没有 Logo），按 `components/navItems.ts` 的表画：
“剧本”“角色”都是库页（`tab=cards` 和 `tab=lorebooks` 算角色，角色页顶上是“角色卡 / 世界书”切换），“模型”“设置”都是设置页（`section=models` 算模型），点同一个页面的另一块时带着新参数再导航。和设计稿不同：
阅读页的选项不再放在固定于底部的行动面板里（它在手机上长期盖住小半屏正文），而是接在故事流末尾（`TurnActions.tsx`），跟着正文滚动；
底部只留一条贴边的操作栏（`BottomBar.tsx`，iPhone 上连同安全区约 80pt，故事流的底部按它的高度留白）：左边世界状态，右边“更多”，
中间按状态换成“自己写…”（点了原地展开成输入框，跟着键盘浮起）、生成中的状态和“停止”、同步中的提示；
往上翻离开最新位置时，中间这一格右端滑出一个下箭头图标按钮（和世界、更多一样，生成中带蓝点），“自己写…”跟着变窄，点它回到最新。
生成状态只在操作栏里显示，正文里不重复。“我的行动”不画成卡片，和叙述用同样的字、同样的墨色，左边一道 3 的蓝线，读起来是故事的一部分。
**写结局**（设计稿里没有）：“更多”里的一项，只在能行动时可点（开场写完、没在生成、没有失败等着重试）。点了弹出确认框，说明写完就结束、不能撤销，
带一个可以不填的“结局方向”输入框（`overlay.prompt` 的 `optional`）。确认后提交 `ending` 行动，故事流里“我的行动”那一行是“写结局”或“写结局：方向”，
导演接着写一大段；写完后最后一段下面居中一行“— END —”，没有选项，操作栏中间换成旗子和灰字“故事已完结”，“更多”里不再有写结局；
故事列表里这个故事显示“已完结”（`storyStatus()`）。改名、看世界状态、删除照常可以。没做的：世界状态的“新”标记和按钮上的变化提示（服务端还没有世界状态的变更记录）、导入进度条（上传没有进度事件，用来回扫动的线代替）、改昵称（没有接口）、存档和剧本上的“闪电”标记（网页端有）。

没有单独的世界页（世界状态在阅读页的面板里看）；时间线页还没做；大纲只给导演看，不做页面。

**平板**的布局按 [design/ui/tablet/](design/ui/tablet/README.md) 实现，横屏的样子按 [design/comic/tablet/](design/comic/tablet/README.md)：同一套代码做响应式，视觉规则不变，只换布局；手机上的布局和行为不变。
平板竖屏（600–899）没有单独的稿子，用手机的样式套中屏的布局。

- 方向：`app.config.ts` 打开 `ios.supportsTablet`，`orientation` 不锁（iPad 要参与分屏和台前调度，必须支持所有方向；
  Expo 会把 `UISupportedInterfaceOrientations~ipad` 填成四个方向）。iPhone 用 `ios.infoPlist` 只给竖屏，
  启动时再按屏幕短边（< 600 是手机）用 `expo-screen-orientation` 锁竖屏，管住 Android 手机和 Expo Go（`src/utils/orientation.ts`）。
  所有 `Modal` 都要声明支持全部方向，否则 iPad 横着打开面板会被转回竖屏（`MODAL_ORIENTATIONS`）。
- 断点只看窗口宽度（`useWindowDimensions().width`，见 `packages/design/src/layout.ts` 和 `src/hooks/useLayout.ts`），不判断设备型号或横竖屏：
  < 600 是手机布局；600–899 内容收进居中单栏（≤ 640），Tab 栏仍在底部、宽 392 居中；≥ 900 左侧浮动导航栏，设置和剧本详情两栏；
  阅读页 ≥ 1100 时世界状态停靠在右侧。旋转、分屏拖动时只换布局，页面不卸载，草稿、滚动位置、打开的故事都保留。
- 浮层（`components/sheet.tsx`）：底部面板在平板上换成居中对话框（≤ 480）；阅读页“更多”贴着按钮弹出；世界状态从右侧滑出；
  故事、剧本卡片长按时卡片抬起、下方弹出菜单（`useOverlay().menu` 的 `anchor`）；提示浮条宽 ≤ 480。
- 浮层的先后（`components/gatedModal.ts`、`modalGate.ts`）：自己带 `<Modal>` 的组件（`Sheet`、非 inline 的 `Dialog`、平板的卡片菜单）
  都写在页面层级，iOS 上都由根视图控制器 present，而它同一时间只能 present 一个；上一个还没被 iOS 收回就 present 下一个，
  iOS 会拒绝，界面停在点不动的状态。所以这几个组件都经 `useGatedModal` 决定 `<Modal>` 什么时候挂上、拿掉：
  - 打开：没有正在收回的 `<Modal>` 才挂上，有就等；
  - 关闭：先登记“正在收回”，播完收起动画后把 `visible` 设为 `false`，收到 `onDismiss`（iOS 确认已经收回）才拿掉、撤销登记；
  - 有面板开着时 `useOverlay()` 的对话框画在面板的 `<Modal>` 里（inline），不另挂一层，也就不用等。
  例如“更多”里点“写结局”：对话框等“更多”面板被收回才出现；“更多”切到“世界状态”也一样，不再固定等一段时间。
  `<Modal>` 还没被 present 就关掉时 iOS 不会发 `onDismiss`，登记带 1 秒的保底超时，到点当作已收回，记 `modal.dismiss_timeout`。
  Android 没有这个限制，`<Modal>` 也没有 `onDismiss`，不排队。
- 阅读页：正文和末尾的选项最宽 640 居中，宽屏选项两列；底部操作栏的内容宽 672、同一条中线；停靠的开关存在界面偏好里（`worldDocked`）。
- 存档列表网格 1 / 2 / 3 列，最近一个存档放大成主卡（方形封面撑满卡片高度，没有“继续读”按钮）；剧本网格宽屏按 240 一列（≤ 5 列），列表视图限宽 640。
- 设置宽屏两栏：设置子页的主体在 `features/settings/screens/`（连接测试在 `features/probe/ProbeBody.tsx`），
  既是路由页面，也嵌进右栏（`SettingsPane.tsx`）；跳转经 `useSettingsNav()`，右栏里换成自己的小栈。
  右栏是详情区：2.5 墨线、圆角 16，底色是详情区的灰，里面的格子是白的；`RaisedSurface` 把这一片的页面底色换成详情区的灰，页面主体不用改。
- 登录、注册宽屏左右分栏（`components/AuthLayout.tsx`）：左边一格是网页登录页那张没有字的桌面（`AuthDesk.tsx`、`AuthDeskSheets.tsx`，
  形状由 `packages/design` 的 `desk.ts` 生成，注册页是“刚开始”的样子），Logo 和名字在右边表单的顶上；中屏表单宽 440 居中。

### 目录（实际）

手机端和网页端共用的纯 TypeScript 放在 `packages/`（npm 工作区，仓库根目录的 `package.json` 登记）。包里只有逻辑和数据：
不 import React、React Native、Expo 或浏览器专属的接口，用到的平台能力（令牌存储、`fetch`、当前时间）由调用方传进来。
导入写成 `@bettertavern/core/api/client`：包的 `exports` 把 `./*` 指到 `src/*.ts`，直接用源码、不预先编译，Metro、Vite 和
`node --experimental-strip-types` 都能读。所以包里只能用“去掉类型就是 JavaScript”的写法（不用 enum、namespace），
类型导入写 `import type`（`tsconfig.base.json` 的 `erasableSyntaxOnly`、`verbatimModuleSyntax` 会检查）。

```
packages/
├── core/src/                  # @bettertavern/core
│   ├── api/      client.ts  endpoints.ts  types.ts  events.ts  turnStream.ts  sse/（SseParser、SseClient）
│   ├── i18n/     index.ts  zh/  en/  ja/   # 界面文字：共用的 i18next 实例、按领域分文件的中、英、日资源（docs/i18n.md）
│   ├── auth/     session.ts                # SessionManager：令牌、单飞刷新
│   ├── play/     turnMachine.ts  playSession.ts  reading.ts  worldGraph.ts  testing.ts（测试用的回合样本）
│   ├── scenario/ startForm.ts              # 开始新故事的内置选项与拼接
│   │             cardEdit.ts               # 编辑角色卡：草稿、上限（同服务端）、保存前检查、世界书条目移动、关键词拆分（正则里的逗号不拆）
│   │             lorebook.ts               # 世界书：条目的“更多设置”、小标、永远用不到的条目、检查、导入报告、剧本里的一行
│   ├── settings/ labels.ts  window.ts      # 模型状态、窗口来源的说明（调用时按界面语言取）；“能记住多少”的格子
│   ├── probe/    probeSession.ts           # 连接测试
│   ├── observability/ log.ts  requests.ts  # 诊断日志：脱敏、请求记录
│   └── utils/    format.ts  ids.ts
└── design/src/                # @bettertavern/design
    ├── palettes.ts  themes.ts              # 色板（浅色、深色）与主题表（浅色、夜间）
    ├── comic.ts                            # 漫画风的颜色（按主题）、描边、圆角、硬投影、网点
    ├── tokens.ts                           # 间距、手机端的控件尺寸（不随主题变）
    ├── portrait.ts  desk.ts                # 人物位取字和底；登录页桌面的形状（两端共用）
    ├── layout.ts                           # 平板断点、栏宽、列数和浮层形态
    └── icons.ts  cover.ts  logo.ts         # 图标路径、几何封面的图形、标志的几何：只有数据，两端各自画

apps/mobile/
├── app/                       # 路由，见上表；_layout.tsx 里按登录状态切换可访问的页面
└── src/
    ├── config.ts                           # 版本号、默认服务器地址
    ├── state/    AppProvider.tsx           # 组装 ApiClient、会话、事件流连接；useApp()
    │             PrefsProvider.tsx         # 设备上的界面偏好：最近用过的服务器、阅读设置、剧本库视图、外观、界面语言
    │             language.ts               # 按设置和系统语言（expo-localization）切换界面语言
    ├── storage/  secure.ts                 # expo-secure-store（令牌、服务器地址、界面偏好）
    ├── features/
    │   ├── play/     usePlaySession.ts  StoryFeed.tsx  FeedParts.tsx  TurnActions.tsx  BottomBar.tsx
    │   │             ActionParts.tsx  WorldSheet.tsx  WorldParts.tsx  MoreSheet.tsx  RollbackSheet.tsx
    │   ├── stories/  StoryCards.tsx                   # 平板的存档卡片（网格小卡、主卡）
    │   ├── library/  LibraryParts.tsx  cardActions.ts # 三个仓库的卡片、列表行、空状态；角色卡的操作
    │   │             lorebookActions.ts               # 世界书的导入、新建、改名、删除
    │   ├── lorebook/ useLorebookForm.ts               # 世界书详情里条目的自动保存
    │   ├── scenario/ StartForm.tsx                    # 开始新故事的表单（剧本设置也用它）
    │   ├── workbench/ useDraftSession.ts  useCardForm.ts  useCardImport.ts  assets.tsx  # 草稿的状态、自动保存、导入、图片
    │   │             AgentPane.tsx  Messages.tsx  QuestionsCard.tsx  PlanCard.tsx  ChangesCard.tsx  chatStyles.ts
    │   │             ManualPane.tsx  BookEditor.tsx  PreviewSheet.tsx  CoverSheet.tsx
    │   ├── settings/ servers.ts  AddModelForm.tsx  ModelPicker.tsx  ModelSheets.tsx
    │   │             MemoryBlocks.tsx  ProbeResults.tsx  AppearanceSheet.tsx  LanguageSheet.tsx  nav.tsx  SettingsPane.tsx
    │   │             screens/（模型列表、模型详情、外部服务、人设、账户的页面主体）
    │   └── probe/    DiagnosticsCard.tsx  ProbeBody.tsx   # 连接测试；诊断日志的导出和清空
    ├── components/ ui.tsx（门面）primitives  buttons  rows  feedback  controls  bars  tabBar  sheet  menu  overlay  dialog  icons
    │               press.ts（按下的效果）navItems.ts（Tab 栏和侧栏的表）
    │               Cover.tsx（图片或几何封面）Portrait.tsx  Halftone.tsx  SwipeRow.tsx  KeyParts.tsx  Logo.tsx  ServerSetting.tsx
    │               AuthLayout.tsx  AuthDesk.tsx  AuthDeskSheets.tsx
    ├── hooks/      useAsync.ts  useKeyboardLift.ts  useLayout.ts
    ├── observability/ persist.ts  setup.ts  # 诊断日志存文件、启动时安装
    ├── theme/      index.ts  fonts.ts      # 设计 token 的出口：主题表、漫画颜色和 tokens；字体族和按语言选正文宋体（fonts.ts）
    │               comicType.ts            # 字号
    │               ThemeProvider.tsx       # useComic()、useIsDark()、RaisedSurface
    └── utils/      orientation.ts
```

`*.test.ts` 与被测文件放在一起，在仓库根目录 `npm test`（各工作区的 `node --test`）运行。`packages/core`：两种语言的资源一一对应、语言的解析、SSE 解析与重连、回合状态机、
`PlaySession`（加载、幂等重试、409 的处理、续传、轮询）、`SessionManager`、`ApiClient`、诊断日志，以及开始表单的拼接、窗口格子、
关系图布局、阅读字号、数字格式；`packages/design`：平板断点与栏宽、主题、漫画颜色、图标、几何封面、人物位、登录页桌面的形状；
`apps/mobile`：最近用过的服务器、Tab 栏和侧栏的选中、浮层的先后、正文宋体的选择。

**字体**：界面用系统黑体，不打包；等宽字用 `@expo-google-fonts/ibm-plex-mono`；叙述用思源宋体的子集，中文、日文各一份（OFL 许可）：
简体中文版的 GB2312 子集（`assets/fonts/NotoSerifSC-Regular.ttf`，约 3.2 MB）和日文版的 JIS X 0208 子集（`assets/fonts/NotoSerifJP-Regular.ttf`，约 3.3 MB）。
正文按这一局的语言选（`theme/fonts.ts` 的 `serifFor()`，日文的局用日文子集，其他用中文子集），不按界面语言；剧本详情页的原始开场白（角色卡原文）用系统字体。
子集的字符表由 `scripts/font-subset-chars.py` 生成（`--set jis` 是日文），再用 fonttools 的 `pyftsubset` 从完整字体裁出；字符集以外的生僻字退回系统字体显示。详见 [i18n.md](i18n.md) 第 3 节“字体”。

## 4 网页端（`apps/web`）

电脑浏览器里的客户端。窗口 ≥ 900 时是漫画分镜版（[design/comic/](design/comic/README.md)）：墨黑粗描边、硬投影、网点、宋体粗标题，
没有顶栏和侧栏，导航收进一只可以拖动的轮盘；一级页用“漫画格子”排，一页排满、翻页。更窄时沿用平板中屏和手机的布局（底部胶囊 Tab 栏），
样子换成同一套粗线变量。最早按 [design/ui/web/](design/ui/web/README.md) 的设计稿做；设计稿只管外观和交互，文案、状态和错误提示以 App 现有代码为准。

### 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 构建 | Vite + TypeScript（strict） | 开发和预览服务器把 `/v1`、`/health`、`/ready` 转给后端（默认 `http://localhost:8000`，`BT_API_URL` 可以改） |
| 界面 | React 19，浏览器的 DOM 和 CSS | 不用 react-native-web：链接、表单自动填充、`:focus-visible`、悬停、右键菜单、拖放、选中复制都是浏览器原生的 |
| 路由 | react-router 7 | `/login`、`/register`、`/verify`、`/forgot`、`/terms`、`/privacy`、`/rules`、`/playthroughs`、`/scenarios`、`/characters`、`/scenario/:id`、`/scenario/:id/edit`、`/card/:id`、`/workbench`、`/workbench/d/:id`、`/play/:id`、`/models`、`/models/:id`、`/settings`、`/settings/tools`、`/settings/personas`、`/dev/probe`。和 App 不再一一对应：剧本和角色分开，模型从设置里拿出来，外部服务是设置的子页面；旧地址 `/library`、`/tools`、`/settings/models`、`/settings/model/:id`、`/settings/account` 跳到新地址 |
| 服务端数据 | TanStack Query | 没有下拉刷新：回到标签页、窗口回到前台时自动刷新 |
| 样式 | CSS Modules + CSS 变量 | 变量名同 `docs/design/ui/web/tokens.css`，加上漫画版的描边、硬投影（`--x*` 墨色、`--b*` 蓝色）、三种网点底和圆角（`theme/tokens.css`）；色板由 `ThemeProvider` 从 `@bettertavern/design` 写到 `<html>` 上，夜间模式墨和纸对调、蓝用 `#8597FF`；页面底色是网页端单独的 `--page`（很浅的灰 `#F8F8F5`，夜间 `#0B0B0D`），白格子放在上面分得开，色板里 App 共用的 `--bg` 不动 |
| 字体 | 自己托管 | 标题的思源宋体 900、标签和键帽的 IBM Plex Mono 500 / 700（`@fontsource`，按 unicode-range 切片，`theme/fonts.ts`）；正文的宋体和黑体用系统字体 |
| 共用 | `@bettertavern/core`、`@bettertavern/design` | 接口客户端、SSE、会话、回合状态机、色板、布局函数、图标和封面的数据，和 App 是同一份代码（见第 3 节的“目录”） |

### 登录：Cookie 模式

网页的刷新令牌放在 HttpOnly Cookie 里，页面脚本读不到，访问令牌只在内存中（[api/auth.md 的“两种登录方式”](api/auth.md#两种登录方式)）：

- 登录、注册的请求带 `X-Auth-Mode: cookie`，服务端把刷新令牌写进 Cookie `bt_refresh`（`Path=/v1/auth`、`SameSite=Strict`），响应体里的 `refresh_token` 是 `null`。
- 打开页面时凭 Cookie 刷新一次，拿到访问令牌和账户就是已登录；没有 Cookie 或被拒就去登录页（登录后回到原来要去的地址）。
  `SessionManager` 和 App 是同一个，网页传给它的“存储”就是这次刷新，刷新令牌是 `null`。
- 访问令牌快过期时照常刷新，浏览器自动带上 Cookie；几个标签页各自刷新，Cookie 是共用的。
- 退出时先请服务端吊销并删掉 Cookie，再本地退出：服务端没收到时 Cookie 还在，刷新页面会重新登录上。
- 网页和接口必须同源（开发时 Vite 转发，部署时反向代理），所以网页不能像 App 那样只换服务器地址。
  自己部署的网页上，登录、注册页底部的服务器行写着现在的网站，点“更改”是**跳到另一台服务器自己的网页**（`pages/auth/ServerSwitch.tsx`；
  官方网站 bettertavern.com 上不显示，用官方服务的人用不着）：
  对话框里列出官方服务（不在官方时）和最近打开过的地址（这个网站的 localStorage `bt.servers`，最多 5 个），也能输入新地址；
  地址只认 http、https，不带账号密码，路径丢掉（网页只能部署在根路径）；“打开”跳到那边的 `/login`。
  地址只能自己填，不从链接参数带进来，免得被做成钓鱼链接。https 的官方页面请求不了局域网的 http 地址，所以跳之前不检查那边是不是 BetterTavern。

### 页面

| 地址 | 页面 |
| --- | --- |
| `/login`、`/register` | 登录、注册（W01、W02）：真正的 `<form>` 和 `autocomplete`，打开时焦点在邮箱，Enter 提交。注册要勾选“已满 18 岁并同意协议”。版式见下面的“登录页” |
| `/verify`、`/forgot` | 验证邮箱、找回密码，同 App 的 `(auth)/verify`、`(auth)/forgot`；验证码是 6 个格子，底下是一个 `autocomplete="one-time-code"` 的真输入框 |
| `/terms`、`/privacy`、`/rules` | 用户协议、隐私政策、内容规则：登录前后都能打开（App 在浏览器里打开这三个地址）。正文是 `pages/legal/content/<语言>/*.md`，按界面语言按需加载，用页面里的极简 Markdown 渲染（标题、段落、列表、粗体、链接）；三种语言一一对应，改一份就改另外两份 |
| `/playthroughs` | 存档（漫画稿 01）：最近玩的那个占左上的大格（剧本名、最近一段的摘录、“继续”、回合数、主角色的人物位），正在写的存档是墨底格，“新的故事 ＋”一格（键 N，去剧本页挑一个），其余是白格；闪电模式的存档在大格和宽格上标“闪电”；一页六个，之后每页九个，翻页 |
| `/scenarios`、`/characters` | 剧本、角色两个一级页（`pages/library/`，漫画稿 04、05）。剧本：页头是搜索、题材筛选（取剧本里几张卡的标签）、导入；最近添加的占左边一整列（大封面、题材、卡数和存档数、简介、主角色、默认主角，“开局”和“看设定”，Enter 开局：有默认主角时直接开一局），其余是宽格和窄格，“新建剧本 ＋”一格；闪电模式的剧本在题材前面标“闪电”。角色：4 × 2 张卡，人物位（头像或名字里的一个大字压在网点底上）、名牌、简介、题材和世界书数；指着的卡出现“用这张开局”（用它新建剧本）；页头有“角色卡 / 世界书”切换 |
| `/lorebooks` | 世界书（“角色”一级页的另一段，[lorebook.md](lorebook.md) 第 9.1 节）：排法同角色卡，每本一格（书名的第一个字压在网点底上、书名牌、简介或来源、条目数和常驻数、几个剧本在用，有不支持的设置时琥珀色小标），右键改名、删除；页头是切换、搜索、新建（输入书名）、导入（选 .json）；在这一页把文件拖进窗口导入的是世界书 |
| `/lorebook/:id` | 世界书详情：≥ 900 两栏各自滚动，左栏是书名和改名、来源、三个数字格、简介（失焦保存）、导入报告、挂着它的剧本、删除；右栏是条目编辑（和工作台的世界书同一个 `BookEditor`：次要关键词和逻辑，“更多设置”里优先级、概率、分组、粘滞冷却延迟、递归开关、整词匹配），顶上保存状态和搜索；改了 800 毫秒后自动保存整本，别处改过时换成最新的。更窄单栏，删除在最后 |
| `/workbench` | 工作台首页（漫画稿 06）：一句话开始（气泡形状的输入框和三条示例）、导入（墨底一格，按钮和拖放，一次一张）、手动新建；下面是草稿（正在写时是五步进度）和最近保存的角色卡；页头“草稿 N”列出全部草稿 |
| `/workbench/d/:id` | 草稿（设计稿 W02–W06）：顶上一条（返回、名字和保存状态、Agent / 手动、进度、保存、保存并开始新故事）；下面两栏，Agent 模式左边对话、右边卡片预览（卡片、资料、图片），手动模式左边分节目录和表单、右边检查。窄于 1100 只有左栏，预览从页头打开 |
| `/card/:id` | 角色卡：在工作台里改、新建剧本、导出 PNG / JSON、在用的剧本、参考资料、版本历史、删除 |
| `/scenario/:id` | 剧本详情（W05）：≥ 900 两栏各自滚动，左栏是剧本里的卡和剧本设置（主角、偏好、开场、世界书），右栏是按设置预填的开始新故事五步，底部浮着摘要栏；更窄单栏。剧本名右边是“编辑设置” |
| `/scenario/new`、`/scenario/:id/edit` | 新建（`?card=` 预选）和编辑剧本：选卡（最多 8 张）、剧本名、默认主角和偏好、开场、世界书（从仓库挂最多 4 本，可调先后，也能当场导入一本挂上）、闪电模式开关（同 App） |
| `/play/:id` | 阅读页（漫画稿 09）：页头一行（回合数、存档名、剧本名和主角，“世界 W”“回想 L”“更多”），往下读时贴在顶上；左栏回想（最近几段，L 看全部），中间是故事正文（直接写在页面上，没有任何边框；回合之间不画线、也不多空，和段与段之间一样；每回合上面是玩家这一回合的行动，下面是叙述；都从左往右排、同样的正文字体，行动只在左边多一道蓝色竖线；叙述是连着读的正文，段与段之间空一点，不一段一个框），右栏这一话的人物和刚记下的（取自世界状态）；分镜后面是选项卡（A–D）和虚线框的“自己写”（/），生成中换成状态和“停止”；最底下一条提示条写能按的键。世界状态从右侧滑出，更多里有阅读设置、重命名、写结局、删除。鼠标移到更早的一格上，右上角出现“回到这里”，确认后回退。闪电模式的存档不取世界状态，没有“世界 W”、右栏和世界状态面板，提示条里也不写 W |
| `/models`、`/models/:id` | 模型（漫画稿 07）：“分工”三行（导演、后台整理、工作台各用哪个模型，下拉框直接换）、官方模型的点数（蓝网点一格）、我的模型列表（状态点、用途标签、服务商、Key 尾号、工作窗口、测试结果；点一行在窗口正中的对话框里打开详情）、添加模型三步（对话框）；页头是连接测试 |
| `/settings` | 设置（漫画稿 08）：账户（头像、昵称、邮箱、注册时间、存档 / 剧本 / 模型数量，修改密码、退出登录、删除账户，三份条款）、外观（带预览）、语言、阅读（字号、字体）、键盘快捷键（含单键开关）、外部服务三项的状态、连接测试，各占一格 |
| `/settings/tools` | 外部服务（设置的子页面）：网页搜索、读网页、生成封面三栏并排，每栏是配好的服务，添加用对话框 |
| `/settings/personas` | 人设（设置的子页面，设置页第四行那一格也进这里）：左边一列人设，右边编辑选中的（`?id=`，`?id=new` 是新建）：头像、名字、描述、设为默认、删除；顶上能导入 SillyTavern 的人设备份。开新故事和剧本设置的第 1 步“你扮演谁”从这里选；阅读页页头和存档列表里“我是 林川”前面放开局时那个人设的头像（[personas.md](personas.md)） |

和 App 不同的只是布局和输入方式：文案、状态、错误提示、接口调用都照 App 的页面写，纯逻辑直接用 `@bettertavern/core`。

### 布局

- 断点只看窗口宽度：`src/theme/layout.ts`（设计稿的 `layout.ts`，平板的函数从 `@bettertavern/design/layout` 引入）。
  拖动窗口时布局即时切换，页面不卸载：草稿、滚动位置、打开着的世界面板都不丢。
- 外壳 `src/shell/`：窗口 ≥ 900 时导航是轮盘（`NavWheel.tsx`，几何和规则的纯函数在 `theme/wheel.ts`）。收起是 72 的白圆，默认贴着左边、上下居中；
  鼠标停 120ms 展开成整圈，六块从正上方顺时针是存档、剧本、角色、工作台、模型、设置，当前页那块墨底，指着的那块蓝网点、往外弹出，旁边有说明气泡和数量；
  靠边时圆心先挪到离每条边至少 204 的地方，挪完等鼠标动一下才高亮；选哪块只看方向（离圆心超过内半径以后）。
  离开圆盘 0.3 秒收起（圆盘缩回去、淡出），Esc、点别处、换页立刻收起。在圆上或展开的圆盘上长按 0.4 秒拿起来拖，松手时离左右边 40 以内贴边；位置按窗口比例存在浏览器里（偏好的 `wheel`）。
  键盘：Q 打开或收起，展开时 1–6 直达、方向键转、Enter 进去；触屏点一下展开。按钮是 `aria-haspopup="menu"`，六块是 `menu` / `menuitem`。
  页面左右留边写成 CSS 变量 `--page-left`、`--page-right`：轮盘贴着的一边 112，另一边 40，没贴边时两边 40。
  更窄是底部 Tab 栏：存档、剧本、角色、工作台和“更多”（账户小窗 `AccountMenu.tsx`：模型、外部服务、设置、修改密码、退出登录、删除账户和三份条款），
  只在一级页上，进了阅读页、剧本详情、草稿就收起。
  站内跳转进新页面从顶上开始，前进、后退回到原来的位置（`ScrollRestoration`）。
- 一级页的“漫画格子”（`components/ComicGrid.tsx`）：6 列 × 3 行，间距 14，三行分掉窗口高度（每行至少 200）；每一页放哪几项、每一项占哪几格由
  `theme/grid.ts` 的纯函数决定（存档、剧本第一页不满时换一套排法，不留空洞；角色是 4 × 2）。翻页在底下，← → 也能翻。
  不翻页的页面（工作台、模型、设置）格子放不下时这一行跟着长高。窄于 900 时变成一列。
- 漫画版的部件在 `components/comic.tsx`：格子（五种底、“热”的大投影）、对话气泡、旁白框、键帽、人物位（`@bettertavern/design` 的 `portrait.ts` 决定取名字里的哪个字、用哪种底，手机端也用它）、底部提示条；
  共用控件（`controls.tsx`）换成粗线样式，接口不变。
- 阅读页：世界状态一律从右侧滑出（手机宽度是底部面板，`worldMode()`）。页面整体滚动（浏览器的查找、滚动条都是原生的），停在底部时跟着新文字滚，
  往上翻就停下，右下角出现“回到最新”。窄于 1200 收起右栏，窄于 900 只剩分镜一栏。
  已完成的回合用 `content-visibility: auto`，很长的故事也只排版看得见的部分。
- 模型详情面板、添加模型的对话框、连接测试页是容器（`container: pane / inline-size`），宽于 720 时分两栏。
- 深色模式：`index.html` 里的一小段脚本在页面脚本加载前按外观设置设好 `data-scheme`，深色下打开不闪白。

### 鼠标、键盘与浮层

- 悬停只在 `(hover: hover) and (pointer: fine)` 下生效；键盘焦点是 2px 蓝环（`:focus-visible`）；按下缩到 0.98。都写在共用控件的样式里。
- 格子、列表的一行都是 `<a href>`，⌘ / Ctrl + 点击、中键在新标签页打开。
  存档格悬停时出现“…”，右键（或 Shift + F10）打开同一个菜单：在新标签页打开、重命名、删除。正文和输入框保留浏览器自己的右键菜单。
- 浮层在 `src/overlay/`：确认、输入、外观、快捷键、世界状态的滑出都用浏览器的 `<dialog>`（焦点进出、Esc、点遮罩关闭，删除类默认焦点在“取消”）；
  菜单按 `contextMenuFrame` 定位，↑↓ 移动；“更多”贴着按钮弹出（`popoverFrame`）；提示浮条在内容区底部居中，4 秒，鼠标停留时不消失；
  提示（tooltip）给图标按钮，悬停 500ms 或键盘焦点到达时出现，有快捷键时带键帽。
- 快捷键：A–D 选选项、/ 自己写、W 世界状态、L 回想、End 回到最新（阅读页），N 新的故事（存档页），Enter 开局（剧本页），← → 翻页，
  Q 打开或收起轮盘、展开时 1–6 直达、? 快捷键一览（任何地方）。
  单键快捷键在输入、输入法组字、按着修饰键、对话框开着时不响应，可以在快捷键一览或设置页里关掉（存在浏览器里）。
  输入框里 Enter 发送、Shift + Enter 换行，组字时的 Enter 不发送（`isComposing`，Safari 还要看 `keyCode === 229`）。
- 拖放导入：文件拖进窗口时任何页面都接收，内容区盖上“松开就导入”；一次一张，解析完进草稿的手动表单；导入过的问打开已有的还是另外导入，失败的写在红色提示里。
- 草稿每个故事一份存在浏览器里（`bt.draft.<故事 ID>`）；诊断日志存最近 500 条（`bt.diagnostics`），连接测试页可以导出、清空。
- 标签页标题“页面名 · BetterTavern”，阅读页生成中在前面加“● ”。

### 目录

```
apps/web/
├── index.html  vite.config.ts  playwright.config.ts  public/favicon.svg
├── e2e/                         # Playwright 端到端测试（中文的完整流程、英文界面的冒烟测试）和测试用的角色卡
└── src/
    ├── main.tsx                 # 诊断日志 → 界面语言 → 数据缓存 → 界面偏好 → 主题 → 登录状态 → 路由
    ├── app/       router.tsx  guards.tsx        # 路由表（阅读页、剧本详情、角色卡、工作台、设置按需加载）；没登录去登录页、登录了不停在登录页
    ├── state/     AppProvider.tsx  PrefsProvider.tsx  prefs.ts   # 接口、会话（Cookie 模式）；浏览器里的界面偏好
    │              language.ts                  # 按设置和浏览器语言（navigator.languages）切换界面语言，设好 <html lang>
    ├── storage/   local.ts                      # localStorage：存不进去、读不出来都当作没存过
    ├── observability/ setup.ts                 # 诊断日志接回、定时写入、页面报错
    ├── theme/     tokens.css  base.css  fonts.ts  layout.ts  wheel.ts（轮盘）  grid.ts（漫画格子）  palette.ts  ThemeProvider.tsx
    ├── shell/     AppShell.tsx  NavWheel.tsx  useWheelCounts.ts  TabBar.tsx  AccountMenu.tsx  AccountDialogs.tsx  nav.ts  recent.ts
    ├── overlay/   OverlayProvider.tsx  Dialog.tsx  Menu.tsx  Tooltip.tsx  ShortcutsDialog.tsx  useContextMenu.ts
    ├── import/    ImportProvider.tsx  DropZone.tsx  rules.ts   # 导入角色卡（按钮和拖放，一次一张，进草稿）
    ├── components/ controls.tsx（按钮、输入框、提示条、标签、勾选、分段）comic.tsx（格子、气泡、旁白框、键帽、人物位、提示条）
    │               ComicGrid.tsx  PageHeader.tsx  FluidCover.tsx  Icon.tsx  Logo.tsx  Cover.tsx
    ├── data/      stories.ts  scenarios.ts  models.ts  tools.ts  blobs.ts  workbench.ts   # 查询
    │              storyActions.ts  scenarioActions.ts  cardActions.ts                 # 共用的操作
    └── pages/     auth/  stories/  library/  cards/  scenario/  workbench/  play/  models/  tools/  settings/  Splash.tsx  NotFound.tsx
```

纯逻辑（`theme/layout.ts`、`theme/wheel.ts`、`theme/grid.ts`、`theme/palette.ts`、`storage/local.ts`、`state/prefs.ts`、`pages/auth/servers.ts`、`shell/nav.ts`、`shell/recent.ts`、`import/rules.ts`、`pages/library/collection.ts`、`pages/play/reading.ts`）
用 `node --test` 测，在仓库根目录 `npm test` 时一起跑；整条路的端到端测试见 [testing.md 第 3 节](testing.md)。

### 登录页

登录、注册、验证邮箱、找回密码（`pages/auth/`，漫画稿 10–12，规则见 [design/comic/README.md 的“登录页”](design/comic/README.md)）：

- 窗口 ≥ 900 是两格漫画（`AuthLayout.tsx`）：四周离窗口 40、中间空 16，宽度按 700 : 644 分，右格至少 480；窗口太矮时整页滚动。窄于 900 只留表单，同以前的窄屏。
- 左格是一张写故事的桌面（`Desk.tsx`、`DeskSheets.tsx`）：地图、人物关系图、三张文稿、一张索引卡，最上层是胶带、图钉和一根蓝线。
  一个字都没有，不放图片，整格 `aria-hidden`。整个是一张 700×820 的 SVG，格子大小不同时按比例铺满、裁掉多出来的边。
  位置、大小、转角、关系图的人物和连线照设计稿源码；等高线、湖、字条和右格的集中线用固定种子的伪随机生成（`packages/design` 的 `desk.ts`，手机端平板横屏的登录页也用它；`node --test` 测同一个种子结果相同、点都在画布里）。
  注册页是“刚开始”的样子（`desk="start"`）。颜色都走现有的变量，夜间跟着换。
- 右格是表单：Logo 和名字、宋体大标题，输入框用大号的 `Field`（`size="lg"`：高 56、圆角 14、正在输入的那一栏蓝框加 `--b4`），主按钮印着 Enter 键帽（`Button` 的 `kbd`），
  下面是次要按钮（登录页“注册新账户”，注册页和找回密码“返回登录”）。验证码是 6 个格子（`CodeField`），粘贴时先去掉不是数字的再留前 6 位。
  底部一行：左边是服务器行（只在自己部署的网页上的登录、注册页），右边是三份条款。

### 和设计稿不同的地方

- 登录态：设计稿的“平台替代”建议把令牌放在 localStorage；按讨论的方案改成 HttpOnly Cookie（见上），服务端为此加了 Cookie 模式。
- 换服务器：Cookie 只发给同一个网站，网页和接口同源部署，所以不做 W02 那种只换接口地址的服务器对话框；登录页的服务器行改成跳到另一台服务器自己的网页。连接测试只测这一个服务器。
- 共用代码：设计稿建议用路径别名直接引用 `apps/mobile/src`；改成 npm 工作区的两个包，手机端也从包里引用。
- API Key 输入框：用圆点遮住，但不用 `type=password`（免得浏览器把它存成这个网站的密码）；网页里直接粘贴，没有 App 的“粘贴”按钮。
- 诊断日志导出：设计稿写的是 `.json`；内容和 App 导出的一样（开头几行说明，后面每行一条 JSON，可以拖进 vis），所以文件名是 `.jsonl`。
- 提示浮条停留 4 秒（设计稿的值）；App 是 3 秒，带操作的 5 秒。
- 登录页（漫画稿 10–12）：注册页的输入框照旧是邮箱、密码、昵称（稿子是昵称在前）；验证页多一行“没收到？看看垃圾邮件……”，“换一个邮箱”回注册页，
  顶上不再有返回箭头；找回密码的第二步标题下面仍是“如果注册过，验证码已经发过去了”这句（服务端不透露邮箱是否注册过），不是邮箱小块；
  官方网站上没有服务器行。等高线、湖、字条是按种子生成的，和 png 里的线条样子相同、但不是一模一样。

### 还没做的

- 在 Safari 和 Firefox 里过一遍验证清单（设计稿 README 最后一节）：本机只自动跑了 Chrome；`E2E_ALL_BROWSERS=1` 可以加跑 WebKit 和 Firefox。
- 字体：标题的宋体 900 和等宽字已经自己托管（见上）；叙述用系统的宋体（Songti SC、思源宋体；日文是 Hiragino Mincho、Yu Mincho 等），
  没有像 App 那样打包思源宋体的 400；日文标题也用系统的明朝体。正文元素标上这一局的 `lang`，`tokens.css` 按它选中文或日文的字体组（[i18n.md](i18n.md) 第 3 节“字体”）。
- 漫画版的手机布局还没出稿：窄于 900 先沿用 Tab 栏的版式；夜间模式先按“墨和纸对调”做，要不要出一张夜间稿再定。
