/**
 * 落地页的构建：资源用相对路径（base: "./"），放在子路径下也能打开，比如 GitHub Pages 的 /BetterTavern/。
 * npm run build 先打包浏览器用的代码，再打包一份给 Node 用的（--ssr），由 scripts/prerender.ts 把整页渲染进 dist/index.html。
 * 三种语言各一个页面：中文是 /，英文 en/，日文 ja/，都由 prerender 从同一份 index.html 生成。
 * 托管字体的样式表只留页面上用得到的片（scripts/fontFaces.ts）。
 */

import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { fontSubsets } from "./scripts/fontFaces.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    fontSubsets({
      // 思源宋体和等宽字体：中文、英文页上的字（日文页的标题用 Noto Serif JP，日文文案不算进来）
      default: { include: [here("./src"), here("./index.html")], skip: [here("./src/i18n/ja")] },
      "noto-serif-jp": { include: [here("./src/i18n/ja")] },
    }),
  ],
  server: { port: 5174 },
  preview: { port: 4174 },
  // 共用包是 TypeScript 源码，打进给 Node 用的那份里，不让 Node 直接去加载
  ssr: { noExternal: ["@bettertavern/design"] },
});
