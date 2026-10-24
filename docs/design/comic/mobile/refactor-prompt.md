# 重构提示词：App 改成漫画风格（手机和平板）

把下面整段交给 Claude Code（在仓库根目录打开）。也可以只说一句“按 docs/design/comic/mobile/refactor-prompt.md 做”。

手机和平板是同一套代码，这份提示词两边一起做；平板横屏特有的几处在第 6 步。

---

## 任务

把 App（`apps/mobile`）的界面从“白 / 柔线 / 大圆角”换成和网页端同一套漫画风：墨黑粗描边、硬投影、网点。**只换风格**：页面结构、布局、交互和数据都沿用现在的方案。手机和平板竖屏按 `docs/design/comic/mobile/`，平板横屏（窗口 ≥ 900）按 `docs/design/comic/tablet/`。

结构上只有三处变化：

- 底部 Tab 栏的第二块“剧本”改叫“库”（路由还是 `library`）；
- 宽屏的左侧导航栏从 4 块改成 6 块（存档、剧本、角色、工作台、模型、设置），上下居中，不放 Logo；
- 平板横屏登录页左边的插画区换成网页登录页那张桌面。

这次只改 App 的界面。服务端、接口、`apps/site` 不动；`apps/web` 只动第 2、6 步里点名的几处。

## 先读

1. `docs/design/comic/mobile/README.md`：视觉规则、Tab 栏、阅读页、各页要点（带对应的代码）、夜间、和现在代码不一样的地方、要定的事。精确数值以 `source/*.dc.html` 为准。
2. `docs/design/comic/mobile/png/01`…`51`：手机的 2x 截图（屏幕 390×844）；`01-spec.png` 是部件和规格。
3. `docs/design/comic/tablet/README.md` 和 `png/01`…`19`：平板横屏（1194×834），侧栏 6 块的对应表和实现要点都在里面。
4. 网页端已经做好的漫画版，照它的写法：`apps/web/src/theme/tokens.css` 的“漫画分镜版”一段（变量）、`apps/web/src/components/comic.tsx` 和 `controls.tsx`（部件）、`apps/web/src/pages/auth/`（登录页的桌面）、`docs/client.md` 第 4 节。
5. 现在的 App：`src/theme/`（`index.ts` 开头的说明、`ThemeProvider.tsx`、`fonts.ts`）、`packages/design/src/`（`tokens.ts`、`palettes.ts`、`themes.ts`、`layout.ts`、`icons.ts`）、`src/components/`（`ui.tsx` 开头写了每个文件放什么），然后是 `app/` 的路由和 `src/features/` 下的各页。
6. 仓库约定 `AGENTS.md`、`docs/client.md` 第 1–3 节（手机端）、`docs/i18n.md`、`docs/development.md` 里的命令。

读完先用 plan 模式给我一份计划：要改哪些文件、新建哪些、删哪些、分几次提交、每次提交后能看到什么。我确认以后再开始写。

## 先这样定

README 最后“要定的事”先按下面做：

- 字体不动：不打包新字体，也不换成别的系统字体。稿子里宋体 900 的标题用现在的标题字（系统黑体的粗体），字号照稿子；阅读正文照旧用打包的宋体，跟着阅读设置走；稿子里等宽 700 的地方用现有的 500。
- 不用 iOS 26 的液态玻璃：Tab 栏和侧栏照稿子画。
- 平板竖屏（600–899）没有单独出稿：用手机稿的样式套现在中屏的布局（居中单栏、底部 4 块）。
- 图片都是占位：不画插画，不加图片素材。封面用现有的几何封面（`Cover`），人物位是大号的姓压在网点底上，工作台的封面候选是灰色占位格。

## 分步

### 1. 变量和基础部件

