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
| `(auth)/login`、`register` | 登录与注册 |  |
| `(tabs)/library` | 剧本库 | 导入角色卡，列表，进入详情 |
| `scenario/[id]` | 剧本详情 | 预览、设置主角名与偏好、开始 |
| `scenario/[id]/edit` | 编辑角色卡 | 改角色信息和卡片自带的世界书，只影响之后开始的故事 |
| `(tabs)/playthroughs` | 继续游玩 | 最近的故事 |
| `play/[id]` | 阅读主屏 | 故事流、两个选项、自由输入、菜单（重新生成、回退、世界、时间线） |
| `play/[id]/world` | 世界 | 按类型分页浏览实体；角色私有的秘密默认隐藏 |
| `play/[id]/timeline` | 时间线 | 回合列表带一句话摘要，每一回合都可以作为回退的目标 |
| `play/[id]/outline` | 大纲 | 打开剧透开关才显示 |
| `settings/models` | 模型 | 配好的模型列表；添加模型时 Key、端点、模型名、窗口一次填完 |
| `settings/model/[id]` | 模型详情 | 测试、设为导演、用于后台整理、窗口上限（显示当前模型能否满足）与思考开关、更换 Key |
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
│   ├── (auth)/  login.tsx  register.tsx
│   ├── (tabs)/  _layout.tsx  library.tsx  playthroughs.tsx  settings.tsx
│   ├── scenario/[id]/  index.tsx  edit.tsx
│   ├── play/[id]/  index.tsx  world.tsx  timeline.tsx  outline.tsx
│   └── settings/  models.tsx  model/[id].tsx  account.tsx
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

