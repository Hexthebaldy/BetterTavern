# 重构提示词：网页端改成漫画分镜版

把下面整段交给 Claude Code（在仓库根目录打开）。也可以只说一句“按 docs/design/comic/refactor-prompt.md 做”。

主体部分（01–09）已经按这份做完了。登录、注册、验证邮箱是后来补的稿，任务在最后的“追加”一节，可以单独交给 Claude Code：“按 docs/design/comic/refactor-prompt.md 最后的追加一节改登录页”。

---

## 任务

把电脑浏览器端（`apps/web`，窗口 ≥ 900）的界面从“白 / 柔线 / 大圆角”改成漫画分镜版：墨黑粗描边、硬投影、网点、宋体粗标题。顶栏和侧栏去掉，导航收进一只可以拖动的轮盘。设计稿和规则在 `docs/design/comic/`。

这次只改网页端的界面。服务端、接口、`apps/mobile`、`apps/site` 都不动。

## 先读

1. `docs/design/comic/README.md`：视觉语言、轮盘规格、页面结构、各页要点、和现在代码的差别、要定的事。数值以 `source/*.dc.html` 为准。
2. `docs/design/comic/png/01`…`09`：九个画面的 2x 截图（视口 1440×900）。
3. 现在的外壳和布局：`apps/web/src/shell/`（AppShell、Sidebar、TabBar、AccountMenu、nav.ts）、`apps/web/src/theme/`（tokens.css、layout.ts）、`apps/web/src/app/router.tsx`、`apps/web/src/components/`（controls.tsx、PageHeader）。
4. 漫画风变量的来源：`apps/site/src/styles/landing.css` 开头的“粗线版”变量（`--frame`、`--bw`、`--x2`…`--x10`、`--b3`…`--b10`、`--deep`、`--acc2`）。
5. 仓库约定 `AGENTS.md`、`docs/client.md` 的网页端部分、`docs/development.md` 里的命令。

读完先用 plan 模式给我一份计划：要改哪些文件、新建哪些、删哪些、分几次提交、每次提交后能看到什么。我确认以后再开始写。

## 分步

### 1. 变量和基础部件

- 在 `theme/tokens.css` 加上粗线版的变量（从 landing.css 搬过来），三种网点底做成变量或工具类。硬投影的颜色也走变量，方便以后调夜间模式。
- 夜间模式先按 README“要定的事”第 1 条的建议做：墨和纸对调，蓝用 `#8597FF`。
- `components/controls.tsx` 里现有的部件（Button、IconButton、Chip、Pill、Field、Segmented 等）换成粗线样式，接口不变，调用的地方不用改。
- 新增部件：格子 Panel（五种底，加“热”的大投影）、对话气泡 Bubble（尾巴在左下、右下或上面；左上角写说话人；蓝底变体）、旁白框 Caption、键帽 Keycap、人物位 Portrait（有角色卡头像就用头像，没有就用大号的姓压在网点底上）、底部提示条 HintBar。

### 2. 外壳和轮盘

- 纯逻辑单独放一个文件（比如 `theme/wheel.ts`），不依赖 React 和 DOM，用 `node --test` 测，测行为：
  - 角度换算成第几块（从正上方开始顺时针，每块 60°；光标离圆心超过内半径才算选中）；
  - 靠边时展开，圆心往里挪到哪（离每条边至少 204）；
  - 松手时离左右边 40 以内就贴边；
  - 按住多久算拖动（0.4 秒）；
  - 位置的存和取：窗口尺寸变了要重新夹回窗口里。
- 组件 `shell/NavWheel.tsx`：收起的圆、展开的圆盘和 6 块扇区（用 SVG 画，描边和硬投影要和稿子一致）；悬停 120ms 展开、离开 0.3 秒收起；说明气泡；键盘（Q、1–6、方向键、Enter、Esc，走现有的 `acceptsSingleKey` 和单键快捷键开关）；长按拖动（pointer events 加 `setPointerCapture`）；触屏点按；ARIA（按钮加 menu / menuitem）；`prefers-reduced-motion`。
- `AppShell`：窗口 ≥ 900 时不再画侧栏，改画轮盘。主内容在轮盘贴的那一边留 112，另一边 40；轮盘没贴边时两边都是 40。`layout.ts` 里侧栏的 sidebar、rail 两档，以及 `setNavOverride`（阅读页、草稿页在用）一起去掉或改掉。偏好设置里的 `sidebarCollapsed` 换成轮盘的位置。
- 窗口 < 900 时，Tab 栏和账户小窗先保持现在的样子，只是用上新的变量。
- 删掉不再用的代码：`Sidebar.tsx`、只有侧栏在用的 `StoryRow`，`recent.ts` 里只给侧栏分组用的函数（`byRecent` 存档页还在用，留着），连同对应的测试、侧栏的样式和 i18n 键。快捷键表里“展开或收起侧栏”换成轮盘的几条。

### 3. 一级页

- `PageHeader` 改成新的页头：左边是标题加数量，右边是这一页的工具。所有页面共用。
- 新增漫画格子的排版：6 列 × 3 行，按页分配每一项占哪几格，翻页（← → 也能翻），不无限滚动。“哪一项占哪几格”写成纯函数，用 `node --test` 测。
- 按稿子逐页改：存档（`pages/stories`）、剧本和角色（`pages/library`）、工作台首页（`WorkbenchHome`）、模型（`ModelsPage`：外部服务的入口去掉，加上“添加模型”三步那一格）、设置（`SettingsPage`：加上账户、阅读、外部服务三格）。外部服务的页面（`ToolsPage`）挪到 `/settings/tools`，样式换成粗线，旧地址 `/tools` 跳转过去。
- 只用现有接口的数据。存档的摘录用 `head_excerpt`，回合数用 `head_seq`，主角名用 `protagonist_name`。稿子上有、接口里没有的东西（章节名、角色最近说的一句话、人物 / 地点 / 事实 / 秘密的数量等），先不显示，或者换成最接近的现有字段。不要为这些加接口；做完在报告里列出来。

