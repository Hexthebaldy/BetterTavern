/**
 * 落地页的冒烟测试：打开构建出的页面（apps/site/dist）点一遍。页面放在 /BetterTavern/ 子路径下，和 GitHub Pages 一样，
 * 顺便确认资源用的是相对路径。浏览器用本机装的 Chrome（channel: "chrome"），不用另外下载。
 * 先构建再测：make site-e2e（或 npm run build && npm run e2e）。
 */

import { defineConfig } from "@playwright/test";

const PORT = 4184;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}/BetterTavern/`,
    channel: "chrome",
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort --base /BetterTavern/`,
    url: `http://localhost:${PORT}/BetterTavern/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
