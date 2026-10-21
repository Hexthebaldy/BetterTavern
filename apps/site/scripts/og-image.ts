/**
 * 生成分享配图（链接发到社交网站时的预览图，1200×630）：三种语言各一张，写进 public/og/<语言>.png，构建时原样复制到 dist/og/。
 * 样式照落地页首屏：方格纸底、斜放的蓝色网点板、黑边招牌（标志和带蓝色立体边的字），下面是这种语言的一句话介绍和平台。
 * 用本机的 Chrome（Playwright 的 channel: "chrome"）画好再截图；字体用 @fontsource 托管的思源宋体 900。
 * 改了文案或样式以后重新生成：npm run og-image（在 apps/site 下）。
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

import { LOGO } from "../../../packages/design/src/logo.ts";
import { COPIES } from "../src/i18n/all.ts";
import { LANGS, LANG_META, type Lang } from "../src/i18n/langs.ts";

const WIDTH = 1200;
const HEIGHT = 630;
const out = new URL("../public/og/", import.meta.url);
const serifCss = new URL("../node_modules/@fontsource/noto-serif-sc/900.css", import.meta.url);
// 工作区的依赖装在仓库根目录
const rootSerifCss = new URL("../../../node_modules/@fontsource/noto-serif-sc/900.css", import.meta.url);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 一种语言的配图页面。tagline 取标题“BetterTavern · ”后面那半句 */
function pageHtml(lang: Lang, cssHref: string): string {
  const copy = COPIES[lang];
  const tagline = copy.meta.title.split(" · ").slice(1).join(" · ") || copy.meta.title;
  const sans =
    lang === "ja"
      ? `"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif`
      : `"PingFang SC","Hiragino Sans GB","Noto Sans SC",system-ui,sans-serif`;
  // 招牌的硬投影：一像素一层叠出来（和落地页一样）
  const plateShadow = Array.from({ length: 14 }, (_, i) => `${i + 1}px ${i + 1}px 0 #1A1A1A`).join(",");
  const extrude = Array.from({ length: 10 }, (_, i) => {
    const t = (i + 1) / 10;
    const c = [Math.round(56 - 29 * t), Math.round(91 - 39 * t), Math.round(241 - 75 * t)];
    return `${(i + 1) * 0.9}px ${(i + 1) * 0.9}px 0 rgb(${c.join(",")})`;
  }).join(",");
  return `<!doctype html>
<html lang="${LANG_META[lang].html}">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="${cssHref}" />
<style>
  *{box-sizing:border-box;margin:0}
  html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}
  body{position:relative;background-color:#FFFFFF;background-image:linear-gradient(#EFEFEB 1px,transparent 1px),linear-gradient(90deg,#EFEFEB 1px,transparent 1px);background-size:30px 30px;font-family:${sans};color:#1A1A1A}
  .board{position:absolute;right:-140px;top:-60px;width:460px;height:760px;border:4px solid #1A1A1A;border-radius:28px;background-color:#2F55F4;background-image:radial-gradient(rgba(255,255,255,.28) 2px,transparent 2.6px);background-size:16px 16px;transform:rotate(12deg);box-shadow:12px 12px 0 #1A1A1A}
  .copy{position:absolute;left:84px;top:118px;display:flex;flex-direction:column;align-items:flex-start;gap:44px}
  .plate{display:inline-flex;align-items:center;gap:20px;padding:20px 40px 30px 30px;border:5px solid #1A1A1A;border-radius:44px;background:#FFFFFF;box-shadow:${plateShadow}}
  .plate svg{width:88px;height:88px;flex:none;margin-top:6px}
  .plate h1{font-family:"Noto Serif SC",serif;font-weight:900;font-size:104px;line-height:1.1;letter-spacing:-.02em;white-space:nowrap;text-shadow:${extrude}}
  .tag{max-width:760px;text-wrap:balance;word-break:auto-phrase;font-size:${lang === "ja" ? 42 : 46}px;line-height:1.35;font-weight:700}
  .meta{display:inline-flex;align-items:center;gap:14px;font-size:28px;font-weight:600;color:#3D3C38}
  .meta i{width:14px;height:14px;background:#2F55F4;transform:rotate(45deg)}
</style>
</head>
<body>
  <div class="board"></div>
  <div class="copy">
    <div class="plate">
      <svg viewBox="${LOGO.viewBox}" aria-hidden="true">
        <g fill="none" stroke="#1A1A1A" stroke-linejoin="miter" stroke-miterlimit="4">
          <path d="${LOGO.frameA}" stroke-width="${LOGO.frameStroke}" />
          <path d="${LOGO.frameB}" stroke-width="${LOGO.frameStroke}" />
          <path d="${LOGO.inner}" stroke-width="${LOGO.innerStroke}" />
        </g>
        <path d="${LOGO.core}" fill="#2F55F4" />
      </svg>
      <h1>BetterTavern</h1>
    </div>
    <p class="tag">${escapeHtml(tagline)}</p>
    <p class="meta"><i></i>${escapeHtml(copy.hero.platforms)}</p>
  </div>
</body>
</html>`;
}

const css = existsSync(fileURLToPath(serifCss)) ? serifCss : rootSerifCss;
await mkdir(out, { recursive: true });
// 页面写成本地文件再打开：本地页面才能加载本地的字体文件
const tmp = await mkdtemp(path.join(tmpdir(), "bt-og-"));
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  for (const lang of LANGS) {
    const html = path.join(tmp, `${lang}.html`);
    await writeFile(html, pageHtml(lang, css.href));
    await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const file = new URL(`${lang}.png`, out);
    await page.screenshot({ path: fileURLToPath(file) });
    console.log(`og-image: public/og/${lang}.png`);
  }
} finally {
  await browser.close();
  await rm(tmp, { recursive: true, force: true });
}