已经实现：登录注册、剧本库与角色卡导入和编辑、故事列表、阅读主屏（流式叙述、选项、自由输入、停止、重试、写结局、回到更早的一段、世界状态面板）、模型设置（导演模型、后台整理模型）、外观和语言、平板布局。
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
| `(auth)/login`、`(auth)/register` | 登录、注册；底部的服务器行打开服务器面板（最近用过的地址单选、输入新地址、测试连接），连不上时自动打开 |
| `(tabs)/playthroughs`、`(tabs)/library`、`(tabs)/settings` | 存档列表（界面上叫“存档”；每行方形封面 72，标题后面跟状态胶囊，右上角是更新时间，下面两行摘要；左滑或长按：重命名、删除）、剧本库（网格 / 列表，导入角色卡，长按或左滑：重命名、删除）、设置首页（导演模型卡片） |
| `scenario/[id]`（`scenario/[id]/index.tsx`） | 剧本详情：封面、概要（剧本名右边是“编辑角色卡”，改过的卡标“已编辑”）、原卡开场白；“开始新的故事”五步表单（名字建议、“这个角色是谁”输入框、篇幅、文风标签、不想看到的勾选清单），拼回原来的字段；页面最底下是删除剧本（剧本名在编辑页里改；封面上只有返回按钮，没有“更多”） |
| `scenario/[id]/edit` | 编辑角色卡：剧本名、角色名、标签，描述、性格，情境、开场白，对话示例，卡片自带的世界书（条目收起显示名称和常驻 / 未启用 / 有问题的标记，展开改名称、关键词、内容、启用、常驻，上移、下移、删除）。保存前按和服务端相同的规则检查（`@bettertavern/core/scenario/cardEdit`），不合格的字段标红，之后每次修改重新检查；保存带版本号，别处改过（409 `CARD_CHANGED`）时问要不要重新加载；有没保存的修改时离开先问“放弃修改？”；页底“恢复导入时的内容” |
| `play/[id]` | 阅读主屏；选项接在最新一段后面，跟着正文滚动（这一段的选项补了两次也没补齐时，那里写一行“这一段没有给出选项，在下面写下你接下来要做的事”）；底部固定的操作栏左边是世界状态面板（标题下写截至第几回合，整理失败或跳过时有一条提示；人物与地点、关系图、事实，揭示秘密前确认。面板开着时，最新一段变了（写完新的一段、回退）就重新取；后台还没整理到最新一段时每 4 秒再取一次，整理到了就停，最新一段整理失败、要等下一回合再试时也停，`worldRefreshDelay()`；网页同样），右边是“更多”（阅读设置：宋体 / 黑体、字号；重命名、回到更早的一段、写结局、删除故事。“回到更早的一段”列出之前的每一段，点一段、确认后回退，之后的段落和世界状态的变化都撤销；生成中不能点，这个存档的回退次数用完时写明已用完。正文长按是选中复制，所以回退不用长按），中间是“自己写…”或生成中的状态和“停止”，往上翻时右端多出一个回到最新的下箭头按钮；导航栏只有返回和标题 |
| `settings/models` | 模型列表（导演和后台模型那一行带标记）和添加模型：服务商图块（DeepSeek、OpenAI、Grok、Gemini、Hugging Face、自定义兼容端点，一行三块；圆标里是各家的标志，取自 Lobe Icons，形状数据在 `@bettertavern/design/providerLogos`，可以带线性渐变（Gemini 的彩色四角星），自定义端点写 { }）→ Key（每次都新填，可粘贴；不列出已配置过的 Key）→ 端点（使用官方地址）→ 模型列表（Key 和端点填好后自动获取，也可以手动重新获取）、搜索兼手动输入 → 上下文窗口（只有服务商列表和内置资料都不知道时才让填，不知道就按 32K 估计）→ 备注名、是否设为导演 → 保存。一个 Key 配几个模型时每个模型一行 |
| `settings/model/[id]` | 模型详情：服务商、Key、模型名、端点；测试这个模型（结果存在模型上）、设为导演；“能记住多少”格子图，标出窗口的来源（服务商提供、内置资料、你填的、按服务商报错纠正、估计值），估计值和手填的可以改；工作窗口上限、深度思考；“用于后台整理”开关（点了立刻保存；模型不能调用工具时打不开，并说明原因）；编辑备注名、模型名和端点；更换 Key（别的模型也用这个 Key 时可以一起换）；取消导演；删除 |
| `settings/account` | 退出登录；删除账户（展开后列出会删掉的故事、剧本、模型数，输入密码确认） |
| 设置首页的“语言” | 选择面板（手机是底部面板，平板是对话框）：跟随系统（下面注明系统语言）、中文、English、日本語；每种语言用它自己的文字写 |
| `dev/probe` | 连接测试（M0 的 SSE 探针），登录前后都能打开；时长分段、延迟走势、报告 |

