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
| 国际化 | i18next + expo-localization | 界面语言与故事语言是两个独立设置；v1 只提供中文 |
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
| streaming | `turn.waiting_state` | streaming | 提示“世界更新中…” |
| streaming | `narrative.delta` | streaming | 追加文字 |
| streaming | `options.ready` 加 `turn.completed` | idle | 展示两个选项 |
| streaming | 连接断开 | reconnecting | 小提示，自动重连 |
| reconnecting | 重连成功 | streaming |  |
| reconnecting | 连续 3 次连上却拿不到数据，或 404 | polling | 轮询直到终态 |
| 任意 | `turn.failed` 且可重试 | failed | “重试”按钮（等于重新生成） |
| 任意 | `timeline.rolled_back` | syncing | 重新拉取历史与状态 |

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
| `(tabs)/playthroughs` | 继续游玩 | 最近的故事 |
| `play/[id]` | 阅读主屏 | 故事流、两个选项、自由输入、菜单（重新生成、回退、世界、时间线） |
| `play/[id]/world` | 世界 | 按类型分页浏览实体；角色私有的秘密默认隐藏 |
| `play/[id]/timeline` | 时间线 | 回合列表带 digest，标出回退下限，回退入口 |
| `play/[id]/outline` | 大纲 | 打开剧透开关才显示 |
| `settings/models` | 模型 | 配好的模型列表；添加模型时 Key、端点、模型名、窗口一次填完 |
| `settings/model/[id]` | 模型详情 | 测试、设为导演、窗口上限（显示当前模型能否满足）与思考开关、更换 Key |
| `settings/account` | 账户 | 导出数据、删除账户 |

**发布**：EAS Build 出包，EAS Update 推 JS 补丁；补丁与服务端的兼容性靠 `X-Client-Version` 加服务端的最低版本检查兜住（[backend.md 第 9 节](backend.md)）。

## 2 客户端目录结构

```
apps/mobile/
├── app.config.ts  eas.json  package.json  tsconfig.json  babel.config.js  metro.config.js
├── app/                                # Expo Router：文件即路由
│   ├── _layout.tsx  index.tsx
│   ├── (auth)/  login.tsx  register.tsx
│   ├── (tabs)/  _layout.tsx  library.tsx  playthroughs.tsx  settings.tsx
│   ├── scenario/[id].tsx
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
│   └── i18n/  index.ts  zh.json   # v1 只有中文，en.json 以后再加
├── e2e/                                # Maestro 流程
└── __tests__/
```

接口类型由后端导出的 OpenAPI 和 SSE 事件 schema 生成，生成流程见 [backend.md 第 9 节](backend.md)的“契约工具链”。

## 3 M1 的实现状态与偏差

M1 实现了登录注册、剧本库与角色卡导入、故事列表、阅读主屏和模型设置。为了先把主线跑通，技术栈做了简化，
页面和数据流按第 1 节设计，后续补齐：

| 设计 | M1 的做法 | 补齐时间 |
| --- | --- | --- |
| TanStack Query 管服务端数据 | `src/hooks/useAsync.ts`：进入或回到页面时取一次，可下拉刷新 | 页面变多、需要缓存与失效时（M2） |
| Zustand 管登录态与回合状态 | 登录态在 `packages/core/src/auth/session.ts`（`SessionManager`，经 `useSyncExternalStore` 接入 React）；回合状态由 `PlaySession` 持有，`usePlaySession` 订阅 | 需要跨页面共享的界面状态时 |
| `openapi-fetch` 加生成的类型 | `packages/core/src/api/client.ts` 的 `ApiClient`（带令牌、401 时刷新一次再重试、problem+json 转 `ApiError`、超时）加手写的 `types.ts` 与 `endpoints.ts`。字段与 [api/](api/README.md) 里各领域的请求和响应模型一一对应，改接口时一起改 | 契约工具链接入时 |
| FlashList | `FlatList`：已完成的回合用 `memo` 固定，只有生成中的那一段重渲染 | 故事很长、出现卡顿时 |
| expo-sqlite 本地缓存 | 不缓存，打开故事时整条拉取（分页，每页 200 回合） | M2 |
| i18n | 界面文字直接写在组件里（只有中文） | 加英文时 |
| Jest、RNTL、Maestro | 纯逻辑用 `node --test`（见下）；界面还没有自动化测试，靠真机验收 | M2 |
| 触觉反馈 | 没有（需要 expo-haptics） | 之后 |

