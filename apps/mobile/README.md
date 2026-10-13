# BetterTavern 客户端（React Native / Expo）

M0 阶段这里只有 SSE 探针：一个页面在真机上跑 3 分钟的长流，验证 RN 上的流式读取。正式的阅读主屏从 M1 开始加。

## 初始化

需要 Node 22.18 或更新版本（测试直接运行 TypeScript）。

```bash
cd apps/mobile
npm install        # 先装 expo 本体
npm run setup      # 用 expo install 按 SDK 版本装齐 expo-router、react、react-native 等依赖
```

`npm run setup` 会把依赖的确切版本写进 `package.json`，之后提交锁文件即可。

## 跑探针

1. 启动服务端（见仓库根目录的 README），确认 `http://<电脑的局域网 IP>:8000/v1/probe/time` 在手机浏览器里能打开。
2. `npm start`，用 Expo Go 或开发版 App 打开。
3. 在探针页填服务端地址，点“开始”；跑到一半点“模拟断线”，或者直接切到飞行模式再切回来。

验收标准（docs/client.md）：iOS 与 Android 真机，Wi-Fi 与蜂窝网络，各跑一次 3 分钟以上的长流；中文无乱码；
断网恢复后续传，拼出的文本与服务端一致；延迟 p95 小于 300 毫秒。页面最后会给出“通过 / 未通过”和各项数字。

蜂窝网络下手机要能从公网访问服务端，需要一个 https 地址（部署到有域名的服务器，或用一个 https 隧道）。
隧道和反向代理可能会缓冲 SSE，这正是探针要发现的问题：如果“方式”显示“轮询降级”，说明这一跳在缓冲。

在电脑上可以先用同一套逻辑跑一遍，排除服务端和代理的问题：

```bash
npm run probe -- http://localhost:8000 20
```

## 测试

```bash
npm test           # node --test，跑 src/ 下的 *.test.ts（SSE 帧解析、重连、续传）
npm run typecheck
```

SSE 解析和 SseClient 只用标准 Web API（TextDecoder、ReadableStream、AbortController），不依赖 RN，
所以用 Node 自带的测试运行器就能测；界面组件的测试（RNTL）从 M1 起加。