- 漫画风的数值加进 `packages/design`（比如新文件 `comic.ts`）：描边（2.5 / 2 / 1.5）、硬投影（墨色、蓝色，1–8 层）、圆角、网点。色板（`Palette`）里没有的颜色（页面底色、选项的灰、没选中的图标、浅蓝、选中行的底、不能点的灰、出错输入框的底、删除按钮的红、酒红、深绿……）单独放一张表，浅色、夜间各一套，按 `ThemeId` 取。不要加进 `Palette`：网页端会把 `Palette` 的每个字段写成同名的 CSS 变量（`apps/web/src/theme/palette.ts`），和 `tokens.css` 里的漫画变量（`--page`、`--grey`、`--sky`…）重名时会把它们盖掉。白天和夜间的完整对照在 `mobile/source/MobNight.dc.html` 样式里的 `:root{…}`（白天）和 `.N{…}`（夜间）两行。
- 硬投影用 `boxShadow`（新架构直接支持，色板里的投影已经这么写）叠成一像素一层（`1px 1px 0 墨, 2px 2px 0 墨, …`），转角处是连着的。不用模糊阴影，也不用 `elevation`。投影画在格子外面，外层容器要给它留出位置，别被 `overflow: hidden` 裁掉。
- 按下的效果：往投影的方向挪 3，投影从 4 缩到 1，松手弹回；选项按下时变成墨底白字。不缩放、不改透明度。现在按下时缩小（`transform: [{ scale: pressed ? 0.97 : 1 }]`，也有 0.98、0.95）散在 `src/components/`、`src/features/` 和 `app/` 的二十来个文件里，全部换掉；按下的效果写成一个共用的部件或 hook，不要每处各写一遍。面板弹出、长按卡片浮起这些动画不是按下的效果，照稿子留着。
- `src/components/` 的部件换成粗线样式，接口尽量不变，调用的地方不用改：`Page`（页面底色）、`Button`、`IconButton`、`Group`、`ListRow`、`Field`、`Segmented`、`Chip`、`Pill`、`Tag`、`Checkbox`、`Toggle`、`Notice`、`ErrorState`、`Sheet`、`Dialog`、浮条和长按菜单（`overlay.tsx`）、`SwipeRow`、`Cover`。数值见 README 的“视觉规则”和 `png/01-spec.png`。根布局和标签页的底色（`app/_layout.tsx`、`app/(tabs)/_layout.tsx` 里用的 `palette.bg`）换成页面底色，切页时不闪白。
- 图标：线宽 2.2（网页漫画版也是 2.2；两端共用的 `stroke.icon` 是 1.75，别直接改它，改手机端 `Icon` 的默认值）。Tab 栏和侧栏选中时用实心图标：给 `packages/design/src/icons.ts` 加一份实心版（存档、库、工作台、设置，平板侧栏还有剧本 `card`、模型 `director`），主体填蓝，墨色描边不变，挖空的地方是白的；几何照 `mobile/source/MobSpec.dc.html`、`tablet/source/TabSpec.dc.html` 里 Tab 栏和侧栏的 SVG。
- 纯数据和纯函数用 `node --test` 测（比如每个颜色都有夜间的值、硬投影的层数）。
- `tokens.ts` 里“白 / 柔线 / 大圆角”的圆角阶梯、字号这些，两端都不再用的删掉；`ui.tsx`、`theme/index.ts` 开头的说明改成新的规则。

### 2. Tab 栏和导航（`src/components/bars.tsx`）

- 手机和中屏的底部 Tab 栏：位置和大小不变（`tabBarBottom()`、`useTabBarSpace()` 不改）。白底、2.5 墨线、圆角 32、墨色硬投影 4；选中是实心蓝图标加墨色粗字（800），没选中是墨灰图标加灰字（500）；不加胶囊、不加底色、没有滑动的选中框。
- 去掉滑动的选中框（`useGlass`）和液态玻璃（`GlassView`）两条路径。`expo-glass-effect` 别处没用，从 `apps/mobile/package.json` 去掉；色板里只给旧的选中样式用的 `tabOn`、`tabGlassEdge`、`tabGlassShadow`、`tabCapsuleShadow` 也删掉（网页端已经不用，`apps/web/src/theme/tokens.css` 里只剩兜底值，一起删）。
- 宽屏（≥ 900）的左侧导航栏：照 `tablet/README.md` 的“左侧导航栏”和“实现要点”。6 块按一张表画，每项写清楚去哪个路由、带什么参数、什么时候算选中（`library` 带 `tab=cards` 是“角色”，`settings` 带 `section=models` 是“模型”）；这张表和“现在选中哪一块”写成不依赖 React Native 的纯函数，用 `node --test` 测。上下居中，去掉 `railLogo`。现在的 `onPress` 只在没选中这个路由时才跳；6 块以后点同一个路由的另一块，要比较参数，不同就带着新参数再导航一次。
- 一级页的大标题（`LargeHeader`）和二级页的导航栏（`NavBar`、`BackBar`）照稿子：导航栏底边 2.5 墨线、底色同页面，返回是 38 的图标按钮。
- 界面文字：`nav.library` 中文改成“库”、日文改成“ライブラリ”（英文已经是 Library）。网页的剧本详情页（`apps/web/src/pages/scenario/ScenarioPage.tsx`）在剧本还没取到时拿 `nav.library` 当标签页标题，改成 `nav.scenarios`。

