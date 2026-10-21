# BetterTavern 客户端（React Native / Expo）

手机端（iPhone、Android、iPad）：登录注册、剧本库与角色卡导入和编辑、故事列表、阅读主屏（流式叙述、两个选项、自由输入、停止、重试、
写结局、回到更早的一段、世界状态面板）、模型设置（导演模型、后台整理模型）、外观和语言。
M0 的 SSE 探针在“设置 → 连接测试”里（登录页的服务器地址旁边也能打开）。实现与设计文档的差异见 [docs/client.md 第 3 节](../../docs/client.md)。

## 初始化

需要 Node 22.18 或更新版本（测试直接运行 TypeScript）。

手机端和 `packages/`（和网页端共用的纯逻辑、设计数据）是同一个 npm 工作区，依赖装在仓库根目录，锁文件也在根目录：

```bash
npm install
```

可选：在 `apps/mobile` 下 `npm run setup`，用 expo install 按 SDK 版本对齐各个 Expo 模块的版本。

`expo-secure-store` 与 `expo-document-picker` 都包含在 Expo Go 里，不需要重新打开发版 App。

## 运行

1. 启动服务端（见 [docs/development.md](../../docs/development.md)），确认 `http://<电脑的局域网 IP>:8000/health` 在手机浏览器里能打开。
2. 把 `.env` 里的 `EXPO_PUBLIC_API_URL` 改成这个地址（也可以在登录页底部临时改，改过的地址存在手机上）。
3. `npm start`，用 Expo Go 或开发版 App 打开。
4. 注册 → 设置 → 模型 → 添加模型：选服务商（DeepSeek、OpenAI、Grok、Gemini、Hugging Face 或自定义兼容端点），填 Key（模型列表自动出来），
   选一个模型并设为导演 → 剧本 → 导入角色卡（PNG 或 JSON）→ 填主角名字，开始故事。
   世界状态要随剧情更新，服务端还要开着 worker；后台用的模型必须能调用工具（模型详情里“测试这个模型”可以确认）。

蜂窝网络下手机要能从公网访问服务端，需要一个 https 地址（部署到有域名的服务器，或用一个 https 隧道）。
隧道和反向代理可能会缓冲 SSE：连接测试的结果如果是“轮询降级”，说明这一跳在缓冲，阅读页也会退化成每 1.5 秒轮询一次。

## 打包 Android 安装包（APK）

用 EAS Build 在 Expo 的服务器上打包，配置在 `eas.json` 的 `preview`：

- 出一个能直接安装的 APK（不经过应用商店）；
- 不带默认服务器地址，用户在登录页底部填自己的服务器；
- 允许连 `http://` 的局域网服务器（Android 9 起正式包默认只许 https，`app.config.ts` 里用 `expo-build-properties` 放开）；
- 每打一次，版本号（versionCode）在 EAS 上自动加一，新包可以直接覆盖安装旧包。

`app.config.ts` 已经连上作者 Expo 账号下的项目（`owner` 和 `extra.eas.projectId`），作者登录以后直接打包。
用自己的账号打包时，先删掉这两项，再登录、在 Expo 上建项目（在 `apps/mobile` 下）：

```bash
npx eas-cli@latest login
npx eas-cli@latest init --account <你的账号>
```

把 `init` 输出的 projectId 和账号名填回 `app.config.ts`（配置是 TypeScript 写的，EAS 不会自己改）。之后每次打包：

```bash
npx eas-cli@latest build -p android --profile preview
```

第一次打包时选择让 EAS 生成签名密钥并替你保管。以后的版本都用这把密钥签名，用户才能直接装上更新；换了密钥，用户要先卸载旧版。
打完后终端和 expo.dev 上都有下载链接。

发给大家用：安装包和落地页放在同一台服务器上，文件名固定叫 `BetterTavern.apk`，放在站点目录的 `downloads/` 里
（nginx 给这个目录单独配一条规则：直接下载，没有文件时返回 404，不要退回首页）。落地页上的下载按钮指向它，
发新版时覆盖这个文件就行，不用改落地页。安装包不进仓库。发之前先在 Android 真机上装一遍，按下面的验收清单走一遍。

## 真机验收清单（M1 的出口标准）

- DeepSeek 与 Hugging Face 各完整玩 30 回合。
- 生成中切到飞行模式再切回来：叙述接着出，不重复、不缺字。
- 生成中把 App 切到后台或杀掉再打开：能接上这一轮，或者看到可以重试的失败。

## 测试

在仓库根目录：

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` 跑所有工作区的 `node --test`：SSE 解析与重连、回合状态机、PlaySession、令牌刷新、接口客户端在 `packages/core`，
布局和主题在 `packages/design`。这些纯逻辑只用标准 Web API（fetch、TextDecoder、ReadableStream、AbortController），不依赖 RN，
所以用 Node 自带的测试运行器就能测。界面组件还没有自动化测试。

在电脑上可以用同一套探针逻辑先排除服务端和代理的问题（在 `apps/mobile` 下）：

```bash
npm run probe -- http://localhost:8000 20
```