**回合状态机**在第 1 节的表格之外多了两点：加载失败是单独的 `load_failed` 状态（只能“重新加载”）；
提交没送达（网络错误重试用完）时保留行动和幂等键，“重试”用同一个键重发，服务端最多建一个回合；生成失败后的“重试”则用新键重新生成。
开局时的世界构建通过 `world.building` / `world.ready` 事件提示。事件流说结束了却没有可用的终止事件时，转轮询对齐结果，不会卡在“生成中”。

**SseClient** 在第 1 节之外：请求头可以是函数，每次连接前取最新的访问令牌；收到 401 先刷新令牌再立即重连，刷新失败就结束（`unauthorized`）。
流在事件中途结束时，按规范丢弃没写完的事件，`Last-Event-ID` 停在上一个完整事件。

**令牌**：访问令牌 15 分钟，提前一分钟刷新，多个请求同时需要刷新时只发一次；刷新被服务端拒绝就退出登录（路由守卫 `Stack.Protected` 随即切回登录页）。
令牌和自定义的服务器地址存在 expo-secure-store；模型的 API Key 不在设备上保存。

### 页面（实际的路由）

| 路由 | 页面 |
| --- | --- |
| `(auth)/login`、`(auth)/register` | 登录、注册；底部的服务器行打开服务器面板（最近用过的地址单选、输入新地址、测试连接），连不上时自动打开 |
| `(tabs)/playthroughs`、`(tabs)/library`、`(tabs)/settings` | 故事列表（左滑或长按：重命名、删除）、剧本库（网格 / 列表，导入角色卡，长按或左滑：重命名、删除）、设置首页（导演模型卡片） |
| `scenario/[id]` | 剧本详情：封面、概要、原卡开场白；“开始新的故事”五步表单（名字建议、身份底稿、篇幅、文风标签、不想看到的勾选清单），拼回原来的字段 |
| `play/[id]` | 阅读主屏；选项接在最新一段后面，跟着正文滚动；底部固定的操作栏左边是世界状态面板（人物与地点、关系图、事实，揭示秘密前确认），右边是“更多”（阅读设置：宋体 / 黑体、字号；重命名、删除故事），中间是“自己写…”或生成中的状态和“停止”，往上翻时右端多出一个回到最新的下箭头按钮；导航栏只有返回和标题 |
| `settings/models` | 模型列表（导演那一行带标记）和添加模型：服务商图块 → Key（每次都新填，可粘贴；不列出已配置过的 Key）→ 端点（使用官方地址）→ 模型列表（Key 和端点填好后自动获取，也可以手动重新获取）、搜索兼手动输入 → 上下文窗口（只有服务商列表和内置资料都不知道时才让填，不知道就按 32K 估计）→ 备注名、是否设为导演 → 保存。一个 Key 配几个模型时每个模型一行 |
| `settings/model/[id]` | 模型详情：服务商、Key、模型名、端点；测试这个模型（结果存在模型上）、设为导演；“能记住多少”格子图，标出窗口的来源（服务商提供、内置资料、你填的、按服务商报错纠正、估计值），估计值和手填的可以改；工作窗口上限、深度思考；编辑备注名、模型名和端点；更换 Key（别的模型也用这个 Key 时可以一起换）；取消导演；删除 |
| `settings/account` | 退出登录；删除账户（展开后列出会删掉的故事、剧本、模型数，输入密码确认） |
| `dev/probe` | 连接测试（M0 的 SSE 探针），登录前后都能打开；时长分段、延迟走势、报告 |

界面按 [design/ui/](design/ui/README.md) 的设计稿实现（“白 / 柔线 / 大圆角”，第一版正式界面；交互规则也在那份 README 里）。外观在“设置 → 外观”里选：跟随系统、浅色、夜间（夜间就是深色色板），存在设备上，选了立刻生效；固定主题时用 `Appearance.setColorScheme` 覆盖系统深浅，键盘和状态栏跟着 App 走。加主题只要在 `packages/design/src/themes.ts` 的主题表里加一项、配一套色板；主题只换颜色和投影，圆角、字号、间距是固定的。标签栏是浮在内容上的胶囊，按安全区摆放，列表底部按它的高度留白（`useTabBarSpace()`）。和设计稿不同：
阅读页的选项不再放在固定于底部的行动面板里（它在手机上长期盖住小半屏正文），而是接在故事流末尾（`TurnActions.tsx`），跟着正文滚动；
底部只留一条贴边的操作栏（`BottomBar.tsx`，iPhone 上连同安全区约 80pt，故事流的底部按它的高度留白）：左边世界状态，右边“更多”，
中间按状态换成“自己写…”（点了原地展开成输入框，跟着键盘浮起）、生成中的状态和“停止”、同步中的提示；
往上翻离开最新位置时，中间这一格右端滑出一个灰底的下箭头按钮（和世界、更多一样，生成中带蓝点），“自己写…”跟着变窄，点它回到最新。
生成状态只在操作栏里显示，正文里不重复。“我的行动”不画成卡片，和叙述用同样的字、浅一档的颜色，左边一道竖线，读起来是故事的一部分。没做的：世界状态的“新”标记和按钮上的变化提示（服务端还没有世界状态的变更记录）、导入进度条（上传没有进度事件，用来回扫动的线代替）、改昵称（没有接口）。