### 3. 一级页

按 README“各页要点”的表逐页改：

- 存档（`app/(tabs)/playthroughs.tsx`、`src/features/stories/`）：手机是一列白底墨线格子；中屏和宽屏的网格、主卡在 `StoryCards.tsx`（宽屏见 `tablet/png/02`、`03`）。下拉刷新的手势照旧用系统的 `RefreshControl`，不要自己重写；稿子里“刷新中”的胶囊在刷新时浮在列表顶上。
- 库（`app/(tabs)/library.tsx`、`src/features/library/`）：大标题“库”，下面是“剧本 / 角色卡”两段切换和挪到工作台的提示条；网格、列表、长按菜单照稿子。宽屏不画两段切换，标题按 `tab` 显示“剧本”或“角色”，提示条只在“角色”出现（`tablet/png/04`、`05`）。
- 工作台首页（`app/(tabs)/workbench.tsx`）。
- 设置（`app/(tabs)/settings.tsx`、`src/features/settings/`）：设置首页的导演模型是墨底格加蓝投影 4，其他是格子里的列表行。宽屏右栏开哪一项现在是页面里的 `picked` 状态，改成也能从参数读：带 `section=models` 时左栏是模型列表（`ModelsBody`），点一行在右栏打开 `ModelBody`，默认打开导演模型；不带参数时左栏是设置首页（去掉导演模型格和“模型”一行，侧栏里有了），右栏默认打开账户（`tablet/png/14`、`15`）。窄屏和中屏照旧，忽略 `section`。

### 4. 阅读页（`app/play/[id]/index.tsx`、`src/features/play/`）

- 照 README 的“阅读页”一节改：正文和你的行动用同一种字、同一种墨色，行动只在左边多一道 3 的蓝线（现在是灰线、颜色浅一档）；选项是灰底墨线加硬投影，左边墨底字母块；还有底部操作栏、生成中、没写完、开场前、结局、更多、回到更早的一段、写结局、世界状态（`png/05`–`09`、`41`–`47`）。
- 现有的行为全部保留，只改样式：流式输出、停止、重试、跟随新文字和“回到最新”、回退、写结局、阅读设置（字体、字号、跟随系统字号）、闪电模式的存档没有世界状态。
- 平板：阅读栏、选项两列、世界状态滑出或停靠、更多贴着按钮弹出，都用现有的布局函数（`readableColumn`、`optionColumns`、`worldPresentation`），样子照 `tablet/png/06`–`09`。

### 5. 二级页和浮层

- 剧本详情和开始新的故事（`app/scenario/[id]/index.tsx`、`src/features/scenario/StartForm.tsx`）：五步，每步一个墨线格子，步骤号是墨底方块白字；第 2 步只有输入框。宽屏两栏，右栏底部浮着摘要栏（现有的 `floatingBar`）。
- 角色卡详情（`app/card/[id].tsx`）、新建剧本（`app/scenario/form.tsx`）。
- 工作台的草稿页（`app/workbench/[id].tsx`、`src/features/workbench/`）：Agent / 手动切换和四步、对话、问卷、方案、进度、写好了、改一改（原文半透明酒红底加删除线，改后半透明深绿底，和网页一样）、封面、手动模式。
- 设置的子页（`app/settings/*`、`src/features/settings/`）：模型、添加模型、模型详情（“能记住多少”的格子图）、外部服务、账户、外观和语言面板。
- 登录、注册、验证邮箱、找回密码（`app/(auth)/*`、`src/features/auth/parts.tsx`、`src/components/ServerSetting.tsx`）：排法不变，服务器行换成墨色虚线胶囊。
- 连接测试（`app/dev/probe.tsx`、`src/features/probe/`）没有出稿：布局不动，换成新部件。
- 同一个画面里不要新旧两种风格混在一起。

### 6. 平板横屏的其他几处

侧栏、库页、设置页、阅读页已经在前面几步里。另外：