界面按 [design/ui/](design/ui/README.md) 的设计稿实现（“白 / 柔线 / 大圆角”，第一版正式界面；交互规则也在那份 README 里）。
界面文字有中文、英文和日文，在“设置 → 语言”里选：跟随系统（系统语言是中文时用中文，是日文时用日文，其他用英文）、中文、English、日本語，存在设备上，选了立刻生效；
开局时把当前的界面语言传给服务端，决定这一局的提示词用哪种语言（[i18n.md](i18n.md)）。外观在“设置 → 外观”里选：跟随系统、浅色、夜间（夜间就是深色色板），存在设备上，选了立刻生效；固定主题时用 `Appearance.setColorScheme` 覆盖系统深浅，键盘和状态栏跟着 App 走。加主题只要在 `packages/design/src/themes.ts` 的主题表里加一项、配一套色板；主题只换颜色和投影，圆角、字号、间距是固定的。标签栏是浮在内容上的胶囊，按安全区摆放，列表底部按它的高度留白（`useTabBarSpace()`）。
选中标签的图标和文字是 `#5B7CFF`（色板的 `tabOn`），底下是一块选中框，切换时滑到新标签（宽屏的竖向导航栏上下滑）：
iOS 26 起用系统的液态玻璃（`expo-glass-effect` 的 `GlassView`）——整条标签栏是一块玻璃，页面内容从下面透出来，选中框是另一块透明玻璃；
没有液态玻璃时（Android、更早的 iOS）标签栏是白卡，选中框没有底色，一圈蓝色细描边加灰色投影（`tabCapsuleShadow`）。
玻璃和它的上层都不能改透明度（改了玻璃不画），选中框只改位置。网页的侧栏、导航条、底部 Tab 栏是透明玻璃框加蓝色描边和高光（`shell/glass.tsx`）。和设计稿不同：
阅读页的选项不再放在固定于底部的行动面板里（它在手机上长期盖住小半屏正文），而是接在故事流末尾（`TurnActions.tsx`），跟着正文滚动；
底部只留一条贴边的操作栏（`BottomBar.tsx`，iPhone 上连同安全区约 80pt，故事流的底部按它的高度留白）：左边世界状态，右边“更多”，
中间按状态换成“自己写…”（点了原地展开成输入框，跟着键盘浮起）、生成中的状态和“停止”、同步中的提示；
往上翻离开最新位置时，中间这一格右端滑出一个灰底的下箭头按钮（和世界、更多一样，生成中带蓝点），“自己写…”跟着变窄，点它回到最新。
生成状态只在操作栏里显示，正文里不重复。“我的行动”不画成卡片，和叙述用同样的字、浅一档的颜色，左边一道竖线，读起来是故事的一部分。
**写结局**（设计稿里没有）：“更多”里的一项，只在能行动时可点（开场写完、没在生成、没有失败等着重试）。点了弹出确认框，说明写完就结束、不能撤销，
带一个可以不填的“结局方向”输入框（`overlay.prompt` 的 `optional`）。确认后提交 `ending` 行动，故事流里“我的行动”那一行是“写结局”或“写结局：方向”，
导演接着写一大段；写完后最后一段下面居中一行“—END—”，没有选项，操作栏中间换成旗子和灰字“故事已完结”，“更多”里不再有写结局；
故事列表里这个故事显示“已完结”（`storyStatus()`）。改名、看世界状态、删除照常可以。没做的：世界状态的“新”标记和按钮上的变化提示（服务端还没有世界状态的变更记录）、导入进度条（上传没有进度事件，用来回扫动的线代替）、改昵称（没有接口）。

没有单独的世界页（世界状态在阅读页的面板里看）；时间线页还没做；大纲只给导演看，不做页面。

**平板**按 [design/ui/tablet/](design/ui/tablet/README.md) 实现：同一套代码做响应式，视觉规则不变，只换布局；手机上的布局和行为不变。

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
  右栏是“灰底白卡”，用 `RaisedSurface` 换这一片的色板，页面主体不用改。
