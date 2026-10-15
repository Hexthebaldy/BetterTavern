/**
 * 网页端的端到端测试：真的后端（开发数据库）+ 假模型服务（apps/server/tests/fakes/story_llm.py）+ Vite 开发服务器，
 * 三个都由 Playwright 自己起（端口 8011、8021、5181，和平时开发用的错开；已经开着就直接用）。
 * 浏览器默认用本机装的 Chrome（channel: "chrome"），不用另外下载。测试注册的账号以 e2e- 开头，最后一步会删掉。
 * 设 E2E_ALL_BROWSERS=1 时再跑 WebKit（Safari 的内核）和 Firefox，要先 npx playwright install webkit firefox。
 *
 *   cd apps/web && npm run e2e
 */

import { defineConfig, devices } from "@playwright/test";

const API = "http://127.0.0.1:8011";
const WEB = "http://localhost:5181";
const VIEWPORT = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chrome", use: { channel: "chrome", viewport: VIEWPORT } },
    ...(process.env.E2E_ALL_BROWSERS
      ? [
          { name: "webkit", use: { ...devices["Desktop Safari"], viewport: VIEWPORT } },
          { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: VIEWPORT } },
        ]
      : []),
  ],
  webServer: [
    {
      command: "uv run --directory ../server python -m tests.fakes.story_llm --port 8021 --delay 0.01",
      url: "http://127.0.0.1:8021/v1/models",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "uv run --directory ../server bettertavern serve --host 127.0.0.1 --port 8011",
      url: `${API}/health`,
      env: {
        ENV: "dev",
        ALLOW_PRIVATE_ENDPOINTS: "true",
        RATE_LIMIT_AUTH_PER_MIN: "100",
        LOG_LEVEL: "WARNING",
      },
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npx vite --port 5181 --strictPort",
      url: WEB,
      env: { BT_API_URL: API },
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