- 两栏页面的详情区（`RaisedSurface`）换成稿子里的灰底 `#EFEFEA` 加白格子；左栏选中的一行浅蓝底、左边一道 3 的蓝线（`tablet/png/14`、`15`）。
- 登录、注册（`src/components/AuthLayout.tsx` 的 `AuthSplit`）：左边的插画区换成网页登录页那张桌面（地图、关系图、文稿、索引卡），去掉胶带；注册页画“刚开始”的样子。左格里一个字也不放（现在的 Logo 和介绍语去掉），对读屏隐藏；Logo 和名字挪到右边表单的顶上，登录和注册都有（现在 `login.tsx` 宽屏时不画 Logo，因为它在插画区里；`register.tsx` 本来就没有），介绍语不放。生成形状的纯函数 `apps/web/src/pages/auth/desk.ts` 不依赖 DOM：连同 `desk.test.ts` 挪到 `packages/design`，网页改成从那里引入；App 用 react-native-svg 照 `Desk.tsx`、`DeskSheets.tsx` 再画一份。尺寸和位置见 `tablet/README.md`“各页”表里 16–17 那一行。

### 7. 夜间

- 按 README 的“夜间”一节和 `MobNight.dc.html` 的对照表：墨和纸对调，硬投影跟着墨走（夜间是浅色的），墨底的格子（设置首页的导演模型格）跟着对调成浅色，结构不变。
- 稿子里没有的夜间颜色（比如平板详情区的灰底）照“墨和纸对调”取最接近的，列进报告。

### 8. 文档

- `docs/client.md` 第 3 节里写手机端外观的几段（主题、标签栏的 `tabOn` 和液态玻璃、平板、字体）改成现在的样子。
- `docs/design/ui/README.md` 和 `docs/design/ui/tablet/README.md` 开头注明：App 已经改用 `docs/design/comic/mobile/` 和 `tablet/`。
- `docs/design/comic/mobile/README.md`、`tablet/README.md` 的状态改成已经实现，和稿子不一样的地方记在 `docs/client.md`。
- 新加的界面文字写进 `packages/core/src/i18n/` 的中文、英文、日文资源（三种语言的键要一一对应，`i18n.test.ts` 会查）；不再用的键删掉。

## 约定

- 界面文字一律走 i18n，组件里用 `t()`；`make lint` 里的 `scripts/check-i18n.mjs` 会拦住写死的中文。
- 只改样式：路由、接口、数据、状态机、手势和各页的行为都不改。稿子上有、接口里没有的东西，先不显示或者换成最接近的现有字段，不要为这些加接口；做完在报告里列出来。
- 纯逻辑用 `node --test` 测，测行为，不测实现文本，测试不读源码。单个文件超过约 600 行就拆开（`primitives.tsx` 已经 606 行，`bars.tsx`、`sheet.tsx`、`overlay.tsx` 都在 540 行左右，改的时候顺手拆）。
- 不要渐变、模糊阴影、纸纹；按下不缩放、不改透明度。
- 每一步做完提交一次。提交信息的类型前缀用英文（比如 `feat(mobile): …`），正文用中文。不要 push。

## 验收

- 在模拟器里截图和稿子对照：390×844 左右的 iPhone 对 `mobile/png`，11 寸 iPad 横屏对 `tablet/png`。布局、颜色、描边、投影、圆角都要对（字体按上面定的）。后端照 `docs/development.md` 的“本地开发”起，没有模型 Key 就用假模型服务；截图用 `xcrun simctl io booted screenshot`，放进最后的报告。
- 窗口宽 390、600–899（iPad 竖屏、分屏）、1194、1376（13 寸横屏）时都不溢出、不重叠。转屏和分屏拖动时页面、参数、草稿、滚动位置都还在；横屏停在“角色”或“模型”时竖过来，落在库的“角色卡”或设置首页。
- 侧栏 6 块都能点到对的页面，选中项跟着路由和参数走。
- 现有的交互都还在：存档左滑、下拉刷新、长按菜单、流式输出、停止、重试、回到最新、回退、写结局、世界状态（手机底部面板、平板滑出、宽于 1100 停靠）、键盘弹起时的输入框。
- 夜间和跟随系统都正常；Android 模拟器上也看一遍硬投影和描边。
- `make lint`、`make js-typecheck`、`make js-test` 和 `make web-build` 全部通过。
- 最后给我一份报告：做了什么；哪里和稿子不一样、为什么；接口里缺哪些数据；稿子里没有、自己定的颜色和规则。