- 登录、注册宽屏左右分栏（左侧插画区，`components/AuthLayout.tsx`），中屏表单宽 440 居中。

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
│   │             cardEdit.ts               # 编辑角色卡：草稿、上限（同服务端）、保存前检查、世界书条目移动
│   ├── settings/ labels.ts  window.ts      # 模型状态、窗口来源的说明（调用时按界面语言取）；“能记住多少”的格子
│   ├── probe/    probeSession.ts           # 连接测试
│   ├── observability/ log.ts  requests.ts  # 诊断日志：脱敏、请求记录
│   └── utils/    format.ts  ids.ts
└── design/src/                # @bettertavern/design
    ├── palettes.ts  themes.ts              # 色板（浅色、深色）与主题表（浅色、夜间）
    ├── tokens.ts                           # 圆角、字号、间距、控件尺寸（不随主题变）
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
    │   ├── play/     usePlaySession.ts  StoryFeed.tsx  TurnActions.tsx  BottomBar.tsx
    │   │             ActionParts.tsx  WorldSheet.tsx  WorldParts.tsx  MoreSheet.tsx
    │   ├── stories/  StoryCards.tsx                   # 平板的存档卡片（网格小卡、主卡）
    │   ├── library/  LibraryParts.tsx                 # 剧本库的卡片、列表行、空状态
    │   ├── scenario/ StartForm.tsx  BookEditor.tsx    # 开始新故事的表单；编辑角色卡里的世界书
    │   ├── settings/ servers.ts  AddModelForm.tsx  ModelPicker.tsx  ModelSheets.tsx
    │   │             MemoryBlocks.tsx  ProbeResults.tsx  AppearanceSheet.tsx  LanguageSheet.tsx  nav.tsx  SettingsPane.tsx
    │   │             screens/（模型列表、模型详情、账户的页面主体）
    │   └── probe/    DiagnosticsCard.tsx  ProbeBody.tsx   # 连接测试；诊断日志的导出和清空
    ├── components/ ui.tsx（门面）primitives  feedback  controls  bars  sheet  overlay  dialog  icons
    │               Cover.tsx（图片或几何封面）SwipeRow.tsx  KeyParts.tsx  Logo.tsx  ServerSetting.tsx  AuthLayout.tsx
    ├── hooks/      useAsync.ts  useKeyboardLift.ts  useLayout.ts
    ├── observability/ persist.ts  setup.ts  # 诊断日志存文件、启动时安装
    ├── theme/      index.ts  fonts.ts      # 设计 token 的出口：共用的色板、主题表和 tokens；字体族和按语言选正文宋体（fonts.ts）
    │               ThemeProvider.tsx       # usePalette()、RaisedSurface
    └── utils/      orientation.ts
```

`*.test.ts` 与被测文件放在一起，在仓库根目录 `npm test`（各工作区的 `node --test`）运行。`packages/core`：两种语言的资源一一对应、语言的解析、SSE 解析与重连、回合状态机、
`PlaySession`（加载、幂等重试、409 的处理、续传、轮询）、`SessionManager`、`ApiClient`、诊断日志，以及开始表单的拼接、窗口格子、
关系图布局、阅读字号、数字格式；`packages/design`：平板断点与栏宽、主题、几何封面；`apps/mobile`：最近用过的服务器。

**字体**：界面用系统黑体，不打包；等宽字用 `@expo-google-fonts/ibm-plex-mono`；叙述用思源宋体的子集，中文、日文各一份（OFL 许可）：
简体中文版的 GB2312 子集（`assets/fonts/NotoSerifSC-Regular.ttf`，约 3.2 MB）和日文版的 JIS X 0208 子集（`assets/fonts/NotoSerifJP-Regular.ttf`，约 3.3 MB）。
正文按这一局的语言选（`theme/fonts.ts` 的 `serifFor()`，日文的局用日文子集，其他用中文子集），不按界面语言；剧本详情页的原始开场白（角色卡原文）用系统字体。
子集的字符表由 `scripts/font-subset-chars.py` 生成（`--set jis` 是日文），再用 fonttools 的 `pyftsubset` 从完整字体裁出；字符集以外的生僻字退回系统字体显示。详见 [i18n.md](i18n.md) 第 3 节“字体”。

## 4 网页端（`apps/web`）

电脑浏览器里的客户端，按 [design/ui/web/](design/ui/web/README.md) 的设计稿做：窗口 ≥ 1280 时左边是常驻侧栏，
900–1279 是导航条，更窄时沿用平板中屏和手机的布局（底部胶囊 Tab 栏）。设计稿只管外观和交互；文案、状态和错误提示以 App 现有代码为准。

### 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 构建 | Vite + TypeScript（strict） | 开发和预览服务器把 `/v1`、`/health`、`/ready` 转给后端（默认 `http://localhost:8000`，`BT_API_URL` 可以改） |
| 界面 | React 19，浏览器的 DOM 和 CSS | 不用 react-native-web：链接、表单自动填充、`:focus-visible`、悬停、右键菜单、拖放、选中复制都是浏览器原生的 |
| 路由 | react-router 7 | 地址和 App 的 expo-router 一一对应：`/login`、`/register`、`/playthroughs`、`/library`、`/scenario/:id`、`/scenario/:id/edit`、`/play/:id`、`/settings`、`/settings/models`、`/settings/model/:id`、`/settings/account`、`/dev/probe` |
| 服务端数据 | TanStack Query | 没有下拉刷新：回到标签页、窗口回到前台时自动刷新 |
| 样式 | CSS Modules + CSS 变量 | 变量名同 `docs/design/ui/web/tokens.css`；色板由 `ThemeProvider` 从 `@bettertavern/design` 写到 `<html>` 上 |
| 共用 | `@bettertavern/core`、`@bettertavern/design` | 接口客户端、SSE、会话、回合状态机、色板、布局函数、图标和封面的数据，和 App 是同一份代码（见第 3 节的“目录”） |

