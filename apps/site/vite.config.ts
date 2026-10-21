/**
 * 落地页的构建：资源用相对路径（base: "./"），放在子路径下也能打开，比如 GitHub Pages 的 /BetterTavern/。
 * npm run build 先打包浏览器用的代码，再打包一份给 Node 用的（--ssr），由 scripts/prerender.ts 把整页渲染进 dist/index.html。
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5174 },
  preview: { port: 4174 },
  // 共用包是 TypeScript 源码，打进给 Node 用的那份里，不让 Node 直接去加载
  ssr: { noExternal: ["@bettertavern/design"] },
});