### 4. 阅读页

- `pages/play` 按稿子重排：页头一行；左栏是回想（L）；中间是分镜；右栏是“这一话的人物”和“刚记下的”；下面是选项卡和“自己写”；最底下是提示条。
- 现有的按键（A–D、/、W、End）和行为（流式输出、回退“回到这里”、失败重试、结局的 —END—）全部保留，只改排法和样式。
- 分镜第一版：叙述的每一段放进一个旁白框，玩家的行动是靠右的蓝气泡。不做说话人识别，也不做拟声词。
- W 照旧打开完整的世界面板（滑出），样式换成粗线。

### 5. 没出稿的页面

剧本详情、角色卡详情、草稿页、模型详情对话框、登录注册、404、对话框、菜单、提示浮条：布局不动，换成新部件和新变量。同一个画面里不要出现新旧两种风格混在一起。

### 6. 文档

- 更新 `docs/client.md` 里网页端外壳和导航的部分。
- 在 `docs/design/ui/web/README.md` 开头注明：电脑端已经改用 `docs/design/comic/`。
- 新加的界面文字写进 `packages/core/src/i18n/` 的中文和英文资源。

## 约定

- 界面文字一律走 i18n，组件里用 `t()`；`make lint` 里的检查会拦住写死的中文。
- 纯逻辑用 `node --test` 测，测行为，不测实现文本。单个文件超过约 600 行就拆开。
- 不画插画，也不加图片素材；人物位用占位，封面用现有的 `Cover`。
- 不要斜切，不要模糊阴影，不要渐变。
- 每一步做完提交一次。提交信息的类型前缀用英文（比如 `feat(web): …`），正文用中文。不要 push。

## 验收

- 在 1440×900 的浏览器里，九个画面和 `docs/design/comic/png` 对得上：布局、颜色、描边、投影、字体都要对。用 Playwright 截图对照，截图放进最后的报告。
- 轮盘的每条规则都能实际操作到：悬停展开和收起的延迟、靠边时往里挪、防误选、1–6、方向键、Esc、长按拖动、贴边、刷新后位置还在、触屏点按。
- 窗口宽 900、1280、1440、1920 时都没有横向滚动，也没有东西重叠；窄于 900 时和现在一样。
- 夜间模式能正常用。
- `make lint`、类型检查、`node --test` 和网页端的构建全部通过。
- 最后给我一份报告：做了什么；哪里和稿子不一样、为什么；接口里缺哪些数据。

---

## 追加：登录、注册、验证邮箱

把 `apps/web/src/pages/auth/` 改成 `docs/design/comic/png/10`–`12` 的样子。

### 先读

1. `docs/design/comic/README.md` 的“登录页”一节，和 `png/10-login.png`、`png/11-register.png`、`png/12-verify.png`。
2. `docs/design/comic/source/ComicAuth.dc.html`：里面是生成好的 SVG，地图、关系图、文稿的具体形状和数值以它为准。
3. 现在的 `pages/auth/`：`AuthLayout.tsx`、`LoginPage.tsx`、`RegisterPage.tsx`、`VerifyPage.tsx`、`ForgotPage.tsx`、`ServerSwitch.tsx`、`auth.module.css`。

动手前先给我一份简短的计划，我确认后再写。

### 要做的

- `AuthLayout`：窗口 ≥ 900 时是两格漫画，左格是桌面，右格是表单；去掉现在的 `Art` 插画。窗口 < 900 时不显示左格，只留表单，排法和现在的窄屏一样。
- 桌面写成一个组件（比如 `pages/auth/Desk.tsx`）。地图、人物关系图、文稿、索引卡各自是一个只画 SVG 的小组件；胶带、图钉、蓝线放在最上层。注册页传一个参数，画“刚开始”的样子。
- 等高线、湖、河、字条这些看起来随机的形状，用固定种子的伪随机来生成：同一个种子每次画出来都一样。生成用的纯函数单独放一个文件，用 `node --test` 测行为：同一个种子结果相同，所有的点都落在画布里面。
- 左格里一个字也不要出现，不放图片，也不画插画。整个左格加 `aria-hidden`。
- 表单按稿子改：Logo 和名字、宋体大标题、输入框、主按钮（里面印 Enter 键帽）、次要按钮；验证码是 6 个格子。右格的底是一圈很淡的集中线。现有的 `ServerSwitch` 放在右格底部左边，三个条款链接放在右边。表单的校验、错误提示、跳转逻辑、服务器切换的行为都不改，只改排法和样式。
- 找回密码页（`ForgotPage`）没有单独出稿，用和验证邮箱一样的版式。
- 夜间模式下，桌面上的纸、底纹和描边都跟着现有的变量走。
- 界面文字照旧走 i18n。左格没有字，所以不需要新加文案。

### 验收

- 1440×900 下三页和 png 对得上。用 Playwright 截图对照，截图放进最后的报告。
- 窗口宽 900、1280、1920 时都不溢出；窄于 900 时只剩表单。
- 登录、注册、验证、找回密码和服务器切换的端到端测试都通过；`make lint`、类型检查、`node --test` 和构建全部通过。
- 更新 `docs/client.md` 里登录页的说明，把 `docs/design/comic/README.md` 的状态改成“10–12 已经实现”。
- 做完提交一次，不要 push。
