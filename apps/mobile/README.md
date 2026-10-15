# BetterTavern 客户端（React Native / Expo）

M1 的客户端：登录注册、剧本库与角色卡导入、故事列表、阅读主屏（流式叙述、两个选项、自由输入、停止、重试）、
密钥与导演模型设置。M0 的 SSE 探针移到了“设置 → 连接测试”（登录页的服务器地址旁边也能打开）。
实现与设计文档的差异见 [docs/client.md 第 3 节](../../docs/client.md)。

## 初始化

需要 Node 22.18 或更新版本（测试直接运行 TypeScript）。

```bash
cd apps/mobile
npm install        # 装 package.json 里的依赖（含 M1 新增的 expo-secure-store、expo-document-picker、@types/node）
npm run setup      # 可选：用 expo install 按 SDK 版本对齐各个 Expo 模块的版本
```

`expo-secure-store` 与 `expo-document-picker` 都包含在 Expo Go 里，不需要重新打开发版 App。

## 运行

1. 启动服务端（见 [docs/development.md](../../docs/development.md)），确认 `http://<电脑的局域网 IP>:8000/health` 在手机浏览器里能打开。
2. 把 `.env` 里的 `EXPO_PUBLIC_API_URL` 改成这个地址（也可以在登录页底部临时改，改过的地址存在手机上）。
3. `npm start`，用 Expo Go 或开发版 App 打开。
4. 注册 → 设置 → 模型 → 添加模型：选 DeepSeek 或 Hugging Face，填 Key（模型列表自动出来），选一个模型并设为导演
   → 剧本 → 导入角色卡（PNG 或 JSON）→ 填主角名字，开始故事。

蜂窝网络下手机要能从公网访问服务端，需要一个 https 地址（部署到有域名的服务器，或用一个 https 隧道）。
隧道和反向代理可能会缓冲 SSE：连接测试的结果如果是“轮询降级”，说明这一跳在缓冲，阅读页也会退化成每 1.5 秒轮询一次。

## M1 验收（真机）

- DeepSeek 与 Hugging Face 各完整玩 30 回合。
- 生成中切到飞行模式再切回来：叙述接着出，不重复、不缺字。
- 生成中把 App 切到后台或杀掉再打开：能接上这一轮，或者看到可以重试的失败。

## 测试

```bash
npm test           # node --test：SSE 解析与重连、回合状态机、PlaySession、令牌刷新、接口客户端
npm run typecheck
```

这些纯逻辑只用标准 Web API（fetch、TextDecoder、ReadableStream、AbortController），不依赖 RN，
所以用 Node 自带的测试运行器就能测。界面组件还没有自动化测试。

在电脑上可以用同一套探针逻辑先排除服务端和代理的问题：

```bash
npm run probe -- http://localhost:8000 20
```