还没有的页面：世界、时间线、大纲（M2、M3）。

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
- 阅读页：正文和末尾的选项最宽 640 居中，宽屏选项两列；底部操作栏的内容宽 672、同一条中线；停靠的开关存在界面偏好里（`worldDocked`）。
- 故事列表网格 1 / 2 / 3 列，最近一个故事放大成主卡；剧本网格宽屏按 240 一列（≤ 5 列），列表视图限宽 640。
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
│   ├── auth/     session.ts                # SessionManager：令牌、单飞刷新
│   ├── play/     turnMachine.ts  playSession.ts  reading.ts  worldGraph.ts  testing.ts（测试用的回合样本）
│   ├── scenario/ startForm.ts              # 开始新故事的内置选项与拼接
│   ├── settings/ labels.ts  window.ts      # 模型状态、窗口来源的文案；“能记住多少”的格子
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
    │             PrefsProvider.tsx         # 设备上的界面偏好：最近用过的服务器、阅读设置、剧本库视图、外观
    ├── storage/  secure.ts                 # expo-secure-store（令牌、服务器地址、界面偏好）
    ├── features/
    │   ├── play/     usePlaySession.ts  StoryFeed.tsx  TurnActions.tsx  BottomBar.tsx
    │   │             ActionParts.tsx  WorldSheet.tsx  WorldParts.tsx  MoreSheet.tsx
    │   ├── stories/  StoryCards.tsx                   # 平板的故事卡片（网格小卡、主卡）
    │   ├── library/  LibraryParts.tsx                 # 剧本库的卡片、列表行、空状态
    │   ├── scenario/ StartForm.tsx                    # 开始新故事的表单
    │   ├── settings/ servers.ts  AddModelForm.tsx  ModelPicker.tsx  ModelSheets.tsx
    │   │             MemoryBlocks.tsx  ProbeResults.tsx  AppearanceSheet.tsx  nav.tsx  SettingsPane.tsx
    │   │             screens/（模型列表、模型详情、账户的页面主体）
    │   └── probe/    DiagnosticsCard.tsx  ProbeBody.tsx   # 连接测试；诊断日志的导出和清空
    ├── components/ ui.tsx（门面）primitives  feedback  controls  bars  sheet  overlay  dialog  icons
    │               Cover.tsx（图片或几何封面）SwipeRow.tsx  KeyParts.tsx  Logo.tsx  ServerSetting.tsx  AuthLayout.tsx
    ├── hooks/      useAsync.ts  useKeyboardLift.ts  useLayout.ts
    ├── observability/ persist.ts  setup.ts  # 诊断日志存文件、启动时安装
    ├── theme/      index.ts                # 设计 token 的出口：共用的色板、主题表和 tokens，加上字体族
    │               ThemeProvider.tsx       # usePalette()、RaisedSurface
    └── utils/      orientation.ts