### 登录：Cookie 模式

网页的刷新令牌放在 HttpOnly Cookie 里，页面脚本读不到，访问令牌只在内存中（[api/auth.md 的“两种登录方式”](api/auth.md#两种登录方式)）：

- 登录、注册的请求带 `X-Auth-Mode: cookie`，服务端把刷新令牌写进 Cookie `bt_refresh`（`Path=/v1/auth`、`SameSite=Strict`），响应体里的 `refresh_token` 是 `null`。
- 打开页面时凭 Cookie 刷新一次，拿到访问令牌和账户就是已登录；没有 Cookie 或被拒就去登录页（登录后回到原来要去的地址）。
  `SessionManager` 和 App 是同一个，网页传给它的“存储”就是这次刷新，刷新令牌是 `null`。
- 访问令牌快过期时照常刷新，浏览器自动带上 Cookie；几个标签页各自刷新，Cookie 是共用的。
- 退出时先请服务端吊销并删掉 Cookie，再本地退出：服务端没收到时 Cookie 还在，刷新页面会重新登录上。
- 网页和接口必须同源（开发时 Vite 转发，部署时反向代理），所以网页没有 App 登录页底部的“服务器”入口。

### 页面

| 地址 | 页面 |
| --- | --- |
| `/login`、`/register` | 登录、注册（W01、W02）：真正的 `<form>` 和 `autocomplete`，打开时焦点在邮箱，Enter 提交；宽屏左边是插画区 |
| `/playthroughs` | 存档（W03）：三列网格，最近一个存档放大成主卡（两列两行）；600–899 两列，手机一列。卡片布局同 App，“…”在右下角 |
| `/library` | 剧本库（W04）：网格按内容宽度 ÷ 240 取整（2–5 列）或限宽 640 的列表；导入按钮可以多选 |
| `/scenario/:id` | 剧本详情（W05）：≥ 900 两栏各自滚动，右栏是开始新故事的五步，底部浮着摘要栏；更窄单栏。剧本名右边进编辑角色卡；封面上只有返回按钮，删除剧本在概要下面（单栏时在最底下） |
| `/scenario/:id/edit` | 编辑角色卡：单栏（≤ 640）居中，顶上一条（返回、标题、保存）贴着；内容和规则同 App 的 `scenario/[id]/edit`。没保存时站内跳转（侧栏、返回、浏览器后退）由路由的 blocker 先问，刷新或关标签页由浏览器提示（`beforeunload`） |
| `/play/:id` | 阅读页（W06–W11）：书名页、故事流、选项（≥ 900 两列）、底部操作栏、世界状态（停靠 / 滑出）、更多（含写结局，行为同 App）。鼠标移到更早的一段上，右上角出现“回到这里”，确认后回退；回退次数用完时那里写明已用完；没有鼠标的设备上它一直显示在这一段下面 |
| `/settings` 及子页 | 设置（W13–W17）：≥ 900 两栏，左栏是设置首页，右栏是子页（模型、模型详情、账户、连接测试）；更窄逐层进入。“外观”“语言”是居中对话框，选了立刻生效；跟随系统时看浏览器的语言 |

和 App 不同的只是布局和输入方式：文案、状态、错误提示、接口调用都照 App 的页面写，纯逻辑直接用 `@bettertavern/core`。

### 布局

- 断点只看窗口宽度：`src/theme/layout.ts`（设计稿的 `layout.ts`，平板的函数从 `@bettertavern/design/layout` 引入）。
  拖动窗口时布局即时切换，页面不卸载：草稿、滚动位置、打开着的世界面板都不丢。
- 外壳 `src/shell/`：≥ 1280 侧栏（三项导航、按“今天 / 本周 / 更早”分组的最近故事、账户），900–1279 导航条（最近四个故事的封面），
  更窄是底部 Tab 栏（只在三个一级页上，进了阅读页、剧本详情、设置子页就收起，和 App 一样有返回）。
  侧栏收起存在浏览器里；窄于 1280 时“展开”打开的侧栏盖在内容上，点遮罩、按 Esc、点了里面的一项都会收回。
- 阅读页用 `readingLayout()`：窗口 − 导航 ≥ 1100 时世界停靠；侧栏展开放不下、收成导航条就放得下时，侧栏临时收成导航条（`useShell().setNavOverride`）；
  其余从右侧滑出。页面整体滚动（浏览器的查找、滚动条都是原生的），停在底部时跟着新文字滚，往上翻就停下，操作栏中间多出“回到最新”。
  已完成的回合用 `content-visibility: auto`，很长的故事也只排版看得见的部分。
- 设置右栏是容器（`container-type: inline-size`），宽于 720 时模型详情、添加模型、连接测试分两栏。
- 深色模式：`index.html` 里的一小段脚本在页面脚本加载前按外观设置设好 `data-scheme`，深色下打开不闪白。

### 鼠标、键盘与浮层

- 悬停只在 `(hover: hover) and (pointer: fine)` 下生效；键盘焦点是 2px 蓝环（`:focus-visible`）；按下缩到 0.98。都写在共用控件的样式里。
- 卡片、侧栏的故事行、导航条的封面、设置左栏的每一项都是 `<a href>`，⌘ / Ctrl + 点击、中键在新标签页打开。
  卡片和故事行悬停时出现“…”，右键（或 Shift + F10）打开同一个菜单：在新标签页打开、重命名、删除。正文和输入框保留浏览器自己的右键菜单。
- 浮层在 `src/overlay/`：确认、输入、外观、快捷键、世界状态的滑出都用浏览器的 `<dialog>`（焦点进出、Esc、点遮罩关闭，删除类默认焦点在“取消”）；
  菜单按 `contextMenuFrame` 定位，↑↓ 移动；“更多”贴着按钮弹出（`popoverFrame`）；提示浮条在内容区底部居中，4 秒，鼠标停留时不消失；
  提示（tooltip）给图标按钮和导航条的封面，悬停 500ms 或键盘焦点到达时出现，有快捷键时带键帽。
- 快捷键：A–D 选选项、/ 自己写、W 世界状态、End 回到最新（阅读页），[ 展开或收起侧栏、? 快捷键一览（任何地方）。
  单键快捷键在输入、输入法组字、按着修饰键、对话框开着时不响应，可以在快捷键一览里关掉（存在浏览器里）。
  输入框里 Enter 发送、Shift + Enter 换行，组字时的 Enter 不发送（`isComposing`，Safari 还要看 `keyCode === 229`）。
- 拖放导入：文件拖进窗口时任何页面都接收，内容区盖上“松开就导入”；逐个上传，一张成功进剧本详情，多张汇总成一句浮条，失败的列在红色提示里。
- 草稿每个故事一份存在浏览器里（`bt.draft.<故事 ID>`）；诊断日志存最近 500 条（`bt.diagnostics`），连接测试页可以导出、清空。
- 标签页标题“页面名 · BetterTavern”，阅读页生成中在前面加“● ”。

### 目录

```
apps/web/
├── index.html  vite.config.ts  playwright.config.ts  public/favicon.svg
├── e2e/                         # Playwright 端到端测试（中文的完整流程、英文界面的冒烟测试）和测试用的角色卡
└── src/
    ├── main.tsx                 # 诊断日志 → 界面语言 → 数据缓存 → 界面偏好 → 主题 → 登录状态 → 路由
    ├── app/       router.tsx  guards.tsx        # 路由表（阅读页、剧本详情、编辑角色卡、设置按需加载）；没登录去登录页、登录了不停在登录页
    ├── state/     AppProvider.tsx  PrefsProvider.tsx  prefs.ts   # 接口、会话（Cookie 模式）；浏览器里的界面偏好
    │              language.ts                  # 按设置和浏览器语言（navigator.languages）切换界面语言，设好 <html lang>
    ├── storage/   local.ts                      # localStorage：存不进去、读不出来都当作没存过
    ├── observability/ setup.ts                 # 诊断日志接回、定时写入、页面报错
    ├── theme/     tokens.css  base.css  layout.ts  palette.ts  ThemeProvider.tsx
    ├── shell/     AppShell.tsx  Sidebar.tsx  Rail.tsx  TabBar.tsx  StoryRow.tsx  glass.tsx  nav.ts  recent.ts
    ├── overlay/   OverlayProvider.tsx  Dialog.tsx  Menu.tsx  Tooltip.tsx  ShortcutsDialog.tsx  useContextMenu.ts
    ├── import/    ImportProvider.tsx  DropZone.tsx  rules.ts   # 导入角色卡（按钮和拖放）
    ├── components/ controls.tsx（按钮、输入框、提示条、胶囊、标签、勾选）Icon.tsx  Logo.tsx  Cover.tsx  PageHeader.tsx
    ├── data/      stories.ts  scenarios.ts  models.ts  blobs.ts  storyActions.ts  scenarioActions.ts   # 查询和共用的操作
    └── pages/     auth/  stories/  library/  scenario/  play/  settings/  Splash.tsx  NotFound.tsx
```

纯逻辑（`theme/layout.ts`、`theme/palette.ts`、`storage/local.ts`、`state/prefs.ts`、`shell/nav.ts`、`shell/recent.ts`、`import/rules.ts`、`pages/play/reading.ts`）
用 `node --test` 测，在仓库根目录 `npm test` 时一起跑；整条路的端到端测试见 [testing.md 第 3 节](testing.md)。

### 和设计稿不同的地方

- 登录态：设计稿的“平台替代”建议把令牌放在 localStorage；按讨论的方案改成 HttpOnly Cookie（见上），服务端为此加了 Cookie 模式。
- 没有“换服务器”：Cookie 只发给同一个网站，网页和接口同源部署，登录页不放服务器入口和服务器对话框（W02 的对话框不做）；连接测试只测这一个服务器。
- 共用代码：设计稿建议用路径别名直接引用 `apps/mobile/src`；改成 npm 工作区的两个包，手机端也从包里引用。
- API Key 输入框：用圆点遮住，但不用 `type=password`（免得浏览器把它存成这个网站的密码）；网页里直接粘贴，没有 App 的“粘贴”按钮。
- 诊断日志导出：设计稿写的是 `.json`；内容和 App 导出的一样（开头几行说明，后面每行一条 JSON，可以拖进 vis），所以文件名是 `.jsonl`。
- 提示浮条停留 4 秒（设计稿的值）；App 是 3 秒，带操作的 5 秒。

### 还没做的

- 在 Safari 和 Firefox 里过一遍验证清单（设计稿 README 最后一节）：本机只自动跑了 Chrome；`E2E_ALL_BROWSERS=1` 可以加跑 WebKit 和 Firefox。
- 字体：叙述用系统的宋体（Songti SC、思源宋体；日文是 Hiragino Mincho、Yu Mincho 等），没有像 App 那样打包思源宋体子集；正文元素标上这一局的 `lang`，`tokens.css` 按它选中文或日文的字体组（[i18n.md](i18n.md) 第 3 节“字体”）；等宽字没有打包 IBM Plex Mono。
