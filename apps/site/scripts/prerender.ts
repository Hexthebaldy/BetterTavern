/**
 * 构建的最后一步：用 vite build --ssr 打出的 dist/.ssr/entry-server.js 把整页渲染成 HTML，
 * 填进 dist/index.html 的 <div id="root"></div>，然后删掉 dist/.ssr。
 * 这样不开 JS 也能看到全部文字，搜索引擎和链接预览读得到；浏览器里 main.tsx 再接上交互（hydrate）。
 */

import { readFile, rm, writeFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const ssr = new URL(".ssr/", dist);
const ROOT = '<div id="root"></div>';

const { render } = (await import(new URL("entry-server.js", ssr).href)) as { render: () => Promise<string> };
const page = new URL("index.html", dist);
const template = await readFile(page, "utf8");
if (!template.includes(ROOT)) throw new Error(`dist/index.html 里找不到 ${ROOT}`);

const html = await render();
await writeFile(page, template.replace(ROOT, `<div id="root">${html}</div>`));
await rm(ssr, { recursive: true, force: true });
console.log(`prerender: dist/index.html（正文 ${Math.round(html.length / 1024)} KB）`);
