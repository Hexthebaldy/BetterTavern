/**
 * 构建的最后一步：用 vite build --ssr 打出的 dist/.ssr/entry-server.js 把三种语言的整页各渲染成 HTML，
 * 填进 dist/index.html 的 <div id="root"></div>，按语言改好 <head>（scripts/head.ts），写成三个页面：
 * dist/index.html（中文）、dist/en/index.html、dist/ja/index.html；最后删掉 dist/.ssr。
 * 这样不开 JS 也能看到全部文字，搜索引擎和链接预览读得到；浏览器里 main.tsx 再接上交互（hydrate）。
 * 环境变量 SITE_URL（站点的绝对地址）给了时，页面里写上 canonical 和各语言版本的 hreflang。
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import type { Lang } from "../src/i18n/langs.ts";
import { LANG_META, LANGS } from "../src/i18n/langs.ts";
import type { Copy } from "../src/i18n/types.ts";
import { localizeHead, rebase } from "./head.ts";

const dist = new URL("../dist/", import.meta.url);
const ssr = new URL(".ssr/", dist);
const ROOT = '<div id="root"></div>';

const { render, COPIES } = (await import(new URL("entry-server.js", ssr).href)) as {
  render: (lang: Lang) => Promise<string>;
  COPIES: Record<Lang, Copy>;
};
const template = await readFile(new URL("index.html", dist), "utf8");
if (!template.includes(ROOT)) throw new Error(`dist/index.html 里找不到 ${ROOT}`);

for (const lang of LANGS) {
  const copy = COPIES[lang];
  const html = await render(lang);
  const head = localizeHead(template, {
    lang,
    title: copy.meta.title,
    description: copy.hero.lead,
    siteUrl: process.env.SITE_URL || undefined,
  });
  const dir = LANG_META[lang].dir;
  const page = (dir ? rebase(head) : head).replace(ROOT, () => `<div id="root">${html}</div>`);
  await mkdir(new URL(dir || ".", dist), { recursive: true });
  await writeFile(new URL(`${dir}index.html`, dist), page);
  console.log(`prerender: dist/${dir}index.html（${lang}，正文 ${Math.round(html.length / 1024)} KB）`);
}
await rm(ssr, { recursive: true, force: true });