```

`*.test.ts` 与被测文件放在一起，在仓库根目录 `npm test`（各工作区的 `node --test`）运行。`packages/core`：SSE 解析与重连、回合状态机、
`PlaySession`（加载、幂等重试、409 的处理、续传、轮询）、`SessionManager`、`ApiClient`、诊断日志，以及开始表单的拼接、窗口格子、
关系图布局、阅读字号、数字格式；`packages/design`：平板断点与栏宽、主题、几何封面；`apps/mobile`：最近用过的服务器。

**字体**：界面用系统黑体，不打包；等宽字用 `@expo-google-fonts/ibm-plex-mono`；叙述用思源宋体的 GB2312 子集（`assets/fonts/NotoSerifSC-Regular.ttf`，约 3.2 MB，OFL 许可）。
子集的字符表由 `scripts/font-subset-chars.py` 生成，再用 fonttools 的 `pyftsubset` 从完整字体裁出；GB2312 以外的生僻字退回系统字体显示。

## 4 网页端（`apps/web`）

电脑浏览器里的客户端，按 [design/ui/web/](design/ui/web/README.md) 的设计稿做：窗口 ≥ 1280 时左边是常驻侧栏，
900–1279 是导航条，更窄时沿用平板中屏和手机的布局（底部胶囊 Tab 栏）。设计稿只管外观和交互；文案、状态和错误提示以 App 现有代码为准。

### 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 构建 | Vite + TypeScript（strict） | 开发和预览服务器把 `/v1`、`/health`、`/ready` 转给后端（默认 `http://localhost:8000`，`BT_API_URL` 可以改） |
| 界面 | React 19，浏览器的 DOM 和 CSS | 不用 react-native-web：链接、表单自动填充、`:focus-visible`、悬停、右键菜单、拖放、选中复制都是浏览器原生的 |
| 路由 | react-router 7 | 地址和 App 的 expo-router 一一对应：`/login`、`/register`、`/playthroughs`、`/library`、`/scenario/:id`、`/play/:id`、`/settings`、`/settings/models`、`/settings/model/:id`、`/settings/account`、`/dev/probe` |
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

### 布局

- 断点只看窗口宽度：`src/theme/layout.ts`（设计稿的 `layout.ts`，平板的函数从 `@bettertavern/design/layout` 引入）。
  拖动窗口时布局即时切换，页面不卸载。
- 外壳 `src/shell/`：侧栏（三项导航、按“今天 / 本周 / 更早”分组的最近故事、账户）、导航条（最近四个故事的封面）、底部 Tab 栏。
  侧栏收起存在浏览器里；窄于 1280 时“展开”打开的侧栏盖在内容上，点遮罩、按 Esc、点了里面的一项都会收回。
  导航和故事行都是 `<a href>`，⌘ / Ctrl + 点击在新标签页打开。
- 深色模式：`index.html` 里的一小段脚本在页面脚本加载前按外观设置设好 `data-scheme`，深色下打开不闪白。

### 目录

```
apps/web/
├── index.html  vite.config.ts  public/favicon.svg
└── src/
    ├── main.tsx                 # 数据缓存 → 界面偏好 → 主题 → 登录状态 → 路由
    ├── app/       router.tsx  guards.tsx        # 路由表；没登录去登录页、登录了不停在登录页
    ├── state/     AppProvider.tsx  PrefsProvider.tsx  prefs.ts   # 接口、会话（Cookie 模式）；浏览器里的界面偏好
    ├── storage/   local.ts                      # localStorage：存不进去、读不出来都当作没存过
    ├── theme/     tokens.css  base.css  layout.ts  palette.ts  ThemeProvider.tsx
    ├── shell/     AppShell.tsx  Sidebar.tsx  Rail.tsx  TabBar.tsx  StoryRow.tsx  nav.ts  recent.ts
    ├── components/ controls.tsx（按钮、图标按钮、输入框、提示条、胶囊）Icon.tsx  Logo.tsx  Cover.tsx
    ├── data/      stories.ts                    # TanStack Query 的查询
    └── pages/     auth/（登录、注册）  Splash.tsx  NotFound.tsx
```

纯逻辑（`layout.ts`、`palette.ts`、`storage/local.ts`、`state/prefs.ts`、`shell/nav.ts`、`shell/recent.ts`）用 `node --test` 测，在仓库根目录 `npm test` 时一起跑。

### 和设计稿不同的地方

- 登录态：设计稿的“平台替代”建议把令牌放在 localStorage；按讨论的方案改成 HttpOnly Cookie（见上），服务端为此加了 Cookie 模式。
- 没有“换服务器”：Cookie 只发给同一个网站，网页和接口同源部署，登录页不放服务器入口和服务器对话框（W02 的对话框不做）。
- 共用代码：设计稿建议用路径别名直接引用 `apps/mobile/src`；改成 npm 工作区的两个包，手机端也从包里引用。
- 连不上服务器的提示：App 是“连不上服务器，检查地址或网络。”，网页没有地址可改，改成“连不上服务器，检查网络后再试。”

### 还没做的

故事、剧本库与导入、剧本详情、阅读页、设置几页现在只有标题；快捷键、右键菜单、提示、浮条在后面补上。
