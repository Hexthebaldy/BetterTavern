/**
 * 构建的最后一步：用 vite build --ssr 打出的 dist/.ssr/entry-server.js 把三种语言的整页各渲染成 HTML，
 * 填进 dist/index.html 的 <div id="root"></div>，按语言改好 <head>（scripts/head.ts），写成三个页面：
 * dist/index.html（中文）、dist/en/index.html、dist/ja/index.html；最后删掉 dist/.ssr。
 * 这样不开 JS 也能看到全部文字，搜索引擎和链接预览读得到；浏览器里 main.tsx 再接上交互（hydrate）。
 * 另外写给搜索引擎的几个文件（scripts/seo.ts）：robots.txt、404.html；给了 SITE_URL 时还有 sitemap.xml。
 * 环境变量 SITE_URL（站点的绝对地址）给了时，页面里写上 canonical 和各语言版本的 hreflang。
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import type { Lang } from "../src/i18n/langs.ts";
import { LANG_META, LANGS } from "../src/i18n/langs.ts";
import type { Copy } from "../src/i18n/types.ts";
import { localizeHead, rebase } from "./head.ts";
import { normalizeSiteUrl, notFoundHtml, robotsTxt, sitemapXml } from "./seo.ts";

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
const siteUrl = process.env.SITE_URL || undefined;
// 404 页用站点图标：模板里是相对地址 ./assets/…，404 页出现在任意路径下，要换成从根目录算的地址
const icon = /<link rel="icon" href="\.\/([^"]+)"/.exec(template)?.[1];
const iconHref = icon && (siteUrl ? normalizeSiteUrl(siteUrl) : "/") + icon;
const files: [string, string][] = [
  ["robots.txt", robotsTxt(siteUrl)],
  ["404.html", notFoundHtml(COPIES, { siteUrl, iconHref })],
];
if (siteUrl) files.push(["sitemap.xml", sitemapXml(siteUrl)]);
for (const [name, content] of files) {
  await writeFile(new URL(name, dist), content);
  console.log(`prerender: dist/${name}`);
}
await rm(ssr, { recursive: true, force: true });
